/**
 * Evolution Coordinator
 *
 * Manages the self-evolution lifecycle of the Jarvis platform.
 * Watches for evolution requests, executes them in isolated git worktrees,
 * validates changes, and safely merges them back into the main branch.
 *
 * Dual-model strategy:
 * - Planning phase uses a cheaper model for analysis and plan generation
 * - Execution phase uses a more capable model for code changes
 */

import { EventEmitter } from 'events';
import { spawn, ChildProcess } from 'child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync, readdirSync, unlinkSync } from 'fs';
import { join } from 'path';
import { homedir } from 'os';

// ─── Types ───────────────────────────────────────────────────────

interface EvolutionModelConfig {
  anthropicAuthToken: string;
  anthropicBaseUrl: string;
  model?: string;
}

interface EvolutionConfig {
  enabled: boolean;
  loopIntervalMinutes: number;
  maxConcurrent: number;
  planning: EvolutionModelConfig;
  execution: EvolutionModelConfig;
  sourceDir: string;
  worktreeBaseDir: string;
  maxHistoryRecords: number;
}

interface EvolutionRequest {
  id: string;
  goal: string;
  goalType: 'bugfix' | 'feature' | 'refactor' | 'optimization';
  priority: number;
  source: 'manual' | 'loop' | 'error-fix';
  workspaceId?: string;
  createdAt: string;
}

interface PhaseInfo {
  name: string;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  durationMs?: number;
  startedAt?: string;
  output?: string;
}

interface EvolutionStatus {
  active: boolean;
  currentTask: string | null;
  phase: string | null;
  progress: number;
  phases: PhaseInfo[];
  worktreePath: string | null;
  logs: string[];
  queue: EvolutionRequest[];
}

interface EvolutionCallbacks {
  stopDesktop: () => Promise<void>;
  startDesktop: () => Promise<void>;
  log: (message: string) => void;
}

interface ClaudeCallOptions {
  prompt: string;
  cwd: string;
  modelConfig: EvolutionModelConfig;
  interactive?: boolean;
  timeout?: number;
}

interface EvolutionHistoryRecord {
  id: string;
  request: EvolutionRequest;
  success: boolean;
  startedAt: string;
  completedAt: string;
  phases: PhaseInfo[];
  error?: string;
}

// ─── Constants ───────────────────────────────────────────────────

const EVOLUTION_DIR = join(homedir(), '.jarvis', 'evolution');
const REQUESTS_DIR = join(EVOLUTION_DIR, 'requests');
const HISTORY_DIR = join(EVOLUTION_DIR, 'history');
const STATUS_FILE = join(EVOLUTION_DIR, 'status.json');
const QUEUE_FILE = join(EVOLUTION_DIR, 'queue.json');

const PLANNING_TIMEOUT_MS = 5 * 60 * 1000;   // 5 minutes
const EXECUTION_TIMEOUT_MS = 20 * 60 * 1000;  // 20 minutes
const MAX_LOG_ENTRIES = 50;

// ─── EvolutionCoordinator ────────────────────────────────────────

class EvolutionCoordinator extends EventEmitter {
  private config: EvolutionConfig;
  private callbacks: EvolutionCallbacks;
  private status: EvolutionStatus;
  private queue: EvolutionRequest[] = [];
  private isProcessing = false;
  private loopTimer: ReturnType<typeof setInterval> | null = null;
  private watcher: { close: () => Promise<void> | void } | null = null;
  private activeProcess: ChildProcess | null = null;
  private evolutionStartedAt: string | null = null;

  constructor(config: EvolutionConfig, callbacks: EvolutionCallbacks) {
    super();
    this.config = config;
    this.callbacks = callbacks;
    this.status = {
      active: false,
      currentTask: null,
      phase: null,
      progress: 0,
      phases: [],
      worktreePath: null,
      logs: [],
      queue: [],
    };
  }

  // ─── Lifecycle ───────────────────────────────────────────────

