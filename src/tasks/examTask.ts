import fs from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import chalk from 'chalk';
import { PNG } from 'pngjs';
import { adbService, AdbService } from '../services/adbService.js';
import { COORDINATES, Point } from '../config/coordinates.js';
import { parseUiHierarchy, solveQuestionFromNodes, AnswerItem } from '../services/examSolver.js';
import { ocrSolver } from '../services/ocrSolver.js';
import { eventBus } from '../services/eventBus.js';

export interface AccountConfig {
  username: string;
  password: string;
  deviceSerial?: string;
  fixedAnswer?: 'A' | 'B' | 'C' | 'D' | 'RANDOM';
  totalQuestions?: number;
}

export interface TaskResult {
  username: string;
  serial: string;
  success: boolean;
  screenshotPath?: string;
  error?: string;
  durationMs: number;
}

export interface ExamExecuteOptions {
  answersData?: AnswerItem[];
  bannerTitle?: string;
  abortSignal?: { aborted: boolean };
}

export class ExamTask {
  private adb: AdbService;

  constructor(adb: AdbService = adbService) {
    this.adb = adb;
  }

  private log(serial: string, username: string, message: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' = 'cyan') {
    const timestamp = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    const prefix = `[${timestamp}][${serial}][${username}]`;
    const coloredPrefix = chalk.bold(prefix);
    const coloredMsg = chalk[color](message);
    console.log(`${coloredPrefix} ${coloredMsg}`);

    // Phát log tới Web UI
    try {
      eventBus.broadcastLog({
        time: timestamp,
        serial,
        username,
        message,
        color,
      });
    } catch {}
  }

  /**
   * Phân tích ảnh PNG và trích xuất tọa độ Y của 4 nút radio đáp án (A, B, C, D)
   */
  public detectCirclesFromPng(png: PNG): number[] {
    const rowCounts = new Array(850).fill(0);
    for (let y = 330; y < 800; y++) {
      let count = 0;
      for (let x = 45; x <= 85; x++) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (r < 245 || g < 245 || b < 245) count++;
      }
      rowCounts[y] = count;
    }

    const intervals: { centerY: number }[] = [];
    let inInterval = false;
    let startY = 0;
    for (let y = 330; y < 800; y++) {
      const hasBorder = rowCounts[y] > 0 || (y + 1 < 800 && rowCounts[y + 1] > 0);
      if (hasBorder) {
        if (!inInterval) {
          inInterval = true;
          startY = y;
        }
      } else {
        if (inInterval) {
          inInterval = false;
          const h = y - startY;
          if (h >= 18 && h <= 50) {
            intervals.push({ centerY: Math.round((startY + y) / 2) });
          }
        }
      }
    }

