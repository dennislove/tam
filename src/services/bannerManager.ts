import 'dotenv/config';
import { supabase } from './supabaseClient.js';
import { AnswerItem } from './examSolver.js';

export interface BannerInfo {
  id: string;
  key: number;
  title: string;
  description: string;
  isActive: boolean;
  totalQuestions: number;
}

export class BannerManager {
  private activeBannerId: string = 'banner_4';

  /**
   * Lấy danh sách tất cả banner từ Supabase
   */
  public async getBanners(): Promise<BannerInfo[]> {
    const { data, error } = await supabase
      .from('banners')
      .select('*')
      .order('key');

    if (error) {
      console.error('[BannerManager] Lỗi lấy banners:', error.message);
      return [];
    }

    // Cập nhật activeBannerId từ DB
    const active = data?.find((b) => b.is_active);
    if (active) this.activeBannerId = active.id;

    return (data || []).map((b) => ({
      id: b.id,
      key: b.key,
      title: b.title,
      description: b.description,
      isActive: b.is_active,
      totalQuestions: b.total_questions,
    }));
  }

  public getActiveBannerId(): string {
    return this.activeBannerId;
  }

  /**
   * Đặt banner active (trigger DB sẽ tự unset các banner khác)
   */
  public async setActiveBannerId(id: string): Promise<boolean> {
    const { error } = await supabase
      .from('banners')
      .update({ is_active: true })
      .eq('id', id);

    if (error) {
      console.error('[BannerManager] Lỗi setActive:', error.message);
      return false;
    }
    this.activeBannerId = id;
    return true;
  }

  /**
   * Lấy danh sách đáp án của 1 banner
   */
  public async getBannerAnswers(bannerId: string): Promise<AnswerItem[]> {
    const { data, error } = await supabase
      .from('banner_answers')
      .select('question, options, answer')
      .eq('banner_id', bannerId)
      .order('sort_order');

    if (error) {
      console.error('[BannerManager] Lỗi lấy đáp án:', error.message);
      return [];
    }

    return (data || []).map((row) => ({
      question: row.question,
      options: Array.isArray(row.options) ? row.options : JSON.parse(row.options),
      answer: row.answer,
    }));
  }

  /**
   * Lưu (replace hoàn toàn) đáp án cho 1 banner
   */
  public async saveBannerAnswers(bannerId: string, answers: AnswerItem[]): Promise<boolean> {
    // Xóa hết câu cũ, insert lại toàn bộ
    const { error: delError } = await supabase
      .from('banner_answers')
      .delete()
      .eq('banner_id', bannerId);

    if (delError) {
      console.error('[BannerManager] Lỗi xóa đáp án cũ:', delError.message);
      return false;
    }

    if (answers.length === 0) return true;

    const rows = answers.map((a, idx) => ({
      banner_id: bannerId,
      question: a.question,
      options: a.options,
      answer: a.answer,
      sort_order: idx,
    }));

    const { error: insError } = await supabase.from('banner_answers').insert(rows);
    if (insError) {
      console.error('[BannerManager] Lỗi lưu đáp án:', insError.message);
      return false;
    }
    return true;
  }

  /**
   * Cập nhật tiêu đề / mô tả banner
   */
  public async updateBannerMeta(
    bannerId: string,
    data: { title?: string; description?: string }
  ): Promise<boolean> {
    const updates: Record<string, string> = {};
    if (data.title) updates.title = data.title;
    if (data.description) updates.description = data.description;

    const { error } = await supabase.from('banners').update(updates).eq('id', bannerId);
    if (error) {
      console.error('[BannerManager] Lỗi updateMeta:', error.message);
      return false;
    }
    return true;
  }

  /**
   * Thêm banner mới (dùng khi muốn tạo banner 6, 7, 8...)
   */
  public async addBanner(id: string, key: number, title: string, description = ''): Promise<boolean> {
    const { error } = await supabase
      .from('banners')
      .insert({ id, key, title, description, is_active: false });
    if (error) {
      console.error('[BannerManager] Lỗi addBanner:', error.message);
      return false;
    }
    return true;
  }
}

export const bannerManager = new BannerManager();