  async start(): Promise<void> {
    this.addLog('Evolution Coordinator starting...');

    // 1. Ensure directories exist
    this.ensureDir(EVOLUTION_DIR);
    this.ensureDir(REQUESTS_DIR);
    this.ensureDir(HISTORY_DIR);

    // 2. Load persisted queue
    this.loadQueue();

    // 3. Scan for unprocessed request files
    this.scanPendingRequests();

    // 4. Start file watcher on requests directory
    await this.startWatcher();

    // 5. Start loop timer if enabled
    if (this.config.enabled && this.config.loopIntervalMinutes > 0) {
      this.startLoopTimer();
    }

    this.addLog('Evolution Coordinator started.');
  }

  async stop(): Promise<void> {
    this.addLog('Evolution Coordinator stopping...');

    // Stop loop timer
    if (this.loopTimer) {
      clearInterval(this.loopTimer);
      this.loopTimer = null;
    }

    // Stop file watcher
    if (this.watcher) {
      await this.watcher.close();
      this.watcher = null;
    }

    // Kill any active claude process
    if (this.activeProcess) {
      this.activeProcess.kill('SIGTERM');
      this.activeProcess = null;
    }

    // If there was an active evolution, clean up the worktree
    if (this.status.active && this.status.currentTask) {
      try {
        await this.removeWorktree(this.status.currentTask);
      } catch {
        // Best effort cleanup
      }
      this.updateStatus({ active: false, currentTask: null, phase: null, progress: 0, worktreePath: null });
    }

    this.addLog('Evolution Coordinator stopped.');
  }

  // ─── Request Handling ────────────────────────────────────────

  private onNewRequest(filePath: string): void {
    try {
      const raw = readFileSync(filePath, 'utf-8');
      const request: EvolutionRequest = JSON.parse(raw);

      // Avoid duplicates
      if (this.queue.some((r) => r.id === request.id)) {
        this.addLog(`Duplicate request ignored: ${request.id}`);
        return;
      }

      this.addLog(`New evolution request: [${request.goalType}] ${request.goal} (id=${request.id})`);
      this.queue.push(request);

      // Sort by priority (lower number = higher priority)
      this.queue.sort((a, b) => a.priority - b.priority);
      this.persistQueue();

      this.updateStatus({ queue: [...this.queue] });
      this.tryProcessQueue();
    } catch (err) {
      this.addLog(`Failed to read request file ${filePath}: ${err}`);
    }
  }

  private tryProcessQueue(): void {
    if (!this.isProcessing && this.queue.length > 0) {
      void this.processQueue();
    }
  }

  private async processQueue(): Promise<void> {
    if (this.isProcessing || this.queue.length === 0) return;

    this.isProcessing = true;
    const request = this.queue.shift()!;
    this.persistQueue();
    this.updateStatus({ queue: [...this.queue] });

    try {
      await this.executeEvolution(request);
    } catch (err) {
      this.addLog(`Evolution failed for ${request.id}: ${err}`);
    } finally {
      this.isProcessing = false;
      // Continue processing if there are more items
      if (this.queue.length > 0) {
        this.tryProcessQueue();
      }
    }
  }

  // ─── Evolution Execution (Core) ──────────────────────────────