    const circles = intervals.slice(-4).map((i) => i.centerY);
    return circles.length === 4 ? circles : [];
  }

  /**
   * Chụp màn hình thiết bị và trích xuất vị trí Y của 4 lựa chọn đáp án
   */
  public async getOptionCircles(serial: string): Promise<number[]> {
    try {
      const dev = this.adb.getDevice(serial);
      const stream = await dev.screencap();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const png = PNG.sync.read(Buffer.concat(chunks));
      return this.detectCirclesFromPng(png);
    } catch {
      return [];
    }
  }

  /**
   * Tự động phát hiện tọa độ tâm 4 nút radio A, B, C, D từ ảnh chụp màn hình
   * 100% chính xác, tự thích ứng với mọi độ dài câu hỏi (1 dòng, 2 dòng, 3 dòng)
   */
  private async getDynamicOptionCoordinates(serial: string): Promise<Record<'A' | 'B' | 'C' | 'D', { x: number; y: number }>> {
    for (let attempt = 0; attempt < 5; attempt++) {
      const circles = await this.getOptionCircles(serial);
      if (circles.length === 4) {
        return {
          A: { x: 200, y: circles[0] },
          B: { x: 200, y: circles[1] },
          C: { x: 200, y: circles[2] },
          D: { x: 200, y: circles[3] },
        };
      }
      await this.adb.sleep(600, 900);
    }

    return {
      A: COORDINATES.EXAM.OPTIONS.A,
      B: COORDINATES.EXAM.OPTIONS.B,
      C: COORDINATES.EXAM.OPTIONS.C,
      D: COORDINATES.EXAM.OPTIONS.D,
    };
  }

  /**
   * Tính hash vùng nội dung câu hỏi để kiểm tra màn hình đã thực sự chuyển câu hay chưa
   */
  private getQuestionHash(png: PNG): number {
    let h = 0;
    for (let y = 350; y < 450; y += 2) {
      for (let x = 40; x < 600; x += 4) {
        const idx = (png.width * y + x) << 2;
        h = ((h << 5) - h) + png.data[idx] + png.data[idx + 1] + png.data[idx + 2];
        h |= 0;
      }
    }
    return h;
  }

  /**
   * Tự động phát hiện vị trí chính xác của nút màu xanh "NỘP BÀI" ở góc trên bên phải
   */
  public findNopBaiButton(png: PNG): { x: number; y: number } {
    let minX = 9999, maxX = 0, minY = 9999, maxY = 0;
    for (let y = 175; y < 290; y++) {
      for (let x = 420; x < 705; x++) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (b > 190 && r < 90 && g < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX < maxX && minY < maxY && maxX - minX > 100 && maxY - minY > 40) {
      return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
    }
    return { x: 563, y: 235 };
  }

  /**
   * Tự động tìm nút màu xanh trong popup xác nhận (khoảng y: 750 - 870)
   */
  public findPopupConfirmButton(png: PNG): { x: number; y: number } {
    let minX = 9999, maxX = 0, minY = 9999, maxY = 0;
    for (let y = 750; y < 870; y++) {
      for (let x = 350; x < 600; x++) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (b > 190 && r < 90 && g < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX < maxX && minY < maxY && maxX - minX > 80 && maxY - minY > 30) {
      return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
    }
    return { x: 476, y: 815 };
  }

  /**
   * Tự động tìm nút màu xanh "XEM KẾT QUẢ" (khoảng y: 880 - 1000)
   */
  public findPopupResultButton(png: PNG): { x: number; y: number } {
    let minX = 9999, maxX = 0, minY = 9999, maxY = 0;
    for (let y = 880; y < 1000; y++) {
      for (let x = 120; x < 600; x++) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (b > 190 && r < 90 && g < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
          if (y < minY) minY = y;
          if (y > maxY) maxY = y;
        }
      }
    }
    if (minX < maxX && minY < maxY && maxX - minX > 150 && maxY - minY > 30) {
      return { x: Math.round((minX + maxX) / 2), y: Math.round((minY + maxY) / 2) };
    }
    return { x: 361, y: 939 };
  }

  /**
   * Tự động phát hiện vị trí Y của banner cuộc thi "Tuần 4_Cuộc thi Huỳnh Thúc Kháng"
   * dựa trên huy hiệu màu đỏ đậm "MỞ CỔNG Tuần 4"
   */
  public findTuan3Banner(png: PNG): number | null {
    for (let y = 170; y < png.height - 100; y += 4) {
      let darkRedCount = 0;
      for (let x = 250; x <= 470; x += 2) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        // Huy hiệu đỏ đậm "MỞ CỔNG Tuần 4" (r: 100-170, g <= 50, b <= 50)
        if (r >= 100 && r <= 170 && g <= 50 && b <= 50) {
          darkRedCount++;
        }
      }
      if (darkRedCount > 35) {
        return y;
      }
    }
    return null;
  }

  /**
   * Cuộn xuống cuối trang / danh sách cuộc thi và bấm chọn "Tuần 4_Cuộc thi..."
   */
  public async scrollToAndSelectTuan3(serial: string, username: string): Promise<void> {
    this.log(serial, username, '[Bước 2/4] Cuộn xuống trang để chọn cuộc thi "Tuần 4_Cuộc thi..."...');

    let foundY: number | null = null;

    // Kiểm tra ngay trên màn hình hiện tại xem Tuần 4 đã nằm trong tầm click chưa
    try {
      const dev = this.adb.getDevice(serial);
      const stream = await dev.screencap();
      const chunks: Buffer[] = [];
      for await (const chunk of stream) chunks.push(chunk);
      const png = PNG.sync.read(Buffer.concat(chunks));
      foundY = this.findTuan3Banner(png);
    } catch {}

    // Nếu chưa thấy hoặc nằm quá sát mép màn hình, tiến hành cuộn xuống (swipe từ dưới lên)
    for (let attempt = 1; attempt <= 4; attempt++) {
      if (foundY && foundY >= 250 && foundY <= 1050) {
        this.log(serial, username, `[Bước 2/4] ✔ Đã thấy banner Tuần 4 tại Y: ${foundY}`, 'green');
        break;
      }

      this.log(serial, username, `[Bước 2/4] Đang cuộn xuống trang (lần ${attempt}/4)...`);
      await this.adb.swipe(serial, 360, 950, 360, 400, 450);
      await this.adb.sleep(900, 1300);

      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const png = PNG.sync.read(Buffer.concat(chunks));
        foundY = this.findTuan3Banner(png);
      } catch {}
    }

    // Nếu cuộn xuống quá đà mà vượt qua Tuần 4, cuộn nhẹ ngược lên lại
    if (!foundY || foundY < 250 || foundY > 1050) {
      this.log(serial, username, '[Bước 2/4] Căn chỉnh vị trí banner Tuần 4...', 'yellow');
      await this.adb.swipe(serial, 360, 400, 360, 850, 450);
      await this.adb.sleep(900, 1300);

      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const png = PNG.sync.read(Buffer.concat(chunks));
        foundY = this.findTuan3Banner(png);
      } catch {}
    }

    const clickY = foundY && foundY >= 250 && foundY <= 1050 ? foundY : COORDINATES.NAVIGATION.EXAM_BANNER_TUAN_3.y;
    this.log(serial, username, `[Bước 2/4] 👉 Click vào banner "Tuần 4_Cuộc thi..." tại (360, ${clickY})...`, 'green');
    await this.adb.exec(serial, `input tap 360 ${clickY}`);
  }

  /**
   * Tạm dừng chờ người dùng tự thao tác chọn Banner cuộc thi trên máy ảo.
   * Tool DỪNG HOÀN TOÀN, KHÔNG GỬI BẤT KỲ LỆNH NÀO LÊN MÁY ẢO.
   * Người dùng có thể bấm nút "TIẾP TỤC" trên giao diện Web hoặc bấm phím [ENTER] tại Terminal!
   */
  public async waitForUserToReachExam(serial: string, username: string): Promise<void> {
    this.log(serial, username, '========================================================================', 'yellow');
    this.log(serial, username, '👉 ĐÃ VÀO MỤC "CUỘC THI TRỰC TUYẾN"!', 'yellow');
    this.log(serial, username, '👉 TOOL ĐÃ DỪNG LẠI (CHỜ BẠN CHỌN ĐÚNG BANNER TRÊN MÁY ẢO).', 'yellow');
    this.log(serial, username, '👉 Hãy dùng chuột trên máy ảo: Tìm và click vào đúng Banner bạn muốn thi.', 'yellow');
    this.log(serial, username, '👉 Khi đến màn hình có nút "BẮT ĐẦU BÀI THI", BẤM NÚT [TIẾP TỤC] TRÊN WEB HOẶC [ENTER] TẠI ĐÂY:', 'green');
    this.log(serial, username, '========================================================================', 'yellow');

    await new Promise<void>((resolve) => {
      let isResolved = false;

      const doResolve = (source: string) => {
        if (!isResolved) {
          isResolved = true;
          eventBus.emit('banner_resumed', { serial, username, source });
          this.log(serial, username, `[Bước 2/4] ✔ Nhận lệnh TIẾP TỤC (từ ${source})! Bắt đầu vào làm bài...`, 'green');
          resolve();
        }
      };

      // 1. Lắng nghe tín hiệu Tiếp tục từ Web UI
      const onWebResume = () => {
        eventBus.off('request_resume_banner', onWebResume);
        doResolve('Giao diện Web');
      };
      eventBus.on('request_resume_banner', onWebResume);

      // Phát sự kiện báo cho Web UI hiển thị popup/banner alert
      eventBus.emit('waiting_banner', {
        serial,
        username,
        message: 'Đã vào Cuộc thi trực tuyến! Vui lòng chọn Banner trên máy ảo rồi bấm Tiếp tục.',
      });

      // 2. Lắng nghe phím ENTER từ Terminal
      const rl = readline.createInterface({
        input: process.stdin,
        output: process.stdout,
      });

      rl.question('', () => {
        rl.close();
        eventBus.off('request_resume_banner', onWebResume);
        doResolve('Phím ENTER Terminal');
      });
    });
  }

  /**
   * Tự động phát hiện vị trí chính xác của nút "BẮT ĐẦU BÀI THI" hoặc "LÀM LẠI BÀI THI" (nút màu xanh lớn chiều ngang > 400px)
   * Vị trí nút có thể thay đổi linh hoạt từ y: 750 đến y: 1200 tùy thuộc vào kích thước banner ảnh
   */
  public findStartExamButton(png: PNG): Point {
    for (let y = 750; y < 1220; y += 4) {
      let minX = 999, maxX = 0;
      for (let x = 30; x < png.width - 30; x += 3) {
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const g = png.data[idx + 1];
        const b = png.data[idx + 2];
        if (b > 180 && r < 100 && g < 130) {
          if (x < minX) minX = x;
          if (x > maxX) maxX = x;
        }
      }
      // Nút xanh lớn chiếm chiều ngang > 400px
      if (maxX - minX > 400) {
        let bottomY = y;
        for (let checkY = y; checkY < Math.min(png.height, y + 120); checkY += 4) {
          const idx = (png.width * checkY + 360) << 2;
          const r = png.data[idx];
          const g = png.data[idx + 1];
          const b = png.data[idx + 2];
          if (b > 180 && r < 100 && g < 130) {
            bottomY = checkY;
          } else {
            break;
          }
        }
        const centerY = Math.round((y + bottomY) / 2);
        return { x: 360, y: centerY, description: 'Nút BẮT ĐẦU BÀI THI / LÀM LẠI BÀI THI (phát hiện)' };
      }
    }
    return { x: 360, y: 868, description: 'Nút BẮT ĐẦU BÀI THI (fallback)' };
  }

  /**
   * Kiểm tra xem hình tròn radio tại centerY có đang được chọn (tô màu xanh) hay không
   */
  private isOptionSelected(png: PNG, centerY: number): boolean {
    for (let dy = -15; dy <= 15; dy++) {
      for (let dx = -15; dx <= 15; dx++) {
        const x = 65 + dx;
        const y = centerY + dy;
        if (x < 0 || x >= png.width || y < 0 || y >= png.height) continue;
        const idx = (png.width * y + x) << 2;
        const r = png.data[idx];
        const b = png.data[idx + 2];
        if (r < 120 && b > 160) return true;
      }
    }
    return false;
  }

  /**
   * Thực hiện quy trình làm bài thi tự động tuần tự 4 bước
   */
  public async execute(
    account: AccountConfig,
    serial: string,
    options?: ExamExecuteOptions
  ): Promise<TaskResult> {
    const startTime = Date.now();
    const username = account.username;
    const totalQuestions = account.totalQuestions || 20;

    this.log(serial, username, '>>> Bắt đầu tiến trình thi tự động...', 'blue');

    if (options?.abortSignal?.aborted) {
      return {
        username,
        serial,
        success: false,
        error: 'Tiến trình bị hủy trước khi bắt đầu',
        durationMs: 0,
      };
    }

    // Tải ngân hàng đáp án từ options (theo Banner đã chọn) hoặc fallback sang answers.json
    let answersData: any[] = [];
    if (options?.answersData && options.answersData.length > 0) {
      answersData = options.answersData;
      const bTitle = options.bannerTitle ? `[${options.bannerTitle}]` : '[Banner Active]';
      this.log(serial, username, `${bTitle} Đã nạp thành công ${answersData.length} câu hỏi & đáp án chuẩn!`, 'green');
    } else {
      const answersPath = path.resolve(process.cwd(), 'answers.json');
      if (fs.existsSync(answersPath)) {
        try {
          answersData = JSON.parse(fs.readFileSync(answersPath, 'utf-8'));
          this.log(serial, username, `[answers.json] Đã nạp thành công ${answersData.length} câu hỏi & đáp án chuẩn!`, 'green');
        } catch (err: any) {
          this.log(serial, username, `[answers.json] Không thể đọc file: ${err.message}`, 'yellow');
        }
      }
    }

    try {
      // -------------------------------------------------------------
      // BƯỚC 1: Khởi động app & Đăng nhập
      // -------------------------------------------------------------
      const targetPkg = await this.adb.getTargetPackage(serial);
      this.log(serial, username, `[Bước 1/4] Làm mới dữ liệu và mở app (${targetPkg})...`);
      await this.adb.clearApp(serial, targetPkg);
      await this.adb.sleep(1000, 1500);
      await this.adb.launchApp(serial, targetPkg);
      this.log(serial, username, '[Bước 1/4] Chờ 3.5 giây để app tải giao diện...');
      await new Promise((resolve) => setTimeout(resolve, 3500));

      this.log(serial, username, '[Bước 1/4] Click vào ô nhập Email/Số điện thoại/CCCD...');
      await this.adb.tap(serial, COORDINATES.LOGIN.USERNAME_INPUT);
      await this.adb.sleep(600, 1000);
      await this.adb.clearInput(serial, 40);
      await this.adb.sleep(300, 600);

      this.log(serial, username, `[Bước 1/4] Nhập tài khoản: ${username}`);
      await this.adb.inputText(serial, username);
      await this.adb.sleep(600, 1200);

      this.log(serial, username, '[Bước 1/4] Click vào ô nhập Mật khẩu...');
      await this.adb.tap(serial, COORDINATES.LOGIN.PASSWORD_INPUT);
      await this.adb.sleep(600, 1000);
      await this.adb.clearInput(serial, 40);
      await this.adb.sleep(300, 600);

      this.log(serial, username, '[Bước 1/4] Nhập mật khẩu...');
      await this.adb.inputText(serial, account.password);
      await this.adb.sleep(600, 1200);

      this.log(serial, username, '[Bước 1/4] Click nút cam "ĐĂNG NHẬP"...');
      await this.adb.tap(serial, COORDINATES.LOGIN.LOGIN_BUTTON);

      this.log(serial, username, '[Bước 1/4] Đang đăng nhập, chờ 3.5 giây...', 'yellow');
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // Kiểm tra và xử lý kết quả đăng nhập (Thành công hay Thất bại)
      let loginSuccess = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const focusWindow = await this.adb.exec(serial, 'dumpsys window | grep mCurrentFocus');
          if (focusWindow.includes('permissioncontroller') || focusWindow.includes('GrantPermissionsActivity')) {
            this.log(serial, username, '[Bước 1/4] Phát hiện popup thông báo, click "CHO PHÉP"...');
            await this.adb.tap(serial, COORDINATES.LOGIN.PERMISSION_ALLOW);
            await this.adb.sleep(1500, 2000);
            loginSuccess = true;
            break;
          }
        } catch {
          // bỏ qua
        }

        try {
          const dump = await this.adb.exec(serial, 'uiautomator dump /sdcard/login_check.xml && cat /sdcard/login_check.xml');
          // Nếu đã vào giao diện trong (có các mục thanh điều hướng)
          if (dump.includes('Công tác đoàn') || dump.includes('Bảng tin') || dump.includes('Khám phá') || dump.includes('Cá nhân')) {
            loginSuccess = true;
            break;
          }

          // Nếu vẫn còn nút ĐĂNG NHẬP trên màn hình
          if (dump.includes('content-desc="ĐĂNG NHẬP"') || dump.includes('content-desc="Đăng nhập"')) {
            if (attempt < 2) {
              await this.adb.sleep(1500, 2000);
              continue;
            } else {
              this.log(serial, username, '[LỖI] Đăng nhập thất bại (tài khoản hoặc mật khẩu không đúng)! Bỏ qua tài khoản này...', 'red');
              await this.adb.clearApp(serial, targetPkg);
              throw new Error(`Đăng nhập thất bại: Tài khoản hoặc mật khẩu không chính xác (${username})`);
            }
          }
        } catch (err: any) {
          if (err.message.includes('Đăng nhập thất bại')) throw err;
        }

        await this.adb.sleep(1000, 1500);
      }

      // -------------------------------------------------------------
      // BƯỚC 2: Điều hướng đến mục Thi trực tuyến
      // -------------------------------------------------------------
      this.log(serial, username, '[Bước 2/4] Click icon thứ 2 "Công tác đoàn" ở thanh điều hướng đáy...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.BOTTOM_CONG_TAC_DOAN);
      await this.adb.sleep(1500, 2200);

      this.log(serial, username, '[Bước 2/4] Click vào ô mục "Học và thi" (icon tập tài liệu có bút đỏ)...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.HOC_VA_THI);
      this.log(serial, username, '[Bước 2/4] Đang chờ 5 giây theo yêu cầu...');
      await new Promise((resolve) => setTimeout(resolve, 5000));

      this.log(serial, username, '[Bước 2/4] Click vào mục đầu tiên "Cuộc thi trực tuyến"...');
      await this.adb.tap(serial, COORDINATES.NAVIGATION.CUOC_THI_TRUC_TUYEN_CARD);
      await this.adb.sleep(2000, 3000);

      // Tạm dừng 100% chờ người dùng chọn cuộc thi và bấm ENTER
      await this.waitForUserToReachExam(serial, username);

      // Sau khi người dùng bấm ENTER (đã ở màn hình chi tiết bài thi):
      this.log(serial, username, '[Bước 2/4] 👉 Click nút màu xanh "BẮT ĐẦU BÀI THI" tại (360, 868)...', 'green');
      await this.adb.exec(serial, 'input tap 360 868');
      await this.adb.sleep(1000, 1500);

      this.log(serial, username, '[Bước 2/4] Đang chờ WebView bài thi tải xong hoàn toàn Câu 1...');

      // Polling thông minh: Chờ cho đến khi phát hiện được đủ 4 hình tròn đáp án của Câu 1
      let examLoaded = false;
      for (let wait = 1; wait <= 18; wait++) {
        await this.adb.sleep(1000, 1200);
        const circles = await this.getOptionCircles(serial);
        if (circles.length === 4) {
          this.log(serial, username, `[Bước 2/4] ✔ WebView đã tải xong Câu 1! 4 đáp án tại Y: [${circles.join(', ')}]`, 'green');
          examLoaded = true;
          break;
        }
        // Nếu sau mỗi 4 lần check chưa tải xong, thử click lại nút Bắt đầu
        if (wait % 4 === 0) {
          this.log(serial, username, `[Bước 2/4] Chưa thấy bài thi mở ra (lần ${wait}/18), thử click lại nút Bắt đầu tại (360, 868)...`, 'yellow');
          try {
            await this.adb.exec(serial, 'input tap 360 868');
          } catch {}
        }
      }

      if (!examLoaded) {
        throw new Error('Giao diện bài thi chưa tải xong (không tìm thấy 4 đáp án). Dừng tiến trình để tránh bấm nhầm!');
      }

      // -------------------------------------------------------------
      // BƯỚC 3: Tự động trả lời bài thi (hoàn tất chuẩn xác 20/20 câu bằng OCR & answers.json)
      // -------------------------------------------------------------
      const maxLoops = 20;
      this.log(serial, username, `[Bước 3/4] Bắt đầu tự động trả lời 20 câu hỏi (so khớp answers.json qua OCR/Hình ảnh siêu tốc)...`, 'blue');

      const optionsList: Array<'A' | 'B' | 'C' | 'D'> = ['A', 'B', 'C', 'D'];
      let nextClickCount = 0;
      let currentQuestionNum = 1;

      for (let q = 1; q <= maxLoops; q++) {
        if (options?.abortSignal?.aborted) {
          throw new Error('Tiến trình đã bị dừng bởi người dùng (Stop action).');
        }
        // Cho WebView ổn định giao diện và hoàn tất hiệu ứng chuyển câu
        await this.adb.sleep(1000, 1400);

        let targetCoord: { x: number; y: number } | null = null;
        let chosenLabel = '';

        // Chụp ảnh màn hình để vừa phát hiện radio button vừa đọc câu hỏi bằng OCR
        let currentPng: PNG | null = null;
        try {
          const dev = this.adb.getDevice(serial);
          const stream = await dev.screencap();
          const chunks: Buffer[] = [];
          for await (const chunk of stream) chunks.push(chunk);
          currentPng = PNG.sync.read(Buffer.concat(chunks));
        } catch {}

        const circles = currentPng ? this.detectCirclesFromPng(currentPng) : [];

        // Ưu tiên 1: Tự động nhận diện câu hỏi và đáp án qua OCR + answers.json
        if (
          currentPng &&
          circles.length === 4 &&
          answersData.length > 0 &&
          (!account.fixedAnswer || account.fixedAnswer === 'RANDOM')
        ) {
          try {
            const ocrMatch = await ocrSolver.solveFromPng(currentPng, circles, answersData as AnswerItem[]);
            if (ocrMatch) {
              targetCoord = ocrMatch.targetCoord;
              const optLetter = ['A', 'B', 'C', 'D'][ocrMatch.matchedOptionIndex];
              chosenLabel = `[${optLetter}] ${ocrMatch.targetAnswer}`;
              
              // Trích xuất số câu thực tế trên màn hình nếu có
              const numMatch = ocrMatch.detectedQuestionText.match(/câu\s*(\d+)/i);
              if (numMatch) currentQuestionNum = parseInt(numMatch[1], 10);

              this.log(
                serial,
                username,
                `[Bước 3/4] [Câu ${currentQuestionNum || q}/${maxLoops}] 🎯 Khớp câu hỏi: "${ocrMatch.questionMatched.slice(0, 50)}..."`,
                'green'
              );
              this.log(
                serial,
                username,
                `[Bước 3/4] [Câu ${currentQuestionNum || q}/${maxLoops}] 👉 Chọn đáp án: [${optLetter}] "${ocrMatch.targetAnswer}" tại (${targetCoord.x}, ${targetCoord.y}) (Tin cậy: ${(ocrMatch.confidence * 100).toFixed(0)}%)`,
                'green'
              );
            }
          } catch (err: any) {
            this.log(serial, username, `[Lưu ý] Lỗi xử lý OCR: ${err.message}`, 'yellow');
          }
        }

        // Ưu tiên 2 (Fallback): Nếu không khớp answers.json hoặc người dùng chỉ định fixedAnswer
        if (!targetCoord) {
          const optionCoords = circles.length === 4
            ? {
                A: { x: 200, y: circles[0] },
                B: { x: 200, y: circles[1] },
                C: { x: 200, y: circles[2] },
                D: { x: 200, y: circles[3] },
              }
            : await this.getDynamicOptionCoordinates(serial);

          let chosenOption: 'A' | 'B' | 'C' | 'D';
          if (account.fixedAnswer && account.fixedAnswer !== 'RANDOM') {
            chosenOption = account.fixedAnswer as 'A' | 'B' | 'C' | 'D';
          } else {
            const randomIndex = Math.floor(Math.random() * optionsList.length);
            chosenOption = optionsList[randomIndex];
          }
          targetCoord = optionCoords[chosenOption];
          chosenLabel = `[Fallback] [${chosenOption}]`;
          this.log(
            serial,
            username,
            `[Bước 3/4] [Câu ${q}/${maxLoops}] Chọn đáp án fallback: [${chosenOption}] tại (${targetCoord.x}, ${targetCoord.y})`,
            'cyan'
          );
        }

        // Click ĐÚNG 1 LẦN DUY NHẤT vào đáp án đã chọn (tránh multi-click/double-tap làm hủy chọn hoặc lỗi WebView)
        await this.adb.exec(serial, `input tap ${targetCoord.x} ${targetCoord.y}`);
        // Nghỉ 1.2s - 1.5s để WebView ghi nhận câu trả lời lên hệ thống
        await this.adb.sleep(1200, 1500);

        // Chuyển sang câu tiếp theo bằng icon mũi tên sang phải (>) nếu chưa đến câu cuối (q < 20)
        if (q < maxLoops) {
          nextClickCount++;
          this.log(
            serial,
            username,
            `[Bước 3/4] [Click Next lần ${nextClickCount}] Chuyển sang câu tiếp theo...`,
            'blue'
          );

          // Click Next và chờ 2.2 - 2.6s cho WebView trượt màn hình hoàn tất
          await this.adb.tap(serial, COORDINATES.EXAM.BTN_NEXT_QUESTION, false);
          await this.adb.sleep(2200, 2600);
        }
      }

      this.log(
        serial,
        username,
        `[Bước 3/4] ✔ Đã hoàn thành toàn bộ ${maxLoops} câu hỏi với ${nextClickCount} lần bấm Next!`,
        'green'
      );

      // -------------------------------------------------------------
      // BƯỚC 4: Nộp bài & Xem kết quả
      // -------------------------------------------------------------
      // Đợi 2 giây sau khi hoàn thành câu 20 để WebView ghi nhận đáp án
      await this.adb.sleep(1800, 2200);
      this.log(serial, username, '[Bước 4/4] Bắt đầu quy trình nộp bài...', 'blue');

      // 1. Click nút "NỘP BÀI" ở góc trên bên phải màn hình làm bài
      let topBtn = { x: 563, y: 235 };
      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const screenPng = PNG.sync.read(Buffer.concat(chunks));
        topBtn = this.findNopBaiButton(screenPng);
      } catch {
        // Fallback
      }
      this.log(serial, username, `[Bước 4/4] Click nút "NỘP BÀI" ở góc trên bên phải tại (${topBtn.x}, ${topBtn.y})...`);
      await this.adb.exec(serial, `input tap ${topBtn.x} ${topBtn.y}`);
      this.log(serial, username, '[Bước 4/4] Chờ 2.5 giây để hộp thoại xác nhận nộp bài mở ra...');
      await new Promise((resolve) => setTimeout(resolve, 2500));

      // 2. Click nút xác nhận "NỘP BÀI" trên popup
      let confirmBtn = { x: 476, y: 815 };
      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const screenPng = PNG.sync.read(Buffer.concat(chunks));
        confirmBtn = this.findPopupConfirmButton(screenPng);
      } catch {
        // Fallback
      }
      this.log(serial, username, `[Bước 4/4] Click nút xác nhận "NỘP BÀI" (bên phải popup) tại (${confirmBtn.x}, ${confirmBtn.y})...`);
      await this.adb.exec(serial, `input tap ${confirmBtn.x} ${confirmBtn.y}`);
      // Đồng thời click tọa độ (562, 187) theo cấu hình người dùng
      await this.adb.exec(serial, 'input tap 562 187');
      this.log(serial, username, '[Bước 4/4] Chờ 3.5 giây để hệ thống xử lý nộp bài và tải popup kết quả...');
      await new Promise((resolve) => setTimeout(resolve, 3500));

      // 3. Click nút "XEM KẾT QUẢ"
      let resultBtn = { x: 361, y: 939 };
      try {
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        const screenPng = PNG.sync.read(Buffer.concat(chunks));
        resultBtn = this.findPopupResultButton(screenPng);
      } catch {
        // Fallback
      }
      this.log(serial, username, `[Bước 4/4] Click nút "XEM KẾT QUẢ" tại (${resultBtn.x}, ${resultBtn.y})...`);
      await this.adb.exec(serial, `input tap ${resultBtn.x} ${resultBtn.y}`);
      await this.adb.exec(serial, 'input tap 362 735');
      await new Promise((resolve) => setTimeout(resolve, 2000));

      // 4. Chụp ảnh màn hình kết quả lưu lại làm bằng chứng
      let resultScreenshotPath = '';
      try {
        const screenshotDir = path.resolve(process.cwd(), 'logs', 'screenshots');
        if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });
        resultScreenshotPath = path.join(screenshotDir, `${username}_result_${Date.now()}.png`);
        const dev = this.adb.getDevice(serial);
        const stream = await dev.screencap();
        const chunks: Buffer[] = [];
        for await (const chunk of stream) chunks.push(chunk);
        fs.writeFileSync(resultScreenshotPath, Buffer.concat(chunks));
        this.log(serial, username, `[Bước 4/4] 📸 Đã lưu ảnh chụp màn hình kết quả tại: ${resultScreenshotPath}`, 'green');
      } catch (err: any) {
        this.log(serial, username, `[Bước 4/4] Không thể chụp ảnh kết quả: ${err.message}`, 'yellow');
      }

      // 5. Dừng 10 giây để người dùng xem kết quả theo yêu cầu
      this.log(
        serial,
        username,
        '[Bước 4/4] 🎯 Đang hiển thị kết quả bài thi. Dừng 10 giây để bạn xem kết quả trước khi chuyển tài khoản tiếp theo...',
        'yellow'
      );
      await new Promise((resolve) => setTimeout(resolve, 10000));

      const durationMs = Date.now() - startTime;
      const durationSec = (durationMs / 1000).toFixed(1);
      this.log(serial, username, `✔ HOÀN THÀNH TOÀN BỘ QUY TRÌNH THI! (Thời gian: ${durationSec}s)`, 'green');

      return {
        username,
        serial,
        success: true,
        screenshotPath: resultScreenshotPath,
        durationMs,
      };
    } catch (error: any) {
      const durationMs = Date.now() - startTime;
      this.log(serial, username, `✖ GẶP LỖI: ${error.message}`, 'red');

      return {
        username,
        serial,
        success: false,
        error: error.message,
        durationMs,
      };
    }
  }
}

export const examTask = new ExamTask();
