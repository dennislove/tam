// ============================================================
// TNVN AUTO EXAM PRO - CLIENT APPLICATION LOGIC
// ============================================================

(function () {
  'use strict';

  // --- APPLICATION STATE ---
  const state = {
    runner: {
      status: 'idle',
      activeBannerId: 'banner_1',
      currentAccount: null,
      currentDevice: null,
      waitingDetails: null,
      stats: { total: 0, completed: 0, failed: 0 },
    },
    banners: [],
    currentBannerId: 'banner_1',
    bannerAnswers: [],
    accounts: [],
    devices: [],
    selectedAccountUsernames: new Set(),
    accountFilter: 'all',
    accountSearchQuery: '',
    questionSearchQuery: '',
    autoscroll: true,
  };

  // --- AUDIO SYNTHESIS NOTIFICATION (No external files needed) ---
  function playAlertChime() {
    try {
      const AudioContext = window.AudioContext || window.webkitAudioContext;
      if (!AudioContext) return;
      const ctx = new AudioContext();

      const playTone = (freq, time, duration) => {
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, time);
        gain.gain.setValueAtTime(0.15, time);
        gain.gain.exponentialRampToValueAtTime(0.001, time + duration);
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.start(time);
        osc.stop(time + duration);
      };

      const now = ctx.currentTime;
      playTone(523.25, now, 0.2); // C5
      playTone(659.25, now + 0.15, 0.2); // E5
      playTone(783.99, now + 0.3, 0.35); // G5
    } catch {}
  }

  // ============================================================
  // DOM REFERENCES
  // ============================================================
  const dom = {
    // Navigation
    tabBtns: document.querySelectorAll('.tab-btn'),
    tabPanes: document.querySelectorAll('.tab-pane'),
    globalStatusBadge: document.getElementById('global-status-badge'),
    globalStatusText: document.getElementById('global-status-text'),
    currentActiveBannerPill: document.getElementById('current-active-banner-pill'),
    pillBannerName: document.getElementById('pill-banner-name'),
    btnReconnectAdb: document.getElementById('btn-reconnect-adb'),

    // Banner wait alert
    bannerAlert: document.getElementById('banner-alert-banner'),
    waitDeviceName: document.getElementById('wait-device-name'),
    waitAccountName: document.getElementById('wait-account-name'),
    btnResumeRun: document.getElementById('btn-resume-run'),

    // Sidebar Stats
    progressBarFill: document.getElementById('progress-bar-fill'),
    statTotal: document.getElementById('stat-total'),
    statCompleted: document.getElementById('stat-completed'),
    statFailed: document.getElementById('stat-failed'),
    badgeTotalAccounts: document.getElementById('badge-total-accounts'),

    // Dashboard controls
    selectBanner: document.getElementById('select-banner'),
    selectDevice: document.getElementById('select-device'),
    selectStartAccount: document.getElementById('select-start-account'),
    btnStartRun: document.getElementById('btn-start-run'),
    btnStopRun: document.getElementById('btn-stop-run'),
    btnRunFailedOnly: document.getElementById('btn-run-failed-only'),

    // Info card
    infoStatusBadge: document.getElementById('info-status-badge'),
    infoCurrentAcc: document.getElementById('info-current-acc'),
    infoCurrentDevice: document.getElementById('info-current-device'),
    infoCurrentBanner: document.getElementById('info-current-banner'),

    // Console
    consoleOutput: document.getElementById('console-output'),
    chkAutoscroll: document.getElementById('chk-autoscroll'),
    btnClearLogs: document.getElementById('btn-clear-logs'),

    // Accounts
    tbodyAccounts: document.getElementById('tbody-accounts'),
    inputSearchAccount: document.getElementById('input-search-account'),
    filterChips: document.querySelectorAll('.filter-chip'),
    chkSelectAllAccs: document.getElementById('chk-select-all-accs'),
    btnRunSelectedAccounts: document.getElementById('btn-run-selected-accounts'),
    selectedAccCount: document.getElementById('selected-acc-count'),
    countFilterAll: document.getElementById('count-filter-all'),
    countFilterPending: document.getElementById('count-filter-pending'),
    countFilterSuccess: document.getElementById('count-filter-success'),
    countFilterError: document.getElementById('count-filter-error'),
    btnOpenAddAccModal: document.getElementById('btn-open-add-acc-modal'),
    btnOpenImportAccModal: document.getElementById('btn-open-import-acc-modal'),
    btnResetAllStatuses: document.getElementById('btn-reset-all-statuses'),

    // Banners manager
    bannerSubtabsList: document.getElementById('banner-subtabs-list'),
    inputBannerTitle: document.getElementById('input-banner-title'),
    btnUpdateBannerMeta: document.getElementById('btn-update-banner-meta'),
    btnSetAsActiveBanner: document.getElementById('btn-set-as-active-banner'),
    btnOpenRename: document.getElementById('btn-open-rename'),
    btnCancelRename: document.getElementById('btn-cancel-rename'),
    titleDisplayBox: document.getElementById('title-display-box'),
    titleRenameBox: document.getElementById('title-rename-box'),
    btnToggleJsonEditor: document.getElementById('btn-toggle-json-editor'),
    jsonEditorContainer: document.getElementById('json-editor-container'),
    lblActiveEditorBannerName: document.getElementById('lbl-active-editor-banner-name'),
    textareaJsonAnswers: document.getElementById('textarea-json-answers'),
    jsonAnswersStatus: document.getElementById('json-answers-status'),
    btnFormatJsonAnswers: document.getElementById('btn-format-json-answers'),
    btnSampleJsonAnswers: document.getElementById('btn-sample-json-answers'),
    btnSaveCurrentBannerAnswers: document.getElementById('btn-save-current-banner-answers'),

    // Modals
    modalScreenshotPreview: document.getElementById('modal-screenshot-preview'),
    imgScreenshotFull: document.getElementById('img-screenshot-full'),
    btnDownloadScreenshot: document.getElementById('btn-download-screenshot'),
    btnCloseScreenshotModal: document.getElementById('btn-close-screenshot-modal'),
    btnDismissScreenshotModal: document.getElementById('btn-dismiss-screenshot-modal'),

    modalJsonAccounts: document.getElementById('modal-json-accounts'),
    textareaJsonAccounts: document.getElementById('textarea-json-accounts'),
    btnCancelJsonAccounts: document.getElementById('btn-cancel-json-accounts'),
    btnConfirmSaveJsonAccounts: document.getElementById('btn-confirm-save-json-accounts'),
    btnCloseJsonAccountsModal: document.getElementById('btn-close-json-accounts-modal'),

    modalAddAccount: document.getElementById('modal-add-account'),
    inputNewAccUsername: document.getElementById('input-new-acc-username'),
    inputNewAccPassword: document.getElementById('input-new-acc-password'),
    btnCancelAddAcc: document.getElementById('btn-cancel-add-acc'),
    btnConfirmAddAcc: document.getElementById('btn-confirm-add-acc'),
    btnCloseAddAccModal: document.getElementById('btn-close-add-acc-modal'),

    // Settings
    btnTriggerLdplayerConnect: document.getElementById('btn-trigger-ldplayer-connect'),
  };

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  dom.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');
      dom.tabBtns.forEach((b) => b.classList.remove('active'));
      dom.tabPanes.forEach((p) => p.classList.remove('active'));

      btn.classList.add('active');
      const targetPane = document.getElementById(targetId);
      if (targetPane) targetPane.classList.add('active');
    });
  });

  // ============================================================
  // SERVER-SENT EVENTS (SSE) STREAM
  // ============================================================
  let eventSource = null;

  function connectSse() {
    if (eventSource) eventSource.close();

    eventSource = new EventSource('/api/events');

    eventSource.addEventListener('runner_state', (e) => {
      try {
        const data = JSON.parse(e.data);
        updateRunnerState(data);
      } catch (err) {
        console.error('Lỗi parse runner_state:', err);
      }
    });

    eventSource.addEventListener('waiting_banner', (e) => {
      try {
        const data = JSON.parse(e.data);
        state.runner.status = 'waiting_banner';
        state.runner.waitingDetails = data;
        renderBannerAlert(data);
        playAlertChime();
      } catch (err) {
        console.error('Lỗi parse waiting_banner:', err);
      }
    });

    eventSource.addEventListener('banner_resumed', () => {
      state.runner.status = 'running';
      state.runner.waitingDetails = null;
      dom.bannerAlert.classList.add('hidden');
    });

    eventSource.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse(e.data);
        appendLogEntry(entry);
      } catch (err) {
        console.error('Lỗi parse log:', err);
      }
    });

    eventSource.addEventListener('clear_logs', () => {
      dom.consoleOutput.innerHTML = '';
    });

    eventSource.onerror = () => {
      console.warn('[SSE] Mất kết nối SSE, tự động kết nối lại sau 3s...');
      eventSource.close();
      setTimeout(connectSse, 3000);
    };
  }

  // ============================================================
  // RUNNER STATE UPDATES
  // ============================================================
  function updateRunnerState(data) {
    state.runner = { ...state.runner, ...data };
    const status = state.runner.status;

    // Update Global Badge
    dom.globalStatusBadge.className = 'status-badge ' + status;
    if (status === 'idle') {
      dom.globalStatusText.textContent = 'Đang nghỉ (Idle)';
      dom.infoStatusBadge.className = 'badge badge-idle';
      dom.infoStatusBadge.textContent = 'Sẵn sàng';
      dom.btnStartRun.classList.remove('hidden');
      dom.btnStopRun.classList.add('hidden');
      dom.bannerAlert.classList.add('hidden');
    } else if (status === 'running') {
      dom.globalStatusText.textContent = 'Đang chạy (Running)...';
      dom.infoStatusBadge.className = 'badge badge-running';
      dom.infoStatusBadge.textContent = 'Đang thi tự động...';
      dom.btnStartRun.classList.add('hidden');
      dom.btnStopRun.classList.remove('hidden');
      dom.bannerAlert.classList.add('hidden');
    } else if (status === 'waiting_banner') {
      dom.globalStatusText.textContent = 'CHỜ BẠN CHỌN BANNER!';
      dom.infoStatusBadge.className = 'badge badge-waiting';
      dom.infoStatusBadge.textContent = 'Tạm dừng: Chờ chọn banner';
      dom.btnStartRun.classList.add('hidden');
      dom.btnStopRun.classList.remove('hidden');
      if (state.runner.waitingDetails) {
        renderBannerAlert(state.runner.waitingDetails);
      }
    } else if (status === 'stopping') {
      dom.globalStatusText.textContent = 'Đang dừng lại...';
      dom.infoStatusBadge.className = 'badge badge-idle';
      dom.infoStatusBadge.textContent = 'Đang dừng...';
    }

    // Active Banner Pill
    const activeBanner = state.banners.find((b) => b.id === state.runner.activeBannerId);
    if (activeBanner) {
      dom.pillBannerName.textContent = activeBanner.title;
      dom.infoCurrentBanner.textContent = activeBanner.title;
    }

    // Running info card
    dom.infoCurrentAcc.textContent = state.runner.currentAccount || 'Chưa có';
    dom.infoCurrentDevice.textContent = state.runner.currentDevice || 'Tự động';

    // Stats
    const stats = state.runner.stats || { total: 0, completed: 0, failed: 0 };
    dom.statTotal.textContent = stats.total;
    dom.statCompleted.textContent = stats.completed;
    dom.statFailed.textContent = stats.failed;

    const progressPct = stats.total > 0 ? Math.round(((stats.completed + stats.failed) / stats.total) * 100) : 0;
    dom.progressBarFill.style.width = progressPct + '%';

    // Refresh accounts table periodically or when status changes
    loadAccounts(false);
  }

  function renderBannerAlert(details) {
    dom.waitDeviceName.textContent = details.serial || 'LDPlayer';
    dom.waitAccountName.textContent = details.username || 'Tài khoản hiện tại';
    dom.bannerAlert.classList.remove('hidden');
    dom.bannerAlert.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ============================================================
  // LOGS CONSOLE
  // ============================================================
  function appendLogEntry(entry) {
    const line = document.createElement('div');
    line.className = 'log-line';

    let html = '';
    if (entry.time) {
      html += `<span class="log-time">[${entry.time}]</span>`;
    }
    if (entry.serial) {
      html += `<span class="log-serial">[${entry.serial}]</span>`;
    }
    if (entry.username) {
      html += `<span class="log-user">[${entry.username}]</span>`;
    }

    const colorClass = entry.color ? `log-${entry.color}` : 'log-msg';
    html += `<span class="${colorClass}">${escapeHtml(entry.message)}</span>`;

    line.innerHTML = html;
    dom.consoleOutput.appendChild(line);

    if (state.autoscroll) {
      dom.consoleOutput.scrollTop = dom.consoleOutput.scrollHeight;
    }
  }

  dom.chkAutoscroll.addEventListener('change', (e) => {
    state.autoscroll = e.target.checked;
  });

  dom.btnClearLogs.addEventListener('click', async () => {
    await fetch('/api/logs/clear', { method: 'POST' });
    dom.consoleOutput.innerHTML = '';
  });

  // ============================================================
  // BANNERS MANAGEMENT
  // ============================================================
  async function loadBanners() {
    try {
      const res = await fetch('/api/banners');
      const data = await res.json();
      if (!data.success) return;

      state.banners = data.banners;
      state.currentBannerId = data.activeId || 'banner_1';
      state.runner.activeBannerId = state.currentBannerId;

      renderBannerDropdown();
      renderBannerSubtabs();
      loadBannerAnswers(state.currentBannerId);
    } catch (err) {
      console.error('Lỗi nạp banners:', err);
    }
  }

  function updateActiveBannerEditorHeader(bannerMeta) {
    if (!bannerMeta) return;
    if (dom.lblActiveEditorBannerName) {
      dom.lblActiveEditorBannerName.textContent = bannerMeta.title;
    }
    if (dom.inputBannerTitle) {
      dom.inputBannerTitle.value = bannerMeta.title;
    }
    if (dom.titleDisplayBox && dom.titleRenameBox) {
      dom.titleRenameBox.classList.add('hidden');
      dom.titleDisplayBox.classList.remove('hidden');
    }
    if (dom.btnSetAsActiveBanner) {
      const isExamActive = bannerMeta.id === state.runner.activeBannerId;
      if (isExamActive) {
        dom.btnSetAsActiveBanner.textContent = '✔ Đang Chọn Thi';
        dom.btnSetAsActiveBanner.classList.add('btn-primary');
        dom.btnSetAsActiveBanner.classList.remove('btn-outline-cyan');
        dom.btnSetAsActiveBanner.disabled = true;
      } else {
        dom.btnSetAsActiveBanner.textContent = '🎯 Chọn Thi Phần Này';
        dom.btnSetAsActiveBanner.classList.remove('btn-primary');
        dom.btnSetAsActiveBanner.classList.add('btn-outline-cyan');
        dom.btnSetAsActiveBanner.disabled = false;
      }
    }
    updateJsonAnswersStatus(bannerMeta.totalQuestions || 0);
  }

  async function setActiveBanner(bannerId) {
    try {
      const res = await fetch('/api/banners/active', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ bannerId }),
      });
      const data = await res.json();
      if (data.success) {
        state.runner.activeBannerId = bannerId;
        renderBannerDropdown();
        renderBannerSubtabs();
        const curMeta = state.banners.find((b) => b.id === state.currentBannerId);
        updateActiveBannerEditorHeader(curMeta);
      }
    } catch (err) {
      console.error('Lỗi thiết lập banner thi:', err);
    }
  }

  function renderBannerDropdown() {
    dom.selectBanner.innerHTML = '';
    state.banners.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.title} (${b.totalQuestions} câu hỏi)`;
      if (b.id === state.runner.activeBannerId) opt.selected = true;
      dom.selectBanner.appendChild(opt);
    });

    const active = state.banners.find((b) => b.id === state.runner.activeBannerId);
    if (active) {
      dom.pillBannerName.textContent = active.title;
      dom.infoCurrentBanner.textContent = active.title;
    }
  }

  function renderBannerSubtabs() {
    dom.bannerSubtabsList.innerHTML = '';
    state.banners.forEach((b) => {
      const tabCard = document.createElement('div');
      tabCard.className = `banner-subtab-card ${b.id === state.currentBannerId ? 'active' : ''}`;
      tabCard.innerHTML = `
        <span class="subtab-key">PHẦN THI #${b.key}</span>
        <div class="subtab-title" title="${escapeHtml(b.title)}">${escapeHtml(b.title)}</div>
        <div class="subtab-count">📚 ${b.totalQuestions} câu hỏi</div>
      `;
      tabCard.addEventListener('click', () => {
        state.currentBannerId = b.id;
        renderBannerSubtabs();
        // Cập nhật ngay lập tức tiêu đề banner và số câu hỏi bên dưới
        updateActiveBannerEditorHeader(b);
        loadBannerAnswers(b.id);
      });
      dom.bannerSubtabsList.appendChild(tabCard);
    });
  }

  async function loadBannerAnswers(bannerId) {
    try {
      const bannerMeta = state.banners.find((b) => b.id === bannerId);
      if (bannerMeta) {
        updateActiveBannerEditorHeader(bannerMeta);
      }

      const res = await fetch(`/api/banners/${bannerId}/answers`);
      const data = await res.json();
      if (!data.success) return;

      state.bannerAnswers = data.answers || [];
      if (bannerMeta) {
        bannerMeta.totalQuestions = state.bannerAnswers.length;
        updateActiveBannerEditorHeader(bannerMeta);
      }

      if (dom.textareaJsonAnswers) {
        dom.textareaJsonAnswers.value = JSON.stringify(state.bannerAnswers, null, 2);
      }
    } catch (err) {
      console.error('Lỗi nạp đáp án banner:', err);
    }
  }

  function updateJsonAnswersStatus(count) {
    if (dom.jsonAnswersStatus) {
      dom.jsonAnswersStatus.className = 'badge badge-success';
      dom.jsonAnswersStatus.textContent = `✔ ${count} câu hỏi`;
    }
  }

  // Live validate JSON on input
  if (dom.textareaJsonAnswers) {
    dom.textareaJsonAnswers.addEventListener('input', () => {
      try {
        const parsed = JSON.parse(dom.textareaJsonAnswers.value);
        if (Array.isArray(parsed)) {
          dom.jsonAnswersStatus.className = 'badge badge-success';
          dom.jsonAnswersStatus.textContent = `✔ ${parsed.length} câu hỏi`;
        } else {
          dom.jsonAnswersStatus.className = 'badge badge-error';
          dom.jsonAnswersStatus.textContent = '✖ Phải là mảng []';
        }
      } catch {
        dom.jsonAnswersStatus.className = 'badge badge-error';
        dom.jsonAnswersStatus.textContent = '✖ Cú pháp JSON chưa đúng';
      }
    });
  }

  // Lưu ngân hàng đáp án hiện tại
  if (dom.btnSaveCurrentBannerAnswers) {
    dom.btnSaveCurrentBannerAnswers.addEventListener('click', async () => {
      try {
        const parsed = JSON.parse(dom.textareaJsonAnswers.value);
        if (!Array.isArray(parsed)) {
          return alert('Dữ liệu đáp án phải là một mảng JSON các câu hỏi!');
        }

        const res = await fetch(`/api/banners/${state.currentBannerId}/answers`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ answers: parsed }),
        });
        const data = await res.json();
        if (data.success) {
          state.bannerAnswers = parsed;
          updateJsonAnswersStatus(parsed.length);
          await loadBanners();
          const banner = state.banners.find((b) => b.id === state.currentBannerId);
          alert(`✔ Đã lưu thành công ${parsed.length} câu hỏi cho [${banner ? banner.title : state.currentBannerId}]!`);
        } else {
          alert('Lỗi lưu đáp án: ' + (data.message || 'Không xác định'));
        }
      } catch (err) {
        alert('Lỗi: Cú pháp JSON chưa hợp lệ! ' + err.message);
      }
    });
  }

  // Đặt banner đang chọn làm phần thi hiện tại
  if (dom.btnSetAsActiveBanner) {
    dom.btnSetAsActiveBanner.addEventListener('click', async () => {
      await setActiveBanner(state.currentBannerId);
    });
  }

  // Khi chọn banner trong dropdown ở trang điều khiển chính
  if (dom.selectBanner) {
    dom.selectBanner.addEventListener('change', async (e) => {
      const bannerId = e.target.value;
      if (bannerId) {
        await setActiveBanner(bannerId);
      }
    });
  }

  // Chỉnh sửa tên hiển thị của Banner
  function openRenameBanner() {
    const currentMeta = state.banners.find((b) => b.id === state.currentBannerId);
    if (!currentMeta) return;
    if (dom.inputBannerTitle) {
      dom.inputBannerTitle.value = currentMeta.title;
    }
    if (dom.titleDisplayBox && dom.titleRenameBox) {
      dom.titleDisplayBox.classList.add('hidden');
      dom.titleRenameBox.classList.remove('hidden');
      if (dom.inputBannerTitle) {
        dom.inputBannerTitle.focus();
        dom.inputBannerTitle.select();
      }
    }
  }

  function closeRenameBanner() {
    if (dom.titleDisplayBox && dom.titleRenameBox) {
      dom.titleRenameBox.classList.add('hidden');
      dom.titleDisplayBox.classList.remove('hidden');
    }
  }

  async function saveBannerTitle() {
    if (!dom.inputBannerTitle) return;
    const newTitle = dom.inputBannerTitle.value.trim();
    if (!newTitle) {
      return alert('Vui lòng nhập tên phần thi!');
    }

    try {
      const res = await fetch(`/api/banners/${state.currentBannerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const data = await res.json();
      if (data.success) {
        const meta = state.banners.find((b) => b.id === state.currentBannerId);
        if (meta) meta.title = newTitle;
        renderBannerDropdown();
        renderBannerSubtabs();
        updateActiveBannerEditorHeader(meta);
        closeRenameBanner();
      } else {
        alert('Lỗi: Không thể lưu tên phần thi mới!');
      }
    } catch (err) {
      alert('Lỗi cập nhật tên banner: ' + err.message);
    }
  }

  if (dom.btnOpenRename) {
    dom.btnOpenRename.addEventListener('click', openRenameBanner);
  }

  if (dom.lblActiveEditorBannerName) {
    dom.lblActiveEditorBannerName.addEventListener('dblclick', openRenameBanner);
  }

  if (dom.btnCancelRename) {
    dom.btnCancelRename.addEventListener('click', closeRenameBanner);
  }

  if (dom.btnUpdateBannerMeta) {
    dom.btnUpdateBannerMeta.addEventListener('click', saveBannerTitle);
  }

  if (dom.inputBannerTitle) {
    dom.inputBannerTitle.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveBannerTitle();
      } else if (e.key === 'Escape') {
        closeRenameBanner();
      }
    });
  }

  // Bật / tắt hiển thị khung nhập đáp án JSON
  if (dom.btnToggleJsonEditor && dom.jsonEditorContainer) {
    dom.btnToggleJsonEditor.addEventListener('click', () => {
      const isHidden = dom.jsonEditorContainer.classList.toggle('hidden');
      if (isHidden) {
        dom.btnToggleJsonEditor.innerHTML = '👁️ Xem / Sửa Đáp Án JSON';
      } else {
        dom.btnToggleJsonEditor.innerHTML = '🙈 Thu Gọn Khung JSON';
        dom.jsonEditorContainer.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    });
  }

  // ============================================================
  // ACCOUNTS MANAGEMENT
  // ============================================================
  async function loadAccounts(renderTable = true) {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      if (!data.success) return;

      state.accounts = data.accounts;
      dom.badgeTotalAccounts.textContent = state.accounts.length;

      // Update start account selector on dashboard
      renderStartAccountDropdown();

      if (renderTable) {
        renderAccountsTable();
      }
      updateAccountCounts();
    } catch (err) {
      console.error('Lỗi nạp accounts:', err);
    }
  }

  function renderStartAccountDropdown() {
    const currentVal = dom.selectStartAccount.value;
    dom.selectStartAccount.innerHTML = '';
    state.accounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = acc.index;
      opt.textContent = `#${acc.index} - ${acc.username}`;
      dom.selectStartAccount.appendChild(opt);
    });
    if (currentVal && dom.selectStartAccount.querySelector(`option[value="${currentVal}"]`)) {
      dom.selectStartAccount.value = currentVal;
    }
  }

  function updateAccountCounts() {
    const total = state.accounts.length;
    const pending = state.accounts.filter((a) => a.status === 'idle' || a.status === 'pending').length;
    const success = state.accounts.filter((a) => a.status === 'success').length;
    const error = state.accounts.filter((a) => a.status === 'error').length;

    dom.countFilterAll.textContent = total;
    dom.countFilterPending.textContent = pending;
    dom.countFilterSuccess.textContent = success;
    dom.countFilterError.textContent = error;
  }

  function renderAccountsTable() {
    const tbody = dom.tbodyAccounts;
    tbody.innerHTML = '';

    const query = state.accountSearchQuery.toLowerCase().trim();
    const filtered = state.accounts.filter((acc) => {
      // Filter status
      if (state.accountFilter === 'pending' && acc.status !== 'idle' && acc.status !== 'pending') return false;
      if (state.accountFilter === 'success' && acc.status !== 'success') return false;
      if (state.accountFilter === 'error' && acc.status !== 'error') return false;

      // Filter query
      if (query && !acc.username.toLowerCase().includes(query)) return false;

      return true;
    });

    if (filtered.length === 0) {
      tbody.innerHTML = `<tr><td colspan="8" class="text-center text-muted py-4">Không tìm thấy tài khoản nào phù hợp!</td></tr>`;
      return;
    }

    filtered.forEach((acc) => {
      const tr = document.createElement('tr');
      if (acc.status === 'running') tr.className = 'row-running';
      if (acc.status === 'waiting_banner') tr.className = 'row-waiting';

      // Status badge
      let statusHtml = '';
      if (acc.status === 'idle') statusHtml = '<span class="badge badge-idle">Sẵn sàng</span>';
      else if (acc.status === 'pending') statusHtml = '<span class="badge badge-pending">Chờ chạy</span>';
      else if (acc.status === 'running') statusHtml = '<span class="badge badge-running">Đang chạy</span>';
      else if (acc.status === 'waiting_banner') statusHtml = '<span class="badge badge-waiting">Chờ chọn banner</span>';
      else if (acc.status === 'success') statusHtml = '<span class="badge badge-success">Thành công</span>';
      else if (acc.status === 'error') statusHtml = '<span class="badge badge-error">Lỗi</span>';

      const durationStr = acc.durationMs ? `${(acc.durationMs / 1000).toFixed(1)}s` : '--';

      let noteHtml = '';
      if (acc.screenshotPath) {
        const fileName = acc.screenshotPath.split(/[/\\]/).pop();
        noteHtml += `<button class="btn-icon-action btn-view-screenshot" data-img="/screenshots/${fileName}" title="Xem ảnh kết quả">📸 Xem ảnh</button>`;
      }
      if (acc.error) {
        noteHtml += `<span class="text-red" title="${escapeHtml(acc.error)}">⚠️ ${escapeHtml(acc.error.slice(0, 25))}...</span>`;
      }
      if (!noteHtml) noteHtml = '<span class="text-muted">--</span>';

      const isChecked = state.selectedAccountUsernames.has(acc.username);

      tr.innerHTML = `
        <td>
          <input type="checkbox" class="chk-acc-row" data-user="${escapeHtml(acc.username)}" ${isChecked ? 'checked' : ''}>
        </td>
        <td><b>#${acc.index}</b></td>
        <td><span class="text-cyan font-semibold">${escapeHtml(acc.username)}</span></td>
        <td><code>••••••••</code></td>
        <td>${statusHtml}</td>
        <td>${durationStr}</td>
        <td>${noteHtml}</td>
        <td style="text-align: right;">
          <button class="btn-icon-action btn-resume-here" data-idx="${acc.index}" title="Chạy tiếp tục từ tài khoản #${acc.index} này đến hết">
            ▶ Chạy từ đây
          </button>
          <button class="btn-icon-action btn-run-single" data-user="${escapeHtml(acc.username)}" title="Chỉ chạy riêng tài khoản này">
            ↻ Chạy riêng
          </button>
          <button class="btn-icon-action btn-delete-acc" data-user="${escapeHtml(acc.username)}" title="Xóa tài khoản">
            🗑️
          </button>
        </td>
      `;

      // Checkbox listener
      const chk = tr.querySelector('.chk-acc-row');
      chk.addEventListener('change', (e) => {
        if (e.target.checked) {
          state.selectedAccountUsernames.add(acc.username);
        } else {
          state.selectedAccountUsernames.delete(acc.username);
        }
        updateSelectedCounter();
      });

      // Actions
      tr.querySelector('.btn-resume-here').addEventListener('click', () => {
        startExecution({ startFromIndex: acc.index });
      });

      tr.querySelector('.btn-run-single').addEventListener('click', () => {
        startExecution({ usernames: [acc.username] });
      });

      tr.querySelector('.btn-delete-acc').addEventListener('click', async () => {
        if (confirm(`Bạn có chắc muốn xóa tài khoản ${acc.username}?`)) {
          await fetch(`/api/accounts/${encodeURIComponent(acc.username)}`, { method: 'DELETE' });
          loadAccounts();
        }
      });

      const btnScreenshot = tr.querySelector('.btn-view-screenshot');
      if (btnScreenshot) {
        btnScreenshot.addEventListener('click', (e) => {
          const imgUrl = e.currentTarget.getAttribute('data-img');
          openScreenshotModal(imgUrl, acc.username);
        });
      }

      tbody.appendChild(tr);
    });

    updateSelectedCounter();
  }

  function updateSelectedCounter() {
    const count = state.selectedAccountUsernames.size;
    dom.selectedAccCount.textContent = count;
    dom.btnRunSelectedAccounts.disabled = count === 0;
  }

  dom.chkSelectAllAccs.addEventListener('change', (e) => {
    const isChecked = e.target.checked;
    if (isChecked) {
      state.accounts.forEach((a) => state.selectedAccountUsernames.add(a.username));
    } else {
      state.selectedAccountUsernames.clear();
    }
    renderAccountsTable();
  });

  dom.filterChips.forEach((chip) => {
    chip.addEventListener('click', () => {
      dom.filterChips.forEach((c) => c.classList.remove('active'));
      chip.classList.add('active');
      state.accountFilter = chip.getAttribute('data-filter');
      renderAccountsTable();
    });
  });

  dom.inputSearchAccount.addEventListener('input', (e) => {
    state.accountSearchQuery = e.target.value;
    renderAccountsTable();
  });

  // Chạy các tài khoản được chọn qua checkbox
  dom.btnRunSelectedAccounts.addEventListener('click', () => {
    const usernames = Array.from(state.selectedAccountUsernames);
    if (usernames.length === 0) return;
    startExecution({ usernames });
  });

  // Reset statuses
  dom.btnResetAllStatuses.addEventListener('click', async () => {
    await fetch('/api/accounts/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
    loadAccounts();
  });

  // Modal Add Single Account
  dom.btnOpenAddAccModal.addEventListener('click', () => {
    dom.inputNewAccUsername.value = '';
    dom.inputNewAccPassword.value = '';
    dom.modalAddAccount.classList.remove('hidden');
  });

  dom.btnCloseAddAccModal.addEventListener('click', () => dom.modalAddAccount.classList.add('hidden'));
  dom.btnCancelAddAcc.addEventListener('click', () => dom.modalAddAccount.classList.add('hidden'));

  dom.btnConfirmAddAcc.addEventListener('click', async () => {
    const username = dom.inputNewAccUsername.value.trim();
    const password = dom.inputNewAccPassword.value.trim();
    if (!username || !password) return alert('Vui lòng điền đủ tài khoản và mật khẩu!');

    try {
      const res = await fetch('/api/accounts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      });
      const data = await res.json();
      if (data.success) {
        dom.modalAddAccount.classList.add('hidden');
        loadAccounts();
      } else {
        alert(data.message || 'Lỗi thêm tài khoản!');
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Modal Import / Edit JSON Accounts
  dom.btnOpenImportAccModal.addEventListener('click', () => {
    const rawList = state.accounts.map((a) => ({
      username: a.username,
      password: a.password,
    }));
    dom.textareaJsonAccounts.value = JSON.stringify(rawList, null, 2);
    dom.modalJsonAccounts.classList.remove('hidden');
  });

  dom.btnCloseJsonAccountsModal.addEventListener('click', () => dom.modalJsonAccounts.classList.add('hidden'));
  dom.btnCancelJsonAccounts.addEventListener('click', () => dom.modalJsonAccounts.classList.add('hidden'));

  dom.btnConfirmSaveJsonAccounts.addEventListener('click', async () => {
    try {
      const parsed = JSON.parse(dom.textareaJsonAccounts.value);
      if (!Array.isArray(parsed)) return alert('Dữ liệu phải là danh sách (array) các tài khoản!');

      const res = await fetch('/api/accounts', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ accounts: parsed }),
      });
      const data = await res.json();
      if (data.success) {
        dom.modalJsonAccounts.classList.add('hidden');
        loadAccounts();
        alert('Đã cập nhật danh sách tài khoản thành công!');
      } else {
        alert('Lỗi lưu danh sách: ' + data.message);
      }
    } catch (err) {
      alert('JSON không hợp lệ: ' + err.message);
    }
  });

  // ============================================================
  // SCREENSHOT PREVIEW MODAL
  // ============================================================
  function openScreenshotModal(imgUrl, username) {
    dom.imgScreenshotFull.src = imgUrl;
    dom.btnDownloadScreenshot.href = imgUrl;
    document.getElementById('modal-screenshot-title').textContent = `Kết Quả Bài Thi - ${username}`;
    dom.modalScreenshotPreview.classList.remove('hidden');
  }

  dom.btnCloseScreenshotModal.addEventListener('click', () => dom.modalScreenshotPreview.classList.add('hidden'));
  dom.btnDismissScreenshotModal.addEventListener('click', () => dom.modalScreenshotPreview.classList.add('hidden'));

  // ============================================================
  // DEVICES
  // ============================================================
  async function loadDevices() {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      if (!data.success) return;

      state.devices = data.devices;
      dom.selectDevice.innerHTML = '<option value="">Tất cả thiết bị sẵn sàng</option>';
      state.devices.forEach((d) => {
        const opt = document.createElement('option');
        opt.value = d.serial;
        const resStr = d.resolution ? `${d.resolution.width}x${d.resolution.height}` : '';
        opt.textContent = `${d.serial} (${d.model || 'Android'} - ${resStr})`;
        dom.selectDevice.appendChild(opt);
      });
    } catch (err) {
      console.error('Lỗi quét thiết bị:', err);
    }
  }

  dom.btnReconnectAdb.addEventListener('click', async () => {
    dom.btnReconnectAdb.disabled = true;
    dom.btnReconnectAdb.innerHTML = '<span class="icon">⏳</span> Đang quét...';
    try {
      const res = await fetch('/api/devices/scan', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        state.devices = data.devices;
        loadDevices();
        alert(`Đã phát hiện ${state.devices.length} máy ảo LDPlayer / thiết bị Android!`);
      }
    } catch (err) {
      alert('Lỗi quét máy ảo: ' + err.message);
    } finally {
      dom.btnReconnectAdb.disabled = false;
      dom.btnReconnectAdb.innerHTML = '<span class="icon">🔄</span> Quét Máy Ảo';
    }
  });

  if (dom.btnTriggerLdplayerConnect) {
    dom.btnTriggerLdplayerConnect.addEventListener('click', () => dom.btnReconnectAdb.click());
  }

  // ============================================================
  // EXECUTION CONTROLLER (START / STOP / RESUME)
  // ============================================================
  async function startExecution(customOptions = {}) {
    const bannerId = dom.selectBanner.value || state.currentBannerId;
    const startFromIndex = customOptions.startFromIndex || parseInt(dom.selectStartAccount.value, 10) || 1;
    const usernames = customOptions.usernames || undefined;
    const deviceSerial = dom.selectDevice.value || undefined;
    const concurrency = 1;
    const fixedAnswer = 'RANDOM';

    const payload = {
      bannerId,
      startFromIndex,
      usernames,
      deviceSerial,
      concurrency,
      fixedAnswer,
    };

    try {
      const res = await fetch('/api/action/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!data.success) {
        alert('Không thể bắt đầu: ' + data.message);
      } else {
        // Switch to dashboard tab to see live execution
        document.getElementById('tab-nav-dashboard').click();
      }
    } catch (err) {
      alert('Lỗi gửi lệnh bắt đầu: ' + err.message);
    }
  }

  dom.btnStartRun.addEventListener('click', () => startExecution());

  dom.btnStopRun.addEventListener('click', async () => {
    if (confirm('Bạn có chắc chắn muốn DỪNG TIẾN TRÌNH THI?')) {
      await fetch('/api/action/stop', { method: 'POST' });
    }
  });

  // Resume when paused at banner selection
  async function resumeBannerWait() {
    try {
      await fetch('/api/action/resume', { method: 'POST' });
      dom.bannerAlert.classList.add('hidden');
    } catch (err) {
      console.error('Lỗi gửi lệnh tiếp tục:', err);
    }
  }

  dom.btnResumeRun.addEventListener('click', () => resumeBannerWait());

  // Global hotkey: press Enter or Space while banner alert is visible to resume
  window.addEventListener('keydown', (e) => {
    if (state.runner.status === 'waiting_banner' && (e.key === 'Enter' || e.code === 'Space')) {
      // Don't trigger if user is typing in an input
      if (['INPUT', 'TEXTAREA', 'SELECT'].includes(document.activeElement?.tagName)) return;
      e.preventDefault();
      resumeBannerWait();
    }
  });

  // Run failed accounts only
  dom.btnRunFailedOnly.addEventListener('click', () => {
    const failedUsers = state.accounts.filter((a) => a.status === 'error').map((a) => a.username);
    if (failedUsers.length === 0) {
      return alert('Hiện tại không có tài khoản nào bị lỗi!');
    }
    if (confirm(`Tìm thấy ${failedUsers.length} tài khoản bị lỗi. Bắt đầu chạy lại ngay?`)) {
      startExecution({ usernames: failedUsers });
    }
  });

  // Helper escape
  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ============================================================
  // INITIALIZATION
  // ============================================================
  async function init() {
    await loadBanners();
    await loadDevices();
    await loadAccounts();
    connectSse();
  }

  init();
})();
