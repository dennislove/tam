import fs from 'node:fs';
import path from 'node:path';

export type AccountStatus = 'idle' | 'pending' | 'running' | 'waiting_banner' | 'success' | 'error';

export interface ManagedAccount {
  index: number;
  username: string;
  password: string;
  deviceSerial?: string;
  status: AccountStatus;
  durationMs?: number;
  error?: string;
  screenshotPath?: string;
  lastRunAt?: string;
}

export class AccountManager {
  private accountsFilePath: string;
  private accountsState: Map<string, ManagedAccount> = new Map();

  constructor() {
    this.accountsFilePath = path.resolve(process.cwd(), 'accounts.json');
    this.loadAccounts();
  }

  /**
   * Đọc danh sách tài khoản từ accounts.json
   */
  public loadAccounts(): ManagedAccount[] {
    let rawList: any[] = [];
    if (fs.existsSync(this.accountsFilePath)) {
      try {
        const content = fs.readFileSync(this.accountsFilePath, 'utf-8');
        rawList = JSON.parse(content);
        if (!Array.isArray(rawList)) rawList = [];
      } catch (err: any) {
        console.error('[AccountManager] Lỗi đọc accounts.json:', err.message);
        rawList = [];
      }
    }

    // Đồng bộ vào memory state giữ lại status nếu có
    const result: ManagedAccount[] = [];
    rawList.forEach((acc, idx) => {
      const existing = this.accountsState.get(acc.username);
      const item: ManagedAccount = {
        index: idx + 1,
        username: acc.username,
        password: acc.password,
        deviceSerial: acc.deviceSerial,
        status: existing?.status || 'idle',
        durationMs: existing?.durationMs,
        error: existing?.error,
        screenshotPath: existing?.screenshotPath,
        lastRunAt: existing?.lastRunAt,
      };
      this.accountsState.set(acc.username, item);
      result.push(item);
    });

    return result;
  }

  public getAccounts(): ManagedAccount[] {
    return this.loadAccounts();
  }

  /**
   * Lưu toàn bộ danh sách tài khoản vào file accounts.json
   */
  public saveAccounts(list: { username: string; password: string; deviceSerial?: string }[]): boolean {
    try {
      const cleanList = list.map((a) => ({
        username: a.username.trim(),
        password: a.password.trim(),
        ...(a.deviceSerial ? { deviceSerial: a.deviceSerial.trim() } : {}),
      }));
      fs.writeFileSync(this.accountsFilePath, JSON.stringify(cleanList, null, 2), 'utf-8');
      this.loadAccounts();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Thêm một tài khoản mới
   */
  public addAccount(username: string, password: string, deviceSerial?: string): boolean {
    const list = this.getAccounts().map((a) => ({
      username: a.username,
      password: a.password,
      deviceSerial: a.deviceSerial,
    }));
    if (list.some((a) => a.username === username.trim())) {
      return false; // Trùng tài khoản
    }
    list.push({ username: username.trim(), password: password.trim(), deviceSerial });
    return this.saveAccounts(list);
  }

  /**
   * Xóa một tài khoản
   */
  public deleteAccount(username: string): boolean {
    const list = this.getAccounts().map((a) => ({
      username: a.username,
      password: a.password,
      deviceSerial: a.deviceSerial,
    }));
    const filtered = list.filter((a) => a.username !== username);
    if (filtered.length === list.length) return false;
    this.accountsState.delete(username);
    return this.saveAccounts(filtered);
  }

  /**
   * Cập nhật trạng thái chạy của tài khoản
   */
  public updateStatus(
    username: string,
    status: AccountStatus,
    meta?: { durationMs?: number; error?: string; screenshotPath?: string }
  ): void {
    const acc = this.accountsState.get(username);
    if (acc) {
      acc.status = status;
      if (meta?.durationMs !== undefined) acc.durationMs = meta.durationMs;
      if (meta?.error !== undefined) acc.error = meta.error;
      if (meta?.screenshotPath !== undefined) acc.screenshotPath = meta.screenshotPath;
      acc.lastRunAt = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    }
  }

  /**
   * Đặt lại trạng thái (reset) cho tất cả hoặc 1 danh sách tài khoản
   */
  public resetStatuses(usernames?: string[]): void {
    if (usernames && usernames.length > 0) {
      usernames.forEach((u) => {
        const acc = this.accountsState.get(u);
        if (acc) {
          acc.status = 'idle';
          acc.error = undefined;
        }
      });
    } else {
      this.accountsState.forEach((acc) => {
        acc.status = 'idle';
        acc.error = undefined;
      });
    }
  }
}

export const accountManager = new AccountManager();
