// ============================================================================
// Jarvis Self-Upgrade Engine – leverages Claude Code (CC) for autonomous fixes
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';

import type {
  UUID,
  ISOTimestamp,
  UpgradeScope,
  UpgradeRequest,
  UpgradeResult,
  CCSkill,
  ToolParametersSchema,
} from '../types';
import logger from '../utils/logger';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface UpgradeActivity {
  id: UUID;
  action: string;
  description: string;
  result: 'success' | 'failure';
  output?: string;
  error?: string;
  timestamp: ISOTimestamp;
}

export interface WebPageSpec {
  name: string;
  description: string;
  framework?: string;
  features?: string[];
  outputDir: string;
}

export interface ToolSpec {
  name: string;
  description: string;
  parameters: ToolParametersSchema;
  language?: string;
  outputDir: string;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const BACKUP_DIR = path.join(os.homedir(), '.jarvis', 'backups');
const SKILLS_DIR = path.join(os.homedir(), '.claude', 'commands');

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

function backupFile(filePath: string): string | null {
  if (!fs.existsSync(filePath)) return null;
  ensureDir(BACKUP_DIR);
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const baseName = path.basename(filePath);
  const dest = path.join(BACKUP_DIR, `${baseName}.${ts}.bak`);
  fs.copyFileSync(filePath, dest);
  logger.info(`Backed up ${filePath} → ${dest}`);
  return dest;
}

// ---------------------------------------------------------------------------
// Claude Code execution helpers
// ---------------------------------------------------------------------------

interface CCResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

/**
 * Run Claude Code in --print mode (non-interactive, returns output).
 */
function runCCPrint(prompt: string, cwd?: string): Promise<CCResult> {
  return new Promise<CCResult>((resolve) => {
    const args = ['--print', prompt];
    const proc: ChildProcess = spawn('claude', args, {
      cwd: cwd ?? process.cwd(),
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });
  });
}

/**
 * Run Claude Code in interactive mode for code changes.
 * Passes a prompt via stdin and lets CC operate on the file system.
 */
function runCCInteractive(prompt: string, cwd?: string): Promise<CCResult> {
  return new Promise<CCResult>((resolve) => {
    const proc: ChildProcess = spawn('claude', [], {
      cwd: cwd ?? process.cwd(),
      stdio: ['pipe', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    let stdout = '';
    let stderr = '';

    proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
    proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

    proc.on('close', (code) => {
      resolve({ stdout, stderr, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      resolve({ stdout, stderr: err.message, exitCode: 1 });
    });

    // Send the prompt and close stdin to signal end of input
    proc.stdin?.write(prompt);
    proc.stdin?.end();
  });
}

// ---------------------------------------------------------------------------
// UpgradeEngine
// ---------------------------------------------------------------------------

export class UpgradeEngine {
  private activities: UpgradeActivity[] = [];

  // -----------------------------------------------------------------------
  // Activity logging
  // -----------------------------------------------------------------------

  private logActivity(
    action: string,
    description: string,
    result: 'success' | 'failure',
    output?: string,
    error?: string,
  ): UpgradeActivity {
    const activity: UpgradeActivity = {
      id: uuid(),
      action,
      description,
      result,
      output,
      error,
      timestamp: new Date().toISOString(),
    };
    this.activities.push(activity);
    logger.info(`[UpgradeEngine] ${action}: ${result}`, { description, error });
    return activity;
  }

  /** Return the full audit trail of upgrade activities. */
  getActivities(): UpgradeActivity[] {
    return [...this.activities];
  }

  // -----------------------------------------------------------------------
  // analyzeError
  // -----------------------------------------------------------------------

  /**
   * Ask CC to analyze an error and return root cause + suggestions.
   */
  async analyzeError(
    error: string,
    context?: string,
  ): Promise<{ analysis: string; suggestions: string[] }> {
    const prompt = [
      'Analyze the following error and provide a root cause analysis plus actionable suggestions.',
      'Respond in JSON with keys: "analysis" (string), "suggestions" (string[]).',
      '',
      '--- Error ---',
      error,
      context ? `\n--- Context ---\n${context}` : '',
    ].join('\n');

    const result = await runCCPrint(prompt);

    if (result.exitCode !== 0) {
      this.logActivity('analyzeError', error, 'failure', undefined, result.stderr);
      return { analysis: 'Analysis failed', suggestions: [] };
    }

    this.logActivity('analyzeError', error, 'success', result.stdout);

    try {
      const parsed = JSON.parse(result.stdout);
      return {
        analysis: parsed.analysis ?? result.stdout,
        suggestions: Array.isArray(parsed.suggestions) ? parsed.suggestions : [],
      };
    } catch {
      return { analysis: result.stdout, suggestions: [] };
    }
  }

  // -----------------------------------------------------------------------
  // fixCode
  // -----------------------------------------------------------------------

  /**
   * Ask CC to fix code in a specific file. Backs up the file first.
   */
  async fixCode(
    filePath: string,
    error: string,
    context?: string,
  ): Promise<UpgradeResult> {
    const requestId = uuid();
    const backupPath = backupFile(filePath);

    const fileContent = fs.existsSync(filePath)
      ? fs.readFileSync(filePath, 'utf-8')
      : '';

    const prompt = [
      `Fix the following error in file "${filePath}".`,
      '',
      '--- Error ---',
      error,
      context ? `\n--- Context ---\n${context}` : '',
      '',
      '--- Current File Content ---',
      fileContent,
      '',
      'Output ONLY the corrected file content, nothing else.',
    ].join('\n');

    const result = await runCCPrint(prompt, path.dirname(filePath));

    if (result.exitCode !== 0) {
      this.logActivity('fixCode', filePath, 'failure', undefined, result.stderr);
      return {
        requestId,
        success: false,
        scope: 'code',
        error: result.stderr || 'CC exited with non-zero status',
        rollbackAvailable: backupPath !== null,
        completedAt: new Date().toISOString(),
      };
    }

    // Write the fixed content back
    fs.writeFileSync(filePath, result.stdout, 'utf-8');
    this.logActivity('fixCode', filePath, 'success', `Fixed ${filePath}`);

    return {
      requestId,
      success: true,
      scope: 'code',
      appliedChanges: `Fixed ${filePath}. Backup at ${backupPath ?? 'N/A'}`,
      rollbackAvailable: backupPath !== null,
      completedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // developFeature
  // -----------------------------------------------------------------------

  /**
   * Ask CC to develop a new feature via interactive mode.
   */
  async developFeature(
    description: string,
    workspacePath?: string,
  ): Promise<UpgradeResult> {
    const requestId = uuid();
    const cwd = workspacePath ?? process.cwd();

    const prompt = [
      'You are developing a new feature for the Jarvis AI agent platform.',
      '',
      '--- Feature Description ---',
      description,
      '',
      'Implement this feature following the existing project conventions.',
      'Create or modify files as needed.',
    ].join('\n');

    const result = await runCCInteractive(prompt, cwd);

    const success = result.exitCode === 0;
    this.logActivity('developFeature', description, success ? 'success' : 'failure', result.stdout, result.stderr);

    return {
      requestId,
      success,
      scope: 'code',
      appliedChanges: success ? result.stdout : undefined,
      error: success ? undefined : result.stderr || 'Feature development failed',
      rollbackAvailable: false,
      completedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // generateTool
  // -----------------------------------------------------------------------

  /**
   * Ask CC to generate a new tool implementation.
   */
  async generateTool(spec: ToolSpec): Promise<UpgradeResult> {
    const requestId = uuid();
    ensureDir(spec.outputDir);

    const prompt = [
      'Generate a TypeScript tool implementation for the Jarvis platform.',
      '',
      `Tool name: ${spec.name}`,
      `Description: ${spec.description}`,
      `Parameters schema: ${JSON.stringify(spec.parameters, null, 2)}`,
      '',
      'The tool should export a ToolDefinition object conforming to this interface:',
      '  { name: string; description: string; parameters: ToolParametersSchema; execute: (params) => Promise<unknown> }',
      '',
      'Output ONLY the TypeScript source code.',
    ].join('\n');

    const result = await runCCPrint(prompt);

    if (result.exitCode !== 0) {
      this.logActivity('generateTool', spec.name, 'failure', undefined, result.stderr);
      return {
        requestId,
        success: false,
        scope: 'tool',
        error: result.stderr || 'Tool generation failed',
        rollbackAvailable: false,
        completedAt: new Date().toISOString(),
      };
    }

    const outputPath = path.join(spec.outputDir, `${spec.name}.ts`);
    fs.writeFileSync(outputPath, result.stdout, 'utf-8');
    this.logActivity('generateTool', spec.name, 'success', `Created ${outputPath}`);

    return {
      requestId,
      success: true,
      scope: 'tool',
      appliedChanges: `Generated tool at ${outputPath}`,
      rollbackAvailable: false,
      completedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // generateWebPage
  // -----------------------------------------------------------------------

  /**
   * Ask CC to generate a web page.
   */
  async generateWebPage(spec: WebPageSpec): Promise<UpgradeResult> {
    const requestId = uuid();
    ensureDir(spec.outputDir);

    const prompt = [
      'Generate a web page with the following specification:',
      '',
      `Name: ${spec.name}`,
      `Description: ${spec.description}`,
      `Framework: ${spec.framework ?? 'vanilla HTML/CSS/JS'}`,
      `Features: ${(spec.features ?? []).join(', ') || 'none specified'}`,
      '',
      'Output ONLY the HTML source code for the page.',
    ].join('\n');

    const result = await runCCPrint(prompt);

    if (result.exitCode !== 0) {
      this.logActivity('generateWebPage', spec.name, 'failure', undefined, result.stderr);
      return {
        requestId,
        success: false,
        scope: 'code',
        error: result.stderr || 'Web page generation failed',
        rollbackAvailable: false,
        completedAt: new Date().toISOString(),
      };
    }

    const outputPath = path.join(spec.outputDir, `${spec.name}.html`);
    fs.writeFileSync(outputPath, result.stdout, 'utf-8');
    this.logActivity('generateWebPage', spec.name, 'success', `Created ${outputPath}`);

    return {
      requestId,
      success: true,
      scope: 'code',
      appliedChanges: `Generated web page at ${outputPath}`,
      rollbackAvailable: false,
      completedAt: new Date().toISOString(),
    };
  }

  // -----------------------------------------------------------------------
  // safeUpgrade – develop with git backup, tsc check, and auto-rollback
  // -----------------------------------------------------------------------

  /**
   * A safer wrapper around developFeature that:
   * 1. Creates a git stash backup before making changes
   * 2. Runs `tsc --noEmit` after development to validate types
   * 3. Automatically rolls back via git stash pop if tsc fails
   */
  async safeUpgrade(
    description: string,
    options?: { workspacePath?: string; tsconfigPath?: string },
  ): Promise<UpgradeResult> {
    const cwd = options?.workspacePath ?? process.cwd();
    const requestId = uuid();

    // Step 1: Create git stash backup
    const stashResult = await this.runCommand('git', ['stash', 'push', '-m', `jarvis-safe-upgrade-${requestId}`], cwd);
    const stashCreated = !stashResult.stdout.includes('No local changes');
    if (stashCreated) {
      this.logActivity('safeUpgrade:stash', description, 'success', 'Created git stash backup');
    }

    // Step 2: Develop the feature
    const devResult = await this.developFeature(description, cwd);

    if (!devResult.success) {
      // Restore stash if development failed
      if (stashCreated) {
        await this.runCommand('git', ['stash', 'pop'], cwd);
        this.logActivity('safeUpgrade:rollback', description, 'success', 'Rolled back via git stash pop (dev failed)');
      }
      return {
        ...devResult,
        requestId,
        rollbackAvailable: false,
      };
    }

    // Step 3: Run tsc to validate
    const tscArgs = ['--noEmit'];
    if (options?.tsconfigPath) {
      tscArgs.push('-p', options.tsconfigPath);
    }
    const tscResult = await this.runCommand('npx', ['tsc', ...tscArgs], cwd);

    if (tscResult.exitCode !== 0) {
      this.logActivity('safeUpgrade:tsc', description, 'failure', tscResult.stdout, tscResult.stderr);

      // Step 4: Rollback – discard changes and restore stash
      await this.runCommand('git', ['checkout', '.'], cwd);
      // Clean any new untracked files from the development
      await this.runCommand('git', ['clean', '-fd'], cwd);
      if (stashCreated) {
        await this.runCommand('git', ['stash', 'pop'], cwd);
      }
      this.logActivity('safeUpgrade:rollback', description, 'success', 'Rolled back due to tsc failure');

      return {
        requestId,
        success: false,
        scope: 'code',
        error: `TypeScript check failed:\n${tscResult.stderr || tscResult.stdout}`,
        rollbackAvailable: false,
        completedAt: new Date().toISOString(),
      };
    }

    this.logActivity('safeUpgrade:tsc', description, 'success', 'TypeScript check passed');

    // Drop the stash since the upgrade succeeded
    if (stashCreated) {
      await this.runCommand('git', ['stash', 'drop'], cwd);
    }

    return {
      requestId,
      success: true,
      scope: 'code',
      appliedChanges: devResult.appliedChanges,
      rollbackAvailable: true,
      completedAt: new Date().toISOString(),
    };
  }

  /**
   * Helper to run a shell command and capture output.
   */
  private runCommand(cmd: string, args: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
    return new Promise((resolve) => {
      const proc = spawn(cmd, args, {
        cwd,
        stdio: ['ignore', 'pipe', 'pipe'],
        env: { ...process.env },
        shell: true,
      });

      let stdout = '';
      let stderr = '';

      proc.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString(); });
      proc.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString(); });

      proc.on('close', (code) => {
        resolve({ stdout, stderr, exitCode: code ?? 1 });
      });

      proc.on('error', (err) => {
        resolve({ stdout, stderr: err.message, exitCode: 1 });
      });
    });
  }

  // -----------------------------------------------------------------------
  // CC Skill management
  // -----------------------------------------------------------------------

  /**
   * Install a CC skill (markdown file) to ~/.claude/commands/.
   */
  async installCCSkill(name: string, content: string): Promise<CCSkill> {
    ensureDir(SKILLS_DIR);
    const fileName = name.endsWith('.md') ? name : `${name}.md`;
    const installPath = path.join(SKILLS_DIR, fileName);

    backupFile(installPath);
    fs.writeFileSync(installPath, content, 'utf-8');

    this.logActivity('installCCSkill', name, 'success', `Installed at ${installPath}`);

    return {
      name,
      description: content.split('\n')[0]?.replace(/^#\s*/, '') ?? name,
      content,
      installPath,
    };
  }

  /**
   * Generate a CC skill from a natural-language description using CC itself.
   */
  async generateCCSkill(description: string): Promise<CCSkill | null> {
    const prompt = [
      'Generate a Claude Code slash command skill in Markdown format.',
      'The skill should follow this structure:',
      '  - A top-level heading as the skill name',
      '  - A description of what the skill does',
      '  - Step-by-step instructions for Claude to follow',
      '  - Any relevant context or constraints',
      '',
      '--- Skill Description ---',
      description,
      '',
      'Output ONLY the Markdown content for the skill.',
    ].join('\n');

    const result = await runCCPrint(prompt);

    if (result.exitCode !== 0) {
      this.logActivity('generateCCSkill', description, 'failure', undefined, result.stderr);
      return null;
    }

    // Derive a name from the first heading or use a slug
    const firstLine = result.stdout.split('\n')[0] ?? '';
    const derivedName = firstLine
      .replace(/^#\s*/, '')
      .replace(/[^a-zA-Z0-9]+/g, '-')
      .toLowerCase()
      .replace(/^-|-$/g, '') || `skill-${uuid().slice(0, 8)}`;

    const skill = await this.installCCSkill(derivedName, result.stdout);
    this.logActivity('generateCCSkill', description, 'success', `Generated skill: ${derivedName}`);
    return skill;
  }

  // -----------------------------------------------------------------------
  // upgradeDesktopApp
  // -----------------------------------------------------------------------

  /**
   * Fix or upgrade the Jarvis desktop app itself using CC interactive mode.
   */
  async upgradeDesktopApp(
    issue: string,
    context?: string,
  ): Promise<UpgradeResult> {
    const requestId = uuid();
    const projectRoot = path.resolve(__dirname, '..', '..', '..', '..');

    const prompt = [
      'You are upgrading the Jarvis desktop application.',
      'The project root is the current working directory.',
      '',
      '--- Issue ---',
      issue,
      context ? `\n--- Context ---\n${context}` : '',
      '',
      'Analyze the issue and apply the necessary fixes or upgrades.',
      'Make sure to maintain backward compatibility and follow existing patterns.',
    ].join('\n');

    const result = await runCCInteractive(prompt, projectRoot);

    const success = result.exitCode === 0;
    this.logActivity('upgradeDesktopApp', issue, success ? 'success' : 'failure', result.stdout, result.stderr);

    return {
      requestId,
      success,
      scope: 'code',
      appliedChanges: success ? result.stdout : undefined,
      error: success ? undefined : result.stderr || 'Desktop app upgrade failed',
      rollbackAvailable: true,
      completedAt: new Date().toISOString(),
    };
  }
}
