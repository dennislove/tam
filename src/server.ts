import path from 'node:path';
import { fileURLToPath } from 'node:url';
import fs from 'node:fs';
import { spawn, execSync } from 'node:child_process';
import express, { Request, Response } from 'express';
import { deviceManager } from './services/deviceManager.js';
import { accountManager } from './services/accountManager.js';
import { bannerManager } from './services/bannerManager.js';
import { taskRunner } from './services/taskRunner.js';
import { eventBus, LogEntry } from './services/eventBus.js';
import { macService } from './services/macService.js';
import { backupLotManager } from './services/backupLotManager.js';

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

eventBus.on('check_event', (data: any) => {
  broadcastSse('check_event', data);
});

eventBus.on('certificates_event', (data: any) => {
  broadcastSse('certificates_event', data);
});

eventBus.on('certificates_log', (data: any) => {
  broadcastSse('certificates_log', data);
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

  // Luôn bổ sung "Lô Dự Phòng" vào danh sách lô
  allLots.push(backupLotManager.getLotInfo());

  res.json({
    success: true,
    lots: allLots,
  });
});

app.get('/api/accounts', async (req: Request, res: Response) => {
  const lotId = req.query.lotId as string | undefined;

  // Nếu truy vấn Lô Dự Phòng: lấy từ backupLotManager
  if (lotId === 'lot_backup') {
    const backupAccounts = backupLotManager.getAccounts().map((a, idx) => ({
      index: idx + 1,
      username: a.username,
      password: a.password,
      lotId: 'lot_backup',
      lotName: 'Lô Dự Phòng',
      status: 'idle',
      error: a.error,
      addedAt: a.addedAt,
    }));
    return res.json({ success: true, total: backupAccounts.length, accounts: backupAccounts });
  }

  const accounts = await accountManager.getAccounts(lotId || undefined);
  res.json({ success: true, total: accounts.length, accounts });
});

app.post('/api/accounts', async (req: Request, res: Response) => {
  const { accounts, autoPartition = true, lotSize = 20 } = req.body;
  if (!Array.isArray(accounts)) {
    return res.status(400).json({ success: false, message: 'Dữ liệu accounts phải là mảng!' });
  }
  const result = await accountManager.saveAccounts(accounts, autoPartition, Number(lotSize) || 20);
  res.json(result);
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

  // Nếu thêm vào Lô Dự Phòng: KHÔNG KIỂM TRA TRÙNG TÀI KHOẢN!
  if (lotId === 'lot_backup') {
    const resAdd = await backupLotManager.addAccounts([{ username, password }]);
    return res.json({
      success: true,
      message: `Đã thêm tài khoản vào Lô Dự Phòng (Không kiểm tra trùng, tổng: ${resAdd.total})!`,
    });
  }

  const ok = await accountManager.addAccount(username, password, lotId || undefined, deviceSerial);
  if (ok) {
    res.json({ success: true, message: 'Đã thêm tài khoản thành công!' });
  } else {
    res.status(400).json({ success: false, message: 'Tài khoản đã tồn tại hoặc lỗi!' });
  }
});

/**
 * -------------------------------------------------------------
 * BACKUP LOT (LÔ DỰ PHÒNG) APIS
 * -------------------------------------------------------------
 */
app.get('/api/backup-lot', (req: Request, res: Response) => {
  const accounts = backupLotManager.getAccounts();
  res.json({ success: true, total: accounts.length, accounts, lot: backupLotManager.getLotInfo() });
});

app.post('/api/backup-lot/add', async (req: Request, res: Response) => {
  const { accounts, username, password, error, replace } = req.body;
  if (replace) {
    backupLotManager.clear();
  }
  let itemsToAdd: Array<{ username: string; password?: string; error?: string }> = [];

  if (Array.isArray(accounts)) {
    itemsToAdd = accounts;
  } else if (username) {
    itemsToAdd = [{ username, password, error }];
  }

  if (itemsToAdd.length === 0) {
    return res.status(400).json({ success: false, message: 'Không có tài khoản nào để thêm vào Lô Dự Phòng!' });
  }

  const result = await backupLotManager.addAccounts(itemsToAdd);
  res.json({
    success: true,
    message: `Đã thêm thành công ${result.added} tài khoản vào Lô Dự Phòng (Tổng: ${result.total})!`,
    ...result,
  });
});

app.delete('/api/backup-lot', (req: Request, res: Response) => {
  backupLotManager.clear();
  res.json({ success: true, message: 'Đã làm trống toàn bộ tài khoản trong Lô Dự Phòng!' });
});

