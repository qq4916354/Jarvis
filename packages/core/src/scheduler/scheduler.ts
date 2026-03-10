// ============================================================
// Jarvis Scheduler – cron, interval, one-time, heartbeat & loop mode
// ============================================================

import cron, { ScheduledTask } from 'node-cron';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';

import type {
  UUID,
  ISOTimestamp,
  CronExpression,
  LoopModeConfig,
  TaskDefinition,
  TaskStatus,
  SchedulerConfig,
} from '../types';

// ------------------------------------------------------------------
// Local types
// ------------------------------------------------------------------

export type ScheduledTaskType = 'cron' | 'interval' | 'once';

export interface ScheduledTaskEntry {
  id: UUID;
  name: string;
  workspaceId: UUID;
  type: ScheduledTaskType;
  config: {
    cronExpression?: CronExpression;
    intervalMs?: number;
    delayMs?: number;
  };
  handler: () => Promise<void> | void;
  status: TaskStatus;
  createdAt: ISOTimestamp;
  lastRunAt?: ISOTimestamp;
}

interface LoopState {
  running: boolean;
  timerId: ReturnType<typeof setTimeout> | null;
  iteration: number;
  config: LoopModeConfig;
}

export interface SchedulerEvents {
  'heartbeat:tick': (workspaceId: UUID, timestamp: ISOTimestamp) => void;
  'loop:iteration': (workspaceId: UUID, iteration: number, timestamp: ISOTimestamp) => void;
  'task:started': (taskId: UUID) => void;
  'task:completed': (taskId: UUID) => void;
  'task:failed': (taskId: UUID, error: Error) => void;
}

// ------------------------------------------------------------------
// Internal handle bookkeeping
// ------------------------------------------------------------------

interface TaskHandle {
  entry: ScheduledTaskEntry;
  cronJob?: ScheduledTask;
  timerId?: ReturnType<typeof setTimeout> | ReturnType<typeof setInterval>;
}

// ------------------------------------------------------------------
// Scheduler
// ------------------------------------------------------------------

export class Scheduler extends EventEmitter<SchedulerEvents> {
  private tasks = new Map<UUID, TaskHandle>();
  private heartbeats = new Map<UUID, ReturnType<typeof setInterval>>();
  private loops = new Map<UUID, LoopState>();
  private config: SchedulerConfig;

  /** Optional hook – called during loop mode to plan & execute the next step. */
  public onLoopIteration?: (
    workspaceId: UUID,
    goal: string,
    iteration: number,
  ) => Promise<void>;

  constructor(config?: Partial<SchedulerConfig>) {
    super();
    this.config = {
      maxConcurrentTasks: config?.maxConcurrentTasks ?? 10,
      defaultTimeoutMs: config?.defaultTimeoutMs ?? 60_000,
    };
  }

  // ----------------------------------------------------------------
  // schedule / cancel / list
  // ----------------------------------------------------------------

  /**
   * Register and start a scheduled task.
   * Returns the task id.
   */
  schedule(task: Omit<ScheduledTaskEntry, 'id' | 'status' | 'createdAt'>): UUID {
    const id: UUID = uuid();
    const entry: ScheduledTaskEntry = {
      ...task,
      id,
      status: 'pending',
      createdAt: new Date().toISOString(),
    };

    const handle: TaskHandle = { entry };

    const wrappedHandler = async () => {
      entry.status = 'running';
      entry.lastRunAt = new Date().toISOString();
      this.emit('task:started', id);
      try {
        await entry.handler();
        entry.status = 'completed';
        this.emit('task:completed', id);
      } catch (err) {
        entry.status = 'failed';
        this.emit('task:failed', id, err instanceof Error ? err : new Error(String(err)));
      }
    };

    switch (task.type) {
      case 'cron': {
        const expr = task.config.cronExpression;
        if (!expr) throw new Error('cronExpression is required for cron tasks');
        if (!cron.validate(expr)) throw new Error(`Invalid cron expression: ${expr}`);
        handle.cronJob = cron.schedule(expr, () => { void wrappedHandler(); });
        break;
      }
      case 'interval': {
        const ms = task.config.intervalMs;
        if (!ms || ms <= 0) throw new Error('intervalMs must be a positive number for interval tasks');
        handle.timerId = setInterval(() => { void wrappedHandler(); }, ms);
        break;
      }
      case 'once': {
        const delay = task.config.delayMs ?? 0;
        handle.timerId = setTimeout(() => {
          void wrappedHandler().finally(() => {
            this.tasks.delete(id);
          });
        }, delay);
        break;
      }
      default:
        throw new Error(`Unknown task type: ${task.type}`);
    }

    this.tasks.set(id, handle);
    return id;
  }

