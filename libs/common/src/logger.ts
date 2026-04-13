import pino, { type Logger, type LoggerOptions } from 'pino';

export type LogLevel = 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace';

export type LoggerOpts = {
  name?: string;
  level?: LogLevel;
  mode?: 'production' | 'development';
};

const LOG_LEVELS: ReadonlySet<string> = new Set(['fatal', 'error', 'warn', 'info', 'debug', 'trace']);

function resolveLogLevel(explicit?: LogLevel): LogLevel {
  if (explicit) return explicit;
  const raw = (process.env.LOG_LEVEL ?? '').trim().toLowerCase();
  return LOG_LEVELS.has(raw) ? (raw as LogLevel) : 'info';
}

function resolveMode(explicit?: 'production' | 'development'): 'production' | 'development' {
  if (explicit) return explicit;
  const format = (process.env.LOG_FORMAT ?? '').trim().toLowerCase();
  if (format === 'json') return 'production';
  if (format === 'pretty') return 'development';
  return process.env.NODE_ENV === 'production' ? 'production' : 'development';
}

export function createLogger(options: LoggerOpts = {}): Logger {
  const mode = resolveMode(options.mode);
  const baseOptions: LoggerOptions = {
    name: options.name ?? process.env.SERVICE_NAME,
    level: resolveLogLevel(options.level),
  };

  if (mode === 'development') {
    return pino(
      baseOptions,
      pino.transport({
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }),
    );
  }

  return pino(baseOptions);
}

function formatArgs(args: unknown[]): { msg: string; err?: Error } {
  let err: Error | undefined;
  const parts: string[] = [];

  for (const a of args) {
    if (a instanceof Error) {
      err = a;
      parts.push(`${a.name}: ${a.message}`);
    } else if (typeof a === 'string') {
      parts.push(a);
    } else {
      try {
        parts.push(JSON.stringify(a));
      } catch {
        parts.push(String(a));
      }
    }
  }

  return { msg: parts.join(' '), err };
}

/**
 * Подменяет глобальные `console.*` методы, чтобы все серверные логи
 * шли через pino в едином формате. Вызывать из `instrumentation.ts`.
 */
export function patchConsole(name?: string): Logger {
  const logger = createLogger({ name });

  const wrap = (method: 'info' | 'warn' | 'error' | 'debug' | 'trace') =>
    (...args: unknown[]) => {
      const { msg, err } = formatArgs(args);
      logger[method]({ context: 'console', ...(err ? { err } : {}) }, msg);
    };

  console.log = wrap('info');
  console.info = wrap('info');
  console.warn = wrap('warn');
  console.error = wrap('error');
  console.debug = wrap('debug');
  console.trace = wrap('trace');

  return logger;
}

export function formatFetchError(err: unknown): string {
  if (!(err instanceof Error)) return String(err);

  const parts = [err.name, err.message].filter(Boolean);

  const anyErr = err as unknown as Record<string, unknown>;
  if (typeof anyErr.code === 'string') parts.push(`code=${anyErr.code}`);

  const cause = anyErr.cause;
  if (cause && typeof cause === 'object') {
    const causeObj = cause as Record<string, unknown>;
    if (Array.isArray(causeObj.errors)) {
      const codes = causeObj.errors
        .map((e: Record<string, unknown>) => e?.code)
        .filter((c): c is string => typeof c === 'string');
      if (codes.length) parts.push(`causeCodes=${[...new Set(codes)].join(',')}`);
    } else if (typeof causeObj.code === 'string') {
      parts.push(`causeCode=${causeObj.code}`);
    }
    if (typeof causeObj.message === 'string') {
      parts.push(`causeMessage=${causeObj.message}`);
    }
  }

  return parts.join(' | ');
}