app.delete('/api/backup-lot/:username', (req: Request, res: Response) => {
  const u = String(req.params.username);
  const ok = backupLotManager.removeAccount(u);
  res.json({ success: ok, message: ok ? `Đã xóa tài khoản ${u} khỏi Lô Dự Phòng!` : 'Không tìm thấy tài khoản!' });
});

app.delete('/api/accounts/:username', async (req: Request, res: Response) => {
  const username = String(req.params.username);
  backupLotManager.removeAccount(username);
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

// -------------------------------------------------------------
// MAC NATIVE APIs — mở app, calibrate tọa độ, screenshot live
// -------------------------------------------------------------

/** Mở app TNVN */
app.post('/api/mac/open', (req: Request, res: Response) => {
  const ok = macService.openApp();
  macService.activateApp();
  const bounds = macService.getWindowBounds(true);
  res.json({ success: ok, bounds });
});

/** Thông tin cửa sổ hiện tại */
app.get('/api/mac/window', (req: Request, res: Response) => {
  const bounds = macService.getWindowBounds(true);
  res.json({ success: !!bounds, bounds });
});

/** Chụp screenshot cửa sổ TNVN và trả về base64 */
app.get('/api/mac/screenshot', async (req: Request, res: Response) => {
  const result = await macService.captureWindow();
  if (!result) return res.status(404).json({ success: false, error: 'Không chụp được màn hình' });
  const b64 = result.buffer.toString('base64');
  res.json({ success: true, image: `data:image/png;base64,${b64}`, width: result.png.width, height: result.png.height });
});

/** Lấy danh sách tọa độ đã calibrate */
app.get('/api/mac/coordinates', (req: Request, res: Response) => {
  res.json({ success: true, coords: macService.getCoordinates(), defaults: macService.getDefaultCoordinates() });
});

/** Lưu tọa độ (từ UI calibrate) */
app.post('/api/mac/coordinates', (req: Request, res: Response) => {
  const { coords } = req.body;
  if (!coords || typeof coords !== 'object') return res.status(400).json({ success: false, error: 'Thiếu coords' });
  macService.saveCoordinates(coords);
  res.json({ success: true, message: 'Đã lưu tọa độ calibration!' });
});

/** Update 1 tọa độ cụ thể */
app.patch('/api/mac/coordinates/:key', (req: Request, res: Response) => {
  const key = String(req.params.key);
  const { rx, ry } = req.body;
  if (rx === undefined || ry === undefined) return res.status(400).json({ success: false, error: 'Cần rx và ry' });
  macService.updateCoord(key, parseFloat(rx), parseFloat(ry));
  res.json({ success: true, key, rx, ry });
});

/** Reset về tọa độ mặc định */
app.post('/api/mac/coordinates/reset', (req: Request, res: Response) => {
  macService.saveCoordinates(macService.getDefaultCoordinates());
  res.json({ success: true, message: 'Đã reset về tọa độ mặc định!' });
});

/**
 * SSE: Bắt đầu lắng nghe click của user trong cửa sổ TNVN.
 * Stream event:
 *   event: ready  → {bounds}
 *   event: click  → {rx, ry, absX, absY, index}
 *   event: error  → {message}
 */
app.get('/api/mac/record', (req: Request, res: Response) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
  });

  let clickIndex = 0;

  const ok = macService.startClickRecorder(
    (bounds) => {
      res.write(`event: ready\ndata: ${JSON.stringify({ bounds })}\n\n`);
    },
    (rx, ry, absX, absY) => {
      clickIndex++;
      res.write(`event: click\ndata: ${JSON.stringify({ rx, ry, absX, absY, index: clickIndex })}\n\n`);
    }
  );

  if (!ok) {
    res.write(`event: error\ndata: ${JSON.stringify({ message: 'Không tìm thấy cửa sổ TNVN! Hãy mở app trước.' })}\n\n`);
    res.end();
    return;
  }

  req.on('close', () => {
    macService.stopClickRecorder();
    console.log('[Server] SSE /api/mac/record đã đóng');
  });
});

/** Dừng recorder (nếu cần dừng thủ công) */
app.post('/api/mac/record/stop', (req: Request, res: Response) => {
  macService.stopClickRecorder();
  res.json({ success: true, message: 'Đã dừng recorder' });
});

/** Trạng thái recorder */
app.get('/api/mac/record/status', (req: Request, res: Response) => {
  res.json({ recording: macService.isRecording(), bounds: macService.getWindowBounds() });
});

// -------------------------------------------------------------
// MAC NATIVE RUN FLOW APIS
// -------------------------------------------------------------
let macFlowProcess: any = null;

app.get('/api/mac/flow/status', (req: Request, res: Response) => {
  res.json({ running: macFlowProcess !== null });
});

