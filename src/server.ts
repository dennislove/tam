import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import express, { Request, Response } from 'express';
import { deviceManager } from './services/deviceManager.js';
import { accountManager } from './services/accountManager.js';
import { bannerManager } from './services/bannerManager.js';
import { taskRunner } from './services/taskRunner.js';
import { eventBus, LogEntry } from './services/eventBus.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ROOT_DIR = process.env.APP_ROOT || path.resolve(__dirname, '..');
const DATA_DIR = process.env.APP_DATA_DIR || process.cwd();

const app = express();
const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 3000;

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// Disable cache for local frontend files
app.use((req, res, next) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  next();
});

// Serve static frontend files (đọc từ app.asar/public hoặc thư mục public)
const publicDir = path.resolve(ROOT_DIR, 'public');
app.use(express.static(publicDir, { etag: false, maxAge: 0 }));

// Serve screenshots directory (ghi và đọc từ thư mục dữ liệu thật trên máy)
const screenshotsDir = path.resolve(DATA_DIR, 'logs', 'screenshots');
try {
  if (!fs.existsSync(screenshotsDir)) {
    fs.mkdirSync(screenshotsDir, { recursive: true });
  }
} catch (err) {
  console.warn('[Server] Khong the tao screenshotsDir:', err);
}
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
app.get('/api/banners', async (req: Request, res: Response) => {
  const banners = await bannerManager.getBanners();
  const activeId = bannerManager.getActiveBannerId();
  res.json({ success: true, activeId, banners });
});

app.post('/api/banners/active', async (req: Request, res: Response) => {
  const { bannerId } = req.body;
  if (!bannerId) {
    return res.status(400).json({ success: false, message: 'Thiếu bannerId' });
  }
  await bannerManager.setActiveBannerId(bannerId);
  taskRunner.setActiveBannerId(bannerId);
  res.json({ success: true, activeId: bannerManager.getActiveBannerId() });
});


app.get('/api/banners/:id/answers', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const answers = await bannerManager.getBannerAnswers(id);
  res.json({ success: true, bannerId: id, total: answers.length, answers });
});

app.post('/api/banners/:id/answers', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { answers } = req.body;
  if (!Array.isArray(answers)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu answers phải là mảng danh sách câu hỏi!' });
  }
  const ok = await bannerManager.saveBannerAnswers(id, answers);
  if (ok) {
    res.json({ success: true, message: `Đã lưu thành công ${answers.length} câu hỏi cho ${id}!` });
  } else {
    res.status(500).json({ success: false, message: 'Lỗi khi ghi đáp án!' });
  }
});

app.put('/api/banners/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { title, description } = req.body;
  const ok = await bannerManager.updateBannerMeta(id, { title, description });
  res.json({ success: ok });
});

app.post('/api/banners', async (req: Request, res: Response) => {
  const { title, description } = req.body;
  if (!title) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tên phần thi (banner)!' });
  }
  const banners = await bannerManager.getBanners();
  const nextKey = banners.length > 0 ? Math.max(...banners.map(b => b.key)) + 1 : 1;
  const nextId = `banner_${nextKey}`;
  const ok = await bannerManager.addBanner(nextId, nextKey, title, description || '');
  if (ok) {
    res.json({ success: true, bannerId: nextId, key: nextKey, title });
  } else {
    res.status(500).json({ success: false, message: 'Lỗi khi tạo banner mới!' });
  }
});

app.delete('/api/banners/:id', async (req: Request, res: Response) => {
  const id = String(req.params.id);
  const { supabase } = await import('./services/supabaseClient.js');
  const { error } = await supabase.from('banners').delete().eq('id', id);
  if (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
  res.json({ success: true, message: `Đã xóa banner ${id}!` });
});
// -------------------------------------------------------------
// ACCOUNTS APIS
// -------------------------------------------------------------
app.get('/api/lots', async (req: Request, res: Response) => {
  const lots = await accountManager.getLots();
  // Đếm số tài khoản trong mỗi lô
  const { data: counts } = await (await import('./services/supabaseClient.js')).supabase
    .from('accounts')
    .select('lot_id');

  const countMap: Record<string, number> = {};
  (counts || []).forEach((r: any) => {
    if (r.lot_id) countMap[r.lot_id] = (countMap[r.lot_id] || 0) + 1;
  });

  // Kiểm tra nếu có lô nào xuất hiện trong danh sách tài khoản mà chưa có trong bảng account_lots
  const existingLotIds = new Set(lots.map(l => l.id));
  const dynamicLots: typeof lots = [];
  for (const lotId of Object.keys(countMap)) {
    if (lotId && !existingLotIds.has(lotId)) {
      const match = lotId.match(/\d+/);
      const num = match ? parseInt(match[0], 10) : 999;
      dynamicLots.push({
        id: lotId,
        name: match ? `Lô ${num}` : lotId,
        description: `Lô tự động ${num}`,
        sortOrder: num,
      });
    }
  }

  // Kết hợp và sắp xếp theo số thứ tự lô
  const mergedLots = [...lots, ...dynamicLots].sort((a, b) => a.sortOrder - b.sortOrder);

  // Hiển thị tất cả các lô kèm số lượng tài khoản (có bao nhiêu hiển thị bấy nhiêu)
  const allLots = mergedLots.map(l => ({
    ...l,
    accountCount: countMap[l.id] || 0,
  }));

  res.json({
    success: true,
    lots: allLots,
  });
});

app.get('/api/accounts', async (req: Request, res: Response) => {
  const lotId = req.query.lotId as string | undefined;
  const accounts = await accountManager.getAccounts(lotId || undefined);
  res.json({ success: true, total: accounts.length, accounts });
});

app.post('/api/accounts', async (req: Request, res: Response) => {
  const { accounts, autoPartition = true, lotSize = 20 } = req.body;
  if (!Array.isArray(accounts)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu accounts phải là mảng!' });
  }
  const ok = await accountManager.saveAccounts(accounts, autoPartition, Number(lotSize) || 20);
  res.json({ success: ok, message: ok ? 'Đã lưu danh sách tài khoản!' : 'Lỗi khi lưu tài khoản' });
});

app.post('/api/accounts/auto-partition', async (req: Request, res: Response) => {
  const lotSize = Number(req.body.lotSize) || 20;
  const result = await accountManager.autoPartitionExistingAccounts(lotSize);
  res.json(result);
});

app.post('/api/accounts/add', async (req: Request, res: Response) => {
  const { username, password, lotId, deviceSerial } = req.body;
  if (!username || !password) {
    return res.status(400).json({ success: false, message: 'Vui lòng nhập tài khoản và mật khẩu!' });
  }
  const ok = await accountManager.addAccount(username, password, lotId || undefined, deviceSerial);
  if (ok) {
    res.json({ success: true, message: 'Đã thêm tài khoản thành công!' });
  } else {
    res.status(400).json({ success: false, message: 'Tài khoản đã tồn tại hoặc lỗi!' });
  }
});

app.delete('/api/accounts/:username', async (req: Request, res: Response) => {
  const username = String(req.params.username);
  const ok = await accountManager.deleteAccount(username);
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
  const { bannerId, lotId, startFromIndex, usernames, deviceSerial, concurrency, fixedAnswer, speedMode } = req.body;
  const result = await taskRunner.start({
    bannerId,
    lotId,
    startFromIndex,
    usernames,
    deviceSerial,
    concurrency,
    fixedAnswer,
    speedMode,
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
