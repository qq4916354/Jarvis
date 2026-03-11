// ============================================================================
// Jarvis Evolution Engine – intelligent goal decomposition & continuous learning
// ============================================================================

import { spawn, type ChildProcess } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { v4 as uuid } from 'uuid';

import type {
  ISOTimestamp,
  SubGoal,
  LearningInsights,
  PlannedChange,
  ImpactAssessment,
  EvolutionStrategy,
  EvolutionContext,
  EvolutionPhaseName,
  EvolutionPhaseResult,
  EvolutionCycleRecord,
  EvolutionGoalType,
} from '../types.js';
import logger from '../utils/logger.js';
import eventBus from '../utils/event-bus.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface EvolutionEngineOptions {
  /** Working directory for Claude Code operations */
  workspacePath?: string;
  /** Directory to store evolution history */
  historyDir?: string;
  /** Maximum duration for a single evolution cycle in ms (default: 30 min) */
  maxCycleDurationMs?: number;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const DEFAULT_HISTORY_DIR = path.join(os.homedir(), '.jarvis', 'data', 'evolution');

function ensureDir(dir: string): void {
  fs.mkdirSync(dir, { recursive: true });
}

interface CCResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

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

function parseJSON<T>(raw: string, fallback: T): T {
  try {
    // Strip markdown code fences if present
    const cleaned = raw.replace(/^```(?:json)?\s*\n?/m, '').replace(/\n?```\s*$/m, '').trim();
    return JSON.parse(cleaned) as T;
  } catch {
    return fallback;
  }
}

// ---------------------------------------------------------------------------
// Phase weight map for progress estimation
// ---------------------------------------------------------------------------

const PHASE_WEIGHTS: Record<EvolutionPhaseName, number> = {
  research: 10,
  design: 15,
  requirements: 10,
  plan: 15,
  develop: 35,
  test: 15,
};

function computeProgress(
  completedPhases: EvolutionPhaseName[],
  allPhases: EvolutionPhaseName[],
): number {
  const totalWeight = allPhases.reduce((sum, p) => sum + (PHASE_WEIGHTS[p] ?? 10), 0);
  const doneWeight = completedPhases.reduce((sum, p) => sum + (PHASE_WEIGHTS[p] ?? 10), 0);
  return totalWeight > 0 ? Math.round((doneWeight / totalWeight) * 100) : 0;
}

// ---------------------------------------------------------------------------
// EvolutionEngine
// ---------------------------------------------------------------------------

export class EvolutionEngine {
  private readonly workspacePath: string;
  private readonly historyDir: string;
  private readonly maxCycleDurationMs: number;
  private history: EvolutionCycleRecord[] = [];

  constructor(options?: EvolutionEngineOptions) {
    this.workspacePath = options?.workspacePath ?? process.cwd();
    this.historyDir = options?.historyDir ?? DEFAULT_HISTORY_DIR;
    this.maxCycleDurationMs = options?.maxCycleDurationMs ?? 30 * 60 * 1000;
    this.loadHistory();
  }

  // -----------------------------------------------------------------------
  // History persistence
  // -----------------------------------------------------------------------

  private loadHistory(): void {
    const historyFile = path.join(this.historyDir, 'cycles.json');
    if (fs.existsSync(historyFile)) {
      try {
        this.history = JSON.parse(fs.readFileSync(historyFile, 'utf-8'));
      } catch {
        logger.warn('[EvolutionEngine] Failed to parse history file, starting fresh');
        this.history = [];
      }
    }
  }

  private saveHistory(): void {
    ensureDir(this.historyDir);
    const historyFile = path.join(this.historyDir, 'cycles.json');
    fs.writeFileSync(historyFile, JSON.stringify(this.history, null, 2), 'utf-8');
  }

  /** Return all recorded evolution cycles. */
  getHistory(): EvolutionCycleRecord[] {
    return [...this.history];
  }

  // -----------------------------------------------------------------------
  // (a) Goal Decomposition
  // -----------------------------------------------------------------------