app.post('/api/mac/flow/prepare-selected', async (req: Request, res: Response) => {
  const { accounts, usernames } = req.body || {};
  let list = Array.isArray(accounts) ? accounts : [];
  if (list.length === 0 && Array.isArray(usernames)) {
    const allAccs = await accountManager.getAccounts();
    const map = new Map(allAccs.map((a: any) => [a.username.toLowerCase(), a]));
    list = usernames.map((u: string) => map.get(u.toLowerCase()) || { username: u });
  }
  if (list.length === 0) {
    return res.status(400).json({ success: false, message: 'Danh sách tài khoản rỗng!' });
  }
  try {
    fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
    fs.writeFileSync(path.join(process.cwd(), 'logs', 'selected_accounts.json'), JSON.stringify(list, null, 2), 'utf-8');
    res.json({ success: true, count: list.length });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
});

app.post('/api/mac/flow/start', async (req: Request, res: Response) => {
  if (macFlowProcess) {
    return res.status(400).json({ success: false, message: 'Tool Mac đang chạy!' });
  }
  const { bannerId = 'banner_2', banners, startFromIndex, lotId, limit, usernames, selectedAccounts } = req.body || {};
  console.log('[MacFlow] Nhận body từ client:', req.body);
  const startIndexNum = parseInt(String(startFromIndex), 10) || 1;
  const scriptArgs = ['scripts/mac_multi_account_flow.py'];

  let bannerDisplayName = bannerId;
  if (banners && Array.isArray(banners) && banners.length > 0) {
    scriptArgs.push(banners[0]); // fallback positional
    scriptArgs.push('--banners', banners.join(','));
    bannerDisplayName = banners.length > 1 ? `${banners.length} banner (${banners.join(', ')})` : banners[0];
  } else {
    scriptArgs.push(bannerId);
  }

  let isSelectedMode = false;
  let selectedCount = 0;

  if (Array.isArray(selectedAccounts) && selectedAccounts.length > 0) {
    try {
      fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
      fs.writeFileSync(path.join(process.cwd(), 'logs', 'selected_accounts.json'), JSON.stringify(selectedAccounts, null, 2), 'utf-8');
      scriptArgs.push('--accounts-file', 'logs/selected_accounts.json');
      isSelectedMode = true;
      selectedCount = selectedAccounts.length;
    } catch (e) {
      console.error('[MacFlow] Lỗi ghi logs/selected_accounts.json:', e);
    }
  } else if (Array.isArray(usernames) && usernames.length > 0) {
    try {
      fs.mkdirSync(path.join(process.cwd(), 'logs'), { recursive: true });
      const allAccs = await accountManager.getAccounts();
      const map = new Map(allAccs.map((a: any) => [a.username.toLowerCase(), a]));
      const enriched = usernames.map((u: string) => map.get(u.toLowerCase()) || { username: u });
      fs.writeFileSync(path.join(process.cwd(), 'logs', 'selected_accounts.json'), JSON.stringify(enriched, null, 2), 'utf-8');
      scriptArgs.push('--accounts-file', 'logs/selected_accounts.json');
      isSelectedMode = true;
      selectedCount = usernames.length;
    } catch (e) {
      console.error('[MacFlow] Lỗi ghi logs/selected_accounts.json:', e);
    }
  }

  if (!isSelectedMode) {
    if (startIndexNum > 1) {
      scriptArgs.push('--start', String(startIndexNum));
    } else if (startFromIndex) {
      scriptArgs.push('--start', String(startFromIndex));
    }
    if (lotId) scriptArgs.push('--lot', String(lotId));
  }

  if (limit) scriptArgs.push('--limit', String(limit));

  console.log('[MacFlow] Chạy lệnh python với args:', scriptArgs);

  const startMsg = isSelectedMode
    ? `🚀 [Mac Native] Khởi động thi ${bannerDisplayName} cho ${selectedCount} tài khoản đã chọn...`
    : String(limit) === '1'
    ? `🎯 [Mac Native] Chạy ĐƠN cho tài khoản #${startIndexNum}${lotId ? ` (Lô: ${lotId})` : ''} - Thi: ${bannerDisplayName}...`
    : `🚀 [Mac Native] Khởi động tiến trình cho ${bannerDisplayName} (Bắt đầu từ Acc #${startIndexNum}${lotId ? ` - Lô: ${lotId}` : ''})...`;

  eventBus.broadcastLog({
    message: startMsg,
    color: String(limit) === '1' ? 'yellow' : 'cyan',
  });

  const runStats = { total: isSelectedMode ? selectedCount : 0, completed: 0, failed: 0 };
  let currentAccRunning = 'Chưa có';

  macFlowProcess = spawn('python3', ['-u', ...scriptArgs], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  macFlowProcess.stdout.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) {
      for (const line of text.split('\n')) {
        // Cập nhật tài khoản đang chạy lên TRẠNG THÁI TIẾN TRÌNH
        const accMatch = line.match(/BẮT ĐẦU TÀI KHOẢN \[([^\]]+)\]/);
        if (accMatch) {
          currentAccRunning = accMatch[1];
          eventBus.emit('runner_state_changed', {
            status: 'running',
            activeBannerId: bannerId,
            currentAccount: currentAccRunning,
            stats: runStats,
          });
        }
        if (line.includes('Hoàn thành tài khoản')) {
          runStats.completed++;
          eventBus.emit('runner_state_changed', {
            status: 'running',
            activeBannerId: bannerId,
            currentAccount: currentAccRunning,
            stats: runStats,
          });
        } else if (line.includes('Bỏ qua [')) {
          runStats.failed++;
          eventBus.emit('runner_state_changed', {
            status: 'running',
            activeBannerId: bannerId,
            currentAccount: currentAccRunning,
            stats: runStats,
          });
        }

        let color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'white' = 'white';
        if (line.includes('❌')) color = 'red';
        else if (line.includes('✅')) color = 'green';
        else if (line.includes('🤖') || line.includes('Gemini') || line.includes('Cache AI')) color = 'cyan';
        else if (line.includes('⚠️')) color = 'yellow';
        eventBus.broadcastLog({ message: line, color });
      }
    }
  });

  macFlowProcess.stderr.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) eventBus.broadcastLog({ message: `[Lỗi] ${text}`, color: 'red' });
  });

  macFlowProcess.on('close', (code: number) => {
    macFlowProcess = null;
    eventBus.emit('runner_state_changed', {
      status: 'idle',
      activeBannerId: bannerId,
      currentAccount: 'Chưa có',
      stats: runStats,
    });
    eventBus.broadcastLog({
      message: `🏁 [Mac Native] Tiến trình đã kết thúc (mã: ${code})`,
      color: code === 0 ? 'green' : 'yellow',
    });
  });

  res.json({ success: true, message: 'Đã khởi động tiến trình Mac Native!', selectedCount: isSelectedMode ? selectedCount : undefined });
});

