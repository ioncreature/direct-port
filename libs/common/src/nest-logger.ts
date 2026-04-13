import type { LoggerService } from '@nestjs/common';
import type { Logger } from 'pino';

import { createLogger, type LoggerOpts, type LogLevel } from './logger';

export class PinoNestLogger implements LoggerService {
  private readonly logger: Logger;
  private readonly logMapping: LogLevel;
  private readonly verboseMapping: LogLevel;

  constructor(options: LoggerOpts & { logLevel?: LogLevel; verboseLevel?: LogLevel } = {}) {
    this.logger = createLogger(options);
    this.logMapping = options.logLevel ?? 'info';
    this.verboseMapping = options.verboseLevel ?? 'trace';
  }

  private emit(level: LogLevel, message: unknown, context?: string, trace?: string) {
    if (message instanceof Error) {
      (this.logger[level] as Function)({ err: message, context, trace }, message.message);
    } else if (typeof message === 'string') {
      (this.logger[level] as Function)({ context, trace }, message);
    } else {
      (this.logger[level] as Function)({ context, trace, data: message }, '');
    }
  }

  log(message: unknown, context?: string) {
    this.emit(this.logMapping, message, context);
  }

  error(message: unknown, trace?: string, context?: string) {
    this.emit('error', message, context, trace);
  }

  warn(message: unknown, context?: string) {
    this.emit('warn', message, context);
  }

  debug(message: unknown, context?: string) {
    this.emit('debug', message, context);
  }

  verbose(message: unknown, context?: string) {
    this.emit(this.verboseMapping, message, context);
  }

  fatal(message: unknown, context?: string) {
    this.emit('fatal', message, context);
  }

  getPino(): Logger {
    return this.logger;
  }
}

export function createNestLogger(options: LoggerOpts = {}): PinoNestLogger {
  return new PinoNestLogger(options);
}