  /**
   * Decompose a large goal into independently executable sub-goals
   * with priority, complexity estimation, and dependency relationships.
   */
  async decomposeGoal(goal: string): Promise<SubGoal[]> {
    const prompt = [
      'You are a software architect. Decompose the following goal into smaller, independently executable sub-goals.',
      'Each sub-goal should have clear boundaries and be implementable on its own (respecting dependencies).',
      '',
      'Respond in JSON as an array of objects with these keys:',
      '  - id: unique short identifier (e.g. "sg-1")',
      '  - title: concise title',
      '  - description: what needs to be done',
      '  - priority: "critical" | "high" | "medium" | "low"',
      '  - complexity: "small" | "medium" | "large"',
      '  - dependencies: array of other sub-goal ids this depends on (empty if none)',
      '',
      '--- Goal ---',
      goal,
      '',
      'Output ONLY the JSON array, no other text.',
    ].join('\n');

    const result = await runCCPrint(prompt, this.workspacePath);

    if (result.exitCode !== 0) {
      logger.error('[EvolutionEngine] decomposeGoal failed', { error: result.stderr });
      return [];
    }

    const parsed = parseJSON<Partial<SubGoal>[]>(result.stdout, []);

    return parsed.map((sg) => ({
      id: sg.id ?? uuid().slice(0, 8),
      title: sg.title ?? 'Untitled sub-goal',
      description: sg.description ?? '',
      priority: sg.priority ?? 'medium',
      complexity: sg.complexity ?? 'medium',
      dependencies: Array.isArray(sg.dependencies) ? sg.dependencies : [],
      status: 'pending' as const,
    }));
  }

  // -----------------------------------------------------------------------
  // (b) History Learning
  // -----------------------------------------------------------------------

  /**
   * Analyze past evolution cycles to identify success patterns,
   * failure reasons, and generate improvement recommendations.
   */
  async learnFromHistory(): Promise<LearningInsights> {
    const emptyInsights: LearningInsights = {
      successPatterns: [],
      failurePatterns: [],
      recommendations: [],
      riskFactors: [],
    };

    if (this.history.length === 0) {
      return {
        ...emptyInsights,
        recommendations: ['No evolution history available yet. Run some evolution cycles first.'],
      };
    }

    const summary = this.history.map((cycle) => ({
      goal: cycle.goal,
      goalType: cycle.goalType,
      strategy: cycle.strategy,
      success: cycle.success,
      phases: cycle.phases.map((p) => ({
        phase: p.phase,
        success: p.success,
        durationMs: p.durationMs,
      })),
      error: cycle.error,
    }));

    const prompt = [
      'Analyze the following history of software evolution cycles and identify patterns.',
      '',
      'Respond in JSON with these keys:',
      '  - successPatterns: string[] (patterns that lead to successful outcomes)',
      '  - failurePatterns: string[] (patterns that lead to failures)',
      '  - recommendations: string[] (actionable suggestions to improve future cycles)',
      '  - riskFactors: string[] (factors that increase risk of failure)',
      '',
      '--- Evolution History ---',
      JSON.stringify(summary, null, 2),
      '',
      'Output ONLY the JSON object, no other text.',
    ].join('\n');

    const result = await runCCPrint(prompt, this.workspacePath);

    if (result.exitCode !== 0) {
      logger.error('[EvolutionEngine] learnFromHistory failed', { error: result.stderr });
      return emptyInsights;
    }

    const parsed = parseJSON<Partial<LearningInsights>>(result.stdout, emptyInsights);

    return {
      successPatterns: Array.isArray(parsed.successPatterns) ? parsed.successPatterns : [],
      failurePatterns: Array.isArray(parsed.failurePatterns) ? parsed.failurePatterns : [],
      recommendations: Array.isArray(parsed.recommendations) ? parsed.recommendations : [],
      riskFactors: Array.isArray(parsed.riskFactors) ? parsed.riskFactors : [],
    };
  }

  // -----------------------------------------------------------------------
  // (c) Impact Assessment
  // -----------------------------------------------------------------------

  /**
   * Evaluate the potential impact of planned changes on existing functionality
   * before execution, determining risk level and required testing.
   */
  async assessImpact(changes: PlannedChange[]): Promise<ImpactAssessment> {
    const defaultAssessment: ImpactAssessment = {
      riskLevel: 'medium',
      affectedModules: [],
      breakingChanges: false,
      testingRequired: [],
      rollbackPlan: 'Revert the committed changes via git revert',
    };

    if (changes.length === 0) {
      return { ...defaultAssessment, riskLevel: 'low' };
    }

    const prompt = [
      'You are a senior software engineer. Assess the impact of the following planned changes.',
      '',
      'Respond in JSON with these keys:',
      '  - riskLevel: "low" | "medium" | "high" | "critical"',
      '  - affectedModules: string[] (modules/packages affected)',
      '  - breakingChanges: boolean',
      '  - testingRequired: string[] (specific test areas needed)',
      '  - rollbackPlan: string (how to undo the changes)',
      '',
      '--- Planned Changes ---',
      JSON.stringify(changes, null, 2),
      '',
      'Output ONLY the JSON object, no other text.',
    ].join('\n');

    const result = await runCCPrint(prompt, this.workspacePath);

    if (result.exitCode !== 0) {
      logger.error('[EvolutionEngine] assessImpact failed', { error: result.stderr });
      return defaultAssessment;
    }

    const parsed = parseJSON<Partial<ImpactAssessment>>(result.stdout, defaultAssessment);

    return {
      riskLevel: parsed.riskLevel ?? 'medium',
      affectedModules: Array.isArray(parsed.affectedModules) ? parsed.affectedModules : [],
      breakingChanges: parsed.breakingChanges ?? false,
      testingRequired: Array.isArray(parsed.testingRequired) ? parsed.testingRequired : [],
      rollbackPlan: parsed.rollbackPlan ?? defaultAssessment.rollbackPlan,
    };
  }

