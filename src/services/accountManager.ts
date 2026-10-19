import 'dotenv/config';
import { supabase } from './supabaseClient.js';

export type AccountStatus = 'idle' | 'pending' | 'running' | 'waiting_banner' | 'success' | 'error';

export interface ManagedAccount {
  index: number;
  username: string;
  password: string;
  lotId?: string;
  lotName?: string;
  deviceSerial?: string;
  status: AccountStatus;
  durationMs?: number;
  error?: string;
  lastRunAt?: string;
}

interface RuntimeState {
  status: AccountStatus;
  durationMs?: number;
  error?: string;
  lastRunAt?: string;
}

export class AccountManager {
  private accountsState: Map<string, RuntimeState> = new Map();

  /**
   * Lấy toàn bộ tài khoản từ Supabase kèm tên lô
   */
  public async getAccounts(lotId?: string): Promise<ManagedAccount[]> {
    let query = supabase
      .from('v_accounts_with_lot')
      .select('*')
      .order('lot_sort', { ascending: true, nullsFirst: false })
      .order('sort_order')
      .order('created_at');

    if (lotId) {
      query = query.eq('lot_id', lotId);
    }

    const { data, error } = await query;

    if (error) {
      console.error('[AccountManager] Lỗi lấy accounts:', error.message);
      return [];
    }

    return (data || []).map((acc, idx) => {
      const state = this.accountsState.get(acc.username);
      return {
        index: idx + 1,
        username: acc.username,
        password: acc.password,
        lotId: acc.lot_id,
        lotName: acc.lot_name,
        deviceSerial: acc.device_serial || undefined,
        status: state?.status || 'idle',
        durationMs: state?.durationMs,
        error: state?.error,
        lastRunAt: state?.lastRunAt,
      };
    });
  }

  /**
   * Thêm 1 tài khoản
   */
  public async addAccount(
    username: string,
    password: string,
    lotId?: string,
    deviceSerial?: string
  ): Promise<boolean> {
    const { error } = await supabase.from('accounts').insert({
      username: username.trim(),
      password: password.trim(),
      lot_id: lotId || null,
      device_serial: deviceSerial || '',
    });
    if (error) {
      console.error('[AccountManager] Lỗi addAccount:', error.message);
      return false;
    }
    return true;
  }

  /**
   * Xóa 1 tài khoản
   */
  public async deleteAccount(username: string): Promise<boolean> {
    const { error } = await supabase.from('accounts').delete().eq('username', username);
    if (error) {
      console.error('[AccountManager] Lỗi deleteAccount:', error.message);
      return false;
    }
    this.accountsState.delete(username);
    return true;
  }

  /**
   * Lưu (replace) toàn bộ danh sách tài khoản (dùng cho import JSON)
   * Chú ý: chỉ xóa & insert lại các tài khoản trong cùng lô hoặc toàn bộ nếu không có lô
   */
  public async saveAccounts(
    list: { username: string; password: string; lotId?: string; deviceSerial?: string }[]
  ): Promise<boolean> {
    // Xóa hết rồi insert lại
    const { error: delError } = await supabase.from('accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) {
      console.error('[AccountManager] Lỗi xóa accounts:', delError.message);
      return false;
    }

    if (list.length === 0) return true;

    const rows = list.map((a, idx) => ({
      username: a.username.trim(),
      password: a.password.trim(),
      lot_id: a.lotId || null,
      device_serial: a.deviceSerial || '',
      sort_order: idx,
    }));

    const { error } = await supabase.from('accounts').insert(rows);
    if (error) {
      console.error('[AccountManager] Lỗi insert accounts:', error.message);
      return false;
    }
    this.accountsState.clear();
    return true;
  }

  /**
   * Cập nhật trạng thái runtime (chỉ trong memory, không ghi DB)
   */
  public updateStatus(
    username: string,
    status: AccountStatus,
    meta?: { durationMs?: number; error?: string }
  ): void {
    const current = this.accountsState.get(username);
    this.accountsState.set(username, {
      status,
      durationMs: meta?.durationMs ?? current?.durationMs,
      error: meta?.error ?? current?.error,
      lastRunAt: new Date().toLocaleTimeString('vi-VN', { hour12: false }),
    });
  }

  /**
   * Reset tất cả trạng thái runtime
   */
  public resetStatuses(usernames?: string[]): void {
    if (usernames?.length) {
      usernames.forEach((u) => this.accountsState.delete(u));
    } else {
      this.accountsState.clear();
    }
  }

  /**
   * Lấy danh sách lô
   */
  public async getLots(): Promise<{ id: string; name: string; description: string; sortOrder: number }[]> {
    const { data, error } = await supabase
      .from('account_lots')
      .select('*')
      .order('sort_order');

    if (error) {
      console.error('[AccountManager] Lỗi lấy lots:', error.message);
      return [];
    }

    return (data || []).map((l) => ({
      id: l.id,
      name: l.name,
      description: l.description,
      sortOrder: l.sort_order,
    }));
  }
}

export const accountManager = new AccountManager();
