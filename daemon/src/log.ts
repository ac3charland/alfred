/**
 * A tiny structured logger. stdout carries the running commentary; warnings and errors go to
 * stderr so `--dry-run`'s normalized-message JSON on stdout stays machine-readable.
 *
 * Secrets never pass through here. Callers log the NAME of a keychain item, never its value.
 */

export type LogLevel = 'info' | 'warn' | 'error';

export type LogFields = Record<string, unknown>;

export interface Logger {
  info(message: string, fields?: LogFields): void;
  warn(message: string, fields?: LogFields): void;
  error(message: string, fields?: LogFields): void;
}

export interface LoggerOptions {
  now?: () => Date;
  out?: (line: string) => void;
  err?: (line: string) => void;
}

function format(now: Date, level: LogLevel, message: string, fields?: LogFields): string {
  const suffix = fields === undefined ? '' : ` ${JSON.stringify(fields)}`;
  return `${now.toISOString()} ${level} ${message}${suffix}\n`;
}

export function createLogger(options: LoggerOptions = {}): Logger {
  const now = options.now ?? ((): Date => new Date());
  const out = options.out ?? ((line: string): void => void process.stdout.write(line));
  const err = options.err ?? ((line: string): void => void process.stderr.write(line));

  return {
    info: (message, fields) => {
      out(format(now(), 'info', message, fields));
    },
    warn: (message, fields) => {
      err(format(now(), 'warn', message, fields));
    },
    error: (message, fields) => {
      err(format(now(), 'error', message, fields));
    },
  };
}
