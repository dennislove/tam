/**
 * mac_check.js — Module Kiểm Tra Đăng Nhập Hàng Loạt (Account Checker)
 * Tự động kiểm tra tài khoản trên app TNVN (macOS), cập nhật trạng thái thời gian thực.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    isRunning: false,
    currentAccount: '',
    stats: { total: 0, checked: 0, ok: 0, fail: 0 },
    accounts: [],
    lots: [],
    results: {}, // username -> { status, error, checked_at, index, lotId, password }
    filter: 'all', // 'all' | 'fail' | 'ok'
    searchQuery: '',
  };

  // ── DOM Elements Cache ─────────────────────────────────────────────────────
  let dom = {};

  function initDom() {
    dom = {
      tabNavBtn: document.getElementById('tab-nav-check'),
      badgeCheckCount: document.getElementById('badge-check-count'),
      btnJumpToCheck: document.getElementById('btn-jump-to-check'),

      // Controls
      selectLot: document.getElementById('select-check-lot'),
      selectStart: document.getElementById('select-check-start'),
      selectLimit: document.getElementById('select-check-limit'),
      chkRecheckFailed: document.getElementById('chk-recheck-failed'),
      btnStart: document.getElementById('btn-start-check'),
      btnStop: document.getElementById('btn-stop-check'),

      // Status
      statusBadge: document.getElementById('check-status-badge'),
      currentAccText: document.getElementById('check-current-acc'),
      currentLotText: document.getElementById('check-current-lot'),

      // Stats
      statTotal: document.getElementById('stat-check-total'),
      statDone: document.getElementById('stat-check-done'),
      statOk: document.getElementById('stat-check-ok'),
      statFail: document.getElementById('stat-check-fail'),

      // Filters
      inputSearch: document.getElementById('input-search-check'),
      filterChips: document.querySelectorAll('[data-check-filter]'),
      filterAllCount: document.getElementById('filter-check-all-count'),
      filterFailCount: document.getElementById('filter-check-fail-count'),
      filterOkCount: document.getElementById('filter-check-ok-count'),

      // Table
      tbody: document.getElementById('tbody-check-results'),

      // Action Buttons
      btnAddFailedToBackup: document.getElementById('btn-add-failed-to-backup'),
      btnClearBackupLot: document.getElementById('btn-clear-backup-lot'),
      btnExportFailed: document.getElementById('btn-export-failed-check'),
      btnDownloadJson: document.getElementById('btn-download-check-json'),
      btnClearHistory: document.getElementById('btn-clear-check-history'),
    };
  }

  // ── Helpers ────────────────────────────────────────────────────────────────
  function showToast(message, isError = false) {
    let toast = document.getElementById('app-floating-toast');
    if (!toast) {
      toast = document.createElement('div');
      toast.id = 'app-floating-toast';
      toast.style.cssText = `
        position: fixed;
        bottom: 28px;
        right: 28px;
        padding: 12px 20px;
        background: #1e293b;
        color: #fff;
        border-radius: 10px;
        box-shadow: 0 10px 25px rgba(0,0,0,0.5);
        font-size: 0.88rem;
        font-weight: 600;
        z-index: 99999;
        display: flex;
        align-items: center;
        gap: 10px;
        border: 1px solid rgba(255,255,255,0.15);
        transition: all 0.3s cubic-bezier(0.4, 0, 0.2, 1);
        transform: translateY(20px);
        opacity: 0;
        pointer-events: none;
      `;
      document.body.appendChild(toast);
    }

    toast.style.borderColor = isError ? '#f43f5e' : '#10b981';
    toast.innerHTML = `${isError ? '⚠️' : '✅'} <span>${message}</span>`;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';

    clearTimeout(toast._timeout);
    toast._timeout = setTimeout(() => {
      toast.style.transform = 'translateY(20px)';
      toast.style.opacity = '0';
    }, 3200);
  }

  // ── Data Fetching ──────────────────────────────────────────────────────────
  async function loadLots() {
    try {
      const res = await fetch('/api/lots');
      const data = await res.json();
      if (data.success && Array.isArray(data.lots)) {
        state.lots = data.lots;
        if (dom.selectLot) {
          const currentVal = dom.selectLot.value;
          dom.selectLot.innerHTML = '<option value="">Tất cả các lô</option>';
          data.lots.forEach((lot) => {
            const opt = document.createElement('option');
            opt.value = lot.id;
            opt.textContent = `${lot.name} (${lot.accountCount || 0} acc)`;
            dom.selectLot.appendChild(opt);
          });
          dom.selectLot.value = currentVal || '';
        }
      }
    } catch (err) {
      console.warn('[Check] Không thể tải danh sách lô:', err);
    }
  }

  async function loadAccounts() {
    try {
      const lotId = dom.selectLot ? dom.selectLot.value : '';
      const url = lotId ? `/api/accounts?lotId=${encodeURIComponent(lotId)}` : '/api/accounts';
      const res = await fetch(url);
      const data = await res.json();
      if (data.success && Array.isArray(data.accounts)) {
        state.accounts = data.accounts;
        renderStartAccountDropdown();
      }
    } catch (err) {
      console.warn('[Check] Không thể tải danh sách tài khoản:', err);
    }
  }

  function renderStartAccountDropdown() {
    if (!dom.selectStart) return;
    const currentVal = dom.selectStart.value;
    dom.selectStart.innerHTML = '';

    if (state.accounts.length === 0) {
      dom.selectStart.innerHTML = '<option value="1">Không có tài khoản nào</option>';
      return;
    }

    state.accounts.forEach((acc, idx) => {
      const opt = document.createElement('option');
      const num = acc.index || idx + 1;
      opt.value = num;
      opt.textContent = `#${num} - ${acc.username}`;
      dom.selectStart.appendChild(opt);
    });

    dom.selectStart.value = currentVal && state.accounts.some((a) => (a.index || 1) == currentVal) ? currentVal : '1';
  }

  async function loadCheckResults() {
    try {
      const res = await fetch('/api/mac/check/results');
      const data = await res.json();
      if (data.success && data.results) {
        state.results = data.results;
        updateStats();
        renderTable();
      }
    } catch (err) {
      console.warn('[Check] Không thể tải kết quả check:', err);
    }
  }

  async function checkInitialStatus() {
    try {
      const res = await fetch('/api/mac/check/status');
      const data = await res.json();
      updateRunningUI(data.running, data.currentAccount, data.stats);
    } catch (err) {
      console.warn('[Check] Không thể kiểm tra status:', err);
    }
  }

  // ── UI Updates ─────────────────────────────────────────────────────────────
  function updateRunningUI(running, currentAccount = '', stats = null) {
    state.isRunning = running;
    if (currentAccount) state.currentAccount = currentAccount;
    if (stats) {
      state.stats = { ...state.stats, ...stats };
    }

    if (dom.btnStart) {
      if (running) {
        dom.btnStart.classList.add('hidden');
        dom.btnStop.classList.remove('hidden');
      } else {
        dom.btnStart.classList.remove('hidden');
        dom.btnStop.classList.add('hidden');
      }
    }

    if (dom.statusBadge) {
      if (running) {
        dom.statusBadge.textContent = '⚡ Đang kiểm tra...';
        dom.statusBadge.className = 'badge badge-warning pulse-glow';
        dom.statusBadge.style.background = 'rgba(245, 158, 11, 0.2)';
        dom.statusBadge.style.color = '#fbbf24';
        dom.statusBadge.style.border = '1px solid rgba(245, 158, 11, 0.4)';
      } else {
        dom.statusBadge.textContent = 'Sẵn sàng';
        dom.statusBadge.className = 'badge';
        dom.statusBadge.style.background = '';
        dom.statusBadge.style.color = '';
        dom.statusBadge.style.border = '';
      }
    }

    if (dom.currentAccText) {
      dom.currentAccText.textContent = running ? (state.currentAccount || 'Đang khởi động...') : 'Chưa có';
    }

    if (dom.currentLotText && dom.selectLot) {
      const selectedOpt = dom.selectLot.selectedOptions?.[0];
      dom.currentLotText.textContent = selectedOpt ? selectedOpt.textContent : 'Tất cả';
    }

    updateStats();
  }

  function updateStats() {
    const items = Object.values(state.results || {});
    const okCount = items.filter((i) => i.status === 'OK').length;
    const failCount = items.filter((i) => i.status === 'FAIL').length;
    const totalCount = state.stats.total > 0 ? state.stats.total : (state.accounts.length || items.length);
    const doneCount = state.stats.checked > 0 ? state.stats.checked : items.length;

    if (dom.statTotal) dom.statTotal.textContent = totalCount;
    if (dom.statDone) dom.statDone.textContent = `${doneCount} (${totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%)`;
    if (dom.statOk) dom.statOk.textContent = okCount;
    if (dom.statFail) dom.statFail.textContent = failCount;

    if (dom.filterAllCount) dom.filterAllCount.textContent = items.length;
    if (dom.filterFailCount) dom.filterFailCount.textContent = failCount;
    if (dom.filterOkCount) dom.filterOkCount.textContent = okCount;

    if (dom.badgeCheckCount) {
      if (failCount > 0) {
        dom.badgeCheckCount.style.display = 'inline-flex';
        dom.badgeCheckCount.textContent = `${failCount} lỗi`;
        dom.badgeCheckCount.style.background = 'rgba(244, 63, 94, 0.2)';
        dom.badgeCheckCount.style.color = '#f87171';
        dom.badgeCheckCount.style.border = '1px solid rgba(244, 63, 94, 0.4)';
      } else if (items.length > 0) {
        dom.badgeCheckCount.style.display = 'inline-flex';
        dom.badgeCheckCount.textContent = `${items.length} xong`;
        dom.badgeCheckCount.style.background = 'rgba(16, 185, 129, 0.2)';
        dom.badgeCheckCount.style.color = '#34d399';
        dom.badgeCheckCount.style.border = '1px solid rgba(16, 185, 129, 0.4)';
      } else {
        dom.badgeCheckCount.style.display = 'none';
      }
    }
  }

  function renderTable() {
    if (!dom.tbody) return;
    const items = Object.entries(state.results || {}).map(([username, val]) => ({
      username,
      ...val,
    }));

    // Sắp xếp: Mới nhất lên đầu hoặc theo thứ tự index
    items.sort((a, b) => {
      if (a.checked_at && b.checked_at) {
        return new Date(b.checked_at).getTime() - new Date(a.checked_at).getTime();
      }
      return (b.index || 0) - (a.index || 0);
    });

    const query = (state.searchQuery || '').trim().toLowerCase();
    const filtered = items.filter((item) => {
      // Lọc theo filter chip
      if (state.filter === 'fail' && item.status === 'OK') return false;
      if (state.filter === 'ok' && item.status !== 'OK') return false;

      // Lọc theo search input
      if (query) {
        const u = (item.username || '').toLowerCase();
        const err = (item.error || '').toLowerCase();
        const lot = (item.lotId || '').toLowerCase();
        return u.includes(query) || err.includes(query) || lot.includes(query);
      }
      return true;
    });

    if (filtered.length === 0) {
      dom.tbody.innerHTML = `
        <tr>
          <td colspan="6" class="text-center text-muted py-4">
            ${items.length === 0 ? 'Chưa có dữ liệu kiểm tra. Hãy bấm "Bắt Đầu Check" ở trên.' : 'Không tìm thấy tài khoản phù hợp với bộ lọc.'}
          </td>
        </tr>
      `;
      return;
    }

    dom.tbody.innerHTML = filtered
      .map((item, idx) => {
        const isOk = item.status === 'OK';
        const isOverload = item.status === 'OVERLOAD' || (item.error && (item.error.includes('504') || item.error.includes('quá tải') || item.error.includes('Timeout') || item.error.includes('thử lại')));

        let statusBadge = '';
        let errorText = '';
        if (isOk) {
          statusBadge = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">✅ HỢP LỆ (OK)</span>`;
          errorText = `<span style="color: #64748b; font-style: italic;">Đăng nhập thành công</span>`;
        } else if (isOverload) {
          statusBadge = `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">⏳ APP QUÁ TẢI (CHỜ)</span>`;
          errorText = `<span style="color: #fde047; font-weight: 600;">⏳ ${escapeHtml(item.error || 'Server quá tải / 504')} (Tài khoản chuẩn)</span>`;
        } else {
          statusBadge = `<span class="badge" style="background: rgba(244, 63, 94, 0.2); color: #f87171; border: 1px solid rgba(244, 63, 94, 0.4); padding: 4px 10px; border-radius: 6px; font-weight: 700; font-size: 0.8rem;">❌ SAI MẬT KHẨU</span>`;
          errorText = `<span style="color: #fca5a5; font-weight: 600;">⚠️ ${escapeHtml(item.error || 'Sai thông tin')}</span>`;
        }

        const lotLabel = item.lotId ? `<span class="badge" style="background: rgba(56, 189, 248, 0.12); color: #38bdf8; font-size: 0.78rem;">${escapeHtml(item.lotId)}</span>` : '<span class="text-muted">--</span>';

        return `
          <tr style="${!isOk ? 'background: rgba(244, 63, 94, 0.04);' : ''}">
            <td style="font-weight: 600; color: var(--text-muted);">#${item.index || idx + 1}</td>
            <td>
              <div style="font-weight: 600; color: #f1f5f9; font-family: var(--font-mono); font-size: 0.88rem;">${escapeHtml(item.username)}</div>
            </td>
            <td class="lot-feature-hidden">${lotLabel}</td>
            <td style="text-align: center;">${statusBadge}</td>
            <td>${errorText}</td>
            <td style="font-size: 0.82rem; color: var(--text-muted);">${item.checked_at || '--'}</td>
            <td style="text-align: right; white-space: nowrap;">
              <button class="btn btn-warning btn-xs btn-add-one-to-backup lot-feature-hidden" data-user="${escapeHtml(item.username)}" data-pass="${escapeHtml(item.password || '')}" data-err="${escapeHtml(item.error || '')}" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4); margin-right: 4px;" title="Thêm tài khoản này vào Lô Dự Phòng">
                🛡️ +Dự Phòng
              </button>
              <button class="btn btn-ghost btn-xs btn-copy-one-acc" data-user="${escapeHtml(item.username)}" data-pass="${escapeHtml(item.password || '')}" title="Copy tài khoản">
                📋 Copy
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    // Attach copy buttons
    dom.tbody.querySelectorAll('.btn-copy-one-acc').forEach((btn) => {
      btn.addEventListener('click', () => {
        const user = btn.getAttribute('data-user');
        const pass = btn.getAttribute('data-pass');
        const str = pass ? `${user}|${pass}` : user;
        navigator.clipboard.writeText(str).then(() => {
          showToast(`Đã copy: ${user}`);
        });
      });
    });

    // Attach add to backup buttons
    dom.tbody.querySelectorAll('.btn-add-one-to-backup').forEach((btn) => {
      btn.addEventListener('click', async () => {
        const username = btn.getAttribute('data-user');
        const password = btn.getAttribute('data-pass');
        const error = btn.getAttribute('data-err');
        try {
          const res = await fetch('/api/backup-lot/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password, error }),
          });
          const data = await res.json();
          if (data.success) {
            showToast(`Đã thêm [${username}] vào Lô Dự Phòng!`);
            if (typeof window.reloadAllLots === 'function') window.reloadAllLots();
          } else {
            showToast(data.message || 'Lỗi thêm vào Lô Dự Phòng', true);
          }
        } catch (err) {
          showToast('Lỗi kết nối máy chủ', true);
        }
      });
    });
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }

  // ── Actions ────────────────────────────────────────────────────────────────
  async function startCheck() {
    const lotId = dom.selectLot ? dom.selectLot.value : undefined;
    const startFromIndex = dom.selectStart ? parseInt(dom.selectStart.value, 10) || 1 : 1;
    const limitVal = dom.selectLimit ? dom.selectLimit.value : undefined;
    const limit = limitVal ? parseInt(limitVal, 10) : undefined;
    const recheckFailed = dom.chkRecheckFailed ? dom.chkRecheckFailed.checked : false;

    updateRunningUI(true, 'Đang gửi lệnh bắt đầu...');

    try {
      const res = await fetch('/api/mac/check/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ lotId, startFromIndex, limit, recheckFailed }),
      });
      const data = await res.json();
      if (!data.success) {
        showToast('Không thể bắt đầu: ' + data.message, true);
        updateRunningUI(false);
      } else {
        showToast('Đã bắt đầu kiểm tra tài khoản!');
      }
    } catch (err) {
      showToast('Lỗi kết nối máy chủ: ' + err.message, true);
      updateRunningUI(false);
    }
  }

  async function stopCheck() {
    try {
      await fetch('/api/mac/check/stop', { method: 'POST' });
      showToast('Đã gửi lệnh dừng kiểm tra tài khoản!');
      updateRunningUI(false);
    } catch (err) {
      showToast('Lỗi dừng: ' + err.message, true);
    }
  }

  async function clearHistory() {
    if (!confirm('Bạn có chắc chắn muốn xóa toàn bộ lịch sử kiểm tra tài khoản đã lưu không?')) return;
    try {
      const res = await fetch('/api/mac/check/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        state.results = {};
        state.stats = { total: 0, checked: 0, ok: 0, fail: 0 };
        updateStats();
        renderTable();
        showToast('Đã xóa sạch lịch sử check!');
      }
    } catch (err) {
      showToast('Lỗi xóa lịch sử: ' + err.message, true);
    }
  }

  function exportFailedAccounts() {
    const items = Object.entries(state.results || {})
      .map(([username, val]) => ({ username, ...val }))
      .filter((i) => i.status === 'FAIL');

    if (items.length === 0) {
      showToast('Hiện không có tài khoản lỗi nào!', true);
      return;
    }

    const lines = items.map((i) => `${i.username}${i.password ? `|${i.password}` : ''} | Lỗi: ${i.error || 'FAIL'}`);
    const text = lines.join('\n');

    navigator.clipboard.writeText(text).then(() => {
      showToast(`Đã copy ${items.length} tài khoản lỗi vào Clipboard!`);
    });
  }

  function downloadJsonResults() {
    const items = state.results || {};
    const count = Object.keys(items).length;
    if (count === 0) {
      showToast('Chưa có kết quả để tải về!', true);
      return;
    }

    const jsonStr = JSON.stringify(items, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `check_accounts_result_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast(`Đã tải về file kết quả (${count} tài khoản)!`);
  }

  async function addFailedToBackupLot() {
    const items = Object.values(state.results || {}).filter(
      (i) => i.status !== 'OK'
    );
    if (items.length === 0) {
      showToast('Hiện không có tài khoản lỗi nào để thêm vào Lô Dự Phòng!', true);
      return;
    }

    try {
      const payload = items.map((i) => ({
        username: i.username,
        password: i.password,
        error: i.error || 'Tài khoản lỗi cần thi lại',
      }));

      const res = await fetch('/api/backup-lot/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: payload }),
      });
      const data = await res.json();
      if (data.success) {
        showToast(`✅ Đã thêm ${items.length} tài khoản vào Lô Dự Phòng (Tổng: ${data.total})!`);
        if (typeof window.reloadAllLots === 'function') window.reloadAllLots();
      } else {
        showToast(data.message || 'Lỗi thêm vào Lô Dự Phòng', true);
      }
    } catch (err) {
      showToast('Lỗi kết nối máy chủ', true);
    }
  }

  async function clearBackupLot() {
    if (!confirm('Bạn có chắc chắn muốn làm trống toàn bộ tài khoản trong Lô Dự Phòng?')) return;
    try {
      const res = await fetch('/api/backup-lot', { method: 'DELETE' });
      const data = await res.json();
      showToast(data.message || 'Đã làm trống Lô Dự Phòng');
      if (typeof window.reloadAllLots === 'function') window.reloadAllLots();
    } catch (err) {
      showToast('Lỗi khi xóa Lô Dự Phòng', true);
    }
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────
  function setupEventListeners() {
    // Start / Stop
    if (dom.btnStart) dom.btnStart.addEventListener('click', () => startCheck());
    if (dom.btnStop) dom.btnStop.addEventListener('click', () => stopCheck());

    // Lot change -> reload accounts dropdown
    if (dom.selectLot) {
      dom.selectLot.addEventListener('change', () => {
        loadAccounts();
        if (dom.currentLotText) {
          const selectedOpt = dom.selectLot.selectedOptions?.[0];
          dom.currentLotText.textContent = selectedOpt ? selectedOpt.textContent : 'Tất cả';
        }
      });
    }

    // Export / Download / Clear / Backup Lot
    if (dom.btnAddFailedToBackup) dom.btnAddFailedToBackup.addEventListener('click', () => addFailedToBackupLot());
    if (dom.btnClearBackupLot) dom.btnClearBackupLot.addEventListener('click', () => clearBackupLot());
    if (dom.btnExportFailed) dom.btnExportFailed.addEventListener('click', () => exportFailedAccounts());
    if (dom.btnDownloadJson) dom.btnDownloadJson.addEventListener('click', () => downloadJsonResults());
    if (dom.btnClearHistory) dom.btnClearHistory.addEventListener('click', () => clearHistory());

    // Filter Chips
    if (dom.filterChips) {
      dom.filterChips.forEach((chip) => {
        chip.addEventListener('click', () => {
          dom.filterChips.forEach((c) => c.classList.remove('active'));
          chip.classList.add('active');
          state.filter = chip.getAttribute('data-check-filter') || 'all';
          renderTable();
        });
      });
    }

    // Search input
    if (dom.inputSearch) {
      dom.inputSearch.addEventListener('input', (e) => {
        state.searchQuery = e.target.value;
        renderTable();
      });
    }

    // Shortcut button from Accounts tab
    if (dom.btnJumpToCheck) {
      dom.btnJumpToCheck.addEventListener('click', () => {
        if (dom.tabNavBtn) dom.tabNavBtn.click();
      });
    }

    // Listen to real-time events forwarded from app.js SSE
    window.addEventListener('mac_check_event', (e) => {
      const eventData = e.detail;
      if (!eventData) return;

      if (eventData.type === 'start') {
        updateRunningUI(true, 'Bắt đầu kiểm tra...', { total: eventData.total });
      } else if (eventData.type === 'account_start') {
        updateRunningUI(true, `${eventData.username} (#${eventData.index})`, {
          total: eventData.total,
          checked: (eventData.current || 1) - 1,
        });
      } else if (eventData.type === 'account_done') {
        // Cập nhật kết quả tài khoản vừa xong
        const u = eventData.username;
        if (u) {
          state.results[u] = {
            status: eventData.status,
            error: eventData.error || '',
            checked_at: eventData.checked_at,
            index: eventData.index,
            lotId: eventData.lotId || '',
          };
        }
        updateRunningUI(true, `${eventData.username} [${eventData.status}]`, {
          checked: eventData.current,
          ok: eventData.okCount,
          fail: eventData.failCount,
        });
        renderTable();
      } else if (eventData.type === 'finish' || eventData.type === 'stopped') {
        updateRunningUI(false, eventData.type === 'finish' ? 'Đã hoàn tất toàn bộ' : 'Đã dừng');
        loadCheckResults();
      } else if (eventData.type === 'cleared') {
        state.results = {};
        updateStats();
        renderTable();
      }
    });
  }

  // ── Init on DOM Ready ──────────────────────────────────────────────────────
  function init() {
    initDom();
    setupEventListeners();
    loadLots();
    loadAccounts();
    loadCheckResults();
    checkInitialStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
