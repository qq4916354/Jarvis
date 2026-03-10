// ============================================================================
// Event Bus - Typed application-wide event emitter for Jarvis
// ============================================================================

import EventEmitter from 'eventemitter3';
import type { JarvisEventMap, JarvisEventName } from '../types.js';

/**
 * Listener signature: receives the event payload for a given event name.
 */
type EventListener<K extends JarvisEventName> = (payload: JarvisEventMap[K]) => void;

/**
 * A strongly-typed event bus for cross-module communication within Jarvis.
 *
 * Supported events:
 * - workspace:created / workspace:updated / workspace:deleted
 * - agent:message / agent:error
 * - heartbeat:tick
 * - upgrade:start / upgrade:complete
 * - lark:message
 * - loop:iteration
 * - task:started / task:completed / task:failed
 * - memory:updated
 */
class JarvisEventBus {
  private readonly emitter = new EventEmitter();

  /**
   * Subscribe to a typed event.
   */
  on<K extends JarvisEventName>(event: K, listener: EventListener<K>): this {
    this.emitter.on(event, listener);
    return this;
  }

  /**
   * Subscribe to a typed event, automatically unsubscribing after the first firing.
   */
  once<K extends JarvisEventName>(event: K, listener: EventListener<K>): this {
    this.emitter.once(event, listener);
    return this;
  }

  /**
   * Remove a previously registered listener.
   */
  off<K extends JarvisEventName>(event: K, listener: EventListener<K>): this {
    this.emitter.off(event, listener);
    return this;
  }

  /**
   * Emit a typed event with its payload.
   */
  emit<K extends JarvisEventName>(event: K, payload: JarvisEventMap[K]): boolean {
    return this.emitter.emit(event, payload);
  }

  /**
   * Convenience helper that mirrors the old `emitEvent` API.
   * Kept for backward compatibility with modules that used the previous event bus.
   */
  emitEvent(type: string, payload: unknown): void {
    this.emitter.emit(type, payload);
  }

  /**
   * Remove all listeners, optionally for a specific event.
   */
  removeAllListeners(event?: JarvisEventName): this {
    if (event) {
      this.emitter.removeAllListeners(event);
    } else {
      this.emitter.removeAllListeners();
    }
    return this;
  }

  /**
   * Return the number of listeners registered for a given event.
   */
  listenerCount(event: JarvisEventName): number {
    return this.emitter.listenerCount(event);
  }
}

/** Singleton event bus instance shared across the Jarvis process. */
const eventBus = new JarvisEventBus();

export { JarvisEventBus };
export default eventBus;
