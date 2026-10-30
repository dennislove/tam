/**
 * mac_calibrate.js — Tab "Hiệu Chỉnh Tọa Độ" cho TNVN Auto Tool
 * Cho phép user click vào app để học tọa độ, xem live screenshot, lưu calibration
 */
(function () {
  'use strict';

  // ── Tên + mô tả các bước cần calibrate (theo thứ tự quy trình) ─────────────
  const STEPS = [
    { key: 'login_username',      label: 'Ô nhập Username/Email/SĐT',         guide: '👆 Click vào ô nhập tên đăng nhập' },
    { key: 'login_password',      label: 'Ô nhập Mật khẩu',                   guide: '👆 Click vào ô nhập mật khẩu' },
    { key: 'login_button',        label: 'Nút ĐĂNG NHẬP (màu cam)',            guide: '👆 Click vào nút ĐĂNG NHẬP màu cam' },
    { key: 'tab_cong_tac_doan',   label: 'Tab "Công tác đoàn" (thanh đáy)',    guide: '👆 Click vào icon "Công tác đoàn" ở thanh đáy' },
    { key: 'hoc_va_thi',          label: 'Mục "Học và thi"',                   guide: '👆 Click vào mục "Học và thi"' },
    { key: 'cuoc_thi_trc_tuyen',  label: 'Thẻ "Cuộc thi trực tuyến"',         guide: '👆 Click vào thẻ "Cuộc thi trực tuyến"' },
    { key: 'cuoc_thi_dau_tien',   label: 'Cuộc thi đầu tiên trong danh sách', guide: '👆 Click vào cuộc thi đầu tiên' },
    { key: 'bat_dau_bai_thi',     label: 'Nút "BẮT ĐẦU BÀI THI"',            guide: '👆 Click vào nút BẮT ĐẦU BÀI THI (màu xanh)' },
    { key: 'answer_A',            label: 'Đáp án A (radio button)',            guide: '👆 Click vào radio A (câu hỏi bất kỳ)' },
    { key: 'answer_B',            label: 'Đáp án B (radio button)',            guide: '👆 Click vào radio B' },
    { key: 'answer_C',            label: 'Đáp án C (radio button)',            guide: '👆 Click vào radio C' },
    { key: 'answer_D',            label: 'Đáp án D (radio button)',            guide: '👆 Click vào radio D' },
    { key: 'next_question',       label: 'Nút ">" chuyển câu tiếp theo',       guide: '👆 Click vào nút mũi tên > ở góc dưới phải' },
    { key: 'nop_bai',             label: 'Nút "NỘP BÀI" (góc trên phải)',     guide: '👆 Click vào nút NỘP BÀI màu xanh' },
    { key: 'confirm_nop',         label: 'Nút xác nhận trên popup nộp bài',   guide: '👆 Bấm xác nhận trên popup nộp bài' },
    { key: 'back_home',           label: 'Nút Back về trang chính',           guide: '👆 Click nút Back (←) về trang chủ' },
    { key: 'tab_ca_nhan',         label: 'Tab "Cá nhân" (thanh đáy)',          guide: '👆 Click vào tab Cá nhân ở thanh đáy' },
    { key: 'dang_xuat',           label: 'Nút "Đăng xuất"',                   guide: '👆 Click vào nút Đăng xuất' },
  ];

  let currentCoords = {};
  let recordingSSE = null;
  let currentStepIndex = -1;
  let recordedThisSession = {};
  let screenshotInterval = null;

  // ── Inject HTML tab panel ──────────────────────────────────────────────────
  function injectCalibratePanelHTML() {
    const contentViewport = document.querySelector('.content-viewport');
    if (!contentViewport) return;

    const panel = document.createElement('div');
    panel.className = 'tab-pane';
    panel.id = 'tab-calibrate';
    panel.innerHTML = `
      <div style="display:flex;gap:16px;height:100%;min-height:600px;">

        <!-- LEFT: Controls -->
        <div style="flex:1;min-width:0;display:flex;flex-direction:column;gap:12px;">

          <!-- Header -->
          <div style="background:linear-gradient(135deg,#1e293b,#0f172a);border:1px solid #334155;border-radius:12px;padding:16px;">
            <h2 style="margin:0 0 4px;font-size:1.1rem;color:#f1f5f9;">🎯 Hiệu Chỉnh Tọa Độ Click (Calibration)</h2>
            <p style="margin:0;font-size:0.82rem;color:#94a3b8;">
              Mở app TNVN → Bấm <b style="color:#06b6d4">Bắt đầu ghi</b> → Click vào đúng vị trí trên app → Tool tự học tọa độ
            </p>
          </div>

          <!-- App Control -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;">
            <button id="cal-btn-open-app" class="btn btn-primary" style="min-width:140px;">
              <span class="icon">📱</span> Mở App TNVN
            </button>
            <button id="cal-btn-screenshot" class="btn btn-secondary" style="min-width:140px;">
              <span class="icon">📷</span> Chụp Màn Hình
            </button>
            <div id="cal-window-info" style="font-size:0.8rem;color:#64748b;flex:1;text-align:right;">
              Chưa phát hiện cửa sổ app
            </div>
          </div>

          <!-- Recording Control -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;">
            <div style="display:flex;gap:10px;align-items:center;margin-bottom:10px;">
              <button id="cal-btn-start-record" class="btn btn-emerald" style="min-width:160px;">
                <span class="icon">🔴</span> Bắt Đầu Ghi Click
              </button>
              <button id="cal-btn-stop-record" class="btn btn-secondary" style="min-width:140px;" disabled>
                <span class="icon">⬛</span> Dừng Ghi
              </button>
              <div id="cal-record-status" style="font-size:0.82rem;color:#64748b;flex:1;">
                Chưa bắt đầu
              </div>
            </div>

            <!-- Current step guide -->
            <div id="cal-step-guide" style="display:none;background:#0f172a;border:1px solid #0ea5e9;border-radius:8px;padding:10px 14px;">
              <div style="font-size:0.75rem;color:#0ea5e9;margin-bottom:4px;">BƯỚC <span id="cal-step-num">1</span> / ${STEPS.length}</div>
              <div id="cal-step-label" style="font-size:0.95rem;font-weight:600;color:#f1f5f9;margin-bottom:3px;"></div>
              <div id="cal-step-guide-text" style="font-size:0.83rem;color:#94a3b8;"></div>
            </div>
          </div>

          <!-- Recent clicks log -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:14px;flex:1;overflow:hidden;display:flex;flex-direction:column;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px;">
              <span style="font-size:0.85rem;font-weight:600;color:#94a3b8;">📋 Log click ghi được</span>
              <button id="cal-btn-clear-log" class="btn btn-secondary btn-sm">Xóa log</button>
            </div>
            <div id="cal-click-log" style="flex:1;overflow-y:auto;font-family:'JetBrains Mono',monospace;font-size:0.78rem;background:#0f172a;border-radius:8px;padding:10px;line-height:1.7;"></div>
          </div>

          <!-- Save / Reset -->
          <div style="display:flex;gap:10px;">
            <button id="cal-btn-save" class="btn btn-primary" style="flex:1;">
              <span class="icon">💾</span> Lưu Tọa Độ
            </button>
            <button id="cal-btn-reset" class="btn btn-secondary" style="min-width:130px;">
              <span class="icon">↺</span> Reset Mặc Định
            </button>
          </div>
        </div>

        <!-- RIGHT: Screenshot preview + coords table -->
        <div style="width:340px;flex-shrink:0;display:flex;flex-direction:column;gap:12px;">

          <!-- Live screenshot -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px;flex:0 0 auto;">
            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px;">
              <span style="font-size:0.83rem;font-weight:600;color:#94a3b8;">📺 Màn hình App</span>
              <label style="display:flex;align-items:center;gap:6px;font-size:0.75rem;color:#64748b;cursor:pointer;">
                <input type="checkbox" id="cal-auto-refresh" style="cursor:pointer;"> Tự động refresh
              </label>
            </div>
            <div id="cal-screenshot-wrap" style="background:#0f172a;border-radius:8px;min-height:200px;display:flex;align-items:center;justify-content:center;overflow:hidden;position:relative;">
              <span id="cal-screenshot-placeholder" style="color:#334155;font-size:0.85rem;">Chưa có ảnh chụp</span>
              <img id="cal-screenshot-img" style="max-width:100%;border-radius:6px;display:none;" alt="TNVN App Screenshot">
              <!-- Click dot overlay -->
              <div id="cal-click-dot" style="position:absolute;width:16px;height:16px;border-radius:50%;background:#ef4444;border:2px solid #fff;pointer-events:none;display:none;transform:translate(-50%,-50%);box-shadow:0 0 8px rgba(239,68,68,0.8);"></div>
            </div>
          </div>

          <!-- Coords table -->
          <div style="background:#1e293b;border:1px solid #334155;border-radius:12px;padding:12px;flex:1;overflow:hidden;display:flex;flex-direction:column;">
            <span style="font-size:0.83rem;font-weight:600;color:#94a3b8;margin-bottom:8px;display:block;">📐 Tọa Độ Đã Calibrate</span>
            <div style="flex:1;overflow-y:auto;">
              <table id="cal-coords-table" style="width:100%;border-collapse:collapse;font-size:0.75rem;">
                <thead>
                  <tr style="color:#64748b;text-align:left;border-bottom:1px solid #334155;">
                    <th style="padding:4px 6px;">Bước</th>
                    <th style="padding:4px 6px;text-align:center;">X%</th>
                    <th style="padding:4px 6px;text-align:center;">Y%</th>
                    <th style="padding:4px 6px;text-align:center;">Trạng thái</th>
                  </tr>
                </thead>
                <tbody id="cal-coords-tbody"></tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    `;
    contentViewport.appendChild(panel);
  }

  // ── Render bảng tọa độ ────────────────────────────────────────────────────
  function renderCoordsTable() {
    const tbody = document.getElementById('cal-coords-tbody');
    if (!tbody) return;
    tbody.innerHTML = '';
    STEPS.forEach(step => {
      const coord = currentCoords[step.key] || {};
      const isRecorded = !!recordedThisSession[step.key];
      const hasCoord = coord.rx !== undefined;
      const tr = document.createElement('tr');
      tr.style.borderBottom = '1px solid #1e293b';
      tr.style.background = isRecorded ? 'rgba(16,185,129,0.08)' : 'transparent';
      tr.innerHTML = `
        <td style="padding:5px 6px;color:#cbd5e1;font-size:0.73rem;">${step.label}</td>
        <td style="padding:5px 6px;text-align:center;font-family:'JetBrains Mono',monospace;color:${hasCoord ? '#06b6d4' : '#475569'};">
          ${hasCoord ? (coord.rx * 100).toFixed(1) + '%' : '—'}
        </td>
        <td style="padding:5px 6px;text-align:center;font-family:'JetBrains Mono',monospace;color:${hasCoord ? '#06b6d4' : '#475569'};">
          ${hasCoord ? (coord.ry * 100).toFixed(1) + '%' : '—'}
        </td>
        <td style="padding:5px 6px;text-align:center;">
          ${isRecorded ? '<span style="color:#10b981;font-size:0.8rem;">✅ Mới</span>' : (hasCoord ? '<span style="color:#64748b;font-size:0.8rem;">💾 Lưu</span>' : '<span style="color:#475569;font-size:0.8rem;">—</span>')}
        </td>
      `;
      tbody.appendChild(tr);
    });
  }

  // ── Load coords từ server ─────────────────────────────────────────────────
  async function loadCoords() {
    try {
      const res = await fetch('/api/mac/coordinates');
      const data = await res.json();
      if (data.success) {
        currentCoords = data.coords || {};
        renderCoordsTable();
      }
    } catch (e) {
      console.warn('[Calibrate] loadCoords error:', e);
    }
  }

  // ── Chụp screenshot ───────────────────────────────────────────────────────
  async function refreshScreenshot() {
    try {
      const res = await fetch('/api/mac/screenshot');
      if (!res.ok) return;
      const data = await res.json();
      if (data.success && data.image) {
        const img = document.getElementById('cal-screenshot-img');
        const placeholder = document.getElementById('cal-screenshot-placeholder');
        if (img && placeholder) {
          img.src = data.image;
          img.style.display = 'block';
          placeholder.style.display = 'none';
          img._natW = data.width;
          img._natH = data.height;
        }
      }
    } catch (e) {
      console.warn('[Calibrate] screenshot error:', e);
    }
  }

  // ── Hiện dot click trên preview ─────────────────────────────────────────
  function showClickDot(rx, ry) {
    const wrap = document.getElementById('cal-screenshot-wrap');
    const img = document.getElementById('cal-screenshot-img');
    const dot = document.getElementById('cal-click-dot');
    if (!wrap || !img || !dot || img.style.display === 'none') return;
    const rect = img.getBoundingClientRect();
    const wRect = wrap.getBoundingClientRect();
    const px = rect.left - wRect.left + rx * rect.width;
    const py = rect.top - wRect.top + ry * rect.height;
    dot.style.left = px + 'px';
    dot.style.top = py + 'px';
    dot.style.display = 'block';
    setTimeout(() => { dot.style.display = 'none'; }, 2000);
  }

  // ── Log click ─────────────────────────────────────────────────────────────
  function logClick(html) {
    const log = document.getElementById('cal-click-log');
    if (!log) return;
    const div = document.createElement('div');
    div.innerHTML = html;
    log.appendChild(div);
    log.scrollTop = log.scrollHeight;
  }

  // ── Cập nhật step guide ───────────────────────────────────────────────────
  function updateStepGuide() {
    const guide = document.getElementById('cal-step-guide');
    const numEl = document.getElementById('cal-step-num');
    const labelEl = document.getElementById('cal-step-label');
    const guideEl = document.getElementById('cal-step-guide-text');
    if (!guide) return;

    if (currentStepIndex < 0 || currentStepIndex >= STEPS.length) {
      guide.style.display = 'none';
      return;
    }
    const step = STEPS[currentStepIndex];
    guide.style.display = 'block';
    if (numEl) numEl.textContent = currentStepIndex + 1;
    if (labelEl) labelEl.textContent = step.label;
    if (guideEl) guideEl.textContent = step.guide;
  }

  // ── Bắt đầu recording SSE ─────────────────────────────────────────────────
  function startRecording() {
    if (recordingSSE) { recordingSSE.close(); recordingSSE = null; }

    currentStepIndex = 0;
    updateStepGuide();

    const statusEl = document.getElementById('cal-record-status');
    const startBtn = document.getElementById('cal-btn-start-record');
    const stopBtn = document.getElementById('cal-btn-stop-record');

    if (statusEl) statusEl.innerHTML = '<span style="color:#f59e0b;">🔴 Đang kết nối recorder...</span>';

    recordingSSE = new EventSource('/api/mac/record');

    recordingSSE.addEventListener('ready', (e) => {
      const data = JSON.parse(e.data);
      const b = data.bounds;
      if (statusEl) statusEl.innerHTML = `<span style="color:#10b981;">🟢 Đang ghi | Cửa sổ: ${Math.round(b.width)}×${Math.round(b.height)}</span>`;
      if (startBtn) startBtn.disabled = true;
      if (stopBtn) stopBtn.disabled = false;
      logClick(`<span style="color:#10b981;">[READY] Recorder khởi động — cửa sổ ${Math.round(b.width)}×${Math.round(b.height)} @ (${Math.round(b.x)},${Math.round(b.y)})</span>`);

      const winInfo = document.getElementById('cal-window-info');
      if (winInfo) winInfo.textContent = `"${b.name}" ${Math.round(b.width)}×${Math.round(b.height)} pid=${b.pid}`;

      updateStepGuide();
      refreshScreenshot();
    });

    recordingSSE.addEventListener('click', (e) => {
      const data = JSON.parse(e.data);
      const { rx, ry, absX, absY, index } = data;
      const step = STEPS[currentStepIndex];

      if (step) {
        // Lưu vào currentCoords
        currentCoords[step.key] = { rx, ry, label: step.label };
        recordedThisSession[step.key] = true;
        renderCoordsTable();
        showClickDot(rx, ry);

        logClick(`<span style="color:#06b6d4;">#${index} [${step.key}]</span> <span style="color:#f1f5f9;">${(rx*100).toFixed(1)}%, ${(ry*100).toFixed(1)}%</span> <span style="color:#64748b;">abs(${Math.round(absX)},${Math.round(absY)})</span>`);

        // Chuyển bước tiếp theo
        currentStepIndex++;
        if (currentStepIndex >= STEPS.length) {
          updateStepGuide();
          if (statusEl) statusEl.innerHTML = '<span style="color:#10b981;">✅ Đã ghi xong tất cả bước! Bấm Lưu Tọa Độ.</span>';
          logClick(`<span style="color:#10b981;font-weight:bold;">✅ Hoàn thành! Đã ghi tất cả ${STEPS.length} bước. Bấm "Lưu Tọa Độ" để áp dụng.</span>`);
          stopRecording();
        } else {
          updateStepGuide();
          refreshScreenshot();
        }
      } else {
        logClick(`<span style="color:#f59e0b;">Click thêm: ${(rx*100).toFixed(1)}%, ${(ry*100).toFixed(1)}%</span>`);
      }
    });

    recordingSSE.addEventListener('error', (e) => {
      try {
        const data = JSON.parse(e.data);
        logClick(`<span style="color:#ef4444;">❌ Lỗi: ${data.message}</span>`);
        if (statusEl) statusEl.innerHTML = `<span style="color:#ef4444;">❌ ${data.message}</span>`;
      } catch {
        if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">❌ Mất kết nối recorder</span>';
      }
      stopRecording();
    });

    recordingSSE.onerror = () => {
      if (statusEl) statusEl.innerHTML = '<span style="color:#ef4444;">❌ Mất kết nối SSE</span>';
      stopRecording();
    };
  }

  // ── Dừng recording ────────────────────────────────────────────────────────
  function stopRecording() {
    if (recordingSSE) { recordingSSE.close(); recordingSSE = null; }
    fetch('/api/mac/record/stop', { method: 'POST' }).catch(() => {});
    const startBtn = document.getElementById('cal-btn-start-record');
    const stopBtn = document.getElementById('cal-btn-stop-record');
    const guide = document.getElementById('cal-step-guide');
    if (startBtn) startBtn.disabled = false;
    if (stopBtn) stopBtn.disabled = true;
    if (guide) guide.style.display = 'none';
    currentStepIndex = -1;
  }

  // ── Lưu tọa độ ───────────────────────────────────────────────────────────
  async function saveCoords() {
    try {
      const res = await fetch('/api/mac/coordinates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ coords: currentCoords }),
      });
      const data = await res.json();
      if (data.success) {
        recordedThisSession = {};
        renderCoordsTable();
        logClick(`<span style="color:#10b981;font-weight:bold;">💾 Đã lưu tọa độ thành công!</span>`);
        alert('✅ Đã lưu tọa độ calibration! Tool sẽ dùng tọa độ này trong lần chạy tiếp theo.');
      } else {
        alert('❌ Lưu thất bại: ' + data.error);
      }
    } catch (e) {
      alert('❌ Lỗi kết nối server');
    }
  }

  // ── Reset tọa độ ──────────────────────────────────────────────────────────
  async function resetCoords() {
    if (!confirm('⚠️ Reset về tọa độ mặc định? Mọi calibration hiện tại sẽ bị mất!')) return;
    try {
      const res = await fetch('/api/mac/coordinates/reset', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        recordedThisSession = {};
        await loadCoords();
        logClick(`<span style="color:#f59e0b;">↺ Đã reset về tọa độ mặc định</span>`);
      }
    } catch (e) { alert('❌ Lỗi kết nối server'); }
  }

  // ── Init ──────────────────────────────────────────────────────────────────
  function init() {
    injectCalibratePanelHTML();
    loadCoords();

    // Tab switch
    document.addEventListener('click', (e) => {
      const btn = e.target.closest('[data-tab="tab-calibrate"]');
      if (btn) {
        loadCoords();
        refreshScreenshot();
      }
    });

    // Mở app
    document.getElementById('cal-btn-open-app')?.addEventListener('click', async () => {
      try {
        const res = await fetch('/api/mac/open', { method: 'POST' });
        const data = await res.json();
        const info = document.getElementById('cal-window-info');
        if (data.bounds && info) {
          const b = data.bounds;
          info.textContent = `"${b.name}" ${Math.round(b.width)}×${Math.round(b.height)} @ (${Math.round(b.x)},${Math.round(b.y)})`;
          info.style.color = '#10b981';
        }
        setTimeout(refreshScreenshot, 1500);
      } catch {}
    });

    // Chụp screenshot
    document.getElementById('cal-btn-screenshot')?.addEventListener('click', refreshScreenshot);

    // Auto-refresh toggle
    document.getElementById('cal-auto-refresh')?.addEventListener('change', (e) => {
      if (e.target.checked) {
        screenshotInterval = setInterval(refreshScreenshot, 2000);
      } else {
        clearInterval(screenshotInterval);
        screenshotInterval = null;
      }
    });

    // Bắt đầu ghi
    document.getElementById('cal-btn-start-record')?.addEventListener('click', startRecording);

    // Dừng ghi
    document.getElementById('cal-btn-stop-record')?.addEventListener('click', stopRecording);

    // Lưu
    document.getElementById('cal-btn-save')?.addEventListener('click', saveCoords);

    // Reset
    document.getElementById('cal-btn-reset')?.addEventListener('click', resetCoords);

    // Xóa log
    document.getElementById('cal-btn-clear-log')?.addEventListener('click', () => {
      const log = document.getElementById('cal-click-log');
      if (log) log.innerHTML = '';
    });
  }

  // Chờ DOM load xong
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
