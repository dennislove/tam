import fs from 'node:fs';
import path from 'node:path';
import { execSync, spawn, ChildProcess } from 'node:child_process';
import { PNG } from 'pngjs';
import { eventBus } from './eventBus.js';
import { AnswerItem } from './examSolver.js';

export interface MacWindowBounds {
  windowId: number;
  pid: number;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface MacExamOptions {
  answersData?: AnswerItem[];
  fixedAnswer?: 'A' | 'B' | 'C' | 'D' | 'RANDOM';
  totalQuestions?: number;
  abortSignal?: { aborted: boolean };
}

export interface ClickCoord {
  rx: number;
  ry: number;
  label?: string;
}

// Tọa độ mặc định — sẽ được ghi đè bởi calibration
const DEFAULT_COORDS: Record<string, ClickCoord> = {
  login_username:  { rx: 0.50, ry: 0.58, label: 'Ô nhập username' },
  login_password:  { rx: 0.50, ry: 0.69, label: 'Ô nhập password' },
  login_button:    { rx: 0.50, ry: 0.88, label: 'Nút ĐĂNG NHẬP' },
  tab_cong_tac_doan: { rx: 0.30, ry: 0.96, label: 'Tab Công tác đoàn (đáy)' },
  hoc_va_thi:      { rx: 0.50, ry: 0.26, label: 'Mục Học và thi' },
  cuoc_thi_trc_tuyen: { rx: 0.50, ry: 0.19, label: 'Card Cuộc thi trực tuyến' },
  cuoc_thi_dau_tien: { rx: 0.50, ry: 0.24, label: 'Cuộc thi đầu tiên' },
  bat_dau_bai_thi: { rx: 0.50, ry: 0.27, label: 'Nút BẮT ĐẦU / LÀM LẠI BÀI THI' },
  answer_A:        { rx: 0.08, ry: 0.22, label: 'Đáp án A' },
  answer_B:        { rx: 0.08, ry: 0.26, label: 'Đáp án B' },
  answer_C:        { rx: 0.08, ry: 0.30, label: 'Đáp án C' },
  answer_D:        { rx: 0.08, ry: 0.34, label: 'Đáp án D' },
  next_question:   { rx: 0.93, ry: 0.96, label: 'Nút Next > (sang câu tiếp)' },
  nop_bai:         { rx: 0.88, ry: 0.11, label: 'Nút NỘP BÀI' },
  confirm_nop:     { rx: 0.50, ry: 0.58, label: 'Xác nhận nộp bài (popup)' },
  back_home:       { rx: 0.06, ry: 0.08, label: 'Back về trang chính' },
  tab_ca_nhan:     { rx: 0.90, ry: 0.96, label: 'Tab Cá nhân' },
  dang_xuat:       { rx: 0.50, ry: 0.85, label: 'Nút Đăng xuất' },
};

export class MacService {
  private binPath: string;
  private clickBinPath: string;
  private recorderBinPath: string;
  private coordsFile: string;
  private coords: Record<string, ClickCoord>;
  private recorderProcess: ChildProcess | null = null;
  private recordCallbacks: Array<(key: string, rx: number, ry: number, absX: number, absY: number) => void> = [];

  constructor() {
    this.binPath = path.join(process.cwd(), 'bin', 'mac_window_info');
    this.clickBinPath = path.join(process.cwd(), 'bin', 'mac_click_helper');
    this.recorderBinPath = path.join(process.cwd(), 'bin', 'mac_coord_recorder');
    this.coordsFile = path.join(process.cwd(), 'data', 'mac_coordinates.json');

    // Load calibrated coords hoặc dùng mặc định
    this.coords = this.loadCoordinates();

    if (!fs.existsSync(this.binPath)) this.ensureWindowInfoBinary();
    if (!fs.existsSync(this.clickBinPath)) this.ensureClickBinary();
    if (!fs.existsSync(this.recorderBinPath)) this.ensureRecorderBinary();
  }

  // ----------------------------------------------------------------
  // BINARY BUILDERS
  // ----------------------------------------------------------------