app.post('/api/mac/flow/stop', (req: Request, res: Response) => {
  if (macFlowProcess) {
    try {
      macFlowProcess.kill('SIGTERM');
    } catch (e) {}
    macFlowProcess = null;
  }
  try {
    execSync('pkill -f "mac_multi_account_flow.py" 2>/dev/null; pkill -f "cliclick" 2>/dev/null');
  } catch (e) {}
  eventBus.emit('runner_state_changed', {
    status: 'idle',
    activeBannerId: 'banner_2',
    currentAccount: 'Chưa có',
    stats: { total: 0, completed: 0, failed: 0 },
  });
  eventBus.broadcastLog({ message: '🛑 [Mac Native] Đã gửi lệnh dừng tiến trình!', color: 'red' });
  res.json({ success: true, message: 'Đã dừng tiến trình Mac Native!' });
});

// -------------------------------------------------------------
// GEMINI AI SOLVER CONFIG APIS
// -------------------------------------------------------------
app.get('/api/gemini/config', (req: Request, res: Response) => {
  const cfgPath = path.resolve(ROOT_DIR, 'data', 'gemini_config.json');
  const cachePath = path.resolve(ROOT_DIR, 'data', 'gemini_cache.json');
  let config = {
    enabled: true,
    api_key: 'AQ.Ab8RN6IhnMuMunQqw_-TEUDoPdFhJmePvYKgf4OYlm6jOS9LHg',
    models: ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
    auto_learn: true,
  };
  let cacheCount = 0;
  try {
    if (fs.existsSync(cfgPath)) {
      config = { ...config, ...JSON.parse(fs.readFileSync(cfgPath, 'utf-8')) };
    }
  } catch (err) {}
  try {
    if (fs.existsSync(cachePath)) {
      const cacheData = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
      cacheCount = Object.keys(cacheData).length;
    }
  } catch (err) {}

  res.json({ success: true, config, cacheCount });
});

