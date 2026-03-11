/**
 * CCSession - Claude Code subprocess manager with session management
 * and streaming support.
 *
 * Wraps the `claude` CLI as a child process, parsing its NDJSON stream
 * output into typed events. Each session tracks a conversation via
 * session ID so it can be resumed across process restarts.
 */

import { spawn, ChildProcess } from 'node:child_process';
import { EventEmitter } from 'eventemitter3';
import { v4 as uuid } from 'uuid';
import { createLogger } from '../utils/logger.js';

const log = createLogger('CCSession');

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CCSessionOptions {
  /** Working directory for the Claude Code subprocess. */
  workspacePath: string;
  /** Existing session ID to resume. Generated if omitted. */
  sessionId?: string;
  /** System prompt injected via --system-prompt flag. */
  systemPrompt?: string;
  /** Restrict tool usage to this allow-list. */
  allowedTools?: string[];
  /** Maximum agentic turns before the process stops. */
  maxTurns?: number;
  /** Model override (e.g. "claude-opus-4-6"). */
  model?: string;
  /** Skip all permission prompts (YOLO mode). Defaults to true. */
  dangerouslySkipPermissions?: boolean;
}

/**
 * Content item inside an assistant message's content array.
 */
interface ContentItem {
  type: string;
  text?: string;
  thinking?: string;
  id?: string;
  name?: string;
  input?: Record<string, unknown>;
}

/**
 * Claude Code CLI stream-json event (loosely typed to handle all variants).
 */
interface CCRawEvent {
  type: string;
  subtype?: string;
  // assistant events
  message?: {
    id?: string;
    role?: string;
    model?: string;
    content?: ContentItem[] | string;
    stop_reason?: string;
  };
  // tool_use (top-level)
  id?: string;
  tool_name?: string;
  name?: string;
  input?: Record<string, unknown>;
  // tool_result
  result?: string;
  is_error?: boolean;
  // result event
  duration_ms?: number;
  session_id?: string;
  // error
  error?: string;
  // stream_event wrapper
  event?: {
    type: string;
    index?: number;
    content_block?: ContentItem;
    delta?: { type: string; text?: string; thinking?: string };
  };
  // system
  cwd?: string;
  tools?: string[];
  model?: string;
  text?: string;
  uuid?: string;
}

/** Re-export a narrower type for external consumers. */
export type CCStreamEvent = CCRawEvent;

interface CCSessionEvents {
  message: (text: string) => void;
  thinking: (text: string) => void;
  tool_use: (name: string, input: Record<string, unknown>) => void;
  tool_result: (name: string, content: string) => void;
  result: (text: string, sessionId: string) => void;
  system: (info: { sessionId: string; model?: string; tools?: string[] }) => void;
  error: (error: Error) => void;
  done: (code: number | null) => void;
}

// ---------------------------------------------------------------------------
// CCSession
// ---------------------------------------------------------------------------

export class CCSession extends EventEmitter<CCSessionEvents> {
  private readonly sessionId: string;
  private readonly workspacePath: string;
  private readonly systemPrompt?: string;
  private readonly allowedTools?: string[];
  private readonly maxTurns?: number;
  private readonly model?: string;
  private readonly dangerouslySkipPermissions: boolean;

  private process: ChildProcess | null = null;
  private hasResumed = false;
  /** Buffer for incomplete NDJSON lines from stdout. */
  private stdoutBuffer = '';
  /** Tracks whether stream_event deltas were received for current turn. */
  private receivedStreamDeltas = false;

