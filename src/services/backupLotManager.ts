import fs from 'node:fs';
import path from 'node:path';
import { supabase } from './supabaseClient.js';

export interface BackupAccount {
  username: string;
  password: string;
  lotId: 'lot_backup';
  lotName: string;
  error?: string;
  addedAt?: string;
  lastRunAt?: string;
}

export class BackupLotManager {
  private filePath: string;
  private accounts: BackupAccount[] = [];

  constructor() {
    this.filePath = path.join(process.cwd(), 'data', 'backup_accounts.json');
    this.loadAccounts();
  }

  private loadAccounts(): void {
    try {
      if (fs.existsSync(this.filePath)) {
        const raw = fs.readFileSync(this.filePath, 'utf-8');
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed)) {
          this.accounts = parsed;
          return;
        }
      }
    } catch (e: any) {
      console.warn('[BackupLotManager] Lỗi đọc backup_accounts.json:', e.message);
    }
    this.accounts = [];
  }

  private saveAccounts(): void {
    try {
      const dir = path.dirname(this.filePath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      fs.writeFileSync(this.filePath, JSON.stringify(this.accounts, null, 2), 'utf-8');
    } catch (e: any) {
      console.error('[BackupLotManager] Lỗi lưu backup_accounts.json:', e.message);
    }
  }

  public getAccounts(): BackupAccount[] {
    this.loadAccounts();
    return this.accounts;
  }

  public getLotInfo() {
    this.loadAccounts();
    return {
      id: 'lot_backup',
      name: '🛡️ Lô Dự Phòng',
      description: 'Lô lưu trữ các tài khoản bị lỗi cần chạy lại (Không kiểm tra trùng)',
      sortOrder: 9999,
      accountCount: this.accounts.length,
    };
  }

  /**
   * Thêm danh sách tài khoản vào Lô dự phòng.
   * KHÔNG KIỂM TRA TRÙNG (cho phép thêm tài khoản kể cả khi đã tồn tại trong DB hoặc trong lô)
   */
  public async addAccounts(
    items: Array<{ username: string; password?: string; error?: string }>
  ): Promise<{ added: number; total: number }> {
    this.loadAccounts();

    // Lấy mật khẩu dự phòng từ DB nếu item không kèm password
    const needPassUsers = items.filter(i => !i.password).map(i => i.username.trim());
    const passMap: Record<string, string> = {};

    if (needPassUsers.length > 0) {
      try {
        const { data } = await supabase
          .from('accounts')
          .select('username, password')
          .in('username', needPassUsers);
        (data || []).forEach(row => {
          if (row.username && row.password) {
            passMap[row.username] = row.password;
          }
        });
      } catch (err: any) {
        console.warn('[BackupLotManager] Tra cứu mật khẩu Supabase:', err.message);
      }
    }

    const now = new Date().toLocaleString('vi-VN', { hour12: false });
    let addedCount = 0;

    for (const item of items) {
      const u = (item.username || '').trim();
      if (!u) continue;

      let p = (item.password || '').trim();
      if (!p && passMap[u]) {
        p = passMap[u];
      }

      // Nếu vẫn chưa có password, tìm trong file accounts.json
      if (!p) {
        try {
          const accJsonPath = path.join(process.cwd(), 'accounts.json');
          if (fs.existsSync(accJsonPath)) {
            const raw = JSON.parse(fs.readFileSync(accJsonPath, 'utf-8'));
            const list = Array.isArray(raw) ? raw : raw.accounts || [];
            const found = list.find((a: any) => a.username === u);
            if (found && found.password) p = found.password;
          }
        } catch {}
      }

      this.accounts.push({
        username: u,
        password: p || '',
        lotId: 'lot_backup',
        lotName: 'Lô Dự Phòng',
        error: item.error || 'Tài khoản lỗi cần thi lại',
        addedAt: now,
      });
      addedCount++;
    }

    this.saveAccounts();
    return { added: addedCount, total: this.accounts.length };
  }

  public removeAccount(username: string): boolean {
    this.loadAccounts();
    const before = this.accounts.length;
    this.accounts = this.accounts.filter(a => a.username !== username);
    if (this.accounts.length !== before) {
      this.saveAccounts();
      return true;
    }
    return false;
  }

  public clear(): void {
    this.accounts = [];
    this.saveAccounts();
  }
}

export const backupLotManager = new BackupLotManager();