app.post('/api/gemini/config', (req: Request, res: Response) => {
  const cfgPath = path.resolve(ROOT_DIR, 'data', 'gemini_config.json');
  try {
    let current: any = {};
    if (fs.existsSync(cfgPath)) {
      try { current = JSON.parse(fs.readFileSync(cfgPath, 'utf-8')); } catch (e) {}
    }
    const updated = { ...current, ...req.body };
    let keysList = updated.api_keys;
    if (typeof keysList === 'string') {
      keysList = keysList.split('\n').map((k: string) => k.trim()).filter((k: string) => k.length > 0);
    }
    if (Array.isArray(keysList) && keysList.length > 0) {
      updated.api_keys = Array.from(new Set(keysList));
      updated.api_key = updated.api_keys[0];
    }
    fs.writeFileSync(cfgPath, JSON.stringify(updated, null, 2), 'utf-8');
    const keyCount = updated.api_keys ? updated.api_keys.length : 1;
    eventBus.broadcastLog({
      message: `🤖 [Gemini AI] Đã cập nhật cấu hình AI (${keyCount} API Keys, Trạng thái: ${updated.enabled ? 'BẬT' : 'TẮT'})`,
      color: 'cyan'
    });
    res.json({ success: true, message: `Đã lưu cấu hình ${keyCount} Gemini API Key thành công!`, config: updated });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/gemini/test', (req: Request, res: Response) => {
  try {
    const out = execSync('python3 scripts/gemini_solver.py', { cwd: ROOT_DIR, encoding: 'utf-8', timeout: 15000 });
    res.json({ success: true, message: 'Kiểm tra Gemini AI thành công!', output: out });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message || 'Lỗi khi gọi kiểm tra Gemini' });
  }
});

// -------------------------------------------------------------
// MAC NATIVE CHECK ACCOUNTS APIS
// -------------------------------------------------------------
let macCheckProcess: any = null;
let macCheckState = {
  running: false,
  currentAccount: '',
  stats: { total: 0, checked: 0, ok: 0, fail: 0 },
};

app.get('/api/mac/check/status', (req: Request, res: Response) => {
  res.json({
    running: macCheckProcess !== null,
    currentAccount: macCheckState.currentAccount,
    stats: macCheckState.stats,
  });
});

app.get('/api/mac/check/results', (req: Request, res: Response) => {
  const resultPath = path.resolve(ROOT_DIR, 'logs', 'check_accounts_result.json');
  try {
    if (fs.existsSync(resultPath)) {
      const data = JSON.parse(fs.readFileSync(resultPath, 'utf-8'));
      const items = Object.entries(data).map(([username, val]: [string, any]) => ({
        username,
        ...val,
      }));
      const okCount = items.filter((i) => i.status === 'OK').length;
      const failCount = items.filter((i) => i.status === 'FAIL').length;
      return res.json({
        success: true,
        summary: { total: items.length, ok: okCount, fail: failCount },
        results: data,
        items,
      });
    }
  } catch (err: any) {
    console.error('[CheckResults] Error:', err);
  }
  res.json({
    success: true,
    summary: { total: 0, ok: 0, fail: 0 },
    results: {},
    items: [],
  });
});

app.post('/api/mac/check/clear', (req: Request, res: Response) => {
  const resultPath = path.resolve(ROOT_DIR, 'logs', 'check_accounts_result.json');
  try {
    if (fs.existsSync(resultPath)) {
      fs.writeFileSync(resultPath, JSON.stringify({}, null, 2), 'utf-8');
    }
    macCheckState = {
      running: false,
      currentAccount: '',
      stats: { total: 0, checked: 0, ok: 0, fail: 0 },
    };
    eventBus.emit('check_event', { type: 'cleared' });
    res.json({ success: true, message: 'Đã xóa kết quả check tài khoản!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/mac/check/start', (req: Request, res: Response) => {
  if (macCheckProcess) {
    return res.status(400).json({ success: false, message: 'Tiến trình kiểm tra tài khoản đang chạy!' });
  }
  if (macFlowProcess) {
    return res.status(400).json({ success: false, message: 'Tiến trình thi tự động đang chạy! Hãy dừng lại trước khi check tài khoản.' });
  }

  const { startFromIndex, lotId, limit, recheckFailed } = req.body || {};
  const startIndexNum = parseInt(String(startFromIndex), 10) || 1;
  const scriptArgs = ['scripts/mac_check_accounts.py'];

  if (startIndexNum > 1) {
    scriptArgs.push('--start', String(startIndexNum));
  }
  if (lotId) scriptArgs.push('--lot', String(lotId));
  if (limit) scriptArgs.push('--limit', String(limit));
  if (recheckFailed) scriptArgs.push('--recheck-failed');

  console.log('[MacCheck] Chạy python với args:', scriptArgs);

  macCheckState = {
    running: true,
    currentAccount: 'Đang khởi động...',
    stats: { total: 0, checked: 0, ok: 0, fail: 0 },
  };

  eventBus.broadcastLog({
    message: `🛡️ [Mac Check] Bắt đầu kiểm tra tài khoản (Bắt đầu từ #${startIndexNum}${lotId ? ` - Lô: ${lotId}` : ''}${recheckFailed ? ' [Chỉ check FAIL]' : ''})...`,
    color: 'cyan',
  });

  macCheckProcess = spawn('python3', ['-u', ...scriptArgs], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  macCheckProcess.stdout.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (trimmed.startsWith('CHECK_EVENT:')) {
          try {
            const eventData = JSON.parse(trimmed.substring(12));
            if (eventData.type === 'start') {
              macCheckState.stats.total = eventData.total || 0;
            } else if (eventData.type === 'account_start') {
              macCheckState.currentAccount = `${eventData.username} (#${eventData.index})`;
            } else if (eventData.type === 'account_done') {
              macCheckState.stats.checked = eventData.current || 0;
              if (eventData.okCount !== undefined) macCheckState.stats.ok = eventData.okCount;
              if (eventData.failCount !== undefined) macCheckState.stats.fail = eventData.failCount;
            }
            eventBus.emit('check_event', eventData);
          } catch (e) {
            console.error('[CheckEvent Parse Error]', e);
          }
          continue;
        }

        eventBus.broadcastLog({
          message: trimmed,
          color: trimmed.includes('❌') ? 'red' : trimmed.includes('✅') ? 'green' : 'white',
        });
      }
    }
  });

  macCheckProcess.stderr.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) eventBus.broadcastLog({ message: `[Lỗi Check] ${text}`, color: 'red' });
  });

  macCheckProcess.on('close', (code: number) => {
    macCheckProcess = null;
    macCheckState.running = false;
    macCheckState.currentAccount = 'Đã dừng';
    eventBus.emit('check_event', { type: 'finish', exitCode: code });
    eventBus.broadcastLog({
      message: `🏁 [Mac Check] Hoàn tất kiểm tra tài khoản (mã: ${code})`,
      color: code === 0 ? 'green' : 'yellow',
    });
  });

  res.json({ success: true, message: 'Đã bắt đầu kiểm tra tài khoản!' });
});