  constructor(options: CCSessionOptions) {
    super();
    this.workspacePath = options.workspacePath;
    this.sessionId = options.sessionId ?? uuid();
    this.systemPrompt = options.systemPrompt;
    this.allowedTools = options.allowedTools;
    this.maxTurns = options.maxTurns;
    this.model = options.model;
    this.dangerouslySkipPermissions = options.dangerouslySkipPermissions ?? true;

    if (options.sessionId) {
      this.hasResumed = true;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  getSessionId(): string {
    return this.sessionId;
  }

  /**
   * Send a message to Claude Code.
   *
   * Spawns a new `claude` subprocess for each message (the CLI is
   * stateless between invocations; conversation continuity is handled
   * by `--session-id` / `--resume`).
   */
  send(message: string): void {
    if (this.process) {
      log.warn('A subprocess is already running; aborting it before sending a new message.');
      this.abort();
    }

    const args = this.buildArgs(message);

    log.info('Spawning claude subprocess', { sessionId: this.sessionId, cwd: this.workspacePath });
    log.debug('claude %s', args.join(' '));

    const child = spawn('claude', args, {
      cwd: this.workspacePath,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env },
    });

    this.process = child;
    this.stdoutBuffer = '';
    this.receivedStreamDeltas = false;

    child.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        log.debug('[claude stderr] %s', text);
      }
    });

    child.on('error', (err: Error) => {
      log.error('Failed to spawn claude process', { error: err.message });
      this.emit('error', err);
      this.cleanup();
    });

    child.on('close', (code: number | null, signal: string | null) => {
      this.flushBuffer();

      if (signal) {
        log.info(`claude process killed with signal ${signal}`);
      } else {
        log.info(`claude process exited with code ${code}`);
      }

      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`claude process exited with code ${code}`));
      }

      this.emit('done', code);
      this.cleanup();
    });

    this.hasResumed = true;
  }

  /** Kill the running subprocess (SIGTERM, then SIGKILL after timeout). */
  abort(): void {
    const child = this.process;
    if (!child || child.killed) return;

    log.info('Aborting claude subprocess (pid=%d)', child.pid);
    child.kill('SIGTERM');

    const killTimer = setTimeout(() => {
      if (!child.killed) {
        log.warn('claude subprocess did not exit after SIGTERM; sending SIGKILL');
        child.kill('SIGKILL');
      }
    }, 5_000);

    killTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  private buildArgs(message: string): string[] {
    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
    ];

    if (this.hasResumed) {
      args.push('--continue');
    } else {
      args.push('--session-id', this.sessionId);
    }

    if (this.dangerouslySkipPermissions) {
      args.push('--dangerously-skip-permissions');
    }

    if (this.systemPrompt) {
      args.push('--system-prompt', this.systemPrompt);
    }

    if (this.allowedTools && this.allowedTools.length > 0) {
      args.push('--allowedTools', this.allowedTools.join(','));
    }

    if (this.maxTurns !== undefined) {
      args.push('--max-turns', String(this.maxTurns));
    }

    if (this.model) {
      args.push('--model', this.model);
    }

    args.push(message);

    return args;
  }

  private handleStdoutChunk(chunk: Buffer): void {
    this.stdoutBuffer += chunk.toString('utf-8');

    let newlineIdx: number;
    while ((newlineIdx = this.stdoutBuffer.indexOf('\n')) !== -1) {
      const line = this.stdoutBuffer.slice(0, newlineIdx).trim();
      this.stdoutBuffer = this.stdoutBuffer.slice(newlineIdx + 1);

      if (line.length === 0) continue;
      this.parseLine(line);
    }
  }

  private flushBuffer(): void {
    const remaining = this.stdoutBuffer.trim();
    this.stdoutBuffer = '';
    if (remaining.length > 0) {
      this.parseLine(remaining);
    }
  }

  /**
   * Parse a single NDJSON line and emit the corresponding event.
   *
   * Claude Code CLI stream-json format (v2.x):
   *
   * - system:    {"type":"system","subtype":"init","session_id":"...","tools":[...]}
   * - assistant: {"type":"assistant","message":{"content":[{type:"text",text:"..."},{type:"thinking",thinking:"..."}]}}
   * - tool_use:  {"type":"tool_use","tool_name":"Read","input":{...}}
   * - tool_result: {"type":"tool_result","result":"...","is_error":false}
   * - stream_event: {"type":"stream_event","event":{"type":"content_block_delta","delta":{"type":"text_delta","text":"..."}}}
   * - result:    {"type":"result","subtype":"success","result":"...","session_id":"..."}
   * - error:     {"type":"error","error":"..."}
   */
  private parseLine(line: string): void {
    let event: CCRawEvent;
    try {
      event = JSON.parse(line);
    } catch {
      log.warn('Failed to parse NDJSON line: %s', line.substring(0, 200));
      return;
    }

    switch (event.type) {
      case 'system':
        this.handleSystemEvent(event);
        break;

      case 'assistant':
        this.handleAssistantEvent(event);
        break;

      case 'tool_use':
        this.handleToolUseEvent(event);
        break;

      case 'tool_result':
        this.handleToolResultEvent(event);
        break;

      case 'stream_event':
        this.handleStreamEvent(event);
        break;

      case 'result':
        this.handleResultEvent(event);
        break;

      case 'error':
        this.emit('error', new Error(event.error ?? 'Unknown CC error'));
        break;

      default:
        log.debug('Unhandled CC stream event type: %s', event.type);
        break;
    }
  }

  private handleSystemEvent(event: CCRawEvent): void {
    if (event.subtype === 'init') {
      this.emit('system', {
        sessionId: event.session_id ?? this.sessionId,
        model: event.model ?? undefined,
        tools: event.tools,
      });
    }
  }

  /**
   * Handle assistant events which contain a `message` object with a
   * `content` array of typed items: text, thinking, tool_use, etc.
   *
   * If we already received incremental stream_event deltas for text/thinking,
   * skip emitting from the assistant event to avoid duplication.
   */
  private handleAssistantEvent(event: CCRawEvent): void {
    const msg = event.message;
    if (!msg) return;

    const content = msg.content;
    if (!content) return;

    if (typeof content === 'string') {
      if (!this.receivedStreamDeltas) {
        this.emit('message', content);
      }
      return;
    }

    if (!Array.isArray(content)) return;

    for (const item of content) {
      switch (item.type) {
        case 'text':
          if (item.text && !this.receivedStreamDeltas) {
            this.emit('message', item.text);
          }
          break;

        case 'thinking':
          if (item.thinking && !this.receivedStreamDeltas) {
            this.emit('thinking', item.thinking);
          }
          break;

        case 'tool_use':
          if (item.name) {
            this.emit('tool_use', item.name, item.input ?? {});
          }
          break;

        default:
          break;
      }
    }
  }

  /**
   * Top-level tool_use event (outside of assistant message content).
   * Uses `tool_name` field (not `name`).
   */
  private handleToolUseEvent(event: CCRawEvent): void {
    const toolName = event.tool_name ?? event.name ?? 'unknown';
    this.emit('tool_use', toolName, event.input ?? {});
  }

  /**
   * Tool result event. Uses `result` field (not `content`).
   */
  private handleToolResultEvent(event: CCRawEvent): void {
    const resultText = typeof event.result === 'string' ? event.result : JSON.stringify(event.result ?? '');
    const toolName = event.name ?? event.tool_name ?? 'unknown';
    this.emit('tool_result', toolName, resultText);
  }

  /**
   * Stream event wrapper - contains incremental content block deltas
   * for real-time text/thinking streaming.
   */
  private handleStreamEvent(event: CCRawEvent): void {
    const inner = event.event;
    if (!inner) return;

    switch (inner.type) {
      case 'content_block_delta': {
        const delta = inner.delta;
        if (!delta) break;

        this.receivedStreamDeltas = true;

        if (delta.type === 'text_delta' && delta.text) {
          this.emit('message', delta.text);
        } else if (delta.type === 'thinking_delta' && delta.thinking) {
          this.emit('thinking', delta.thinking);
        }
        break;
      }

      default:
        break;
    }
  }

  /**
   * Final result event. Uses `result` field for text, `session_id` for session.
   */
  private handleResultEvent(event: CCRawEvent): void {
    const text = typeof event.result === 'string' ? event.result : '';
    this.emit('result', text, event.session_id ?? this.sessionId);
  }

  private cleanup(): void {
    this.process = null;
    this.stdoutBuffer = '';
  }
}