  private async executeEvolution(request: EvolutionRequest): Promise<void> {
    this.evolutionStartedAt = new Date().toISOString();
    const phases: PhaseInfo[] = [
      { name: 'planning', status: 'pending' },
      { name: 'worktree-create', status: 'pending' },
      { name: 'execution', status: 'pending' },
      { name: 'validation', status: 'pending' },
      { name: 'merge', status: 'pending' },
      { name: 'cleanup', status: 'pending' },
    ];

    this.updateStatus({
      active: true,
      currentTask: request.id,
      phase: 'planning',
      progress: 0,
      phases,
      worktreePath: null,
    });

    this.addLog(`Starting evolution: ${request.id} - ${request.goal}`);
    let worktreeCreated = false;
    let plan = '';

    try {
      // Phase 1: Planning (cheap model)
      this.setPhaseRunning(phases, 'planning');
      this.updateStatus({ phases: [...phases], phase: 'planning', progress: 10 });

      const planPrompt = `You are Jarvis, a self-evolving AI platform. Analyze the project and create a detailed implementation plan for the following goal.

Goal: ${request.goal}
Goal Type: ${request.goalType}
${request.workspaceId ? `Workspace: ${request.workspaceId}` : ''}

Instructions:
1. Analyze the current project structure
2. Identify which files need to be modified or created
3. Create a step-by-step implementation plan
4. List potential risks and how to mitigate them
5. Only plan changes under the packages/ directory

Output a detailed markdown plan.`;

      const planResult = await this.callClaude({
        prompt: planPrompt,
        cwd: this.config.sourceDir,
        modelConfig: this.config.planning,
        interactive: false,
        timeout: PLANNING_TIMEOUT_MS,
      });

      if (planResult.exitCode !== 0) {
        this.setPhaseStatus(phases, 'planning', 'failed', planResult.stderr);
        this.updateStatus({ phases: [...phases] });
        throw new Error(`Planning failed: ${planResult.stderr}`);
      }

      plan = planResult.stdout;
      this.setPhaseStatus(phases, 'planning', 'completed', 'Plan generated successfully');
      this.updateStatus({ phases: [...phases], progress: 20 });
      this.addLog('Planning phase completed.');

      // Phase 2: Create git worktree
      this.setPhaseRunning(phases, 'worktree-create');
      this.updateStatus({ phases: [...phases], phase: 'worktree-create', progress: 25 });

      const worktreePath = await this.createWorktree(request.id);
      worktreeCreated = true;

      // Write plan to worktree
      writeFileSync(join(worktreePath, 'EVOLUTION_PLAN.md'), plan);

      this.setPhaseStatus(phases, 'worktree-create', 'completed', `Worktree at ${worktreePath}`);
      this.updateStatus({ phases: [...phases], worktreePath, progress: 30 });
      this.addLog(`Worktree created at ${worktreePath}`);

      // Phase 3: Execution (capable model)
      this.setPhaseRunning(phases, 'execution');
      this.updateStatus({ phases: [...phases], phase: 'execution', progress: 35 });

      const executionPrompt = `Execute the following evolution plan. Make all necessary code changes.

PLAN:
${plan}

IMPORTANT RULES:
- Only modify files under packages/
- Follow existing code patterns and conventions
- Ensure TypeScript types are correct
- Do not add unnecessary dependencies
- Commit your changes when done`;

      const execResult = await this.callClaude({
        prompt: executionPrompt,
        cwd: worktreePath,
        modelConfig: this.config.execution,
        interactive: true,
        timeout: EXECUTION_TIMEOUT_MS,
      });

      if (execResult.exitCode !== 0) {
        this.setPhaseStatus(phases, 'execution', 'failed', execResult.stderr);
        this.updateStatus({ phases: [...phases] });
        throw new Error(`Execution failed: ${execResult.stderr}`);
      }

      this.setPhaseStatus(phases, 'execution', 'completed', 'Code changes applied');
      this.updateStatus({ phases: [...phases], progress: 60 });
      this.addLog('Execution phase completed.');

      // Phase 4: Validation
      this.setPhaseRunning(phases, 'validation');
      this.updateStatus({ phases: [...phases], phase: 'validation', progress: 65 });

      const validated = await this.runValidation(worktreePath, request.id, phases);
      if (!validated) {
        throw new Error('Validation failed after retry');
      }

      this.setPhaseStatus(phases, 'validation', 'completed', 'TypeScript compilation passed');
      this.updateStatus({ phases: [...phases], progress: 75 });
      this.addLog('Validation phase completed.');

      // Phase 5: Safe merge
      this.setPhaseRunning(phases, 'merge');
      this.updateStatus({ phases: [...phases], phase: 'merge', progress: 80 });

      await this.callbacks.stopDesktop();
      this.addLog('Desktop stopped for merge.');

      const baseBranch = await this.getCurrentBranch();
      const mergeSuccess = await this.mergeWorktree(request.id, baseBranch);

      if (!mergeSuccess) {
        this.setPhaseStatus(phases, 'merge', 'failed', 'Merge or build failed');
        this.updateStatus({ phases: [...phases] });
        await this.callbacks.startDesktop();
        throw new Error('Merge failed');
      }

      // Build after merge
      this.addLog('Running build after merge...');
      const buildResult = await this.runCommand('npm', ['run', 'build'], this.config.sourceDir);

      if (buildResult.exitCode !== 0) {
        this.addLog('Build failed after merge, aborting merge...');
        await this.gitExec(['merge', '--abort'], this.config.sourceDir);
        this.setPhaseStatus(phases, 'merge', 'failed', 'Build failed after merge');
        this.updateStatus({ phases: [...phases] });
        await this.callbacks.startDesktop();
        throw new Error('Build failed after merge');
      }

      this.setPhaseStatus(phases, 'merge', 'completed', 'Merged and built successfully');
      this.updateStatus({ phases: [...phases], progress: 90 });
      this.addLog('Merge phase completed.');

      await this.callbacks.startDesktop();
      this.addLog('Desktop restarted.');

      // Phase 6: Cleanup
      this.setPhaseRunning(phases, 'cleanup');
      this.updateStatus({ phases: [...phases], phase: 'cleanup', progress: 95 });

      await this.removeWorktree(request.id);
      worktreeCreated = false;

      // Write history record
      this.writeHistoryRecord(request, true, phases);

      // Delete request file
      const requestFile = join(REQUESTS_DIR, `${request.id}.json`);
      if (existsSync(requestFile)) {
        unlinkSync(requestFile);
      }

      this.setPhaseStatus(phases, 'cleanup', 'completed', 'Cleaned up worktree and branch');
      this.updateStatus({
        active: false,
        currentTask: null,
        phase: null,
        progress: 100,
        phases: [...phases],
        worktreePath: null,
      });

      this.addLog(`Evolution ${request.id} completed successfully.`);
      this.emit('evolution-complete', { id: request.id, success: true });

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err);
      this.addLog(`Evolution ${request.id} failed: ${errorMsg}`);

      // Cleanup worktree on failure
      if (worktreeCreated) {
        try {
          await this.removeWorktree(request.id);
        } catch (cleanupErr) {
          this.addLog(`Worktree cleanup failed: ${cleanupErr}`);
        }
      }

      this.writeHistoryRecord(request, false, phases, errorMsg);

      // Delete request file
      const requestFile = join(REQUESTS_DIR, `${request.id}.json`);
      if (existsSync(requestFile)) {
        try { unlinkSync(requestFile); } catch { /* ignore */ }
      }

      this.updateStatus({
        active: false,
        currentTask: null,
        phase: null,
        progress: 0,
        phases: [...phases],
        worktreePath: null,
      });

      this.emit('evolution-complete', { id: request.id, success: false, error: errorMsg });
    }
  }

  // ─── Validation ──────────────────────────────────────────────

  private async runValidation(worktreePath: string, requestId: string, phases: PhaseInfo[]): Promise<boolean> {
    const tscResult = await this.runCommand('npx', ['tsc', '--noEmit'], worktreePath);

    if (tscResult.exitCode === 0) {
      return true;
    }

    this.addLog('Validation failed, attempting auto-fix...');

    // Give the execution model one more chance to fix
    const fixPrompt = `TypeScript compilation failed with the following errors. Please fix them.

Errors:
${tscResult.stderr || tscResult.stdout}

Fix all TypeScript errors and ensure the code compiles cleanly.`;

    const fixResult = await this.callClaude({
      prompt: fixPrompt,
      cwd: worktreePath,
      modelConfig: this.config.execution,
      interactive: true,
      timeout: EXECUTION_TIMEOUT_MS,
    });

    if (fixResult.exitCode !== 0) {
      this.setPhaseStatus(phases, 'validation', 'failed', 'Auto-fix attempt failed');
      return false;
    }

    // Re-validate
    const retryResult = await this.runCommand('npx', ['tsc', '--noEmit'], worktreePath);
    if (retryResult.exitCode !== 0) {
      this.setPhaseStatus(phases, 'validation', 'failed', 'Still failing after auto-fix');
      return false;
    }

    this.addLog('Auto-fix succeeded, validation passed on retry.');
    return true;
  }

  // ─── Loop Mode ───────────────────────────────────────────────

  private startLoopTimer(): void {
    const intervalMs = this.config.loopIntervalMinutes * 60 * 1000;
    this.loopTimer = setInterval(() => {
      void this.runLoopPlanning();
    }, intervalMs);
    this.addLog(`Loop mode enabled, interval: ${this.config.loopIntervalMinutes} minutes`);
  }

  private async runLoopPlanning(): Promise<void> {
    if (this.isProcessing) {
      this.addLog('Loop planning skipped: evolution already in progress.');
      return;
    }

    this.addLog('Loop planning: analyzing project for improvement opportunities...');

    const prompt = `You are Jarvis, a self-evolving AI platform. Analyze the current project state and determine if any self-improvement is needed.

Examine the codebase for:
1. Bugs or error-prone code
2. Missing features that would improve the platform
3. Performance optimizations
4. Code quality improvements

If improvement is needed, respond with ONLY a JSON object (no markdown, no explanation):
{"goal": "description of what to improve", "goalType": "bugfix|feature|refactor|optimization", "priority": 1-5}

If no improvement is needed, respond with ONLY:
{"skip": true, "reason": "explanation"}`;

    try {
      const result = await this.callClaude({
        prompt,
        cwd: this.config.sourceDir,
        modelConfig: this.config.planning,
        interactive: false,
        timeout: PLANNING_TIMEOUT_MS,
      });

      if (result.exitCode !== 0) {
        this.addLog(`Loop planning failed: ${result.stderr}`);
        return;
      }

      const output = result.stdout.trim();

      // Try to extract JSON from the output
      const jsonMatch = output.match(/\{[\s\S]*\}/);
      if (!jsonMatch) {
        this.addLog('Loop planning: no valid JSON in response.');
        return;
      }

      const parsed = JSON.parse(jsonMatch[0]) as Record<string, unknown>;

      if ('skip' in parsed && parsed.skip) {
        this.addLog(`Loop planning: no evolution needed - ${parsed.reason ?? 'no reason given'}`);
        return;
      }

      if ('goal' in parsed && typeof parsed.goal === 'string') {
        const request: EvolutionRequest = {
          id: `loop-${Date.now()}`,
          goal: parsed.goal,
          goalType: (parsed.goalType as EvolutionRequest['goalType']) || 'optimization',
          priority: typeof parsed.priority === 'number' ? parsed.priority : 3,
          source: 'loop',
          createdAt: new Date().toISOString(),
        };

        // Write request file to trigger normal flow
        const requestPath = join(REQUESTS_DIR, `${request.id}.json`);
        writeFileSync(requestPath, JSON.stringify(request, null, 2));
        this.addLog(`Loop planning: created evolution request - ${request.goal}`);
      }
    } catch (err) {
      this.addLog(`Loop planning error: ${err}`);
    }
  }

  // ─── Status Management ──────────────────────────────────────

  private updateStatus(partial: Partial<EvolutionStatus>): void {
    Object.assign(this.status, partial);
    this.persistStatus();
    this.emit('status', { ...this.status });
  }

  private persistStatus(): void {
    try {
      writeFileSync(STATUS_FILE, JSON.stringify(this.status, null, 2));
    } catch {
      // Non-critical, ignore write failures
    }
  }

  private addLog(message: string): void {
    const timestamped = `[${new Date().toISOString()}] ${message}`;
    this.status.logs.push(timestamped);

    // Keep only recent entries
    if (this.status.logs.length > MAX_LOG_ENTRIES) {
      this.status.logs = this.status.logs.slice(-MAX_LOG_ENTRIES);
    }

    this.persistStatus();
    this.callbacks.log(message);
  }

  getStatus(): EvolutionStatus {
    return { ...this.status };
  }

  // ─── Phase Helpers ───────────────────────────────────────────

  private setPhaseRunning(phases: PhaseInfo[], name: string): void {
    const phase = phases.find((p) => p.name === name);
    if (phase) {
      phase.status = 'running';
      phase.startedAt = new Date().toISOString();
    }
  }

  private setPhaseStatus(phases: PhaseInfo[], name: string, status: PhaseInfo['status'], output?: string): void {
    const phase = phases.find((p) => p.name === name);
    if (phase) {
      phase.status = status;
      phase.output = output;
      if (phase.startedAt) {
        phase.durationMs = Date.now() - new Date(phase.startedAt).getTime();
      }
    }
  }

  // ─── Queue Persistence ──────────────────────────────────────

  private loadQueue(): void {
    try {
      if (existsSync(QUEUE_FILE)) {
        const raw = readFileSync(QUEUE_FILE, 'utf-8');
        this.queue = JSON.parse(raw) as EvolutionRequest[];
        this.updateStatus({ queue: [...this.queue] });
        this.addLog(`Loaded ${this.queue.length} queued request(s) from disk.`);
      }
    } catch (err) {
      this.addLog(`Failed to load queue: ${err}`);
      this.queue = [];
    }
  }

  private persistQueue(): void {
    try {
      writeFileSync(QUEUE_FILE, JSON.stringify(this.queue, null, 2));
    } catch {
      // Non-critical
    }
  }

  // ─── Scan & Watch ────────────────────────────────────────────

  private scanPendingRequests(): void {
    try {
      const files = readdirSync(REQUESTS_DIR).filter((f) => f.endsWith('.json'));
      for (const file of files) {
        const filePath = join(REQUESTS_DIR, file);
        this.onNewRequest(filePath);
      }
      if (files.length > 0) {
        this.addLog(`Scanned ${files.length} pending request(s).`);
      }
    } catch (err) {
      this.addLog(`Failed to scan requests directory: ${err}`);
    }
  }

  private async startWatcher(): Promise<void> {
    try {
      const chokidar = await import('chokidar');
      this.watcher = chokidar.watch(join(REQUESTS_DIR, '*.json'), {
        persistent: true,
        ignoreInitial: true,
        awaitWriteFinish: { stabilityThreshold: 500, pollInterval: 100 },
      });

      (this.watcher as ReturnType<typeof chokidar.watch>).on('add', (filePath: string) => {
        this.onNewRequest(filePath);
      });

      this.addLog('File watcher started on requests directory.');
    } catch (err) {
      this.addLog(`Failed to start file watcher: ${err}`);
    }
  }

  // ─── History ─────────────────────────────────────────────────

  private writeHistoryRecord(
    request: EvolutionRequest,
    success: boolean,
    phases: PhaseInfo[],
    error?: string,
  ): void {
    const record: EvolutionHistoryRecord = {
      id: request.id,
      request,
      success,
      startedAt: this.evolutionStartedAt || new Date().toISOString(),
      completedAt: new Date().toISOString(),
      phases: [...phases],
      error,
    };

    try {
      writeFileSync(join(HISTORY_DIR, `${request.id}.json`), JSON.stringify(record, null, 2));
    } catch (err) {
      this.addLog(`Failed to write history record: ${err}`);
    }

    // Trim old history records
    this.trimHistory();
  }

  private trimHistory(): void {
    try {
      const files = readdirSync(HISTORY_DIR)
        .filter((f) => f.endsWith('.json'))
        .map((f) => ({ name: f, path: join(HISTORY_DIR, f) }));

      if (files.length > this.config.maxHistoryRecords) {
        // Sort by modification time, remove oldest
        const sorted = files.sort((a, b) => {
          try {
            const aRecord = JSON.parse(readFileSync(a.path, 'utf-8')) as EvolutionHistoryRecord;
            const bRecord = JSON.parse(readFileSync(b.path, 'utf-8')) as EvolutionHistoryRecord;
            return new Date(aRecord.completedAt).getTime() - new Date(bRecord.completedAt).getTime();
          } catch {
            return 0;
          }
        });

        const toRemove = sorted.slice(0, files.length - this.config.maxHistoryRecords);
        for (const file of toRemove) {
          try { unlinkSync(file.path); } catch { /* ignore */ }
        }
      }
    } catch {
      // Non-critical
    }
  }

  // ─── Git Helpers ─────────────────────────────────────────────

  private async gitExec(args: string[], cwd: string): Promise<{ stdout: string; exitCode: number }> {
    return this.runCommand('git', args, cwd);
  }

  private async getCurrentBranch(): Promise<string> {
    const result = await this.gitExec(['rev-parse', '--abbrev-ref', 'HEAD'], this.config.sourceDir);
    if (result.exitCode !== 0) {
      throw new Error('Failed to get current branch');
    }
    return result.stdout.trim();
  }

  private async createWorktree(id: string): Promise<string> {
    const worktreePath = join(this.config.worktreeBaseDir, `evo-${id}`);
    const branchName = `evolution/evo-${id}`;

    const result = await this.gitExec(
      ['worktree', 'add', worktreePath, '-b', branchName],
      this.config.sourceDir,
    );

    if (result.exitCode !== 0) {
      throw new Error(`Failed to create worktree: ${result.stdout}`);
    }

    return worktreePath;
  }

  private async removeWorktree(id: string): Promise<void> {
    const worktreePath = join(this.config.worktreeBaseDir, `evo-${id}`);
    const branchName = `evolution/evo-${id}`;

    // Remove worktree
    await this.gitExec(['worktree', 'remove', worktreePath, '--force'], this.config.sourceDir);

    // Delete branch
    await this.gitExec(['branch', '-D', branchName], this.config.sourceDir);

    this.addLog(`Removed worktree and branch for ${id}`);
  }

  private async mergeWorktree(id: string, baseBranch: string): Promise<boolean> {
    const branchName = `evolution/evo-${id}`;

    // Ensure we're on the base branch
    const checkoutResult = await this.gitExec(['checkout', baseBranch], this.config.sourceDir);
    if (checkoutResult.exitCode !== 0) {
      this.addLog(`Failed to checkout ${baseBranch}: ${checkoutResult.stdout}`);
      return false;
    }

    // Merge with no-ff
    const mergeResult = await this.gitExec(
      ['merge', branchName, '--no-ff', '-m', `evolution: ${id}`],
      this.config.sourceDir,
    );

    if (mergeResult.exitCode !== 0) {
      this.addLog(`Merge failed: ${mergeResult.stdout}`);
      // Abort the merge
      await this.gitExec(['merge', '--abort'], this.config.sourceDir);
      return false;
    }

    return true;
  }

  // ─── Claude Code Integration ─────────────────────────────────

  private async callClaude(options: ClaudeCallOptions): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    const { prompt, cwd, modelConfig, interactive = false, timeout = EXECUTION_TIMEOUT_MS } = options;

    const args: string[] = [];
    if (interactive) {
      args.push('--dangerously-skip-permissions');
    } else {
      args.push('--print');
    }

    // Add model flag if specified
    if (modelConfig.model) {
      args.push('--model', modelConfig.model);
    }

    // For --print mode, pass prompt as argument; for interactive, use stdin
    if (!interactive) {
      args.push(prompt);
    }

    const env: Record<string, string> = {
      ...process.env as Record<string, string>,
      ANTHROPIC_AUTH_TOKEN: modelConfig.anthropicAuthToken,
      ANTHROPIC_BASE_URL: modelConfig.anthropicBaseUrl,
    };

    return new Promise((resolve) => {
      const proc = spawn('claude', args, {
        cwd,
        stdio: interactive ? ['pipe', 'pipe', 'pipe'] : ['ignore', 'pipe', 'pipe'],
        env,
        shell: true,
      });

      this.activeProcess = proc;

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      // Send prompt via stdin for interactive mode
      if (interactive && proc.stdin) {
        proc.stdin.write(prompt);
        proc.stdin.end();
      }

      const timer = setTimeout(() => {
        this.addLog(`Claude process timed out after ${timeout}ms`);
        proc.kill('SIGTERM');
      }, timeout);

      proc.on('exit', (code) => {
        clearTimeout(timer);
        this.activeProcess = null;
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err) => {
        clearTimeout(timer);
        this.activeProcess = null;
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }

  // ─── General Command Runner ──────────────────────────────────

  private runCommand(command: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn(command, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (data: Buffer) => {
        stdout += data.toString();
      });

      proc.stderr?.on('data', (data: Buffer) => {
        stderr += data.toString();
      });

      proc.on('exit', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err) => {
        resolve({ stdout: '', stderr: err.message, exitCode: 1 });
      });
    });
  }

  // ─── Utility ─────────────────────────────────────────────────

  private ensureDir(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }
}

export { EvolutionCoordinator, EvolutionConfig, EvolutionRequest, EvolutionStatus, EvolutionModelConfig };
