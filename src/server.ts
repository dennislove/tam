import path from 'node:path';
import express, { Request, Response } from 'express';
import { deviceManager } from './services/deviceManager.js';
import { accountManager } from './services/accountManager.js';
import { bannerManager } from './services/bannerManager.js';
import { taskRunner } from './services/taskRunner.js';
import { eventBus, LogEntry } from './services/eventBus.js';

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Serve static frontend files
const publicDir = path.resolve(process.cwd(), 'public');
app.use(express.static(publicDir));

// Serve screenshots directory
const screenshotsDir = path.resolve(process.cwd(), 'logs', 'screenshots');
app.use('/screenshots', express.static(screenshotsDir));

// SSE Clients pool
interface SseClient {
  id: number;
  res: Response;
}
let sseClients: SseClient[] = [];

function broadcastSse(event: string, data: any) {
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach((client) => {
    try {
      client.res.write(payload);
    } catch {
      // client disconnected
    }
  });
}

// Lắng nghe eventBus để broadcast SSE tới toàn bộ trình duyệt đang mở
eventBus.on('log', (logEntry: LogEntry) => {
  broadcastSse('log', logEntry);
});

eventBus.on('clear_logs', () => {
  broadcastSse('clear_logs', {});
});

eventBus.on('runner_state_changed', (state: any) => {
  broadcastSse('runner_state', state);
});

eventBus.on('waiting_banner', (data: any) => {
  broadcastSse('waiting_banner', data);
});

eventBus.on('banner_resumed', (data: any) => {
  broadcastSse('banner_resumed', data);
});

// -------------------------------------------------------------
// SSE STREAM ENDPOINT
// -------------------------------------------------------------
app.get('/api/events', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  const clientId = Date.now() + Math.random();
  const newClient: SseClient = { id: clientId, res };
  sseClients.push(newClient);

  // Gửi trạng thái hiện tại ngay khi kết nối
  res.write(`event: runner_state\ndata: ${JSON.stringify(taskRunner.getStatus())}\n\n`);

  req.on('close', () => {
    sseClients = sseClients.filter((c) => c.id !== clientId);
  });
});

// -------------------------------------------------------------
// STATUS & DEVICES APIS
// -------------------------------------------------------------
app.get('/api/status', (req: Request, res: Response) => {
  res.json(taskRunner.getStatus());
});

app.get('/api/devices', async (req: Request, res: Response) => {
  try {
    const devices = await deviceManager.getConnectedDevices();
    res.json({ success: true, devices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/devices/scan', async (req: Request, res: Response) => {
  try {
    await deviceManager.tryConnectLdplayerPorts();
    const devices = await deviceManager.getConnectedDevices();
    res.json({ success: true, devices });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

// -------------------------------------------------------------
// BANNERS & ANSWERS APIS
// -------------------------------------------------------------
app.get('/api/banners', (req: Request, res: Response) => {
  const banners = bannerManager.getBanners();
  const activeId = bannerManager.getActiveBannerId();
  res.json({ success: true, activeId, banners });
});

app.post('/api/banners/active', (req: Request, res: Response) => {
  const { bannerId } = req.body;
  if (!bannerId) {
    return res.status(400).json({ success: false, message: 'Thiếu bannerId' });
  }
  bannerManager.setActiveBannerId(bannerId);
  res.json({ success: true, activeId: bannerManager.getActiveBannerId() });
});

app.get('/api/banners/:id/answers', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const answers = bannerManager.getBannerAnswers(id);
  res.json({ success: true, bannerId: id, total: answers.length, answers });
});

app.post('/api/banners/:id/answers', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu answers phải là mảng danh sách câu hỏi!' });
  }
  const ok = bannerManager.saveBannerAnswers(id, answers);
  if (ok) {
    res.json({ success: true, message: `Đã lưu thành công ${answers.length} câu hỏi cho ${id}!` });
  } else {
    res.status(500).json({ success: false, message: 'Lỗi khi ghi file đáp án!' });
  }
});

app.put('/api/banners/:id', (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { title, description } = req.body;
  const ok = bannerManager.updateBannerMeta(id, { title, description });
  res.json({ success: ok });
});

// -------------------------------------------------------------
// ACCOUNTS APIS
// -------------------------------------------------------------
app.get('/api/accounts', (req: Request, res: Response) => {
  const accounts = accountManager.getAccounts();
  res.json({ success: true, total: accounts.length, accounts });
});

app.post('/api/accounts', (req: Request, res: Response) => {
  const { accounts } = req.body;
  if (!Array.isArray(accounts)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu accounts phải là mảng!' });
  }
  const ok = accountManager.saveAccounts(accounts);
  res.json({ success: ok, message: ok ? 'Đã lưu danh sách tài khoản!' : 'Lỗi khi lưu tài khoản' });
});

app.post('/api/accounts/add', (req: Request, res: Response) => {
  const { username, password, deviceSerial } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
  }
  const ok = accountManager.addAccount(username, password, deviceSerial);
  if (ok) {
    res.json({ success: true, message: 'Đã thêm tài khoản thành công!' });
  } else {
    res.status(400).json({ success: false, message: 'Tài khoản đã tồn tại!' });
  }
});

app.delete('/api/accounts/:username', (req: Request, res: Response) => {
  const username = String(req.params.username);
  const ok = accountManager.deleteAccount(username);
  res.json({ success: ok, message: ok ? 'Đã xóa tài khoản!' : 'Không tìm thấy tài khoản!' });
});

app.post('/api/accounts/reset', (req: Request, res: Response) => {
  const { usernames } = req.body;
  accountManager.resetStatuses(usernames);
  res.json({ success: true });
});

// -------------------------------------------------------------
// ACTION CONTROLLERS (START / STOP / RESUME)
// -------------------------------------------------------------
app.post('/api/action/start', async (req: Request, res: Response) => {
  const { bannerId, startFromIndex, usernames, deviceSerial, concurrency, fixedAnswer } = req.body;
  const result = await taskRunner.start({
    bannerId,
    startFromIndex,
    usernames,
    deviceSerial,
    concurrency,
    fixedAnswer,
  });
  res.json(result);
});

app.post('/api/action/stop', (req: Request, res: Response) => {
  taskRunner.stop();
  res.json({ success: true, message: 'Đã gửi lệnh dừng!' });
});

app.post('/api/action/resume', (req: Request, res: Response) => {
  taskRunner.resumeWaitingBanner();
  res.json({ success: true, message: 'Đã gửi lệnh tiếp tục làm bài!' });
});

// -------------------------------------------------------------
// LOGS APIS
// -------------------------------------------------------------
app.get('/api/logs', (req: Request, res: Response) => {
  res.json({ success: true, logs: eventBus.getRecentLogs() });
});

app.post('/api/logs/clear', (req: Request, res: Response) => {
  eventBus.clearLogs();
  res.json({ success: true });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===============================================================`);
  console.log(`  🚀 THANH NIÊN VIỆT NAM AUTOMATION - WEB DASHBOARD PORT ${PORT}`);
  console.log(`  👉 Truy cập trình duyệt: http://localhost:${PORT}`);
  console.log(`===============================================================\n`);
});
