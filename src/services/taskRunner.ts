import { deviceManager, DeviceInfo } from './deviceManager.js';
import { accountManager, ManagedAccount } from './accountManager.js';
import { bannerManager } from './bannerManager.js';
import { examTask, TaskResult } from '../tasks/examTask.js';
import { macService } from './macService.js';
import { eventBus } from './eventBus.js';

export type RunnerStatus = 'idle' | 'running' | 'waiting_banner' | 'stopping';

export interface StartRunOptions {
  bannerId?: string;
  lotId?: string;
  startFromIndex?: number;
  usernames?: string[];
  deviceSerial?: string;
  concurrency?: number;
  fixedAnswer?: 'A' | 'B' | 'C' | 'D' | 'RANDOM';
  speedMode?: 'fast' | 'normal' | 'safe';
}

export class TaskRunner {
  private status: RunnerStatus = 'idle';
  private abortSignal = { aborted: false };
  private activeBannerId: string = 'banner_1';
  private currentAccountUsername: string | null = null;
  private currentDeviceSerial: string | null = null;
  private waitingDetails: { serial: string; username: string; message: string } | null = null;

  private totalAccounts: number = 0;
  private completedCount: number = 0;
  private failedCount: number = 0;

  constructor() {
    // Lắng nghe sự kiện chờ banner từ examTask
    eventBus.on('waiting_banner', (data: { serial: string; username: string; message: string }) => {
      this.status = 'waiting_banner';
      this.waitingDetails = data;
      this.broadcastState();
    });

    eventBus.on('banner_resumed', () => {
      if (this.status === 'waiting_banner') {
        this.status = 'running';
        this.waitingDetails = null;
        this.broadcastState();
      }
    });
  }

  public getStatus() {
    return {
      status: this.status,
      activeBannerId: bannerManager.getActiveBannerId() || this.activeBannerId,
      currentAccount: this.currentAccountUsername,
      currentDevice: this.currentDeviceSerial,
      waitingDetails: this.waitingDetails,
      stats: {
        total: this.totalAccounts,
        completed: this.completedCount,
        failed: this.failedCount,
      },
    };
  }

  public setActiveBannerId(bannerId: string): void {
    this.activeBannerId = bannerId;
    this.broadcastState();
  }

  private broadcastState(): void {
    eventBus.emit('runner_state_changed', this.getStatus());
  }

