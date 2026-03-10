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
}

/** Discriminated union of every event the CC stream-json format can emit. */
export type CCStreamEvent =
  | { type: 'assistant'; subtype: 'text'; text: string }
  | { type: 'assistant'; subtype: 'thinking'; text: string }
  | { type: 'tool_use'; name: string; input: Record<string, unknown> }
  | { type: 'tool_result'; name: string; content: string }
  | { type: 'result'; text: string; session_id: string }
  | { type: 'error'; error: string };

interface CCSessionEvents {
  message: (text: string) => void;
  thinking: (text: string) => void;
  tool_use: (name: string, input: Record<string, unknown>) => void;
  tool_result: (name: string, content: string) => void;
  result: (text: string, sessionId: string) => void;
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

  private process: ChildProcess | null = null;
  private hasResumed = false;
  /** Buffer for incomplete NDJSON lines from stdout. */
  private stdoutBuffer = '';

  constructor(options: CCSessionOptions) {
    super();
    this.workspacePath = options.workspacePath;
    this.sessionId = options.sessionId ?? uuid();
    this.systemPrompt = options.systemPrompt;
    this.allowedTools = options.allowedTools;
    this.maxTurns = options.maxTurns;
    this.model = options.model;

    // If a session ID was supplied externally we assume it already exists.
    if (options.sessionId) {
      this.hasResumed = true;
    }
  }

  // -----------------------------------------------------------------------
  // Public API
  // -----------------------------------------------------------------------

  /** Return the session ID (stable across `send` calls). */
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

    // -- stdout (NDJSON stream) -------------------------------------------
    child.stdout!.on('data', (chunk: Buffer) => {
      this.handleStdoutChunk(chunk);
    });

    // -- stderr (informational / errors) ----------------------------------
    child.stderr!.on('data', (chunk: Buffer) => {
      const text = chunk.toString('utf-8').trim();
      if (text) {
        log.debug('[claude stderr] %s', text);
      }
    });

    // -- process lifecycle ------------------------------------------------
    child.on('error', (err: Error) => {
      log.error('Failed to spawn claude process', { error: err.message });
      this.emit('error', err);
      this.cleanup();
    });

    child.on('close', (code: number | null, signal: string | null) => {
      // Flush any remaining buffer content.
      this.flushBuffer();

      if (signal) {
        log.info('claude process killed with signal %s', signal);
      } else {
        log.info('claude process exited with code %d', code);
      }

      if (code !== 0 && code !== null) {
        this.emit('error', new Error(`claude process exited with code ${code}`));
      }

      this.emit('done', code);
      this.cleanup();
    });

    // After the first successful send the session exists on disk, so any
    // subsequent send should use --resume.
    this.hasResumed = true;
  }

  /** Kill the running subprocess (SIGTERM, then SIGKILL after timeout). */
  abort(): void {
    const child = this.process;
    if (!child || child.killed) return;

    log.info('Aborting claude subprocess (pid=%d)', child.pid);
    child.kill('SIGTERM');

    // Forcefully kill if it hasn't exited after 5 seconds.
    const killTimer = setTimeout(() => {
      if (!child.killed) {
        log.warn('claude subprocess did not exit after SIGTERM; sending SIGKILL');
        child.kill('SIGKILL');
      }
    }, 5_000);

    // Prevent the timer from keeping the Node process alive.
    killTimer.unref();
  }

  // -----------------------------------------------------------------------
  // Internals
  // -----------------------------------------------------------------------

  /** Build the argument list for the `claude` CLI. */
  private buildArgs(message: string): string[] {
    const args: string[] = [
      '--print',
      '--output-format', 'stream-json',
      '--verbose',
      '--session-id', this.sessionId,
    ];

    if (this.hasResumed) {
      args.push('--resume');
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

    // The user message is the trailing positional argument.
    args.push(message);

    return args;
  }

  /**
   * Buffer incoming stdout data and parse complete NDJSON lines.
   *
   * The CC stream-json format emits one JSON object per line. Because OS
   * pipe buffering can split a JSON line across multiple `data` events we
   * buffer until we encounter a newline.
   */
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

  /** Flush any remaining data in the buffer (called on process close). */
  private flushBuffer(): void {
    const remaining = this.stdoutBuffer.trim();
    this.stdoutBuffer = '';
    if (remaining.length > 0) {
      this.parseLine(remaining);
    }
  }

  /** Parse a single NDJSON line and emit the corresponding event. */
  private parseLine(line: string): void {
    let event: CCStreamEvent;
    try {
      event = JSON.parse(line) as CCStreamEvent;
    } catch {
      log.warn('Failed to parse NDJSON line: %s', line);
      return;
    }

    switch (event.type) {
      case 'assistant':
        if (event.subtype === 'thinking') {
          this.emit('thinking', event.text);
        } else {
          this.emit('message', event.text);
        }
        break;

      case 'tool_use':
        this.emit('tool_use', event.name, event.input);
        break;

      case 'tool_result':
        this.emit('tool_result', event.name, event.content);
        break;

      case 'result':
        this.emit('result', event.text, event.session_id);
        break;

      case 'error':
        this.emit('error', new Error(event.error));
        break;

      default:
        log.debug('Unhandled CC stream event type: %s', (event as any).type);
        break;
    }
  }

  /** Reset internal process state after exit. */
  private cleanup(): void {
    this.process = null;
    this.stdoutBuffer = '';
  }
}
