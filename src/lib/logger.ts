type LogLevel = 'info' | 'warn' | 'error' | 'debug';

interface LogEntry {
  level: LogLevel;
  message: string;
  timestamp: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  data?: any;
}

const isDev = import.meta.env.DEV;

class Logger {
  private log(level: LogLevel, message: string, data?: unknown) {
    const entry: LogEntry = {
      level,
      message,
      timestamp: new Date().toISOString(),
      data,
    };

    // In development, log to console
    if (isDev) {
      const color = {
        info: 'color: #3b82f6',
        warn: 'color: #eab308',
        error: 'color: #ef4444',
        debug: 'color: #a855f7',
      }[level];

      console.groupCollapsed(`%c[${level.toUpperCase()}] ${message}`, color);
      console.log('Timestamp:', entry.timestamp);
      if (data) console.log('Data:', data);
      console.groupEnd();
    } else {
      // In production, we might want to send this to an external service
      // For now, we'll keep using console but in a structured JSON way for Vercel logs to pick up
      if (level === 'error' || level === 'warn') {
        console[level](JSON.stringify(entry));
      }
    }
  }

  info(message: string, data?: unknown) {
    this.log('info', message, data);
  }

  warn(message: string, data?: unknown) {
    this.log('warn', message, data);
  }

  error(message: string, data?: unknown) {
    this.log('error', message, data);
  }

  debug(message: string, data?: unknown) {
    this.log('debug', message, data);
  }
}

export const logger = new Logger();