  /**
   * Bắt đầu tiến trình chạy danh sách tài khoản
   */
  public async start(options: StartRunOptions): Promise<{ success: boolean; message: string }> {
    if (this.status === 'running' || this.status === 'waiting_banner') {
      return { success: false, message: 'Tiến trình đang chạy, vui lòng dừng trước khi chạy lại!' };
    }

    this.abortSignal = { aborted: false };
    this.status = 'running';
    this.waitingDetails = null;

    // 1. Xác định Banner và nạp đáp án tương ứng
    const bannerId = options.bannerId || bannerManager.getActiveBannerId();
    this.activeBannerId = bannerId;
    await bannerManager.setActiveBannerId(bannerId);

    const banners = await bannerManager.getBanners();
    const currentBanner = banners.find((b) => b.id === bannerId);
    const bannerAnswers = await bannerManager.getBannerAnswers(bannerId);
    const bannerTitle = currentBanner ? currentBanner.title : bannerId;

    eventBus.broadcastLog({
      message: `🚀 Khởi động tiến trình thi cho [${bannerTitle}] (Đã nạp ${bannerAnswers.length} đáp án chuẩn)...`,
      color: 'blue',
    });

    // 2. Quét thiết bị Android / LDPlayer
    let devices: DeviceInfo[] = [];
    if (options.deviceSerial) {
      devices = [{ serial: options.deviceSerial, type: 'device' }];
    } else {
      devices = await deviceManager.getConnectedDevices();
      if (devices.length === 0) {
        eventBus.broadcastLog({
          message: '[ADB] Đang thử kết nối các cổng LDPlayer mặc định (5555, 5557...)...',
          color: 'yellow',
        });
        await deviceManager.tryConnectLdplayerPorts();
        devices = await deviceManager.getConnectedDevices();
      }
    }

    if (devices.length === 0) {
      this.status = 'idle';
      this.broadcastState();
      const msg = 'Không tìm thấy thiết bị Android / LDPlayer nào đang kết nối!';
      eventBus.broadcastLog({ message: `❌ ${msg}`, color: 'red' });
      return { success: false, message: msg };
    }

    // 3. Chuẩn bị danh sách tài khoản cần chạy
    const allAccounts = await accountManager.getAccounts(options.lotId);
    if (options.lotId) {
      eventBus.broadcastLog({
        message: `📦 Đang chạy tài khoản thuộc lô [${options.lotId}] (${allAccounts.length} tài khoản)...`,
        color: 'cyan',
      });
    }
    let accountsToRun: ManagedAccount[] = [];

    if (options.usernames && options.usernames.length > 0) {
      const usernameSet = new Set(options.usernames);
      accountsToRun = allAccounts.filter((a) => usernameSet.has(a.username));
    } else if (options.startFromIndex && options.startFromIndex > 1) {
      accountsToRun = allAccounts.slice(options.startFromIndex - 1);
    } else {
      accountsToRun = [...allAccounts];
    }

    if (accountsToRun.length === 0) {
      this.status = 'idle';
      this.broadcastState();
      return { success: false, message: 'Không có tài khoản nào được chọn để chạy!' };
    }

    // Đặt trạng thái ban đầu cho các tài khoản cần chạy
    accountsToRun.forEach((a) => {
      accountManager.updateStatus(a.username, 'pending');
    });

    this.totalAccounts = accountsToRun.length;
    this.completedCount = 0;
    this.failedCount = 0;
    this.broadcastState();

    eventBus.broadcastLog({
      message: `📋 Tổng số tài khoản sẽ thực thi: ${this.totalAccounts} (Bắt đầu từ: #${accountsToRun[0].index} - ${accountsToRun[0].username})`,
      color: 'green',
    });

    // 4. Khởi chạy hàng đợi (worker pool)
    const concurrency = Math.min(options.concurrency || 1, devices.length);
    const activeDevices = devices.slice(0, concurrency);
    const queue = [...accountsToRun];

    const runWorker = async (device: DeviceInfo) => {
      while (queue.length > 0) {
        if (this.abortSignal.aborted) {
          eventBus.broadcastLog({
            message: `🛑 Đã nhận tín hiệu dừng, bỏ qua các tài khoản còn lại trong hàng đợi.`,
            color: 'yellow',
          });
          break;
        }

        const account = queue.shift();
        if (!account) break;

        this.currentAccountUsername = account.username;
        this.currentDeviceSerial = device.serial;
        accountManager.updateStatus(account.username, 'running');
        this.broadcastState();

        const config = {
          username: account.username,
          password: account.password,
          deviceSerial: device.serial,
          fixedAnswer: options.fixedAnswer,
        };

        let result: TaskResult;
        if (device.serial === 'macos-app') {
          const startTime = Date.now();
          const macRes = await macService.runMacExam(
            {
              username: account.username,
              password: account.password,
              fixedAnswer: options.fixedAnswer,
              totalQuestions: 50,
            },
            {
              answersData: bannerAnswers,
              fixedAnswer: options.fixedAnswer,
              abortSignal: this.abortSignal,
            }
          );
          result = {
            username: account.username,
            serial: 'macos-app',
            success: macRes.success,
            screenshotPath: macRes.screenshotPath,
            error: macRes.error,
            durationMs: Date.now() - startTime,
          };
        } else {
          result = await examTask.execute(config, device.serial, {
            answersData: bannerAnswers,
            bannerTitle,
            abortSignal: this.abortSignal,
            speedMode: options.speedMode || 'safe',
          });
        }

        if (result.success) {
          this.completedCount++;
          accountManager.updateStatus(account.username, 'success', {
            durationMs: result.durationMs,
          });
        } else {
          this.failedCount++;
          accountManager.updateStatus(account.username, 'error', {
            durationMs: result.durationMs,
            error: result.error,
          });
        }

        this.broadcastState();

        // Nghỉ nhẹ 2s giữa các tài khoản nếu chưa dừng
        if (queue.length > 0 && !this.abortSignal.aborted) {
          await new Promise((r) => setTimeout(r, 2000));
        }
      }
    };

    // Chạy song song trong background không block API call
    (async () => {
      try {
        await Promise.all(activeDevices.map((d) => runWorker(d)));
      } catch (err: any) {
        eventBus.broadcastLog({
          message: `❌ Lỗi nghiêm trọng trong worker pool: ${err.message}`,
          color: 'red',
        });
      } finally {
        this.status = 'idle';
        this.currentAccountUsername = null;
        this.currentDeviceSerial = null;
        this.waitingDetails = null;
        this.broadcastState();

        eventBus.broadcastLog({
          message: `🏁 KẾT THÚC: ${this.completedCount} thành công, ${this.failedCount} thất bại trên tổng số ${this.totalAccounts} tài khoản.`,
          color: 'green',
        });
      }
    })();

    return { success: true, message: 'Đã khởi động tiến trình thành công!' };
  }

  /**
   * Dừng toàn bộ tiến trình đang chạy
   */
  public stop(): void {
    if (this.status === 'idle') return;

    this.status = 'stopping';
    this.abortSignal.aborted = true;
    eventBus.broadcastLog({
      message: '⚠️ Đang yêu cầu dừng tiến trình...',
      color: 'yellow',
    });

    // Giải phóng ngay nếu đang kẹt ở màn hình chọn banner
    this.resumeWaitingBanner();
    this.broadcastState();
  }

  /**
   * Người dùng xác nhận đã chọn xong Banner trên máy ảo -> Tiếp tục làm bài
   */
  public resumeWaitingBanner(): void {
    eventBus.emit('request_resume_banner');
  }
}

export const taskRunner = new TaskRunner();
