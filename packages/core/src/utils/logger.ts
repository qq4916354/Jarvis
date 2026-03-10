// ============================================================================
// Logger - Winston-based logging utility for Jarvis
// ============================================================================

import winston from 'winston';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

const LOG_DIR = path.join(os.homedir(), '.jarvis', 'logs');

// Ensure log directory exists at module load time
fs.mkdirSync(LOG_DIR, { recursive: true });

/**
 * Custom format that combines timestamp, label, level, and message
 * into a human-readable string for console output.
 */
const prettyConsoleFormat = winston.format.printf(({ level, message, label, timestamp, stack }) => {
  const tag = label ? `[${label}]` : '';
  const text = stack ?? message;
  return `${timestamp as string} ${level} ${tag} ${text as string}`;
});

/**
 * Build the format pipeline used by all transports.
 * Structured JSON is used for file transports; pretty-printed for console.
 */
function buildFileFormat(label?: string) {
  const formats: winston.Logform.Format[] = [
    winston.format.timestamp({ format: 'YYYY-MM-DD HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
  ];
  if (label) {
    formats.push(winston.format.label({ label }));
  }
  formats.push(winston.format.json());
  return winston.format.combine(...formats);
}

function buildConsoleFormat(label?: string) {
  const formats: winston.Logform.Format[] = [
    winston.format.timestamp({ format: 'HH:mm:ss.SSS' }),
    winston.format.errors({ stack: true }),
  ];
  if (label) {
    formats.push(winston.format.label({ label }));
  }
  formats.push(winston.format.colorize(), prettyConsoleFormat);
  return winston.format.combine(...formats);
}

/**
 * Resolve the effective log level.
 * Priority: explicit argument > JARVIS_LOG_LEVEL env > 'info'.
 */
function resolveLogLevel(level?: string): string {
  return level ?? process.env.JARVIS_LOG_LEVEL ?? 'info';
}

/**
 * Create a labelled Winston logger instance.
 *
 * Each logger writes to:
 * - `~/.jarvis/logs/error.log`   (error-level only)
 * - `~/.jarvis/logs/combined.log` (all levels)
 * - Console (always, respects current log level)
 *
 * @param label - A short tag that identifies the subsystem, e.g. 'Scheduler', 'Workspace'.
 * @param level - Override the default log level.
 * @returns A configured Winston logger.
 */
export function createLogger(label: string, level?: string): winston.Logger {
  const effectiveLevel = resolveLogLevel(level);

  const logger = winston.createLogger({
    level: effectiveLevel,
    defaultMeta: { service: 'jarvis', label },
    transports: [
      // Error-only file
      new winston.transports.File({
        filename: path.join(LOG_DIR, 'error.log'),
        level: 'error',
        format: buildFileFormat(label),
        maxsize: 10 * 1024 * 1024, // 10 MB
        maxFiles: 5,
        tailable: true,
      }),

      // Combined file (all levels)
      new winston.transports.File({
        filename: path.join(LOG_DIR, 'combined.log'),
        format: buildFileFormat(label),
        maxsize: 20 * 1024 * 1024, // 20 MB
        maxFiles: 5,
        tailable: true,
      }),

      // Console (always active)
      new winston.transports.Console({
        format: buildConsoleFormat(label),
      }),
    ],
  });

  return logger;
}

/**
 * Default root logger for quick/unscoped usage.
 */
const rootLogger = createLogger('Jarvis');

export default rootLogger;
