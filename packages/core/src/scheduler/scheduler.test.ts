import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Scheduler } from './scheduler';

describe('Scheduler', () => {
  let scheduler: Scheduler;

  beforeEach(() => {
    vi.useFakeTimers();
    scheduler = new Scheduler({ maxConcurrentTasks: 10, defaultTimeoutMs: 5000 });
  });

  afterEach(() => {
    scheduler.destroy();
    vi.useRealTimers();
  });

  describe('schedule - once', () => {
    it('should schedule and execute a one-time task', async () => {
      const handler = vi.fn();
      const taskId = scheduler.schedule({
        name: 'one-shot',
        workspaceId: 'w1',
        type: 'once',
        config: { delayMs: 100 },
        handler,
      });

      expect(taskId).toBeTruthy();
      expect(handler).not.toHaveBeenCalled();

      await vi.advanceTimersByTimeAsync(150);
      expect(handler).toHaveBeenCalledOnce();
    });

    it('should emit task:started and task:completed events', async () => {
      const started = vi.fn();
      const completed = vi.fn();
      scheduler.on('task:started', started);
      scheduler.on('task:completed', completed);

      scheduler.schedule({
        name: 'events-test',
        workspaceId: 'w1',
        type: 'once',
        config: { delayMs: 0 },
        handler: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(started).toHaveBeenCalledOnce();
      expect(completed).toHaveBeenCalledOnce();
    });

    it('should emit task:failed when handler throws', async () => {
      const failed = vi.fn();
      scheduler.on('task:failed', failed);

      scheduler.schedule({
        name: 'failing-task',
        workspaceId: 'w1',
        type: 'once',
        config: { delayMs: 0 },
        handler: () => { throw new Error('boom'); },
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(failed).toHaveBeenCalledOnce();
      expect(failed.mock.calls[0][1].message).toBe('boom');
    });

    it('should auto-remove once task after execution', async () => {
      const taskId = scheduler.schedule({
        name: 'auto-cleanup',
        workspaceId: 'w1',
        type: 'once',
        config: { delayMs: 0 },
        handler: vi.fn(),
      });

      await vi.advanceTimersByTimeAsync(10);
      expect(scheduler.list()).toHaveLength(0);
    });
  });

  describe('schedule - interval', () => {
    it('should run handler at intervals', async () => {
      const handler = vi.fn();
      scheduler.schedule({
        name: 'repeating',
        workspaceId: 'w1',
        type: 'interval',
        config: { intervalMs: 100 },
        handler,
      });

      await vi.advanceTimersByTimeAsync(350);
      expect(handler).toHaveBeenCalledTimes(3);
    });

    it('should throw for invalid intervalMs', () => {
      expect(() => {
        scheduler.schedule({
          name: 'bad-interval',
          workspaceId: 'w1',
          type: 'interval',
          config: { intervalMs: 0 },
          handler: vi.fn(),
        });
      }).toThrow('intervalMs must be a positive number');
    });
  });

  describe('schedule - cron', () => {
    it('should throw for invalid cron expression', () => {
      expect(() => {
        scheduler.schedule({
          name: 'bad-cron',
          workspaceId: 'w1',
          type: 'cron',
          config: { cronExpression: 'invalid' },
          handler: vi.fn(),
        });
      }).toThrow('Invalid cron expression');
    });

    it('should throw when cronExpression is missing', () => {
      expect(() => {
        scheduler.schedule({
          name: 'no-cron',
          workspaceId: 'w1',
          type: 'cron',
          config: {},
          handler: vi.fn(),
        });
      }).toThrow('cronExpression is required');
    });
  });

  describe('cancel', () => {
    it('should cancel a scheduled task', async () => {
      const handler = vi.fn();
      const taskId = scheduler.schedule({
        name: 'cancellable',
        workspaceId: 'w1',
        type: 'interval',
        config: { intervalMs: 100 },
        handler,
      });

      const cancelled = scheduler.cancel(taskId);
      expect(cancelled).toBe(true);

      await vi.advanceTimersByTimeAsync(500);
      expect(handler).not.toHaveBeenCalled();
    });

    it('should return false for non-existent task', () => {
      expect(scheduler.cancel('non-existent')).toBe(false);
    });
  });

  describe('list', () => {
    it('should list all tasks', () => {
      scheduler.schedule({
        name: 't1',
        workspaceId: 'w1',
        type: 'interval',
        config: { intervalMs: 1000 },
        handler: vi.fn(),
      });
      scheduler.schedule({
        name: 't2',
        workspaceId: 'w2',
        type: 'interval',
        config: { intervalMs: 1000 },
        handler: vi.fn(),
      });

      expect(scheduler.list()).toHaveLength(2);
    });

    it('should filter by workspaceId', () => {
      scheduler.schedule({
        name: 't1',
        workspaceId: 'w1',
        type: 'interval',
        config: { intervalMs: 1000 },
        handler: vi.fn(),
      });
      scheduler.schedule({
        name: 't2',
        workspaceId: 'w2',
        type: 'interval',
        config: { intervalMs: 1000 },
        handler: vi.fn(),
      });

      const w1Tasks = scheduler.list('w1');
      expect(w1Tasks).toHaveLength(1);
      expect(w1Tasks[0].name).toBe('t1');
    });
  });

  describe('heartbeat', () => {
    it('should emit heartbeat:tick events', async () => {
      const listener = vi.fn();
      scheduler.on('heartbeat:tick', listener);

      scheduler.startHeartbeat('w1', 100);
      await vi.advanceTimersByTimeAsync(350);

      expect(listener).toHaveBeenCalledTimes(3);
      expect(listener.mock.calls[0][0]).toBe('w1');
    });

    it('should stop heartbeat', async () => {
      const listener = vi.fn();
      scheduler.on('heartbeat:tick', listener);

      scheduler.startHeartbeat('w1', 100);
      await vi.advanceTimersByTimeAsync(150);

      scheduler.stopHeartbeat('w1');
      await vi.advanceTimersByTimeAsync(500);

      expect(listener).toHaveBeenCalledTimes(1);
    });

    it('should replace existing heartbeat on restart', async () => {
      const listener = vi.fn();
      scheduler.on('heartbeat:tick', listener);

      scheduler.startHeartbeat('w1', 100);
      scheduler.startHeartbeat('w1', 200);

      await vi.advanceTimersByTimeAsync(250);
      expect(listener).toHaveBeenCalledTimes(1);
    });
  });

  describe('loop mode', () => {
    it('should emit loop:iteration events', async () => {
      const listener = vi.fn();
      scheduler.on('loop:iteration', listener);

      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'test goal',
        maxIterations: 3,
      });

      // First tick after 1 minute
      await vi.advanceTimersByTimeAsync(60_000 + 100);
      expect(listener).toHaveBeenCalledTimes(1);
      expect(listener.mock.calls[0][0]).toBe('w1'); // workspaceId
      expect(listener.mock.calls[0][1]).toBe(1); // iteration
    });

    it('should call onLoopIteration hook', async () => {
      const hook = vi.fn();
      scheduler.onLoopIteration = hook;

      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'build something',
        maxIterations: 2,
      });

      await vi.advanceTimersByTimeAsync(60_000 + 100);
      expect(hook).toHaveBeenCalledWith('w1', 'build something', 1);
    });

    it('should stop after maxIterations', async () => {
      const listener = vi.fn();
      scheduler.on('loop:iteration', listener);

      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'test',
        maxIterations: 2,
      });

      await vi.advanceTimersByTimeAsync(60_000 * 3 + 1000);
      expect(listener).toHaveBeenCalledTimes(2);
    });

    it('should stop loop mode', async () => {
      const listener = vi.fn();
      scheduler.on('loop:iteration', listener);

      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'test',
        maxIterations: 0,
      });

      scheduler.stopLoopMode('w1');
      await vi.advanceTimersByTimeAsync(120_000);
      expect(listener).not.toHaveBeenCalled();
    });

    it('should continue loop even if iteration fails', async () => {
      const listener = vi.fn();
      scheduler.on('loop:iteration', listener);
      scheduler.onLoopIteration = async () => { throw new Error('fail'); };

      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'test',
        maxIterations: 3,
      });

      await vi.advanceTimersByTimeAsync(60_000 * 2 + 1000);
      expect(listener).toHaveBeenCalledTimes(2);
    });
  });

  describe('destroy', () => {
    it('should cancel all tasks, heartbeats, and loops', async () => {
      const handler = vi.fn();
      scheduler.schedule({
        name: 't1',
        workspaceId: 'w1',
        type: 'interval',
        config: { intervalMs: 100 },
        handler,
      });
      scheduler.startHeartbeat('w1', 100);
      scheduler.startLoopMode('w1', {
        enabled: true,
        intervalMinutes: 1,
        goal: 'test',
        maxIterations: 0,
      });

      scheduler.destroy();
      await vi.advanceTimersByTimeAsync(500);

      expect(handler).not.toHaveBeenCalled();
      expect(scheduler.list()).toHaveLength(0);
    });
  });
});