app.post('/api/mac/check/stop', (req: Request, res: Response) => {
  if (macCheckProcess) {
    try {
      macCheckProcess.kill('SIGTERM');
    } catch (e) {}
    macCheckProcess = null;
  }
  try {
    execSync('pkill -f "mac_check_accounts.py" 2>/dev/null');
  } catch (e) {}
  macCheckState.running = false;
  macCheckState.currentAccount = 'Đã hủy';
  eventBus.emit('check_event', { type: 'stopped' });
  eventBus.broadcastLog({ message: '🛑 [Mac Check] Đã dừng kiểm tra tài khoản!', color: 'red' });
  res.json({ success: true, message: 'Đã dừng kiểm tra tài khoản!' });
});

// -------------------------------------------------------------
// MAC NATIVE CERTIFICATES (CHỨNG CHỈ) APIS
// -------------------------------------------------------------
let macCertsProcess: any = null;
let macCertsState = {
  running: false,
  currentAccount: '',
  stats: { total: 0, checked: 0, withCerts: 0, noCerts: 0, totalCertsCount: 0, fail: 0 },
};

app.get('/api/mac/certificates/status', (req: Request, res: Response) => {
  res.json({
    running: macCertsProcess !== null,
    currentAccount: macCertsState.currentAccount,
    stats: macCertsState.stats,
  });
});

app.get('/api/mac/certificates/results', (req: Request, res: Response) => {
  const resultJsonPath = path.resolve(ROOT_DIR, 'logs', 'certificates_result.json');
  try {
    if (fs.existsSync(resultJsonPath)) {
      const data = JSON.parse(fs.readFileSync(resultJsonPath, 'utf-8'));
      const items = Object.entries(data).map(([username, val]: [string, any]) => ({
        username,
        ...val,
      }));
      const withCerts = items.filter((i) => (i.certCount || 0) > 0).length;
      const noCerts = items.filter((i) => i.status === 'OK' && (i.certCount || 0) === 0).length;
      const failCount = items.filter((i) => i.status !== 'OK').length;
      const totalCerts = items.reduce((sum, i) => sum + (i.certCount || 0), 0);
      return res.json({
        success: true,
        summary: {
          total: items.length,
          withCerts,
          noCerts,
          fail: failCount,
          totalCerts,
        },
        results: data,
        items,
      });
    }
  } catch (err: any) {
    console.error('[CertificatesResults] Error:', err);
  }
  res.json({
    success: true,
    summary: { total: 0, withCerts: 0, noCerts: 0, fail: 0, totalCerts: 0 },
    results: {},
    items: [],
  });
});

