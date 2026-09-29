import fs from 'node:fs';
import path from 'node:path';
import { AnswerItem } from './examSolver.js';

export interface BannerInfo {
  id: string;
  key: number;
  title: string;
  description: string;
  fileName: string;
  totalQuestions: number;
}

export class BannerManager {
  private dataDir: string;
  private bannersMetaPath: string;
  private activeBannerId: string = 'banner_1';

  constructor() {
    this.dataDir = path.resolve(process.cwd(), 'data');
    this.bannersMetaPath = path.join(this.dataDir, 'banners.json');
    this.ensureInitialized();
  }

  /**
   * Khởi tạo thư mục data và 5 file đáp án mẫu nếu chưa tồn tại
   */
  public ensureInitialized(): void {
    if (!fs.existsSync(this.dataDir)) {
      fs.mkdirSync(this.dataDir, { recursive: true });
    }

    // Đọc đáp án gốc từ answers.json nếu có để làm dữ liệu khởi đầu
    let rootAnswers: AnswerItem[] = [];
    const rootAnswersPath = path.resolve(process.cwd(), 'answers.json');
    if (fs.existsSync(rootAnswersPath)) {
      try {
        rootAnswers = JSON.parse(fs.readFileSync(rootAnswersPath, 'utf-8'));
      } catch {
        rootAnswers = [];
      }
    }

    const defaultBanners: BannerInfo[] = [
      {
        id: 'banner_1',
        key: 1,
        title: 'Phần thi 1 (Banner 1)',
        description: 'Ngân hàng đáp án phần thi 1',
        fileName: 'answers_banner_1.json',
        totalQuestions: 0,
      },
      {
        id: 'banner_2',
        key: 2,
        title: 'Phần thi 2 (Banner 2)',
        description: 'Ngân hàng đáp án phần thi 2',
        fileName: 'answers_banner_2.json',
        totalQuestions: 0,
      },
      {
        id: 'banner_3',
        key: 3,
        title: 'Phần thi 3 (Banner 3)',
        description: 'Ngân hàng đáp án phần thi 3',
        fileName: 'answers_banner_3.json',
        totalQuestions: 0,
      },
      {
        id: 'banner_4',
        key: 4,
        title: 'Phần thi 4 - Huỳnh Thúc Kháng (Banner 4)',
        description: 'Cuộc thi tìm hiểu về Cụ Huỳnh Thúc Kháng',
        fileName: 'answers_banner_4.json',
        totalQuestions: rootAnswers.length,
      },
      {
        id: 'banner_5',
        key: 5,
        title: 'Phần thi 5 (Banner 5)',
        description: 'Ngân hàng đáp án phần thi 5',
        fileName: 'answers_banner_5.json',
        totalQuestions: 0,
      },
    ];

    // Tạo các file answers cho từng banner nếu chưa có
    defaultBanners.forEach((b) => {
      const filePath = path.join(this.dataDir, b.fileName);
      if (!fs.existsSync(filePath)) {
        if (b.id === 'banner_4' && rootAnswers.length > 0) {
          fs.writeFileSync(filePath, JSON.stringify(rootAnswers, null, 2), 'utf-8');
        } else {
          fs.writeFileSync(filePath, JSON.stringify([], null, 2), 'utf-8');
        }
      }
    });

    if (!fs.existsSync(this.bannersMetaPath)) {
      fs.writeFileSync(this.bannersMetaPath, JSON.stringify({ activeBannerId: 'banner_4', banners: defaultBanners }, null, 2), 'utf-8');
      this.activeBannerId = 'banner_4';
    } else {
      try {
        const meta = JSON.parse(fs.readFileSync(this.bannersMetaPath, 'utf-8'));
        if (meta.activeBannerId) {
          this.activeBannerId = meta.activeBannerId;
        }
      } catch {}
    }
  }

  /**
   * Lấy danh sách 5 banner và đếm số câu hỏi thực tế trong từng file
   */
  public getBanners(): BannerInfo[] {
    this.ensureInitialized();
    try {
      const meta = JSON.parse(fs.readFileSync(this.bannersMetaPath, 'utf-8'));
      const banners: BannerInfo[] = meta.banners || [];

      // Cập nhật số lượng câu hỏi thực tế
      banners.forEach((b) => {
        const filePath = path.join(this.dataDir, b.fileName);
        if (fs.existsSync(filePath)) {
          try {
            const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
            b.totalQuestions = Array.isArray(data) ? data.length : 0;
          } catch {
            b.totalQuestions = 0;
          }
        } else {
          b.totalQuestions = 0;
        }
      });

      return banners;
    } catch {
      return [];
    }
  }

  /**
   * Lấy banner đang kích hoạt
   */
  public getActiveBannerId(): string {
    return this.activeBannerId;
  }

  public setActiveBannerId(id: string): void {
    const banners = this.getBanners();
    if (banners.some((b) => b.id === id)) {
      this.activeBannerId = id;
      try {
        const meta = JSON.parse(fs.readFileSync(this.bannersMetaPath, 'utf-8'));
        meta.activeBannerId = id;
        fs.writeFileSync(this.bannersMetaPath, JSON.stringify(meta, null, 2), 'utf-8');
      } catch {}
    }
  }

  /**
   * Đọc danh sách câu hỏi đáp án của 1 banner
   */
  public getBannerAnswers(bannerId: string): AnswerItem[] {
    const banners = this.getBanners();
    const target = banners.find((b) => b.id === bannerId);
    if (!target) return [];

    const filePath = path.join(this.dataDir, target.fileName);
    if (!fs.existsSync(filePath)) return [];

    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return JSON.parse(content);
    } catch {
      return [];
    }
  }

  /**
   * Lưu danh sách câu hỏi đáp án cho 1 banner
   */
  public saveBannerAnswers(bannerId: string, answers: AnswerItem[]): boolean {
    const banners = this.getBanners();
    const target = banners.find((b) => b.id === bannerId);
    if (!target) return false;

    const filePath = path.join(this.dataDir, target.fileName);
    try {
      fs.writeFileSync(filePath, JSON.stringify(answers, null, 2), 'utf-8');
      
      // Đồng thời nếu là banner đang active thì có thể đồng bộ sang answers.json root để CLI cũ vẫn chạy được
      if (bannerId === this.activeBannerId) {
        fs.writeFileSync(path.resolve(process.cwd(), 'answers.json'), JSON.stringify(answers, null, 2), 'utf-8');
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Cập nhật thông tin tiêu đề / mô tả banner
   */
  public updateBannerMeta(bannerId: string, data: { title?: string; description?: string }): boolean {
    try {
      const meta = JSON.parse(fs.readFileSync(this.bannersMetaPath, 'utf-8'));
      const banner = (meta.banners as BannerInfo[]).find((b) => b.id === bannerId);
      if (!banner) return false;

      if (data.title) banner.title = data.title;
      if (data.description) banner.description = data.description;

      fs.writeFileSync(this.bannersMetaPath, JSON.stringify(meta, null, 2), 'utf-8');
      return true;
    } catch {
      return false;
    }
  }
}

export const bannerManager = new BannerManager();
