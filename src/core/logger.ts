type Level = 'debug' | 'info' | 'warn' | 'error';

const LEVELS: Record<Level, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export class Logger {
  private level: number;

  constructor(level: Level = 'info') {
    this.level = LEVELS[level];
  }

  debug(message: string, meta?: unknown): void {
    this.log('debug', message, meta);
  }

  info(message: string, meta?: unknown): void {
    this.log('info', message, meta);
  }

  warn(message: string, meta?: unknown): void {
    this.log('warn', message, meta);
  }

  error(message: string, meta?: unknown): void {
    this.log('error', message, meta);
  }

  private log(level: Level, message: string, meta?: unknown): void {
    if (LEVELS[level] < this.level) {
      return;
    }
    const line = `[${new Date().toISOString()}] ${level.toUpperCase()}: ${message}`;
    if (meta !== undefined) {
      console.log(line, meta);
    } else {
      console.log(line);
    }
  }
}