app.get('/api/mac/certificates/export', (req: Request, res: Response) => {
  const csvPath = path.resolve(ROOT_DIR, 'logs', 'certificates_summary.csv');
  const jsonPath = path.resolve(ROOT_DIR, 'logs', 'certificates_result.json');

  if (fs.existsSync(csvPath)) {
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tong_hop_chung_chi.csv"');
    return fs.createReadStream(csvPath).pipe(res);
  }

  // Fallback nếu chưa có file CSV nhưng có file JSON
  if (fs.existsSync(jsonPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(jsonPath, 'utf-8'));
      const rows = [
        [
          'STT', 'Tài Khoản', 'Mật Khẩu', 'Họ Và Tên', 'Số Chứng Chỉ',
          'Banner 1 (ĐH Đoàn)', 'Banner 2 (ĐH XIV)', 'Banner 3 (ĐVTN)', 'Banner 4 (Phạm Hữu Lầu)', 'Banner 6 (CB Đoàn)',
          'Các Banner Đã Thi', 'Danh Sách Chứng Chỉ', 'Lô', 'Trạng Thái', 'Chi Tiết Lỗi', 'Thời Gian'
        ],
      ];
      for (const [u, item] of Object.entries(data) as any) {
        const bStatus = item.bannerStatus || {};
        const completedBanners = item.completedBanners || [];
        rows.push([
          item.index || '',
          u,
          item.password || '',
          item.fullName || '',
          item.certCount || 0,
          bStatus.banner_1 ? 'ĐÃ THI' : 'CHƯA THI',
          bStatus.banner_2 ? 'ĐÃ THI' : 'CHƯA THI',
          bStatus.banner_3 ? 'ĐÃ THI' : 'CHƯA THI',
          bStatus.banner_4 ? 'ĐÃ THI' : 'CHƯA THI',
          bStatus.banner_6 ? 'ĐÃ THI' : 'CHƯA THI',
          completedBanners.length > 0 ? completedBanners.join(', ').toUpperCase() : 'Chưa có',
          (item.certificates || []).join(' ; '),
          item.lotId || '',
          item.status || '',
          item.error || '',
          item.checked_at || '',
        ]);
      }
      const csvContent = '\ufeff' + rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(',')).join('\n');
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'attachment; filename="tong_hop_chung_chi.csv"');
      return res.send(csvContent);
    } catch (e: any) {
      return res.status(500).json({ success: false, error: e.message });
    }
  }

  res.status(404).json({ success: false, message: 'Chưa có dữ liệu tổng hợp chứng chỉ để tải về.' });
});

