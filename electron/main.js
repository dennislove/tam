import { app, BrowserWindow, shell, dialog } from 'electron';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import net from 'node:net';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3000;
let mainWindow = null;

// Xác định thư mục root của app (đọc mã nguồn/giao diện trong asar)
const ROOT_DIR = app.isPackaged ? app.getAppPath() : path.resolve(__dirname, '..');
process.env.APP_ROOT = ROOT_DIR;
process.env.PORT = String(PORT);

// Thư mục dữ liệu người dùng (lưu logs, ảnh chụp màn hình ngoài asar, có quyền ghi)
const DATA_DIR = app.isPackaged ? app.getPath('userData') : path.resolve(__dirname, '..');
process.env.APP_DATA_DIR = DATA_DIR;

// Đặt current working directory
try {
  if (app.isPackaged) {
    process.chdir(path.dirname(app.getPath('exe')));
  }
} catch (e) {
  console.warn('[Electron] Không thể đổi cwd:', e);
}

// -----------------------------------------------------------
// Kiểm tra cổng server đã sẵn sàng chưa
// -----------------------------------------------------------
function isPortOpen(port) {
  return new Promise((resolve) => {
    const socket = new net.Socket();
    socket.setTimeout(800);
    socket
      .on('connect', () => {
        socket.destroy();
        resolve(true);
      })
      .on('timeout', () => {
        socket.destroy();
        resolve(false);
      })
      .on('error', () => resolve(false))
      .connect(port, '127.0.0.1');
  });
}

async function waitForServer(port, maxRetries = 30) {
  for (let i = 0; i < maxRetries; i++) {
    if (await isPortOpen(port)) return true;
    await new Promise((r) => setTimeout(r, 200));
  }
  return false;
}

// -----------------------------------------------------------
// Khởi chạy Express Server ngay trong tiến trình Electron
// (Không cần spawn node.exe ngoài, Electron tự quản lý Node.js runtime)
// -----------------------------------------------------------
async function startServer() {
  try {
    console.log('[Electron] Dang nap Express Server truc tiep trong Electron runtime...');
    // Import server module
    await import('../dist/server.js');
    console.log('[Electron] Express Server da duoc nap thanh cong!');
  } catch (err) {
    console.error('[Electron] Loi khoi dong Express Server:', err);
    dialog.showErrorBox(
      'Lỗi khởi động Server',
      `Không thể khởi chạy Server nội bộ:\n${err?.message || err}\n\nStack:\n${err?.stack || ''}`
    );
    app.quit();
  }
}

// -----------------------------------------------------------
// Tạo cửa sổ ứng dụng
// -----------------------------------------------------------
function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 960,
    minHeight: 640,
    title: 'TNVN Auto Exam Pro - Hệ Thống Thi Tự Động',
    backgroundColor: '#0f172a',
    autoHideMenuBar: true,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
    show: false,
  });

  mainWindow.loadURL(`http://127.0.0.1:${PORT}`);

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    mainWindow.focus();
  });

  // Mở các link ngoài (http/https không phải localhost) bằng trình duyệt mặc định của Windows
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (!url.startsWith(`http://127.0.0.1:${PORT}`) && !url.startsWith(`http://localhost:${PORT}`)) {
      shell.openExternal(url);
      return { action: 'deny' };
    }
    return { action: 'allow' };
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// -----------------------------------------------------------
// Vòng đời ứng dụng Electron
// -----------------------------------------------------------
app.whenReady().then(async () => {
  await startServer();

  const ready = await waitForServer(PORT);
  if (!ready) {
    dialog.showErrorBox(
      'Lỗi khởi động',
      `Không thể kết nối máy chủ nội bộ tại cổng ${PORT}.\nVui lòng tắt app đang chạy chiếm cổng 3000 và thử lại.`
    );
    app.quit();
    return;
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