  // -----------------------------------------------------------------------
  // (d) Strategy Selection
  // -----------------------------------------------------------------------

  /**
   * Select the optimal evolution strategy based on goal type and context.
   * Determines phase ordering, depth, and safety requirements.
   */
  selectStrategy(goal: string, context: EvolutionContext): EvolutionStrategy {
    const { goalType, history } = context;

    // Analyze recent failure rate for risk-adjusted strategy
    const recentCycles = history.slice(-10);
    const failureRate = recentCycles.length > 0
      ? recentCycles.filter((c) => !c.success).length / recentCycles.length
      : 0;
    const highRisk = failureRate > 0.3;

    switch (goalType) {
      case 'bugfix':
        return {
          name: 'bugfix-fast',
          phases: highRisk
            ? ['research', 'plan', 'develop', 'test']
            : ['research', 'develop', 'test'],
          maxDuration: Math.min(this.maxCycleDurationMs, 10 * 60 * 1000),
          safetyChecks: ['tsc', 'existing-tests', 'git-diff-review'],
        };

      case 'feature':
        return {
          name: 'feature-full',
          phases: ['research', 'design', 'requirements', 'plan', 'develop', 'test'],
          maxDuration: this.maxCycleDurationMs,
          safetyChecks: highRisk
            ? ['tsc', 'lint', 'unit-tests', 'integration-tests', 'manual-review']
            : ['tsc', 'unit-tests'],
        };

      case 'refactor':
        return {
          name: 'refactor-safe',
          phases: ['research', 'design', 'plan', 'develop', 'test'],
          maxDuration: Math.min(this.maxCycleDurationMs, 20 * 60 * 1000),
          safetyChecks: ['tsc', 'existing-tests', 'regression-tests', 'git-diff-review'],
        };

      case 'optimization':
        return {
          name: 'optimization-measured',
          phases: ['research', 'plan', 'develop', 'test'],
          maxDuration: Math.min(this.maxCycleDurationMs, 15 * 60 * 1000),
          safetyChecks: ['tsc', 'benchmark', 'existing-tests'],
        };

      default:
        return {
          name: 'default',
          phases: ['research', 'design', 'requirements', 'plan', 'develop', 'test'],
          maxDuration: this.maxCycleDurationMs,
          safetyChecks: ['tsc', 'existing-tests'],
        };
    }
  }

  // -----------------------------------------------------------------------
  // (e) Full Evolution Cycle with real-time progress
  // -----------------------------------------------------------------------

