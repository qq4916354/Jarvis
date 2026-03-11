/**
 * Jarvis Daemon Process
 *
 * Responsibilities:
 * 1. Launch and monitor the desktop application
 * 2. Auto-restart on crash/failure
 * 3. Watch error logs and invoke Claude Code to fix issues
 * 4. Manage heartbeat and health checks
 * 5. Coordinate self-upgrade process
 */

import { spawn, ChildProcess } from 'child_process';
import { createWriteStream, existsSync, mkdirSync, readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';
import { watch } from 'chokidar';
import { createLogger, format, transports } from 'winston';
import { EvolutionCoordinator, EvolutionConfig } from './evolution-coordinator';

// ─── Configuration ───────────────────────────────────────────────

const JARVIS_HOME = join(homedir(), '.jarvis');
const DATA_DIR = join(JARVIS_HOME, 'data');
const LOG_DIR = join(JARVIS_HOME, 'logs');
const PID_FILE = join(JARVIS_HOME, 'daemon.pid');
const DESKTOP_LOG = join(LOG_DIR, 'desktop.log');
const DAEMON_LOG = join(LOG_DIR, 'daemon.log');

const CONFIG_PATH = join(JARVIS_HOME, 'config.json');

interface DaemonConfig {
  desktopCommand: string;
  desktopArgs: string[];
  maxRestartAttempts: number;
  restartDelayMs: number;
  healthCheckIntervalMs: number;
  errorWatchEnabled: boolean;
  autoFixEnabled: boolean;
  ccCommand: string;
  webServerPort: number;
}

const DEFAULT_CONFIG: DaemonConfig = {
  desktopCommand: 'node',
  desktopArgs: [join(__dirname, '../../desktop/dist/server/index.js')],
  maxRestartAttempts: 5,
  restartDelayMs: 3000,
  healthCheckIntervalMs: 30000,
  errorWatchEnabled: true,
  autoFixEnabled: true,
  ccCommand: 'claude',
  webServerPort: 3927,
};

// ─── Logger ──────────────────────────────────────────────────────

function ensureDir(dir: string) {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

ensureDir(JARVIS_HOME);
ensureDir(DATA_DIR);
ensureDir(LOG_DIR);

const logger = createLogger({
  level: 'info',
  format: format.combine(
    format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss' }),
    format.printf(({ timestamp, level, message }) => `[${timestamp}] [DAEMON] ${level.toUpperCase()}: ${message}`)
  ),
  transports: [
    new transports.Console(),
    new transports.File({ filename: DAEMON_LOG, maxsize: 10 * 1024 * 1024, maxFiles: 5 }),
  ],
});

// ─── Daemon Class ────────────────────────────────────────────────

class JarvisDaemon {
  private config: DaemonConfig;
  private desktopProcess: ChildProcess | null = null;
  private restartCount = 0;
  private isShuttingDown = false;
  private healthCheckTimer: ReturnType<typeof setInterval> | null = null;
  private errorWatcher: ReturnType<typeof watch> | null = null;
  private recentErrors: string[] = [];
  private isFixing = false;
  private evolutionCoordinator: EvolutionCoordinator | null = null;

  constructor() {
    this.config = this.loadConfig();
    this.setupSignalHandlers();
  }

  private loadConfig(): DaemonConfig {
    try {
      if (existsSync(CONFIG_PATH)) {
        const raw = readFileSync(CONFIG_PATH, 'utf-8');
        const cfg = JSON.parse(raw);
        return { ...DEFAULT_CONFIG, ...cfg.daemon };
      }
    } catch (e) {
      logger.warn(`Failed to load config, using defaults: ${e}`);
    }
    return DEFAULT_CONFIG;
  }

  private setupSignalHandlers() {
    const shutdown = async (signal: string) => {
      logger.info(`Received ${signal}, shutting down...`);
      this.isShuttingDown = true;
      await this.stopEvolution();
      await this.stopDesktop();
      this.stopHealthCheck();
      this.stopErrorWatcher();
      this.removePidFile();
      process.exit(0);
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('uncaughtException', (err) => {
      logger.error(`Uncaught exception: ${err.message}\n${err.stack}`);
    });
  }

  // ─── PID Management ──────────────────────────────────────────

  private writePidFile() {
    writeFileSync(PID_FILE, process.pid.toString());
    logger.info(`Daemon PID: ${process.pid}`);
  }

  private removePidFile() {
    try {
      if (existsSync(PID_FILE)) {
        const { unlinkSync } = require('fs');
        unlinkSync(PID_FILE);
      }
    } catch { /* ignore */ }
  }

  // ─── Desktop Process Management ──────────────────────────────

  async startDesktop(): Promise<void> {
    if (this.desktopProcess) {
      logger.warn('Desktop already running');
      return;
    }

    logger.info(`Starting desktop app: ${this.config.desktopCommand} ${this.config.desktopArgs.join(' ')}`);

    const logStream = createWriteStream(DESKTOP_LOG, { flags: 'a' });

    this.desktopProcess = spawn(this.config.desktopCommand, this.config.desktopArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      env: {
        ...process.env,
        JARVIS_HOME,
        JARVIS_DAEMON_PID: process.pid.toString(),
        JARVIS_WEB_PORT: this.config.webServerPort.toString(),
      },
      detached: false,
    });

    this.desktopProcess.stdout?.pipe(logStream);
    this.desktopProcess.stderr?.on('data', (data: Buffer) => {
      const line = data.toString().trim();
      logStream.write(line + '\n');
      this.handleErrorOutput(line);
    });

    this.desktopProcess.on('exit', (code, signal) => {
      logger.info(`Desktop exited with code=${code} signal=${signal}`);
      this.desktopProcess = null;

      if (!this.isShuttingDown) {
        this.handleDesktopExit(code, signal);
      }
    });

    this.desktopProcess.on('error', (err) => {
      logger.error(`Desktop process error: ${err.message}`);
      this.desktopProcess = null;
      if (!this.isShuttingDown) {
        this.handleDesktopExit(1, null);
      }
    });

    this.restartCount = 0;
    logger.info(`Desktop started (PID: ${this.desktopProcess.pid})`);
  }

  async stopDesktop(): Promise<void> {
    if (!this.desktopProcess) return;

    logger.info('Stopping desktop app...');
    this.desktopProcess.kill('SIGTERM');

    await new Promise<void>((resolve) => {
      const timeout = setTimeout(() => {
        if (this.desktopProcess) {
          logger.warn('Force killing desktop app');
          this.desktopProcess.kill('SIGKILL');
        }
        resolve();
      }, 10000);

      this.desktopProcess?.on('exit', () => {
        clearTimeout(timeout);
        resolve();
      });
    });

    this.desktopProcess = null;
  }

  private async handleDesktopExit(code: number | null, signal: string | null) {
    if (this.restartCount >= this.config.maxRestartAttempts) {
      logger.error(`Desktop failed ${this.restartCount} times. Attempting auto-fix before giving up.`);

      if (this.config.autoFixEnabled) {
        const fixed = await this.attemptAutoFix('Desktop app crashed repeatedly');
        if (fixed) {
          this.restartCount = 0;
          await this.restartDesktop();
          return;
        }
      }

      logger.error('Auto-fix failed. Manual intervention required.');
      return;
    }

    this.restartCount++;
    const delay = this.config.restartDelayMs * this.restartCount;
    logger.info(`Restarting desktop in ${delay}ms (attempt ${this.restartCount}/${this.config.maxRestartAttempts})`);

    setTimeout(() => this.restartDesktop(), delay);
  }

  private async restartDesktop() {
    await this.stopDesktop();
    await this.startDesktop();
  }

  // ─── Error Detection & Auto-Fix ──────────────────────────────

  private handleErrorOutput(line: string) {
    const errorPatterns = [
      /Error:/i,
      /TypeError:/i,
      /ReferenceError:/i,
      /SyntaxError:/i,
      /FATAL/i,
      /Unhandled.*rejection/i,
      /Cannot find module/i,
    ];

    const isError = errorPatterns.some((p) => p.test(line));
    if (isError) {
      logger.warn(`Error detected in desktop output: ${line}`);
      this.recentErrors.push(line);

      // Keep only last 20 errors
      if (this.recentErrors.length > 20) {
        this.recentErrors = this.recentErrors.slice(-20);
      }
    }
  }

  private startErrorWatcher() {
    if (!this.config.errorWatchEnabled) return;

    this.errorWatcher = watch(DESKTOP_LOG, { persistent: true });
    logger.info('Error watcher started');
  }

  private stopErrorWatcher() {
    this.errorWatcher?.close();
    this.errorWatcher = null;
  }

  private async attemptAutoFix(context: string): Promise<boolean> {
    if (this.isFixing) {
      logger.info('Auto-fix already in progress, skipping');
      return false;
    }

    this.isFixing = true;
    logger.info(`Attempting auto-fix: ${context}`);

    try {
      const errorContext = this.recentErrors.join('\n');
      const prompt = `The Jarvis desktop application has encountered errors and needs to be fixed.

Context: ${context}

Recent errors:
${errorContext}

The desktop app source is in packages/desktop/.
Please analyze the errors and fix the code. After fixing, the app will be restarted automatically.
Only modify files that are directly related to the error.`;

      const result = await this.invokeClaudeCode(prompt);

      if (result.success) {
        logger.info('Auto-fix completed successfully');
        this.recentErrors = [];
        return true;
      } else {
        logger.error(`Auto-fix failed: ${result.error}`);
        return false;
      }
    } catch (err) {
      logger.error(`Auto-fix error: ${err}`);
      return false;
    } finally {
      this.isFixing = false;
    }
  }

  // ─── Claude Code Integration ─────────────────────────────────

  private invokeClaudeCode(prompt: string): Promise<{ success: boolean; output: string; error?: string }> {
    return new Promise((resolve) => {
      const ccProcess = spawn(this.config.ccCommand, ['--print', prompt], {
        cwd: join(__dirname, '../../..'),
        stdio: ['ignore', 'pipe', 'pipe'],
        timeout: 300000, // 5 min timeout
      });

      let stdout = '';
      let stderr = '';

      ccProcess.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      ccProcess.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      ccProcess.on('exit', (code) => {
        if (code === 0) {
          resolve({ success: true, output: stdout });
        } else {
          resolve({ success: false, output: stdout, error: stderr || `Exit code: ${code}` });
        }
      });

      ccProcess.on('error', (err) => {
        resolve({ success: false, output: '', error: err.message });
      });
    });
  }

  // ─── Health Check ────────────────────────────────────────────

  private startHealthCheck() {
    this.healthCheckTimer = setInterval(() => {
      this.performHealthCheck();
    }, this.config.healthCheckIntervalMs);

    logger.info(`Health check started (interval: ${this.config.healthCheckIntervalMs}ms)`);
  }

  private stopHealthCheck() {
    if (this.healthCheckTimer) {
      clearInterval(this.healthCheckTimer);
      this.healthCheckTimer = null;
    }
  }

  private async performHealthCheck() {
    const isHttpAlive = await this.checkHttpHealth();

    const status = {
      daemonPid: process.pid,
      desktopPid: this.desktopProcess?.pid ?? null,
      desktopRunning: this.desktopProcess !== null,
      httpAlive: isHttpAlive,
      restartCount: this.restartCount,
      recentErrorCount: this.recentErrors.length,
      uptime: process.uptime(),
      memoryUsage: process.memoryUsage(),
      timestamp: new Date().toISOString(),
    };

    const statusPath = join(JARVIS_HOME, 'status.json');
    writeFileSync(statusPath, JSON.stringify(status, null, 2));

    if (!status.desktopRunning && !this.isShuttingDown) {
      logger.warn('Health check: Desktop not running, attempting restart');
      this.restartDesktop();
    } else if (status.desktopRunning && !isHttpAlive && !this.isShuttingDown) {
      logger.warn('Health check: Process alive but HTTP unresponsive, scheduling restart');
      this.handleDesktopExit(1, null);
    }
  }

  private async checkHttpHealth(): Promise<boolean> {
    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 5000);
      const res = await fetch(`http://127.0.0.1:${this.config.webServerPort}/api/system/status`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);
      return res.ok;
    } catch {
      return false;
    }
  }

  // ─── Evolution Coordinator ─────────────────────────────────

  private initEvolutionCoordinator() {
    const evoConfigPath = join(JARVIS_HOME, 'evolution', 'config.json');
    let evoConfig: EvolutionConfig = {
      enabled: true,
      loopIntervalMinutes: 15,
      maxConcurrent: 1,
      planning: {
        anthropicAuthToken: '',
        anthropicBaseUrl: 'https://api.anthropic.com',
        model: 'claude-haiku-4-5-20251001',
      },
      execution: {
        anthropicAuthToken: '',
        anthropicBaseUrl: 'https://api.anthropic.com',
        model: 'claude-sonnet-4-6',
      },
      sourceDir: join(__dirname, '..', '..', '..'),
      worktreeBaseDir: join(JARVIS_HOME, 'evolution', 'worktrees'),
      maxHistoryRecords: 100,
    };

    try {
      if (existsSync(evoConfigPath)) {
        const raw = JSON.parse(readFileSync(evoConfigPath, 'utf-8'));
        evoConfig = { ...evoConfig, ...raw };
      }
    } catch (e) {
      logger.warn(`Failed to load evolution config: ${e}`);
    }

    this.evolutionCoordinator = new EvolutionCoordinator(evoConfig, {
      stopDesktop: () => this.stopDesktop(),
      startDesktop: () => this.startDesktop(),
      log: (message: string) => logger.info(`[Evolution] ${message}`),
    });

    this.evolutionCoordinator.on('status', (status: any) => {
      logger.debug(`[Evolution] Status update: phase=${status.phase} progress=${status.progress}`);
    });
  }

  private async startEvolution() {
    if (!this.evolutionCoordinator) {
      this.initEvolutionCoordinator();
    }
    try {
      await this.evolutionCoordinator!.start();
      logger.info('Evolution coordinator started');
    } catch (err) {
      logger.error(`Failed to start evolution coordinator: ${err}`);
    }
  }

  private async stopEvolution() {
    if (this.evolutionCoordinator) {
      await this.evolutionCoordinator.stop();
      logger.info('Evolution coordinator stopped');
    }
  }

  // ─── Main Entry ──────────────────────────────────────────────

  async start() {
    logger.info('═══════════════════════════════════════');
    logger.info('  Jarvis Daemon Starting...');
    logger.info('═══════════════════════════════════════');

    this.writePidFile();
    this.startHealthCheck();
    this.startErrorWatcher();
    await this.startDesktop();
    await this.startEvolution();

    logger.info('Jarvis Daemon is running.');
  }
}

// ─── Entry Point ─────────────────────────────────────────────────

const daemon = new JarvisDaemon();
daemon.start().catch((err) => {
  logger.error(`Failed to start daemon: ${err}`);
  process.exit(1);
});
