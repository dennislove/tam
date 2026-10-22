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
   * Đảm bảo các lô từ lot_1 tới lot_N tồn tại trong bảng account_lots
   */
  public async ensureLotsExist(maxLotNum: number): Promise<void> {
    if (maxLotNum <= 0) return;
    const lotsToUpsert = Array.from({ length: maxLotNum }, (_, i) => ({
      id: `lot_${i + 1}`,
      name: `Lô ${i + 1}`,
      sort_order: i + 1,
      description: `Lô tự động ${i + 1}`,
    }));

    const { error } = await supabase
      .from('account_lots')
      .upsert(lotsToUpsert, { onConflict: 'id' });

    if (error) {
      console.error('[AccountManager] Lỗi ensureLotsExist:', error.message);
    }
  }

  /**
   * Tự động cắt, đếm và chia toàn bộ tài khoản hiện có trong DB thành các lô (mặc định 20 acc/lô)
   */
  public async autoPartitionExistingAccounts(lotSize = 20): Promise<{
    success: boolean;
    totalAccounts: number;
    totalLots: number;
    message?: string;
  }> {
    // 1. Lấy tất cả tài khoản theo thứ tự
    const { data: accounts, error } = await supabase
      .from('accounts')
      .select('id, username')
      .order('sort_order')
      .order('created_at');

    if (error || !accounts) {
      console.error('[AccountManager] Lỗi autoPartitionExistingAccounts:', error?.message);
      return { success: false, totalAccounts: 0, totalLots: 0, message: error?.message };
    }

    if (accounts.length === 0) {
      return { success: true, totalAccounts: 0, totalLots: 0, message: 'Không có tài khoản nào để phân lô' };
    }

    const totalLots = Math.ceil(accounts.length / lotSize);
    await this.ensureLotsExist(totalLots);

    // 2. Cập nhật lot_id và sort_order cho từng tài khoản theo từng batch
    for (let i = 0; i < accounts.length; i++) {
      const lotNum = Math.floor(i / lotSize) + 1;
      const sortOrder = (i % lotSize) + 1;
      const acc = accounts[i];

      const { error: updateErr } = await supabase
        .from('accounts')
        .update({
          lot_id: `lot_${lotNum}`,
          sort_order: sortOrder,
        })
        .eq('id', acc.id);

      if (updateErr) {
        console.error(`[AccountManager] Lỗi cập nhật lô cho acc ${acc.username}:`, updateErr.message);
      }
    }

    return {
      success: true,
      totalAccounts: accounts.length,
      totalLots,
      message: `Đã phân bổ thành công ${accounts.length} tài khoản vào ${totalLots} lô (${lotSize} acc/lô).`,
    };
  }

  /**
   * Thêm 1 tài khoản (Tự động gán vào lô nếu không chọn)
   */
  public async addAccount(
    username: string,
    password: string,
    lotId?: string,
    deviceSerial?: string,
    lotSize = 20
  ): Promise<boolean> {
    let targetLotId = lotId;
    let targetSortOrder = 0;

    // Nếu không truyền lotId thì tự động tính lô dựa vào tổng số tài khoản hiện có
    if (!targetLotId) {
      const { count } = await supabase
        .from('accounts')
        .select('*', { count: 'exact', head: true });
      const nextIndex = count || 0;
      const lotNum = Math.floor(nextIndex / lotSize) + 1;
      targetLotId = `lot_${lotNum}`;
      targetSortOrder = (nextIndex % lotSize) + 1;
      await this.ensureLotsExist(lotNum);
    }

    const { error } = await supabase.from('accounts').insert({
      username: username.trim(),
      password: password.trim(),
      lot_id: targetLotId,
      device_serial: deviceSerial || '',
      sort_order: targetSortOrder,
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
   * Tự động cắt, đếm và chia lô 20 tài khoản mỗi lô nếu không chỉ định lô
   */
  public async saveAccounts(
    list: { username: string; password: string; lotId?: string; deviceSerial?: string }[],
    autoPartition = true,
    lotSize = 20
  ): Promise<boolean> {
    // Xóa hết rồi insert lại
    const { error: delError } = await supabase.from('accounts').delete().neq('id', '00000000-0000-0000-0000-000000000000');
    if (delError) {
      console.error('[AccountManager] Lỗi xóa accounts:', delError.message);
      return false;
    }

    if (list.length === 0) return true;

    if (autoPartition) {
      const totalLots = Math.ceil(list.length / lotSize);
      await this.ensureLotsExist(totalLots);
    }

    const rows = list.map((a, idx) => {
      let lotId = a.lotId;
      let sortOrder = idx;

      if (autoPartition || !lotId) {
        const lotNum = Math.floor(idx / lotSize) + 1;
        lotId = `lot_${lotNum}`;
        sortOrder = (idx % lotSize) + 1;
      }

      return {
        username: a.username.trim(),
        password: a.password.trim(),
        lot_id: lotId,
        device_serial: a.deviceSerial || '',
        sort_order: sortOrder,
      };
    });

    // Insert theo batch 50 để tránh vượt giới hạn payload
    for (let i = 0; i < rows.length; i += 50) {
      const batch = rows.slice(i, i + 50);
      const { error } = await supabase.from('accounts').insert(batch);
      if (error) {
        console.error(`[AccountManager] Lỗi insert accounts batch ${i}:`, error.message);
        return false;
      }
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
