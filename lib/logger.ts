import { writeSync } from 'node:fs';

type LogLevel = 'error' | 'warn' | 'info' | 'debug';

const LEVELS: Record<LogLevel, number> = { error: 0, warn: 1, info: 2, debug: 3 };

// Node block-buffers stdout when it's a pipe (which it is under systemd
// with StandardOutput=journal). console.log from a request handler sits
// in libuv's async write queue indefinitely — verified by inspecting two
// days of journal output: only startup banners landed, no logger.info /
// per-request logs. Writing directly to fd 1/2 via writeSync bypasses the
// stream layer and guarantees the bytes leave the process before we return.
// Cost: synchronous write. For info-level traffic that's negligible.
const HAS_WRITE_SYNC = typeof process !== 'undefined' && typeof writeSync === 'function';

function emit(level: LogLevel, line: string): void {
  const fd = level === 'error' || level === 'warn' ? 2 : 1;
  if (HAS_WRITE_SYNC) {
    try {
      writeSync(fd, line + '\n');
      return;
    } catch {
      // EAGAIN on pipe overflow, or fd closed; fall through to console.
    }
  }
  (level === 'error' || level === 'warn' ? console.error : console.log)(line);
}

const COLORS: Record<LogLevel, string> = {
  error: '\x1b[31m',
  warn: '\x1b[33m',
  info: '\x1b[34m',
  debug: '\x1b[90m',
};
const RESET = '\x1b[0m';

// Resolve once at module load. Was re-reading process.env on every log
// call (logger.request fires per HTTP request) — process.env access is
// not free on Node, and the result is immutable for the process lifetime.
const _envLevel = process.env.LOG_LEVEL?.toLowerCase() as LogLevel | undefined;
const CURRENT_LEVEL = _envLevel && _envLevel in LEVELS ? LEVELS[_envLevel] : LEVELS.info;
const IS_JSON = process.env.LOG_FORMAT?.toLowerCase() === 'json';

// Pre-built level tags (color + padded label + reset). Was concatenated
// per log call.
const LEVEL_TAGS: Record<LogLevel, string> = {
  error: `${COLORS.error}[ERROR]${RESET}`,
  warn:  `${COLORS.warn}[WARN ]${RESET}`,
  info:  `${COLORS.info}[INFO ]${RESET}`,
  debug: `${COLORS.debug}[DEBUG]${RESET}`,
};

function log(level: LogLevel, message: string, extra?: Record<string, unknown>): void {
  if (LEVELS[level] > CURRENT_LEVEL) return;

  if (IS_JSON) {
    const entry: Record<string, unknown> = {
      timestamp: new Date().toISOString(),
      level,
      message,
      ...extra,
    };
    emit(level, JSON.stringify(entry));
    return;
  }

  // for-in early-return skips the Object.keys array allocation; common
  // case is `extra` either undefined or fully populated.
  let hasExtra = false;
  if (extra) {
    for (const _k in extra) { hasExtra = true; break; }
  }
  const tag = LEVEL_TAGS[level];
  const ts = new Date().toISOString();
  const suffix = hasExtra ? ` ${COLORS.debug}${JSON.stringify(extra)}${RESET}` : '';

  emit(level, `${tag} ${ts} ${message}${suffix}`);
}

export const logger = {
  error: (message: string, extra?: Record<string, unknown>) => log('error', message, extra),
  warn: (message: string, extra?: Record<string, unknown>) => log('warn', message, extra),
  info: (message: string, extra?: Record<string, unknown>) => log('info', message, extra),
  debug: (message: string, extra?: Record<string, unknown>) => log('debug', message, extra),
  request: (method: string, path: string, status: number, durationMs: number) =>
    log('info', `${method} ${path} ${status}`, { method, path, status, durationMs }),
};
