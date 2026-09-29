import { EventEmitter } from 'node:events';

export interface LogEntry {
  id: string;
  time: string;
  serial?: string;
  username?: string;
  message: string;
  color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'white';
}

class ToolEventBus extends EventEmitter {
  private recentLogs: LogEntry[] = [];
  private readonly maxLogs = 500;

  public broadcastLog(entry: Omit<LogEntry, 'id' | 'time'> & { time?: string }): void {
    const time = entry.time || new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const fullEntry: LogEntry = {
      id: Math.random().toString(36).substring(2, 9),
      time,
      serial: entry.serial,
      username: entry.username,
      message: entry.message,
      color: entry.color,
    };

    this.recentLogs.push(fullEntry);
    if (this.recentLogs.length > this.maxLogs) {
      this.recentLogs.shift();
    }

    this.emit('log', fullEntry);
  }

  public getRecentLogs(): LogEntry[] {
    return [...this.recentLogs];
  }

  public clearLogs(): void {
    this.recentLogs = [];
    this.emit('clear_logs');
  }
}

export const eventBus = new ToolEventBus();