  /**
   * Execute a full evolution cycle with real-time progress events.
   *
   * Emits events via the global event bus:
   * - evolution:start
   * - evolution:phase (with progress percentage)
   * - evolution:subgoal
   * - evolution:complete
   */
  async evolve(
    goal: string,
    goalType: EvolutionGoalType = 'feature',
  ): Promise<EvolutionCycleRecord> {
    const cycleId = uuid();
    const startedAt = new Date().toISOString();
    const startMs = Date.now();

    // Build context and select strategy
    const context: EvolutionContext = {
      workspacePath: this.workspacePath,
      goalType,
      history: this.history,
    };
    const strategy = this.selectStrategy(goal, context);

    logger.info(`[EvolutionEngine] Starting evolution cycle: ${strategy.name}`, { goal, goalType });
    eventBus.emit('evolution:start', { goal, strategy: strategy.name });

    const phaseResults: EvolutionPhaseResult[] = [];
    const completedPhases: EvolutionPhaseName[] = [];
    let subGoals: SubGoal[] = [];
    let overallSuccess = true;
    let overallError: string | undefined;

    // Decompose goal into sub-goals
    try {
      subGoals = await this.decomposeGoal(goal);
      for (const sg of subGoals) {
        eventBus.emit('evolution:subgoal', { subGoalId: sg.id, title: sg.title, status: sg.status });
      }
    } catch (err) {
      logger.warn('[EvolutionEngine] Goal decomposition failed, proceeding as single goal', { error: err });
    }

    // Execute each phase
    for (const phaseName of strategy.phases) {
      // Check timeout
      if (Date.now() - startMs > strategy.maxDuration) {
        overallSuccess = false;
        overallError = `Evolution cycle timed out after ${strategy.maxDuration}ms`;
        logger.warn(`[EvolutionEngine] Cycle timed out`, { goal });
        break;
      }

      const progress = computeProgress(completedPhases, strategy.phases);
      eventBus.emit('evolution:phase', {
        phase: phaseName,
        status: 'start',
        progress,
        message: `Starting phase: ${phaseName}`,
      });

      const phaseStart = Date.now();
      const phaseResult = await this.executePhase(phaseName, goal, phaseResults);

      phaseResults.push(phaseResult);
      completedPhases.push(phaseName);

      const phaseProgress = computeProgress(completedPhases, strategy.phases);
      eventBus.emit('evolution:phase', {
        phase: phaseName,
        status: phaseResult.success ? 'complete' : 'error',
        progress: phaseProgress,
        message: phaseResult.success
          ? `Phase ${phaseName} completed in ${phaseResult.durationMs}ms`
          : `Phase ${phaseName} failed: ${phaseResult.error ?? 'unknown error'}`,
      });

      if (!phaseResult.success) {
        overallSuccess = false;
        overallError = `Phase ${phaseName} failed: ${phaseResult.error ?? 'unknown error'}`;
        logger.error(`[EvolutionEngine] Phase ${phaseName} failed`, { error: phaseResult.error });
        break;
      }
    }

    // Update sub-goal statuses
    for (const sg of subGoals) {
      sg.status = overallSuccess ? 'completed' : 'failed';
      eventBus.emit('evolution:subgoal', { subGoalId: sg.id, title: sg.title, status: sg.status });
    }

    const durationMs = Date.now() - startMs;

    // Record the cycle
    const record: EvolutionCycleRecord = {
      id: cycleId,
      goal,
      goalType,
      strategy: strategy.name,
      phases: phaseResults,
      subGoals,
      success: overallSuccess,
      startedAt,
      completedAt: new Date().toISOString(),
      error: overallError,
    };

    this.history.push(record);
    this.saveHistory();

    eventBus.emit('evolution:complete', {
      goal,
      success: overallSuccess,
      durationMs,
      error: overallError,
    });

    logger.info(`[EvolutionEngine] Evolution cycle ${overallSuccess ? 'succeeded' : 'failed'}`, {
      goal,
      durationMs,
      strategy: strategy.name,
    });

    return record;
  }

  // -----------------------------------------------------------------------
  // Phase execution
  // -----------------------------------------------------------------------

  private async executePhase(
    phase: EvolutionPhaseName,
    goal: string,
    previousResults: EvolutionPhaseResult[],
  ): Promise<EvolutionPhaseResult> {
    const startMs = Date.now();

    const previousContext = previousResults.length > 0
      ? previousResults
          .map((r) => `[${r.phase}]: ${r.output.slice(0, 500)}`)
          .join('\n')
      : 'No previous phases completed yet.';

    const phasePrompts: Record<EvolutionPhaseName, string> = {
      research: [
        `Research phase for goal: "${goal}"`,
        'Analyze the codebase and identify relevant files, patterns, and dependencies.',
        'Provide a summary of findings and potential approaches.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),

      design: [
        `Design phase for goal: "${goal}"`,
        'Based on the research findings, create a high-level design.',
        'Define the architecture, component interactions, and data flow.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),

      requirements: [
        `Requirements phase for goal: "${goal}"`,
        'Define specific, testable requirements for the implementation.',
        'List acceptance criteria and edge cases to handle.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),

      plan: [
        `Planning phase for goal: "${goal}"`,
        'Create a step-by-step implementation plan.',
        'List files to create or modify, and the order of changes.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),

      develop: [
        `Development phase for goal: "${goal}"`,
        'Implement the planned changes following existing project conventions.',
        'Create or modify files as specified in the plan.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),

      test: [
        `Testing phase for goal: "${goal}"`,
        'Verify the implementation by running type checks and existing tests.',
        'Report any issues found.',
        '',
        '--- Previous Phase Results ---',
        previousContext,
      ].join('\n'),
    };

    const prompt = phasePrompts[phase];
    const result = await runCCPrint(prompt, this.workspacePath);

    return {
      phase,
      success: result.exitCode === 0,
      output: result.stdout || result.stderr,
      durationMs: Date.now() - startMs,
      error: result.exitCode !== 0 ? (result.stderr || 'Phase execution failed') : undefined,
    };
  }
}