app.post('/api/mac/certificates/clear', (req: Request, res: Response) => {
  const resultJsonPath = path.resolve(ROOT_DIR, 'logs', 'certificates_result.json');
  const csvPath = path.resolve(ROOT_DIR, 'logs', 'certificates_summary.csv');
  try {
    if (fs.existsSync(resultJsonPath)) {
      fs.writeFileSync(resultJsonPath, JSON.stringify({}, null, 2), 'utf-8');
    }
    if (fs.existsSync(csvPath)) {
      fs.unlinkSync(csvPath);
    }
    macCertsState = {
      running: false,
      currentAccount: '',
      stats: { total: 0, checked: 0, withCerts: 0, noCerts: 0, totalCertsCount: 0, fail: 0 },
    };
    eventBus.emit('certificates_event', { type: 'cleared' });
    res.json({ success: true, message: 'Đã xóa dữ liệu kiểm tra chứng chỉ!' });
  } catch (err: any) {
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post('/api/mac/certificates/start', (req: Request, res: Response) => {
  if (macCertsProcess) {
    return res.status(400).json({ success: false, message: 'Tiến trình kiểm tra chứng chỉ đang chạy!' });
  }
  if (macCheckProcess) {
    return res.status(400).json({ success: false, message: 'Tiến trình kiểm tra đăng nhập đang chạy! Hãy dừng trước khi quét chứng chỉ.' });
  }
  if (macFlowProcess) {
    return res.status(400).json({ success: false, message: 'Tiến trình thi tự động đang chạy! Hãy dừng trước khi quét chứng chỉ.' });
  }

  const { startFromIndex, lotId, limit, recheckEmpty, recheckFailed } = req.body || {};
  const startIndexNum = parseInt(String(startFromIndex), 10) || 1;
  const scriptArgs = ['scripts/mac_check_certificates.py'];

  if (startIndexNum > 1) {
    scriptArgs.push('--start', String(startIndexNum));
  }
  if (lotId) scriptArgs.push('--lot', String(lotId));
  if (limit) scriptArgs.push('--limit', String(limit));
  if (recheckEmpty) scriptArgs.push('--recheck-empty');
  if (recheckFailed) scriptArgs.push('--recheck-failed');

  console.log('[MacCerts] Khởi chạy kiểm tra chứng chỉ với args:', scriptArgs);

  macCertsState = {
    running: true,
    currentAccount: 'Đang khởi động...',
    stats: { total: 0, checked: 0, withCerts: 0, noCerts: 0, totalCertsCount: 0, fail: 0 },
  };

  const emitCertLog = (message: string, color: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'white' = 'white') => {
    const logItem = {
      message,
      color,
      time: new Date().toLocaleTimeString('vi-VN'),
    };
    eventBus.emit('certificates_log', logItem);
    eventBus.broadcastLog(logItem);
  };

  emitCertLog(
    `📜 [Chứng Chỉ] Bắt đầu quét & tổng hợp số chứng chỉ (Bắt đầu #${startIndexNum}${lotId ? ` - Lô: ${lotId}` : ''})...`,
    'yellow'
  );

  macCertsProcess = spawn('python3', ['-u', ...scriptArgs], {
    cwd: process.cwd(),
    env: { ...process.env, PYTHONUNBUFFERED: '1' },
  });

  macCertsProcess.stdout.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) {
      for (const line of text.split('\n')) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        if (trimmed.startsWith('CERT_EVENT:')) {
          try {
            const eventData = JSON.parse(trimmed.substring(11));
            if (eventData.type === 'start') {
              macCertsState.stats.total = eventData.total || 0;
            } else if (eventData.type === 'account_start') {
              macCertsState.currentAccount = `${eventData.username} (#${eventData.index})`;
            } else if (eventData.type === 'account_done') {
              macCertsState.stats.checked = eventData.current || 0;
              if (eventData.withCertsCount !== undefined) macCertsState.stats.withCerts = eventData.withCertsCount;
              if (eventData.noCertsCount !== undefined) macCertsState.stats.noCerts = eventData.noCertsCount;
              if (eventData.failCount !== undefined) macCertsState.stats.fail = eventData.failCount;
              if (eventData.totalCertsCount !== undefined) macCertsState.stats.totalCertsCount = eventData.totalCertsCount;
            }
            eventBus.emit('certificates_event', eventData);
          } catch (e) {
            console.error('[CertEvent Parse Error]', e);
          }
          continue;
        }

        let col: 'cyan' | 'green' | 'yellow' | 'red' | 'blue' | 'white' = 'white';
        if (trimmed.includes('❌') || trimmed.includes('Lỗi') || trimmed.includes('thất bại')) col = 'red';
        else if (trimmed.includes('🎖️') || trimmed.includes('📜') || trimmed.includes('📊') || trimmed.includes('CHỨNG NHẬN')) col = 'yellow';
        else if (trimmed.includes('✅') || trimmed.includes('👉') || trimmed.includes('Thành công')) col = 'green';
        else if (trimmed.includes('🔑') || trimmed.includes('🧭') || trimmed.includes('📋') || trimmed.includes('Bắt đầu')) col = 'cyan';
        emitCertLog(trimmed, col);
      }
    }
  });

  macCertsProcess.stderr.on('data', (d: Buffer) => {
    const text = d.toString().trim();
    if (text) emitCertLog(`[Lỗi Chứng Chỉ] ${text}`, 'red');
  });

  macCertsProcess.on('close', (code: number) => {
    macCertsProcess = null;
    macCertsState.running = false;
    macCertsState.currentAccount = 'Đã dừng';
    eventBus.emit('certificates_event', { type: 'finish', exitCode: code });
    emitCertLog(
      `🏁 [Chứng Chỉ] Hoàn tất quét chứng chỉ (mã: ${code})`,
      code === 0 ? 'green' : 'yellow'
    );
  });

  res.json({ success: true, message: 'Đã bắt đầu kiểm tra và tổng hợp chứng chỉ!' });
});

app.post('/api/mac/certificates/stop', (req: Request, res: Response) => {
  if (macCertsProcess) {
    try {
      macCertsProcess.kill('SIGTERM');
    } catch (e) {}
    macCertsProcess = null;
  }
  try {
    execSync('pkill -f "mac_check_certificates.py" 2>/dev/null');
  } catch (e) {}
  macCertsState.running = false;
  macCertsState.currentAccount = 'Đã dừng';
  eventBus.emit('certificates_event', { type: 'stopped' });
  const stopLog = { message: '🛑 [Chứng Chỉ] Đã dừng quét chứng chỉ!', color: 'red' as const, time: new Date().toLocaleTimeString('vi-VN') };
  eventBus.emit('certificates_log', stopLog);
  eventBus.broadcastLog(stopLog);
  res.json({ success: true, message: 'Đã dừng quét chứng chỉ!' });
});

// Start Server
app.listen(PORT, '0.0.0.0', () => {
  console.log(`\n===============================================================`);
  console.log(`  🚀 THANH NIÊN VIỆT NAM AUTOMATION - WEB DASHBOARD PORT ${PORT}`);
  console.log(`  👉 Truy cập trình duyệt: http://localhost:${PORT}`);
  console.log(`===============================================================\n`);
});