  private ensureWindowInfoBinary(): void {
    try {
      const src = `
#include <stdio.h>
#include <ApplicationServices/ApplicationServices.h>
int main() {
    CFArrayRef wl = CGWindowListCopyWindowInfo(kCGWindowListOptionOnScreenOnly|kCGWindowListExcludeDesktopElements, kCGNullWindowID);
    if (!wl) return 1;
    CFIndex n = CFArrayGetCount(wl);
    for (CFIndex i = 0; i < n; i++) {
        CFDictionaryRef w = (CFDictionaryRef)CFArrayGetValueAtIndex(wl, i);
        CFStringRef name = (CFStringRef)CFDictionaryGetValue(w, kCGWindowOwnerName);
        CFNumberRef pidRef = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowOwnerPID);
        CFDictionaryRef bounds = (CFDictionaryRef)CFDictionaryGetValue(w, kCGWindowBounds);
        CFNumberRef wnum = (CFNumberRef)CFDictionaryGetValue(w, kCGWindowNumber);
        char nb[256]={0}; if(name) CFStringGetCString(name,nb,sizeof(nb),kCFStringEncodingUTF8);
        int pid=0; if(pidRef) CFNumberGetValue(pidRef,kCFNumberIntType,&pid);
        int wid=0; if(wnum) CFNumberGetValue(wnum,kCFNumberIntType,&wid);
        CGRect r; if(bounds&&CGRectMakeWithDictionaryRepresentation(bounds,&r)&&r.size.width>200&&r.size.height>200)
            printf("%d\\t%d\\t%s\\t%.0f\\t%.0f\\t%.0f\\t%.0f\\n",wid,pid,nb,r.origin.x,r.origin.y,r.size.width,r.size.height);
    }
    CFRelease(wl); return 0;
}`;
      const dir = path.dirname(this.binPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      execSync(`clang -framework Cocoa -framework CoreGraphics -O2 -o "${this.binPath}" -x c -`, { input: src, stdio: ['pipe','ignore','ignore'] });
    } catch (e: any) { console.warn('[MacService] build window_info failed:', e.message); }
  }

  private ensureClickBinary(): void {
    try {
      const src = `
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <ApplicationServices/ApplicationServices.h>
int main(int argc, char* argv[]) {
    if (argc < 4) { fprintf(stderr, "Usage: mac_click_helper <pid> <x> <y>\\n"); return 1; }
    pid_t pid = (pid_t)atoi(argv[1]);
    double x = atof(argv[2]), y = atof(argv[3]);
    CGPoint pt = CGPointMake(x, y);
    CGEventRef dn = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseDown, pt, kCGMouseButtonLeft);
    if (!dn) return 2;
    CGEventPostToPid(pid, dn); CFRelease(dn);
    usleep(40000);
    CGEventRef up = CGEventCreateMouseEvent(NULL, kCGEventLeftMouseUp, pt, kCGMouseButtonLeft);
    if (!up) return 3;
    CGEventPostToPid(pid, up); CFRelease(up);
    return 0;
}`;
      const dir = path.dirname(this.clickBinPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      execSync(`clang -framework Cocoa -framework CoreGraphics -O2 -o "${this.clickBinPath}" -x c -`, { input: src, stdio: ['pipe','ignore','ignore'] });
      execSync(`chmod +x "${this.clickBinPath}"`, { stdio: 'ignore' });
    } catch (e: any) { console.warn('[MacService] build click_helper failed:', e.message); }
  }

  /**
   * Binary lắng nghe click chuột của user trong cửa sổ TNVN (CGEventTap - không can thiệp)
   * Output: READY\t<x>\t<y>\t<w>\t<h>
   *         CLICK\t<relX>\t<relY>\t<absX>\t<absY>
   */
  private ensureRecorderBinary(): void {
    try {
      const src = `
#include <stdio.h>
#include <stdlib.h>
#include <ApplicationServices/ApplicationServices.h>
#include <CoreFoundation/CoreFoundation.h>

static double wx, wy, ww, wh;

CGEventRef callback(CGEventTapProxy proxy, CGEventType type, CGEventRef event, void *ref) {
    if (type == kCGEventLeftMouseDown) {
        CGPoint pt = CGEventGetLocation(event);
        if (pt.x >= wx && pt.x <= wx+ww && pt.y >= wy && pt.y <= wy+wh) {
            double rx = (pt.x - wx) / ww;
            double ry = (pt.y - wy) / wh;
            printf("CLICK\\t%.4f\\t%.4f\\t%.1f\\t%.1f\\n", rx, ry, pt.x, pt.y);
            fflush(stdout);
        }
    }
    return event;
}

int main(int argc, char* argv[]) {
    if (argc < 5) { fprintf(stderr, "Usage: mac_coord_recorder <x> <y> <w> <h>\\n"); return 1; }
    wx=atof(argv[1]); wy=atof(argv[2]); ww=atof(argv[3]); wh=atof(argv[4]);
    CGEventMask mask = CGEventMaskBit(kCGEventLeftMouseDown);
    CFMachPortRef tap = CGEventTapCreate(kCGSessionEventTap, kCGHeadInsertEventTap, kCGEventTapOptionListenOnly, mask, callback, NULL);
    if (!tap) { fprintf(stderr, "EventTap failed. Grant Accessibility to Terminal.\\n"); return 2; }
    CFRunLoopSourceRef src = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, tap, 0);
    CFRunLoopAddSource(CFRunLoopGetCurrent(), src, kCFRunLoopCommonModes);
    CGEventTapEnable(tap, true);
    printf("READY\\t%.0f\\t%.0f\\t%.0f\\t%.0f\\n", wx, wy, ww, wh);
    fflush(stdout);
    CFRunLoopRun();
    return 0;
}`;
      const dir = path.dirname(this.recorderBinPath);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      execSync(`clang -framework Cocoa -framework CoreGraphics -O2 -o "${this.recorderBinPath}" -x c -`, { input: src, stdio: ['pipe','ignore','ignore'] });
      execSync(`chmod +x "${this.recorderBinPath}"`, { stdio: 'ignore' });
    } catch (e: any) { console.warn('[MacService] build coord_recorder failed:', e.message); }
  }

  // ----------------------------------------------------------------
  // COORDINATES MANAGEMENT
  // ----------------------------------------------------------------

  public loadCoordinates(): Record<string, ClickCoord> {
    try {
      if (fs.existsSync(this.coordsFile)) {
        const raw = fs.readFileSync(this.coordsFile, 'utf-8');
        const saved = JSON.parse(raw) as Record<string, ClickCoord>;
        return { ...DEFAULT_COORDS, ...saved };
      }
    } catch {}
    return { ...DEFAULT_COORDS };
  }

  public saveCoordinates(coords: Record<string, ClickCoord>): void {
    try {
      const dir = path.dirname(this.coordsFile);
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      const b = this.getWindowBounds();
      const payload: any = { ...coords };
      if (b && b.width > 200 && b.height > 200) {
        payload.calibrated_w = Math.round(b.width);
        payload.calibrated_h = Math.round(b.height);
      }
      fs.writeFileSync(this.coordsFile, JSON.stringify(payload, null, 2));
      this.coords = payload;
      console.log('[MacService] Đã lưu tọa độ calibration:', this.coordsFile);
    } catch (e: any) { console.warn('[MacService] saveCoordinates lỗi:', e.message); }
  }

  public updateCoord(key: string, rx: number, ry: number): void {
    this.coords[key] = { ...(this.coords[key] || {}), rx, ry };
    this.saveCoordinates(this.coords);
  }

  public getCoordinates(): Record<string, ClickCoord> {
    return this.coords;
  }

  public getDefaultCoordinates(): Record<string, ClickCoord> {
    return DEFAULT_COORDS;
  }

  // ----------------------------------------------------------------
  // WINDOW MANAGEMENT
  // ----------------------------------------------------------------

  public getWindowBounds(debugLog = false): MacWindowBounds | null {
    try {
      if (!fs.existsSync(this.binPath)) this.ensureWindowInfoBinary();
      const output = execSync(`"${this.binPath}"`, { encoding: 'utf-8' });
      const lines = output.trim().split('\n');
      if (debugLog) { console.log('[MacService][DEBUG] Windows:'); lines.forEach(l => console.log(' ', l)); }
      for (const line of lines) {
        const parts = line.split('\t');
        if (parts.length >= 7) {
          const name = parts[2].toLowerCase();
          if (name.includes('thanh') || name.includes('runner') || name.includes('vnpt') || name.includes('tnvn')) {
            const b: MacWindowBounds = {
              windowId: parseInt(parts[0], 10), pid: parseInt(parts[1], 10),
              name: parts[2], x: parseFloat(parts[3]), y: parseFloat(parts[4]),
              width: parseFloat(parts[5]), height: parseFloat(parts[6]),
            };
            if (debugLog) console.log(`[MacService][DEBUG] Found: "${b.name}" pid=${b.pid} ${b.width}x${b.height} @ (${b.x},${b.y})`);
            return b;
          }
        }
      }
    } catch {}
    return null;
  }

  public activateApp(): void {
    const b = this.getWindowBounds();
    try {
      if (b?.pid) {
        execSync(`osascript -e 'tell application "System Events" to set frontmost of (every process whose unix id is ${b.pid}) to true'`, { stdio: 'ignore' });
      } else {
        execSync(`osascript -e 'tell application "System Events" to set frontmost of (every process whose name contains "Runner") to true'`, { stdio: 'ignore' });
      }
    } catch {
      try { execSync(`open -a "/Applications/Thanh niên Việt Nam.app"`, { stdio: 'ignore' }); } catch {}
    }
  }

  public openApp(): boolean {
    try {
      execSync(`open -a "/Applications/Thanh niên Việt Nam.app"`, { stdio: 'ignore' });
      return true;
    } catch { return false; }
  }

  // ----------------------------------------------------------------
  // CLICK RECORDER (học tọa độ từ click của user)
  // ----------------------------------------------------------------

  /**
   * Bắt đầu lắng nghe click của user trong cửa sổ TNVN.
   * Mỗi lần user click → gọi callback với (relX, relY).
   * @returns true nếu start thành công
   */
  public startClickRecorder(onReady: (bounds: MacWindowBounds) => void, onData: (rx: number, ry: number, absX: number, absY: number) => void): boolean {
    if (this.recorderProcess) {
      console.warn('[MacService] Recorder đang chạy rồi, dừng cái cũ trước');
      this.stopClickRecorder();
    }

    if (!fs.existsSync(this.recorderBinPath)) this.ensureRecorderBinary();

    const bounds = this.getWindowBounds(true);
    if (!bounds) {
      console.warn('[MacService] Không tìm thấy cửa sổ TNVN để record');
      return false;
    }

    this.activateApp();

    console.log(`[MacService] Bắt đầu recorder cho cửa sổ: "${bounds.name}" ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})`);

    this.recorderProcess = spawn(this.recorderBinPath, [
      String(bounds.x), String(bounds.y), String(bounds.width), String(bounds.height)
    ]);

    this.recorderProcess.stdout?.on('data', (chunk: Buffer) => {
      const lines = chunk.toString().split('\n');
      for (const line of lines) {
        const parts = line.trim().split('\t');
        if (parts[0] === 'READY') {
          console.log('[MacService] Recorder READY — đang lắng nghe click của bạn...');
          onReady(bounds);
        } else if (parts[0] === 'CLICK' && parts.length >= 5) {
          const rx = parseFloat(parts[1]);
          const ry = parseFloat(parts[2]);
          const absX = parseFloat(parts[3]);
          const absY = parseFloat(parts[4]);
          console.log(`[MacService] User clicked: rel(${rx.toFixed(3)}, ${ry.toFixed(3)}) abs(${absX}, ${absY})`);
          onData(rx, ry, absX, absY);
        }
      }
    });

    this.recorderProcess.stderr?.on('data', (d: Buffer) => {
      console.warn('[MacService][recorder stderr]', d.toString().trim());
    });

    this.recorderProcess.on('exit', (code) => {
      console.log('[MacService] Recorder exited, code:', code);
      this.recorderProcess = null;
    });

    return true;
  }

  public stopClickRecorder(): void {
    if (this.recorderProcess) {
      try { this.recorderProcess.kill('SIGTERM'); } catch {}
      this.recorderProcess = null;
      console.log('[MacService] Đã dừng recorder');
    }
  }

  public isRecording(): boolean {
    return this.recorderProcess !== null;
  }

  // ----------------------------------------------------------------
  // CLICK ACTIONS
  // ----------------------------------------------------------------

  public async clickRelative(relX: number, relY: number, delayMs: number = 80): Promise<boolean> {
    const bounds = this.getWindowBounds();
    if (!bounds) { this.activateApp(); await this.sleep(200); return false; }

    const screenX = Math.round(bounds.x + relX * bounds.width);
    const screenY = Math.round(bounds.y + relY * bounds.height);

    console.log(`[MacService] click rel(${relX}, ${relY}) → abs(${screenX}, ${screenY}) [win: ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y})]`);

    if (fs.existsSync(this.clickBinPath)) {
      try {
        execSync(`"${this.clickBinPath}" ${bounds.pid} ${screenX} ${screenY}`, { stdio: 'ignore' });
        if (delayMs > 0) await this.sleep(delayMs);
        return true;
      } catch (e: any) { console.warn(`[MacService] CGEventPostToPid err:`, e.message); }
    }
    try {
      execSync(`cliclick c:${screenX},${screenY}`, { stdio: 'ignore' });
      if (delayMs > 0) await this.sleep(delayMs);
      return true;
    } catch (e: any) { console.warn(`[MacService] cliclick err:`, e.message); return false; }
  }

  /** Click theo key trong bảng coords đã calibrate */
  public async clickCoord(key: string, delayMs: number = 80): Promise<boolean> {
    const c = this.coords[key];
    if (!c) { console.warn(`[MacService] Chưa có tọa độ cho key: "${key}"`); return false; }
    console.log(`[MacService] clickCoord("${key}") → rel(${c.rx}, ${c.ry}) [${c.label}]`);
    return this.clickRelative(c.rx, c.ry, delayMs);
  }

  public async typeText(text: string): Promise<void> {
    try {
      execSync('pbcopy', { input: text });
      await this.sleep(50);
      execSync(`osascript -e 'tell application "System Events" to keystroke "v" using command down'`, { stdio: 'ignore' });
      await this.sleep(100);
    } catch (e: any) { console.warn('[MacService] typeText err:', e.message); }
  }

  public async clearInput(): Promise<void> {
    try {
      execSync(`osascript -e 'tell application "System Events" to keystroke "a" using command down'`, { stdio: 'ignore' });
      execSync(`osascript -e 'tell application "System Events" to key code 51'`, { stdio: 'ignore' });
      await this.sleep(80);
    } catch {}
  }

  public async captureWindow(savePath?: string): Promise<{ buffer: Buffer; png: PNG } | null> {
    const b = this.getWindowBounds();
    if (!b) return null;
    const tmpFile = savePath || path.join(process.cwd(), 'logs', 'screenshots', `mac_capture_${Date.now()}.png`);
    const dir = path.dirname(tmpFile);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    try {
      execSync(`screencapture -x -R${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.width)},${Math.round(b.height)} "${tmpFile}"`, { stdio: 'ignore' });
      const buffer = fs.readFileSync(tmpFile);
      const png = PNG.sync.read(buffer);
      if (!savePath) { try { fs.unlinkSync(tmpFile); } catch {} }
      return { buffer, png };
    } catch (e: any) { console.warn('[MacService] captureWindow err:', e.message); return null; }
  }

  public async captureDebugSnapshot(label = 'debug'): Promise<string | null> {
    const savePath = path.join(process.cwd(), 'logs', 'screenshots', `debug_${label}_${Date.now()}.png`);
    const result = await this.captureWindow(savePath);
    if (result) {
      console.log(`[MacService][DEBUG] snapshot: ${savePath} (${result.png.width}x${result.png.height})`);
      this.log('DEBUG', `📷 ${path.basename(savePath)} (${result.png.width}x${result.png.height})`, 'yellow');
      return savePath;
    }
    return null;
  }

  // ----------------------------------------------------------------
  // SCREEN DETECTION
  // ----------------------------------------------------------------

  public isLoginScreen(png: PNG): boolean {
    const startY = Math.round(png.height * 0.82), endY = Math.round(png.height * 0.92);
    let n = 0;
    for (let y = startY; y < endY; y += 4)
      for (let x = Math.round(png.width * 0.2); x < Math.round(png.width * 0.8); x += 4) {
        const i = (y * png.width + x) * 4;
        if (png.data[i] > 220 && png.data[i+1] > 110 && png.data[i+1] < 180 && png.data[i+2] < 100) n++;
      }
    return n > 15;
  }

  public findExamStartButton(png: PNG): { rx: number; ry: number } | null {
    const sy = Math.round(png.height * 0.20), ey = Math.round(png.height * 0.35);
    let n = 0;
    for (let y = sy; y < ey; y += 4)
      for (let x = Math.round(png.width * 0.1); x < Math.round(png.width * 0.9); x += 4) {
        const i = (y * png.width + x) * 4;
        if (png.data[i+2] > 200 && png.data[i] < 90 && png.data[i+1] < 110) n++;
      }
    return n > 20 ? { rx: this.coords.bat_dau_bai_thi?.rx ?? 0.50, ry: this.coords.bat_dau_bai_thi?.ry ?? 0.27 } : null;
  }

  public findNopBaiButton(png: PNG): { rx: number; ry: number } | null {
    const sy = Math.round(png.height * 0.08), ey = Math.round(png.height * 0.16);
    let n = 0;
    for (let y = sy; y < ey; y += 2)
      for (let x = Math.round(png.width * 0.75); x < Math.round(png.width * 0.98); x += 2) {
        const i = (y * png.width + x) * 4;
        if (png.data[i+2] > 190 && png.data[i] < 90 && png.data[i+1] < 120) n++;
      }
    return n > 15 ? { rx: this.coords.nop_bai?.rx ?? 0.88, ry: this.coords.nop_bai?.ry ?? 0.11 } : null;
  }

  // ----------------------------------------------------------------
  // HELPERS
  // ----------------------------------------------------------------

  public sleep(minMs: number, maxMs?: number): Promise<void> {
    const ms = maxMs ? Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs : minMs;
    return new Promise(r => setTimeout(r, ms));
  }

  private log(username: string, message: string, color: 'cyan'|'green'|'yellow'|'red'|'blue' = 'cyan') {
    const time = new Date().toLocaleTimeString('vi-VN', { hour12: false });
    eventBus.broadcastLog({ time, serial: 'macOS Native', username, message, color });
  }

  // ----------------------------------------------------------------
  // MAIN EXAM FLOW (dùng coords đã calibrate)
  // ----------------------------------------------------------------

  public async runMacExam(
    account: { username: string; password: string; fixedAnswer?: 'A'|'B'|'C'|'D'|'RANDOM'; totalQuestions?: number },
    options: MacExamOptions = {}
  ): Promise<{ success: boolean; error?: string; screenshotPath?: string }> {
    const t0 = Date.now();
    const u = account.username;

    this.log(u, `🚀 Bắt đầu làm bài thi: ${u}`, 'blue');

    // Mở & kích hoạt app
    this.openApp();
    this.activateApp();
    await this.sleep(800);

    let bounds = this.getWindowBounds(true);
    if (!bounds) {
      await this.sleep(2000);
      bounds = this.getWindowBounds();
      if (!bounds) {
        const err = 'Không tìm thấy cửa sổ ứng dụng Thanh niên Việt Nam!';
        this.log(u, `❌ ${err}`, 'red');
        return { success: false, error: err };
      }
    }
    this.log(u, `🪟 Window: "${bounds.name}" ${bounds.width}x${bounds.height} @ (${bounds.x},${bounds.y}) pid=${bounds.pid}`, 'cyan');
    this.activateApp();
    await this.sleep(300);

    // BƯỚC 1: ĐĂNG NHẬP
    let cap = await this.captureWindow();
    if (cap && this.isLoginScreen(cap.png)) {
      this.log(u, `[1/8] Đăng nhập... (PNG: ${cap.png.width}x${cap.png.height})`, 'cyan');
      await this.clickCoord('login_username', 50); await this.clearInput(); await this.typeText(account.username);
      await this.clickCoord('login_password', 50); await this.clearInput(); await this.typeText(account.password);
      this.log(u, 'Nhấn ĐĂNG NHẬP...', 'cyan');
      await this.clickCoord('login_button', 1500);
    } else {
      this.log(u, 'Đã đăng nhập sẵn, tiếp tục...', 'green');
    }

    // BƯỚC 2: CÔNG TÁC ĐOÀN → HỌC VÀ THI
    cap = await this.captureWindow();
    const inExam = cap ? this.findNopBaiButton(cap.png) !== null : false;

    if (!inExam) {
      const startBtn = cap ? this.findExamStartButton(cap.png) : null;
      if (!startBtn) {
        this.log(u, '[2/8] Tab "Công tác đoàn"...', 'cyan');
        await this.clickCoord('tab_cong_tac_doan', 600);

        this.log(u, '[3/8] Mục "Học và thi"...', 'cyan');
        await this.clickCoord('hoc_va_thi', 700);

        this.log(u, '[4/8] Cuộc thi trực tuyến...', 'cyan');
        await this.clickCoord('cuoc_thi_trc_tuyen', 700);
        await this.clickCoord('cuoc_thi_dau_tien', 900);
      }

      this.log(u, '[5/8] Bắt đầu bài thi...', 'green');
      await this.clickCoord('bat_dau_bai_thi', 1500);
    }

    // BƯỚC 6: TRẢ LỜI CÂU HỎI
    const total = account.totalQuestions || 50;
    this.log(u, `[6/8] ⚡ Giải ${total} câu...`, 'blue');
    const answerKeys: ('A'|'B'|'C'|'D')[] = ['A','B','C','D'];
    const answerCoordKeys = ['answer_A', 'answer_B', 'answer_C', 'answer_D'];

    for (let q = 1; q <= total; q++) {
      if (options.abortSignal?.aborted) { this.log(u, '🛑 Đã dừng.', 'yellow'); return { success: false, error: 'Aborted' }; }
      let idx = Math.floor(Math.random() * 4);
      const fixed = account.fixedAnswer || options.fixedAnswer;
      if (fixed && fixed !== 'RANDOM') idx = answerKeys.indexOf(fixed);
      const letter = answerKeys[idx] || 'A';
      await this.clickCoord(answerCoordKeys[idx], 60);
      this.log(u, `Câu ${q}/${total}: [${letter}]`, 'green');
      await this.sleep(120, 220);
      if (q < total) await this.clickCoord('next_question', 150);
    }

    // BƯỚC 7: NỘP BÀI
    this.log(u, '[7/8] 🎯 NỘP BÀI...', 'yellow');
    await this.clickCoord('nop_bai', 700);
    await this.clickCoord('confirm_nop', 1500);

    const cleanU = u.replace(/[^a-zA-Z0-9]/g, '_');
    const screenshotPath = path.join(process.cwd(), 'logs', 'screenshots', `${cleanU}_result.png`);
    await this.captureWindow(screenshotPath);
    this.log(u, `📸 Đã lưu kết quả!`, 'green');

    // BƯỚC 8: ĐĂNG XUẤT
    this.log(u, '[8/8] Đăng xuất...', 'cyan');
    await this.clickCoord('back_home', 500);
    await this.clickCoord('tab_ca_nhan', 500);
    await this.clickCoord('dang_xuat', 1000);

    const dur = ((Date.now() - t0) / 1000).toFixed(1);
    this.log(u, `🎉 Hoàn thành ${u} trong ${dur}s!`, 'green');
    return { success: true, screenshotPath };
  }
}

export const macService = new MacService();