  /**
   * Cancel a previously scheduled task.
   */
  cancel(taskId: UUID): boolean {
    const handle = this.tasks.get(taskId);
    if (!handle) return false;

    if (handle.cronJob) {
      handle.cronJob.stop();
    }
    if (handle.timerId !== undefined) {
      // Works for both setTimeout and setInterval ids
      clearTimeout(handle.timerId as ReturnType<typeof setTimeout>);
      clearInterval(handle.timerId as ReturnType<typeof setInterval>);
    }

    handle.entry.status = 'cancelled';
    this.tasks.delete(taskId);
    return true;
  }

  /**
   * List registered tasks, optionally filtered by workspace.
   */
  list(workspaceId?: UUID): ScheduledTaskEntry[] {
    const entries: ScheduledTaskEntry[] = [];
    for (const handle of this.tasks.values()) {
      if (!workspaceId || handle.entry.workspaceId === workspaceId) {
        entries.push({ ...handle.entry });
      }
    }
    return entries;
  }

  // ----------------------------------------------------------------
  // Heartbeat
  // ----------------------------------------------------------------

  /**
   * Start a heartbeat that fires `heartbeat:tick` at a fixed interval.
   */
  startHeartbeat(workspaceId: UUID, intervalMs: number = 30_000): void {
    this.stopHeartbeat(workspaceId); // ensure no duplicate
    const timerId = setInterval(() => {
      const ts = new Date().toISOString();
      this.emit('heartbeat:tick', workspaceId, ts);
    }, intervalMs);
    this.heartbeats.set(workspaceId, timerId);
  }

  /**
   * Stop the heartbeat for a workspace.
   */
  stopHeartbeat(workspaceId: UUID): void {
    const timerId = this.heartbeats.get(workspaceId);
    if (timerId !== undefined) {
      clearInterval(timerId);
      this.heartbeats.delete(workspaceId);
    }
  }

  // ----------------------------------------------------------------
  // Loop mode
  // ----------------------------------------------------------------

  /**
   * Start loop mode for a workspace. The loop periodically triggers goal
   * evaluation, plans next steps, executes them, and logs progress.
   */
  startLoopMode(workspaceId: UUID, config: LoopModeConfig): void {
    this.stopLoopMode(workspaceId);

    const intervalMs = Math.max(config.intervalMinutes, 1) * 60_000;

    const state: LoopState = {
      running: true,
      timerId: null,
      iteration: 0,
      config,
    };

    const tick = async () => {
      if (!state.running) return;
      if (config.maxIterations > 0 && state.iteration >= config.maxIterations) {
        this.stopLoopMode(workspaceId);
        return;
      }

      state.iteration++;
      const ts = new Date().toISOString();
      this.emit('loop:iteration', workspaceId, state.iteration, ts);

      try {
        if (this.onLoopIteration) {
          await this.onLoopIteration(workspaceId, config.goal, state.iteration);
        }
      } catch (_err) {
        // loop keeps going even if one iteration fails
      }

      if (state.running) {
        state.timerId = setTimeout(() => { void tick(); }, intervalMs);
      }
    };

    this.loops.set(workspaceId, state);

    // first tick after initial delay
    state.timerId = setTimeout(() => { void tick(); }, intervalMs);
  }

  /**
   * Stop loop mode for a workspace.
   */
  stopLoopMode(workspaceId: UUID): void {
    const state = this.loops.get(workspaceId);
    if (!state) return;
    state.running = false;
    if (state.timerId !== null) {
      clearTimeout(state.timerId);
      state.timerId = null;
    }
    this.loops.delete(workspaceId);
  }

  // ----------------------------------------------------------------
  // Lifecycle
  // ----------------------------------------------------------------

  /**
   * Destroy the scheduler – cancels every task, heartbeat, and loop.
   */
  destroy(): void {
    for (const id of this.tasks.keys()) {
      this.cancel(id);
    }
    for (const wid of this.heartbeats.keys()) {
      this.stopHeartbeat(wid);
    }
    for (const wid of this.loops.keys()) {
      this.stopLoopMode(wid);
    }
    this.removeAllListeners();
  }
}
