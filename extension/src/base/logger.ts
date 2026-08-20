/** 基座：分级日志 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

export class Logger {
  constructor(
    private readonly scope: string,
    private readonly level: LogLevel = 'info',
  ) {}

  child(scope: string): Logger {
    return new Logger(`${this.scope}:${scope}`, this.level);
  }

  debug(msg: string, ...args: unknown[]): void {
    this.out('debug', msg, args);
  }
  info(msg: string, ...args: unknown[]): void {
    this.out('info', msg, args);
  }
  warn(msg: string, ...args: unknown[]): void {
    this.out('warn', msg, args);
  }
  error(msg: string, ...args: unknown[]): void {
    this.out('error', msg, args);
  }

  private out(level: LogLevel, msg: string, args: unknown[]): void {
    if (!this.enabled(level)) return;
    const line = `[${level.toUpperCase()}] [${this.scope}] ${msg}`;
    const fn =
      level === 'error' ? console.error : level === 'warn' ? console.warn : level === 'debug' ? console.debug : console.log;
    if (args.length) fn(line, ...args);
    else fn(line);
  }

  private enabled(level: LogLevel): boolean {
    const order: Record<LogLevel, number> = { debug: 0, info: 1, warn: 2, error: 3 };
    return order[level] >= order[this.level];
  }
}