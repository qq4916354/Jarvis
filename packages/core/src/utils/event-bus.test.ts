import { describe, it, expect, beforeEach, vi } from 'vitest';
import { JarvisEventBus } from './event-bus';

describe('JarvisEventBus', () => {
  let bus: JarvisEventBus;

  beforeEach(() => {
    bus = new JarvisEventBus();
  });

  it('should emit and receive events via on()', () => {
    const listener = vi.fn();
    bus.on('workspace:created', listener);
    bus.emit('workspace:created', { workspaceId: 'w1', name: 'Test' });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'Test' });
  });

  it('should support multiple listeners for the same event', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    bus.on('workspace:deleted', l1);
    bus.on('workspace:deleted', l2);
    bus.emit('workspace:deleted', { workspaceId: 'w1' });

    expect(l1).toHaveBeenCalledOnce();
    expect(l2).toHaveBeenCalledOnce();
  });

  it('should fire once() listener only once', () => {
    const listener = vi.fn();
    bus.once('task:started', listener);

    bus.emit('task:started', { taskId: 't1', workspaceId: 'w1' });
    bus.emit('task:started', { taskId: 't2', workspaceId: 'w1' });

    expect(listener).toHaveBeenCalledOnce();
  });

  it('should remove listener via off()', () => {
    const listener = vi.fn();
    bus.on('agent:message', listener);
    bus.off('agent:message', listener);

    bus.emit('agent:message', { workspaceId: 'w1', message: {} as any });
    expect(listener).not.toHaveBeenCalled();
  });

  it('should return correct listenerCount', () => {
    const l1 = vi.fn();
    const l2 = vi.fn();
    expect(bus.listenerCount('workspace:created')).toBe(0);

    bus.on('workspace:created', l1);
    expect(bus.listenerCount('workspace:created')).toBe(1);

    bus.on('workspace:created', l2);
    expect(bus.listenerCount('workspace:created')).toBe(2);

    bus.off('workspace:created', l1);
    expect(bus.listenerCount('workspace:created')).toBe(1);
  });

  it('should removeAllListeners for a specific event', () => {
    bus.on('task:started', vi.fn());
    bus.on('task:started', vi.fn());
    bus.on('task:completed', vi.fn());

    bus.removeAllListeners('task:started');

    expect(bus.listenerCount('task:started')).toBe(0);
    expect(bus.listenerCount('task:completed')).toBe(1);
  });

  it('should removeAllListeners for all events', () => {
    bus.on('task:started', vi.fn());
    bus.on('task:completed', vi.fn());

    bus.removeAllListeners();

    expect(bus.listenerCount('task:started')).toBe(0);
    expect(bus.listenerCount('task:completed')).toBe(0);
  });

  it('should return this from chainable methods', () => {
    const listener = vi.fn();
    expect(bus.on('workspace:created', listener)).toBe(bus);
    expect(bus.once('workspace:deleted', listener)).toBe(bus);
    expect(bus.off('workspace:created', listener)).toBe(bus);
    expect(bus.removeAllListeners()).toBe(bus);
  });

  it('should emit return false when no listeners', () => {
    const result = bus.emit('workspace:created', { workspaceId: 'w1', name: 'Test' });
    expect(result).toBe(false);
  });

  it('should emit return true when listeners exist', () => {
    bus.on('workspace:created', vi.fn());
    const result = bus.emit('workspace:created', { workspaceId: 'w1', name: 'Test' });
    expect(result).toBe(true);
  });

  it('should support emitEvent for backward compatibility', () => {
    const listener = vi.fn();
    bus.on('workspace:created' as any, listener);
    bus.emitEvent('workspace:created', { workspaceId: 'w1', name: 'Test' });
    expect(listener).toHaveBeenCalledWith({ workspaceId: 'w1', name: 'Test' });
  });
});
