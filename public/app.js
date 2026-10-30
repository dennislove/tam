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
    batchSelectedUsernames: new Set(),
    batchLastClickedIndex: null,
    batchSearchQuery: '',
    batchFilterMode: 'all',
    certResultsCache: null,
    accountFilter: 'all',
    accountSearchQuery: '',
    questionSearchQuery: '',
    autoscroll: true,
    lots: [],
    selectedLotFilter: '',
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
    linkQuickEditBanner: document.getElementById('link-quick-edit-banner'),
    selectDevice: document.getElementById('select-device'),
    selectStartAccount: document.getElementById('select-start-account'),
    selectLot: document.getElementById('select-lot'),
    selectSpeedMode: document.getElementById('select-speed-mode'),
    btnStartRun: document.getElementById('btn-start-run'),
    btnStartSingle: document.getElementById('btn-start-single'),
    btnStopRun: document.getElementById('btn-stop-run'),
    btnRunFailedOnly: document.getElementById('btn-run-failed-only'),

    // Batch multi-account selector controls (Chế độ chạy hàng loạt)
    batchSelectedCountBadge: document.getElementById('batch-selected-count-badge'),
    btnBatchSelectAll: document.getElementById('btn-batch-select-all'),
    btnBatchDeselectAll: document.getElementById('btn-batch-deselect-all'),
    btnBatchInvert: document.getElementById('btn-batch-invert'),
    btnBatchSelectNoCert: document.getElementById('btn-batch-select-no-cert'),
    btnBatchPasteList: document.getElementById('btn-batch-paste-list'),
    inputBatchSearch: document.getElementById('input-batch-search'),
    btnBatchSearchClear: document.getElementById('btn-batch-search-clear'),
    inputBatchRangeFrom: document.getElementById('input-batch-range-from'),
    inputBatchRangeTo: document.getElementById('input-batch-range-to'),
    btnBatchSelectRange: document.getElementById('btn-batch-select-range'),
    btnBatchDeselectRange: document.getElementById('btn-batch-deselect-range'),
    batchAccountGrid: document.getElementById('batch-account-grid'),
    batchChipCountAll: document.getElementById('batch-chip-count-all'),
    batchChipCountSelected: document.getElementById('batch-chip-count-selected'),
    batchChipCountNoCert: document.getElementById('batch-chip-count-nocert'),
    batchChipCountError: document.getElementById('batch-chip-count-error'),
    batchFilterChips: document.querySelectorAll('[data-batch-filter]'),

    // Area Switcher & Single Multi-banner controls
    btnModeTabBatch: document.getElementById('btn-mode-tab-batch'),
    btnModeTabSingleMulti: document.getElementById('btn-mode-tab-single-multi'),
    panelModeBatch: document.getElementById('panel-mode-batch'),
    panelModeSingleMulti: document.getElementById('panel-mode-single-multi'),
    activeModeIndicator: document.getElementById('active-mode-indicator'),
    selectSingleAcc: document.getElementById('select-single-acc'),
    btnSinglePrevAcc: document.getElementById('btn-single-prev-acc'),
    btnSingleNextAcc: document.getElementById('btn-single-next-acc'),
    singleAccIndexLabel: document.getElementById('single-acc-index-label'),
    selectSingleSpeed: document.getElementById('select-single-speed'),
    btnSelectAllBanners: document.getElementById('btn-select-all-banners'),
    btnDeselectAllBanners: document.getElementById('btn-deselect-all-banners'),
    singleSelectedBannersCount: document.getElementById('single-selected-banners-count'),
    singleMultiBannersGrid: document.getElementById('single-multi-banners-grid'),
    btnStartSingleMulti: document.getElementById('btn-start-single-multi'),
    btnStopSingleMulti: document.getElementById('btn-stop-single-multi'),

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
    selectTableLotFilter: document.getElementById('select-table-lot-filter'),
    filterChips: document.querySelectorAll('.filter-chip'),
    chkSelectAllAccs: document.getElementById('chk-select-all-accs'),
    btnRunSelectedAccounts: document.getElementById('btn-run-selected-accounts'),
    selectedAccCount: document.getElementById('selected-acc-count'),
    btnAddSelectedToBackup: document.getElementById('btn-add-selected-to-backup'),
    selectedBackupCount: document.getElementById('selected-backup-count'),
    countFilterAll: document.getElementById('count-filter-all'),
    countFilterPending: document.getElementById('count-filter-pending'),
    countFilterSuccess: document.getElementById('count-filter-success'),
    countFilterError: document.getElementById('count-filter-error'),
    btnAutoPartition: document.getElementById('btn-auto-partition'),
    btnOpenAddAccModal: document.getElementById('btn-open-add-acc-modal'),
    btnOpenImportAccModal: document.getElementById('btn-open-import-acc-modal'),
    btnResetAllStatuses: document.getElementById('btn-reset-all-statuses'),

    // Banners manager
    tableBanners: document.getElementById('table-banners'),
    tbodyBanners: document.getElementById('tbody-banners'),
    bannerEditorSection: document.getElementById('banner-editor-section'),
    btnOpenAddBannerModal: document.getElementById('btn-open-add-banner-modal'),
    inputBannerTitle: document.getElementById('input-banner-title'),
    btnUpdateBannerMeta: document.getElementById('btn-update-banner-meta'),
    btnSetAsActiveBanner: document.getElementById('btn-set-as-active-banner'),
    btnInsertSampleAnswers: document.getElementById('btn-insert-sample-answers'),
    btnOpenRename: document.getElementById('btn-open-rename'),
    btnCancelRename: document.getElementById('btn-cancel-rename'),
    titleDisplayBox: document.getElementById('title-display-box'),
    titleRenameBox: document.getElementById('title-rename-box'),
    jsonEditorContainer: document.getElementById('json-editor-container'),
    lblActiveEditorBannerName: document.getElementById('lbl-active-editor-banner-name'),
    textareaJsonAnswers: document.getElementById('textarea-json-answers'),
    jsonAnswersStatus: document.getElementById('json-answers-status'),
    btnSaveCurrentBannerAnswers: document.getElementById('btn-save-current-banner-answers'),

    // Modals
    modalJsonAccounts: document.getElementById('modal-json-accounts'),
    textareaJsonAccounts: document.getElementById('textarea-json-accounts'),
    btnCancelJsonAccounts: document.getElementById('btn-cancel-json-accounts'),
    btnConfirmSaveJsonAccounts: document.getElementById('btn-confirm-save-json-accounts'),
    btnCloseJsonAccountsModal: document.getElementById('btn-close-json-accounts-modal'),

    // Modal Import Backup Lot
    btnOpenImportBackupModal: document.getElementById('btn-open-import-backup-modal'),
    modalImportBackupLot: document.getElementById('modal-import-backup-lot'),
    btnCloseImportBackupModal: document.getElementById('btn-close-import-backup-modal'),
    btnCancelImportBackup: document.getElementById('btn-cancel-import-backup'),
    fileImportBackupJson: document.getElementById('file-import-backup-json'),
    labelBackupFileName: document.getElementById('label-backup-file-name'),
    btnClearBackupTextarea: document.getElementById('btn-clear-backup-textarea'),
    badgeBackupJsonCount: document.getElementById('badge-backup-json-count'),
    textareaBackupJson: document.getElementById('textarea-backup-json'),
    chkReplaceBackupLot: document.getElementById('chk-replace-backup-lot'),
    btnConfirmImportBackup: document.getElementById('btn-confirm-import-backup'),
    btnEmptyBackupLotDirect: document.getElementById('btn-empty-backup-lot-direct'),

    modalAddAccount: document.getElementById('modal-add-account'),
    inputNewAccUsername: document.getElementById('input-new-acc-username'),
    inputNewAccPassword: document.getElementById('input-new-acc-password'),
    selectNewAccLot: document.getElementById('select-new-acc-lot'),
    btnCancelAddAcc: document.getElementById('btn-cancel-add-acc'),
    btnConfirmAddAcc: document.getElementById('btn-confirm-add-acc'),
    btnCloseAddAccModal: document.getElementById('btn-close-add-acc-modal'),

    modalAddBanner: document.getElementById('modal-add-banner'),
    inputNewBannerTitle: document.getElementById('input-new-banner-title'),
    inputNewBannerDesc: document.getElementById('input-new-banner-desc'),
    btnCancelAddBanner: document.getElementById('btn-cancel-add-banner'),
    btnConfirmAddBanner: document.getElementById('btn-confirm-add-banner'),
    btnCloseAddBannerModal: document.getElementById('btn-close-add-banner-modal'),

    modalRenameBanner: document.getElementById('modal-rename-banner'),
    inputModalBannerTitle: document.getElementById('input-modal-banner-title'),
    btnCancelRenameModal: document.getElementById('btn-cancel-rename-modal'),
    btnConfirmRenameModal: document.getElementById('btn-confirm-rename-modal'),
    btnCloseRenameBannerModal: document.getElementById('btn-close-rename-banner-modal'),

    // Settings
    btnTriggerLdplayerConnect: document.getElementById('btn-trigger-ldplayer-connect'),
  };

  // ============================================================
  // TAB NAVIGATION
  // ============================================================
  function switchTab(btn, targetId) {
    dom.tabBtns.forEach((b) => b.classList.remove('active'));
    dom.tabPanes.forEach((p) => p.classList.remove('active'));

    btn.classList.add('active');
    const targetPane = document.getElementById(targetId);
    if (targetPane) targetPane.classList.add('active');
  }

  dom.tabBtns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const targetId = btn.getAttribute('data-tab');

      // Khóa 2 Tab quản trị: "Danh Sách Tài Khoản" và "Ngân Hàng Banner"
      if (targetId === 'tab-accounts' || targetId === 'tab-banners') {
        if (!isAuthed()) {
          requireAuth(() => {
            switchTab(btn, targetId);
          });
          return;
        }
      }

      switchTab(btn, targetId);
    });
  });

  // ============================================================
  // AUTH GATE — XÁC THỰC MẬT KHẨU QUẢN TRỊ
  // ============================================================
  const AUTH_KEY = 'tnvn_admin_authed';
  const CORRECT_HASH = btoa('Dennis0923#'); // Mật khẩu quản trị: Dennis0923#

  // Dọn sạch localStorage cũ để phiên mới khi mở app luôn đòi hỏi nhập pass
  try {
    localStorage.removeItem(AUTH_KEY);
  } catch {}

  function isAuthed() {
    return sessionStorage.getItem(AUTH_KEY) === CORRECT_HASH;
  }

  function goToDashboard() {
    const dashBtn = document.getElementById('tab-nav-dashboard');
    if (dashBtn) switchTab(dashBtn, 'tab-dashboard');
  }

  /**
   * requireAuth(callback)
   * Nếu đã xác thực rồi → gọi callback ngay.
   * Nếu chưa → hiện modal nhập pass.
   * Nếu hủy/đóng → redirect về tab Điều khiển.
   */
  function requireAuth(callback) {
    if (isAuthed()) {
      callback();
      return;
    }

    const modal = document.getElementById('modal-auth-gate');
    const input = document.getElementById('input-auth-password');
    const errorMsg = document.getElementById('auth-error-msg');
    const btnConfirm = document.getElementById('btn-auth-confirm');
    const btnCancel = document.getElementById('btn-auth-cancel');
    const backdrop = document.getElementById('modal-auth-backdrop');

    // Reset state
    input.value = '';
    errorMsg.style.display = 'none';
    modal.classList.remove('hidden');
    setTimeout(() => input.focus(), 100);

    function closeModal(proceed) {
      modal.classList.add('hidden');
      input.value = '';
      errorMsg.style.display = 'none';
      btnConfirm.removeEventListener('click', onConfirm);
      btnCancel.removeEventListener('click', onCancel);
      backdrop.removeEventListener('click', onCancel);
      input.removeEventListener('keydown', onKeydown);
      if (proceed) {
        callback();
      } else {
        // Bỏ qua → về tab Điều khiển
        goToDashboard();
      }
    }

    function onConfirm() {
      const val = input.value;
      if (btoa(val) === CORRECT_HASH) {
        sessionStorage.setItem(AUTH_KEY, CORRECT_HASH);
        closeModal(true);
      } else {
        errorMsg.style.display = 'block';
        input.value = '';
        input.focus();
      }
    }

    function onCancel() {
      closeModal(false);
    }

    function onKeydown(e) {
      if (e.key === 'Enter') onConfirm();
      if (e.key === 'Escape') onCancel();
    }

    btnConfirm.addEventListener('click', onConfirm);
    btnCancel.addEventListener('click', onCancel);
    backdrop.addEventListener('click', onCancel);
    input.addEventListener('keydown', onKeydown);
  }

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

    eventSource.addEventListener('check_event', (e) => {
      try {
        const data = JSON.parse(e.data);
        window.dispatchEvent(new CustomEvent('mac_check_event', { detail: data }));
      } catch (err) {
        console.error('Lỗi parse check_event:', err);
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
      if (state.lastRunLimit === 1) {
        state.lastRunLimit = null;
        if (dom.selectStartAccount && dom.selectStartAccount.selectedIndex < dom.selectStartAccount.options.length - 1) {
          dom.selectStartAccount.selectedIndex += 1;
        }
        if (dom.selectSingleAcc && dom.selectSingleAcc.selectedIndex < dom.selectSingleAcc.options.length - 1) {
          dom.selectSingleAcc.selectedIndex += 1;
          if (typeof updateSingleAccLabel === 'function') updateSingleAccLabel();
        }
      }
      dom.globalStatusText.textContent = 'Đang nghỉ (Idle)';
      dom.infoStatusBadge.className = 'badge badge-idle';
      dom.infoStatusBadge.textContent = 'Sẵn sàng';
      dom.btnStartRun.classList.remove('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.remove('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.remove('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.remove('hidden');
      dom.btnStopRun.classList.add('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.add('hidden');
      dom.bannerAlert.classList.add('hidden');
    } else if (status === 'running') {
      dom.globalStatusText.textContent = 'Đang chạy (Running)...';
      dom.infoStatusBadge.className = 'badge badge-running';
      dom.infoStatusBadge.textContent = 'Đang thi tự động...';
      dom.btnStartRun.classList.add('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.add('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.add('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.add('hidden');
      dom.btnStopRun.classList.remove('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.remove('hidden');
      dom.bannerAlert.classList.add('hidden');
    } else if (status === 'waiting_banner') {
      dom.globalStatusText.textContent = 'CHỜ BẠN CHỌN BANNER!';
      dom.infoStatusBadge.className = 'badge badge-waiting';
      dom.infoStatusBadge.textContent = 'Tạm dừng: Chờ chọn banner';
      dom.btnStartRun.classList.add('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.add('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.add('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.add('hidden');
      dom.btnStopRun.classList.remove('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.remove('hidden');
      if (state.runner.waitingDetails) {
        renderBannerAlert(state.runner.waitingDetails);
      }
    } else if (status === 'stopping') {
      dom.globalStatusText.textContent = 'Đang dừng lại...';
      dom.infoStatusBadge.className = 'badge badge-idle';
      dom.infoStatusBadge.textContent = 'Đang dừng...';
    }

    // Active Banner Pill
    const selectedBannerId = dom.selectBanner?.value || state.runner.activeBannerId;
    const activeBanner = state.banners.find((b) => b.id === selectedBannerId);
    if (activeBanner) {
      if (dom.pillBannerName) dom.pillBannerName.textContent = activeBanner.title;
      if (dom.infoCurrentBanner) dom.infoCurrentBanner.textContent = activeBanner.title;
    }

    // Running info card
    let currentAccDisplay = state.runner.currentAccount || 'Chưa có';
    if (currentAccDisplay !== 'Chưa có' && !currentAccDisplay.startsWith('#')) {
      const found = state.accounts?.find((a) => a.username === currentAccDisplay);
      if (found) {
        currentAccDisplay = `#${found.index} - ${found.username}`;
      }
    }
    dom.infoCurrentAcc.textContent = currentAccDisplay;
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
      if (!data.success || !Array.isArray(data.banners)) return;

      state.banners = data.banners;
      const countEl = document.getElementById('badge-total-banners');
      if (countEl) countEl.textContent = state.banners.length;

      // Nếu currentBannerId chưa có hoặc không nằm trong danh sách → chọn activeId hoặc banner đầu tiên
      const exists = state.banners.some((b) => b.id === state.currentBannerId);
      if (!exists && state.banners.length > 0) {
        state.currentBannerId = data.activeId || state.banners[0].id;
      }
      state.runner.activeBannerId = data.activeId || state.currentBannerId;

      renderBannerDropdown();
      renderBannersTable();
      renderMultiBannerCards();

      const cur = state.banners.find((b) => b.id === state.currentBannerId);
      if (cur) {
        updateActiveBannerEditorHeader(cur);
        loadBannerAnswers(state.currentBannerId);
      }
    } catch (err) {
      console.error('Lỗi nạp banners:', err);
    }
  }

  function updateActiveBannerEditorHeader(bannerMeta) {
    if (!bannerMeta) return;
    if (dom.lblActiveEditorBannerName) {
      dom.lblActiveEditorBannerName.textContent = `${bannerMeta.title} (${bannerMeta.id})`;
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
        dom.btnSetAsActiveBanner.textContent = '🎯 Đặt Làm Banner Thi';
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
        renderBannersTable();
        const curMeta = state.banners.find((b) => b.id === state.currentBannerId);
        updateActiveBannerEditorHeader(curMeta);
      }
    } catch (err) {
      console.error('Lỗi thiết lập banner thi:', err);
    }
  }

  function renderBannerDropdown() {
    if (!dom.selectBanner) return;
    const previousSelected = dom.selectBanner.value || state.runner.activeBannerId;
    dom.selectBanner.innerHTML = '';
    state.banners.forEach((b) => {
      const opt = document.createElement('option');
      opt.value = b.id;
      opt.textContent = `${b.title} (${b.totalQuestions} câu hỏi)`;
      if (b.id === previousSelected) opt.selected = true;
      dom.selectBanner.appendChild(opt);
    });

    const selectedBannerId = dom.selectBanner.value || state.runner.activeBannerId;
    const active = state.banners.find((b) => b.id === selectedBannerId);
    if (active) {
      if (dom.pillBannerName) dom.pillBannerName.textContent = active.title;
      if (dom.infoCurrentBanner) dom.infoCurrentBanner.textContent = active.title;
    }
  }

  // Hiển thị DẠNG LIST BANNER
  function renderBannersTable() {
    if (!dom.tbodyBanners) return;
    dom.tbodyBanners.innerHTML = '';

    if (!Array.isArray(state.banners) || state.banners.length === 0) {
      dom.tbodyBanners.innerHTML = `<tr><td colspan="5" class="text-center text-muted py-4">Chưa có banner nào! Bấm nút "+ Thêm Banner Mới" ở trên để tạo.</td></tr>`;
      return;
    }

    state.banners.forEach((b) => {
      const isSelected = b.id === state.currentBannerId;
      const isActiveExam = b.id === state.runner.activeBannerId;

      const tr = document.createElement('tr');
      if (isSelected) tr.className = 'row-selected';

      tr.innerHTML = `
        <td><b>#${b.key}</b></td>
        <td>
          <div style="font-weight: 600; color: #fff; font-size: 0.95rem;">${escapeHtml(b.title)}</div>
          <div style="font-size: 0.76rem; color: var(--text-muted); font-family: monospace;">Mã: ${b.id}</div>
        </td>
        <td style="text-align: center;">
          <span class="badge ${b.totalQuestions > 0 ? 'badge-success' : 'badge-idle'}" style="font-size: 0.78rem;">
            ${b.totalQuestions} câu hỏi
          </span>
        </td>
        <td style="text-align: center;">
          ${isActiveExam 
            ? '<span class="badge badge-running" style="font-size: 0.75rem;">🎯 Đang Chọn Thi</span>' 
            : '<span class="text-muted" style="font-size: 0.8rem;">--</span>'}
        </td>
        <td style="text-align: right;">
          <button class="btn btn-primary btn-xs btn-edit-banner-answers" data-id="${b.id}" title="Soạn thảo câu hỏi & đáp án cho banner này">
            📝 Sửa Đáp Án
          </button>
          <button class="btn ${isActiveExam ? 'btn-ghost' : 'btn-outline-cyan'} btn-xs btn-set-active-banner-row" data-id="${b.id}" ${isActiveExam ? 'disabled' : ''} title="Đặt làm banner thi chính">
            ${isActiveExam ? '✔ Đang Thi' : '🎯 Chọn Thi'}
          </button>
          <button class="btn btn-ghost btn-xs text-cyan btn-rename-banner-row" data-id="${b.id}" data-title="${escapeHtml(b.title)}" title="Đổi tên banner này">
            ✏️
          </button>
          <button class="btn btn-ghost btn-xs text-red btn-delete-banner-row" data-id="${b.id}" data-title="${escapeHtml(b.title)}" title="Xóa banner này">
            🗑️
          </button>
        </td>
      `;

      tr.querySelector('.btn-edit-banner-answers')?.addEventListener('click', (e) => {
        e.stopPropagation();
        selectAndEditBanner(b.id);
      });

      tr.querySelector('.btn-set-active-banner-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        setActiveBanner(b.id);
      });

      tr.querySelector('.btn-rename-banner-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        openRenameModal(b.id, b.title);
      });

      tr.querySelector('.btn-delete-banner-row')?.addEventListener('click', (e) => {
        e.stopPropagation();
        deleteBanner(b.id, b.title);
      });

      tr.addEventListener('click', () => {
        selectAndEditBanner(b.id);
      });

      dom.tbodyBanners.appendChild(tr);
    });
  }

  function selectAndEditBanner(bannerId) {
    state.currentBannerId = bannerId;
    renderBannersTable();
    const meta = state.banners.find((b) => b.id === bannerId);
    if (meta) {
      updateActiveBannerEditorHeader(meta);
    }
    loadBannerAnswers(bannerId);
    dom.bannerEditorSection?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
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

  // Lưu ngân hàng đáp án vào Supabase
  if (dom.btnSaveCurrentBannerAnswers) {
    dom.btnSaveCurrentBannerAnswers.addEventListener('click', () => {
      requireAuth(async () => {
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
            alert(`✔ Đã lưu thành công ${parsed.length} câu hỏi vào Supabase cho [${banner ? banner.title : state.currentBannerId}]!`);
          } else {
            alert('Lỗi lưu đáp án: ' + (data.message || 'Không xác định'));
          }
        } catch (err) {
          alert('Lỗi: Cú pháp JSON chưa hợp lệ! ' + err.message);
        }
      });
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
        state.runner.activeBannerId = bannerId;
        const b = state.banners.find((item) => item.id === bannerId);
        if (b) {
          if (dom.pillBannerName) dom.pillBannerName.textContent = b.title;
          if (dom.infoCurrentBanner) dom.infoCurrentBanner.textContent = b.title;
        }
        await setActiveBanner(bannerId);
      }
    });
  }

  // ==================== ĐỔI TÊN BANNER ====================
  let renamingBannerId = null;

  function openRenameModal(bannerId, currentTitle) {
    requireAuth(() => {
      renamingBannerId = bannerId;
      if (dom.inputModalBannerTitle) {
        dom.inputModalBannerTitle.value = currentTitle || '';
      }
      dom.modalRenameBanner?.classList.remove('hidden');
      setTimeout(() => dom.inputModalBannerTitle?.focus(), 100);
    });
  }

  function closeRenameModal() {
    renamingBannerId = null;
    dom.modalRenameBanner?.classList.add('hidden');
  }

  async function saveBannerTitleFromModal() {
    if (!renamingBannerId) return;
    const newTitle = dom.inputModalBannerTitle?.value.trim();
    if (!newTitle) return alert('Vui lòng nhập tên phần thi!');

    try {
      const res = await fetch(`/api/banners/${renamingBannerId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: newTitle }),
      });
      const data = await res.json();
      if (data.success) {
        const meta = state.banners.find((b) => b.id === renamingBannerId);
        if (meta) meta.title = newTitle;
        renderBannerDropdown();
        renderBannersTable();
        if (state.currentBannerId === renamingBannerId && meta) {
          updateActiveBannerEditorHeader(meta);
        }
        closeRenameModal();
      } else {
        alert('Lỗi: Không thể lưu tên phần thi mới!');
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  }

  dom.btnCloseRenameBannerModal?.addEventListener('click', closeRenameModal);
  dom.btnCancelRenameModal?.addEventListener('click', closeRenameModal);
  dom.btnConfirmRenameModal?.addEventListener('click', saveBannerTitleFromModal);
  dom.inputModalBannerTitle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') saveBannerTitleFromModal();
    if (e.key === 'Escape') closeRenameModal();
  });

  // Nút ✏️ Đổi Tên trong Header của Editor
  if (dom.btnOpenRename) {
    dom.btnOpenRename.addEventListener('click', () => {
      const cur = state.banners.find((b) => b.id === state.currentBannerId);
      openRenameModal(state.currentBannerId, cur?.title || '');
    });
  }
  if (dom.lblActiveEditorBannerName) {
    dom.lblActiveEditorBannerName.addEventListener('dblclick', () => {
      const cur = state.banners.find((b) => b.id === state.currentBannerId);
      openRenameModal(state.currentBannerId, cur?.title || '');
    });
  }

  // ==================== THÊM BANNER MỚI ====================
  function openAddBannerModal() {
    requireAuth(() => {
      if (dom.inputNewBannerTitle) dom.inputNewBannerTitle.value = '';
      if (dom.inputNewBannerDesc) dom.inputNewBannerDesc.value = '';
      dom.modalAddBanner?.classList.remove('hidden');
      setTimeout(() => dom.inputNewBannerTitle?.focus(), 100);
    });
  }

  function closeAddBannerModal() {
    dom.modalAddBanner?.classList.add('hidden');
  }

  async function createNewBanner() {
    const title = dom.inputNewBannerTitle?.value.trim();
    const description = dom.inputNewBannerDesc?.value.trim() || '';
    if (!title) return alert('Vui lòng nhập tên phần thi / banner mới!');

    try {
      const res = await fetch('/api/banners', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title, description }),
      });
      const data = await res.json();
      if (data.success) {
        closeAddBannerModal();
        await loadBanners();
        if (data.bannerId) {
          selectAndEditBanner(data.bannerId);
        }
      } else {
        alert('Lỗi: ' + (data.message || 'Không thể tạo banner!'));
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  }

  dom.btnOpenAddBannerModal?.addEventListener('click', openAddBannerModal);
  dom.btnCloseAddBannerModal?.addEventListener('click', closeAddBannerModal);
  dom.btnCancelAddBanner?.addEventListener('click', closeAddBannerModal);
  dom.btnConfirmAddBanner?.addEventListener('click', createNewBanner);
  dom.inputNewBannerTitle?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createNewBanner();
    if (e.key === 'Escape') closeAddBannerModal();
  });

  // ==================== XÓA BANNER ====================
  async function deleteBanner(bannerId, bannerTitle) {
    requireAuth(async () => {
      if (!confirm(`Bạn có chắc chắn muốn xóa phần thi [${bannerTitle}] (${bannerId}) và toàn bộ câu hỏi liên quan không?`)) {
        return;
      }
      try {
        const res = await fetch(`/api/banners/${bannerId}`, { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          await loadBanners();
        } else {
          alert('Lỗi: ' + (data.message || 'Không thể xóa banner!'));
        }
      } catch (err) {
        alert('Lỗi xóa banner: ' + err.message);
      }
    });
  }

  // 📋 Chèn mẫu 20 câu hỏi vào ô nhập
  if (dom.btnInsertSampleAnswers) {
    dom.btnInsertSampleAnswers.addEventListener('click', () => {
      requireAuth(() => {
        if (dom.textareaJsonAnswers.value.trim() && dom.textareaJsonAnswers.value !== '[]') {
          if (!confirm('Khung đáp án đã có dữ liệu. Bạn có muốn ghi đè bằng mẫu 20 câu hỏi chuẩn không?')) {
            return;
          }
        }
        const sample = Array.from({ length: 20 }, (_, i) => ({
          question: `Câu hỏi số ${i + 1}: Nội dung câu hỏi ở đây?`,
          options: [
            `Lựa chọn A của câu ${i + 1}`,
            `Lựa chọn B của câu ${i + 1}`,
            `Lựa chọn C của câu ${i + 1}`,
            `Lựa chọn D của câu ${i + 1}`,
          ],
          answer: `Lựa chọn A của câu ${i + 1}`,
        }));
        dom.textareaJsonAnswers.value = JSON.stringify(sample, null, 2);
        updateJsonAnswersStatus(sample.length);
      });
    });
  }

  // 📝 Bấm nút "Sửa Đáp Án" ở trang Dashboard chính
  if (dom.linkQuickEditBanner) {
    dom.linkQuickEditBanner.addEventListener('click', () => {
      const bannerId = dom.selectBanner.value || state.runner.activeBannerId;
      if (bannerId) {
        state.currentBannerId = bannerId;
      }
      document.getElementById('tab-nav-banners')?.click();
      selectAndEditBanner(state.currentBannerId);
    });
  }

  // ============================================================
  // ACCOUNTS MANAGEMENT
  // ============================================================
  async function loadAccounts(renderTable = true) {
    try {
      // Khi tạm ẩn phân lô, luôn nạp toàn bộ tài khoản
      const url = '/api/accounts';
      const res = await fetch(url);
      const data = await res.json();
      if (!data.success) return;

      state.accounts = data.accounts;
      dom.badgeTotalAccounts.textContent = state.accounts.length;

      renderStartAccountDropdown();
      renderBatchAccountsGrid();

      if (renderTable) {
        renderAccountsTable();
      }
      updateAccountCounts();
    } catch (err) {
      console.error('Lỗi nạp accounts:', err);
    }
  }

  async function loadLots() {
    try {
      const res = await fetch('/api/lots');
      const data = await res.json();
      if (!data.success) return;

      state.lots = data.lots || [];

      // 1. Cập nhật dropdown ở trang Dashboard
      if (dom.selectLot) {
        const curVal = dom.selectLot.value;
        dom.selectLot.innerHTML = '<option value="">Tất cả tài khoản</option>';
        state.lots.forEach((lot) => {
          const opt = document.createElement('option');
          opt.value = lot.id;
          opt.textContent = `${lot.name}${lot.accountCount ? ' (' + lot.accountCount + ' acc)' : ''}`;
          dom.selectLot.appendChild(opt);
        });
        if (curVal) dom.selectLot.value = curVal;
      }

      // 2. Cập nhật dropdown lọc ở bảng Danh Sách Tài Khoản
      if (dom.selectTableLotFilter) {
        const curVal = dom.selectTableLotFilter.value;
        dom.selectTableLotFilter.innerHTML = '<option value="">Tất cả các lô</option>';
        state.lots.forEach((lot) => {
          const opt = document.createElement('option');
          opt.value = lot.id;
          opt.textContent = `${lot.name}${lot.accountCount ? ' (' + lot.accountCount + ' acc)' : ''}`;
          dom.selectTableLotFilter.appendChild(opt);
        });
        if (curVal) dom.selectTableLotFilter.value = curVal;
      }

      // 3. Cập nhật dropdown chọn lô khi thêm mới tài khoản
      if (dom.selectNewAccLot) {
        const curVal = dom.selectNewAccLot.value;
        dom.selectNewAccLot.innerHTML = '<option value="">⚡ Tự động gán vào lô (tối đa 20 acc/lô)</option>';
        state.lots.forEach((lot) => {
          const opt = document.createElement('option');
          opt.value = lot.id;
          opt.textContent = `${lot.name}`;
          dom.selectNewAccLot.appendChild(opt);
        });
        if (curVal) dom.selectNewAccLot.value = curVal;
      }
    } catch (err) {
      console.error('Lỗi nạp lots:', err);
    }
  }
  window.reloadAllLots = loadLots;

  function renderStartAccountDropdown() {
    if (!dom.selectStartAccount) return;
    const currentVal = dom.selectStartAccount.value;
    dom.selectStartAccount.innerHTML = '';
    state.accounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = String(acc.index);
      opt.textContent = `#${acc.index} - ${acc.username}`;
      dom.selectStartAccount.appendChild(opt);
    });
    if (currentVal && dom.selectStartAccount.querySelector(`option[value="${currentVal}"]`)) {
      dom.selectStartAccount.value = currentVal;
    }
    renderSingleAccountDropdown();
  }

  function renderSingleAccountDropdown() {
    if (!dom.selectSingleAcc) return;
    const currentVal = dom.selectSingleAcc.value || (dom.selectStartAccount ? dom.selectStartAccount.value : '');
    dom.selectSingleAcc.innerHTML = '';
    state.accounts.forEach((acc) => {
      const opt = document.createElement('option');
      opt.value = String(acc.index);
      opt.textContent = `#${acc.index} - ${acc.username}`;
      dom.selectSingleAcc.appendChild(opt);
    });
    if (currentVal && dom.selectSingleAcc.querySelector(`option[value="${currentVal}"]`)) {
      dom.selectSingleAcc.value = currentVal;
    }
    updateSingleAccLabel();
  }

  function updateSingleAccLabel() {
    if (!dom.selectSingleAcc || !dom.singleAccIndexLabel) return;
    const total = state.accounts.length;
    const idx = dom.selectSingleAcc.selectedIndex >= 0 ? dom.selectSingleAcc.selectedIndex + 1 : 0;
    dom.singleAccIndexLabel.textContent = total > 0 ? `Tài khoản ${idx} / ${total}` : 'Chưa có tài khoản';
  }

  function renderMultiBannerCards() {
    if (!dom.singleMultiBannersGrid) return;
    if (!state.banners || state.banners.length === 0) {
      dom.singleMultiBannersGrid.innerHTML = '<div style="color: #94a3b8; font-size: 0.85rem; padding: 10px;">Đang tải danh sách banner...</div>';
      return;
    }

    // Preserve previously checked checkboxes
    const prevChecked = new Set();
    const existingBoxes = dom.singleMultiBannersGrid.querySelectorAll('input[type="checkbox"]');
    const isFirstTime = existingBoxes.length === 0;
    existingBoxes.forEach(cb => {
      if (cb.checked) prevChecked.add(cb.value);
    });

    dom.singleMultiBannersGrid.innerHTML = '';
    state.banners.forEach((b, i) => {
      const card = document.createElement('div');
      // If first time, check all banners by default. Otherwise keep user's checked state
      const isChecked = isFirstTime ? true : prevChecked.has(b.id);
      card.className = `multi-banner-card ${isChecked ? 'checked' : ''}`;
      card.setAttribute('data-banner-id', b.id);

      card.innerHTML = `
        <div style="display: flex; align-items: center; gap: 10px; pointer-events: none;">
          <input type="checkbox" id="chk-banner-${b.id}" value="${b.id}" ${isChecked ? 'checked' : ''} style="pointer-events: auto;">
          <div>
            <div style="font-weight: 700; color: #f8fafc; font-size: 0.88rem; line-height: 1.3;">${b.title}</div>
            <div style="font-size: 0.76rem; color: #94a3b8; margin-top: 3px;">
              Mã: <code style="color: #38bdf8;">${b.id}</code> • <span style="color: #34d399; font-weight: 600;">${b.totalQuestions} câu</span>
            </div>
          </div>
        </div>
        <span class="badge" style="background: rgba(245, 158, 11, 0.15); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.35); font-size: 0.72rem; padding: 2px 8px; border-radius: 8px; pointer-events: none;">
          #${i + 1}
        </span>
      `;

      card.addEventListener('click', (e) => {
        const cb = card.querySelector('input[type="checkbox"]');
        if (e.target !== cb) {
          cb.checked = !cb.checked;
        }
        if (cb.checked) {
          card.classList.add('checked');
        } else {
          card.classList.remove('checked');
        }
        updateSelectedBannersCount();
      });

      dom.singleMultiBannersGrid.appendChild(card);
    });

    updateSelectedBannersCount();
  }

  function updateSelectedBannersCount() {
    if (!dom.singleSelectedBannersCount) return;
    const checkedBoxes = dom.singleMultiBannersGrid ? dom.singleMultiBannersGrid.querySelectorAll('input[type="checkbox"]:checked') : [];
    const total = state.banners ? state.banners.length : 0;
    dom.singleSelectedBannersCount.textContent = `Đã chọn: ${checkedBoxes.length} / ${total} banner`;
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

  // ============================================================
  // CHẾ ĐỘ 1: BỘ CHỌN NHIỀU TÀI KHOẢN (BATCH SELECTOR)
  // ============================================================
  async function ensureCertificatesCache() {
    if (state.certResultsCache) return state.certResultsCache;
    try {
      const res = await fetch('/api/mac/certificates/results');
      const data = await res.json();
      if (data && data.success && data.results) {
        state.certResultsCache = data.results;
        return state.certResultsCache;
      }
    } catch (e) {
      console.warn('Không thể nạp trước kết quả chứng chỉ:', e);
    }
    return null;
  }

  async function renderBatchAccountsGrid() {
    if (!dom.batchAccountGrid) return;
    await ensureCertificatesCache();
    const certResults = state.certResultsCache || {};
    const currentBanner = dom.selectBanner?.value || state.currentBannerId || 'banner_2';

    const query = (state.batchSearchQuery || '').toLowerCase().trim();
    if (!query && dom.inputBatchSearch && dom.inputBatchSearch.value && document.activeElement !== dom.inputBatchSearch) {
      dom.inputBatchSearch.value = '';
    }
    const totalAccounts = state.accounts.length;

    // Tính toán số lượng cho các filter chips
    const selectedCount = state.batchSelectedUsernames.size;
    let noCertCount = 0;
    let errorCount = 0;

    state.accounts.forEach((acc) => {
      const certInfo = certResults[acc.username];
      const hasCert = !!(certInfo && certInfo.bannerStatus && certInfo.bannerStatus[currentBanner]);
      if (!hasCert) noCertCount++;
      if (acc.status === 'error' || (certInfo && certInfo.status === 'FAIL')) errorCount++;
    });

    if (dom.batchChipCountAll) dom.batchChipCountAll.textContent = totalAccounts;
    if (dom.batchChipCountSelected) dom.batchChipCountSelected.textContent = selectedCount;
    if (dom.batchChipCountNoCert) dom.batchChipCountNoCert.textContent = noCertCount;
    if (dom.batchChipCountError) dom.batchChipCountError.textContent = errorCount;

    // Header counter badge
    if (dom.batchSelectedCountBadge) {
      dom.batchSelectedCountBadge.textContent = `Đã chọn: ${selectedCount} / ${totalAccounts}`;
      if (selectedCount > 0) {
        dom.batchSelectedCountBadge.classList.add('active-selection');
      } else {
        dom.batchSelectedCountBadge.classList.remove('active-selection');
      }
    }

    // Dynamic Start Button
    if (dom.btnStartRun) {
      if (selectedCount > 0) {
        dom.btnStartRun.innerHTML = `<span class="icon">▶</span> CHẠY ${selectedCount} ACC ĐÃ CHỌN`;
        dom.btnStartRun.classList.add('running-selected');
        dom.btnStartRun.title = `Chạy chính xác ${selectedCount} tài khoản được chọn cho banner hiện tại`;
      } else {
        dom.btnStartRun.innerHTML = '<span class="icon">▶</span> BẮT ĐẦU CHẠY';
        dom.btnStartRun.classList.remove('running-selected');
        dom.btnStartRun.title = 'Chạy tự động liên tục từ tài khoản đã chọn ở "Bắt Đầu Từ"';
      }
    }

    // Lọc danh sách tài khoản hiển thị
    const filtered = state.accounts.filter((acc) => {
      const u = (acc.username || '').toLowerCase();
      const idxStr = String(acc.index || '');
      const certInfo = certResults[acc.username];
      const hasCertThisBanner = !!(certInfo && certInfo.bannerStatus && certInfo.bannerStatus[currentBanner]);

      // Filter query
      if (query) {
        const matchUser = u.includes(query);
        const matchIdx = idxStr === query || `#${idxStr}` === query;
        if (!matchUser && !matchIdx) return false;
      }

      // Filter chip
      if (state.batchFilterMode === 'selected') {
        if (!state.batchSelectedUsernames.has(acc.username)) return false;
      } else if (state.batchFilterMode === 'no_cert') {
        if (hasCertThisBanner) return false;
      } else if (state.batchFilterMode === 'error') {
        if (acc.status !== 'error' && (!certInfo || certInfo.status !== 'FAIL')) return false;
      }
      return true;
    });

    if (filtered.length === 0) {
      dom.batchAccountGrid.innerHTML = `
        <div style="grid-column: 1 / -1; text-align: center; color: #94a3b8; padding: 24px; font-size: 0.85rem;">
          ${totalAccounts === 0 ? 'Đang tải danh sách tài khoản...' : 'Không có tài khoản nào phù hợp với bộ lọc.'}
        </div>
      `;
      return;
    }

    dom.batchAccountGrid.innerHTML = '';
    const frag = document.createDocumentFragment();

    filtered.forEach((acc) => {
      const isChecked = state.batchSelectedUsernames.has(acc.username);
      const certInfo = certResults[acc.username];
      const hasCertThisBanner = !!(certInfo && certInfo.bannerStatus && certInfo.bannerStatus[currentBanner]);

      const card = document.createElement('div');
      card.className = `batch-acc-card ${isChecked ? 'selected' : ''}`;
      card.setAttribute('data-username', acc.username);
      card.setAttribute('data-idx', acc.index);

      let certTagHtml = '';
      if (certInfo && certInfo.checked_at) {
        if (hasCertThisBanner) {
          certTagHtml = '<span class="batch-cert-tag has-cert" title="Đã có chứng chỉ banner này">✓ Có CC</span>';
        } else {
          certTagHtml = '<span class="batch-cert-tag no-cert" title="Chưa có chứng chỉ banner này">Chưa CC</span>';
        }
      }

      card.innerHTML = `
        <input type="checkbox" class="chk-batch-acc" ${isChecked ? 'checked' : ''} tabindex="-1">
        <span class="batch-acc-idx">#${acc.index}</span>
        <div class="batch-acc-info">
          <div class="batch-acc-user" title="${escapeHtml(acc.username)}">${escapeHtml(acc.username)}</div>
          <div class="batch-acc-meta">
            ${certTagHtml}
            ${acc.status === 'error' ? '<span class="text-red">⚠️ Lỗi</span>' : ''}
          </div>
        </div>
      `;

      // Handle click with Shift + Click support
      card.addEventListener('click', (e) => {
        const chk = card.querySelector('.chk-batch-acc');
        let newCheckedState = !state.batchSelectedUsernames.has(acc.username);

        // If clicked on input itself, keep the input's current state
        if (e.target === chk) {
          newCheckedState = chk.checked;
        }

        if (e.shiftKey && state.batchLastClickedIndex !== null) {
          // Range selection
          const startIdx = Math.min(state.batchLastClickedIndex, acc.index);
          const endIdx = Math.max(state.batchLastClickedIndex, acc.index);
          state.accounts.forEach((a) => {
            if (a.index >= startIdx && a.index <= endIdx) {
              if (newCheckedState) {
                state.batchSelectedUsernames.add(a.username);
              } else {
                state.batchSelectedUsernames.delete(a.username);
              }
            }
          });
        } else {
          if (newCheckedState) {
            state.batchSelectedUsernames.add(acc.username);
          } else {
            state.batchSelectedUsernames.delete(acc.username);
          }
        }

        state.batchLastClickedIndex = acc.index;
        renderBatchAccountsGrid();
      });

      frag.appendChild(card);
    });

    dom.batchAccountGrid.appendChild(frag);
  }

  function renderAccountsTable() {
    const tbody = dom.tbodyAccounts;
    tbody.innerHTML = '';

    const query = state.accountSearchQuery.toLowerCase().trim();
    const filtered = state.accounts.filter((acc) => {
      // Filter lot
      if (state.selectedLotFilter && acc.lotId !== state.selectedLotFilter) return false;

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
      if (acc.error) {
        noteHtml += `<span class="text-red" title="${escapeHtml(acc.error)}">⚠️ ${escapeHtml(acc.error.slice(0, 40))}...</span>`;
      }
      if (!noteHtml) noteHtml = '<span class="text-muted">--</span>';

      const isChecked = state.selectedAccountUsernames.has(acc.username);

      tr.innerHTML = `
        <td>
          <input type="checkbox" class="chk-acc-row" data-user="${escapeHtml(acc.username)}" ${isChecked ? 'checked' : ''}>
        </td>
        <td><b>#${acc.index}</b></td>
        <td><span class="text-cyan font-semibold">${escapeHtml(acc.username)}</span></td>
        <td class="lot-feature-hidden"><span class="badge badge-info" style="font-size: 0.72rem;">${escapeHtml(acc.lotName || 'Chưa gán')}</span></td>
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
        startExecution({ startFromIndex: acc.index, limit: 1 });
      });

      tr.querySelector('.btn-delete-acc').addEventListener('click', () => {
        requireAuth(async () => {
          if (confirm(`Bạn có chắc muốn xóa tài khoản ${acc.username}?`)) {
            await fetch(`/api/accounts/${encodeURIComponent(acc.username)}`, { method: 'DELETE' });
            await loadLots();
            loadAccounts();
          }
        });
      });

      tbody.appendChild(tr);
    });

    updateSelectedCounter();
  }

  function updateSelectedCounter() {
    const count = state.selectedAccountUsernames.size;
    dom.selectedAccCount.textContent = count;
    dom.btnRunSelectedAccounts.disabled = count === 0;
    if (dom.selectedBackupCount) dom.selectedBackupCount.textContent = count;
    if (dom.btnAddSelectedToBackup) dom.btnAddSelectedToBackup.disabled = count === 0;
  }

  if (dom.btnAddSelectedToBackup) {
    dom.btnAddSelectedToBackup.addEventListener('click', async () => {
      const selectedUsers = Array.from(state.selectedAccountUsernames);
      if (selectedUsers.length === 0) return;
      const payload = selectedUsers.map(u => {
        const found = state.accounts.find(a => a.username === u);
        return { username: u, password: found?.password || '', error: found?.error || 'Thêm từ danh sách tài khoản' };
      });
      try {
        const res = await fetch('/api/backup-lot/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accounts: payload }),
        });
        const data = await res.json();
        if (data.success) {
          showToast(`✅ Đã thêm ${selectedUsers.length} tài khoản vào Lô Dự Phòng!`);
          await loadLots();
        } else {
          showToast(data.message || 'Lỗi thêm vào Lô Dự Phòng', true);
        }
      } catch (e) {
        showToast('Lỗi kết nối máy chủ', true);
      }
    });
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
    document.getElementById('tab-nav-dashboard')?.click();
    startExecution({ usernames });
  });

  // Tự động phân lô 20 tài khoản / lô
  if (dom.btnAutoPartition) {
    dom.btnAutoPartition.addEventListener('click', () => {
      requireAuth(async () => {
        if (!confirm('Hệ thống sẽ tự động cắt, đếm và chia toàn bộ tài khoản thành các lô (mỗi lô 20 tài khoản). Bạn có muốn tiếp tục?')) {
          return;
        }
        dom.btnAutoPartition.disabled = true;
        dom.btnAutoPartition.innerHTML = '<span class="icon">⏳</span> Đang phân lô...';
        try {
          const res = await fetch('/api/accounts/auto-partition', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lotSize: 20 }),
          });
          const data = await res.json();
          if (data.success) {
            alert(`✔ ${data.message || 'Phân lô thành công!'}`);
            await loadLots();
            await loadAccounts();
          } else {
            alert('Lỗi phân lô: ' + (data.message || 'Không xác định'));
          }
        } catch (err) {
          alert('Lỗi kết nối: ' + err.message);
        } finally {
          dom.btnAutoPartition.disabled = false;
          dom.btnAutoPartition.innerHTML = '<span class="icon">⚡</span> Tự Động Phân Lô (20 acc)';
        }
      });
    });
  }

  // Reset statuses
  dom.btnResetAllStatuses.addEventListener('click', () => {
    requireAuth(async () => {
      await fetch('/api/accounts/reset', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({}) });
      loadAccounts();
    });
  });

  // Modal Add Single Account
  dom.btnOpenAddAccModal.addEventListener('click', () => {
    requireAuth(() => {
      dom.inputNewAccUsername.value = '';
      dom.inputNewAccPassword.value = '';
      dom.modalAddAccount.classList.remove('hidden');
    });
  });

  dom.btnCloseAddAccModal.addEventListener('click', () => dom.modalAddAccount.classList.add('hidden'));
  dom.btnCancelAddAcc.addEventListener('click', () => dom.modalAddAccount.classList.add('hidden'));

  dom.btnConfirmAddAcc.addEventListener('click', async () => {
    const username = dom.inputNewAccUsername.value.trim();
    const password = dom.inputNewAccPassword.value.trim();
    const lotId = dom.selectNewAccLot?.value || undefined;
    if (!username || !password) return alert('Vui lòng điền đủ tài khoản và mật khẩu!');

    try {
      const res = await fetch('/api/accounts/add', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, lotId }),
      });
      const data = await res.json();
      if (data.success) {
        dom.modalAddAccount.classList.add('hidden');
        await loadLots();
        await loadAccounts();
      } else {
        alert(data.message || 'Lỗi thêm tài khoản!');
      }
    } catch (err) {
      alert('Lỗi: ' + err.message);
    }
  });

  // Modal Import / Edit JSON Accounts (Chính)
  dom.btnOpenImportAccModal.addEventListener('click', () => {
    requireAuth(() => {
      const rawList = state.accounts.map((a) => ({
        username: a.username,
        password: a.password,
      }));
      dom.textareaJsonAccounts.value = JSON.stringify(rawList, null, 2);
      dom.modalJsonAccounts.classList.remove('hidden');
    });
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
        await loadLots();
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
  // MODAL IMPORT JSON LÔ DỰ PHÒNG (KHÔNG CHECK TRÙNG)
  // ============================================================
  function parseBackupAccountsFromText(text) {
    if (!text || !text.trim()) return [];
    let parsed;
    try {
      parsed = JSON.parse(text.trim());
    } catch (e) {
      throw new Error('Cú pháp JSON chưa hợp lệ: ' + e.message);
    }

    let list = [];
    if (Array.isArray(parsed)) {
      list = parsed;
    } else if (parsed && Array.isArray(parsed.accounts)) {
      list = parsed.accounts;
    } else if (parsed && Array.isArray(parsed.users)) {
      list = parsed.users;
    } else if (parsed && typeof parsed === 'object') {
      // Nếu là object dạng {"0866251495": "matkhau", ...}
      list = Object.entries(parsed).map(([u, p]) => ({ username: u, password: String(p) }));
    } else {
      throw new Error('Dữ liệu phải là mảng [...] hoặc đối tượng { "accounts": [...] }');
    }

    return list.map(item => {
      if (typeof item === 'string') {
        return { username: item.trim(), password: '' };
      }
      return {
        username: String(item.username || item.user || item.phone || item.email || '').trim(),
        password: String(item.password || item.pass || '').trim(),
        error: item.error ? String(item.error) : 'Thêm từ file JSON Lô Dự Phòng',
      };
    }).filter(a => a.username);
  }

  function updateBackupJsonBadge() {
    if (!dom.textareaBackupJson || !dom.badgeBackupJsonCount) return;
    const val = dom.textareaBackupJson.value.trim();
    if (!val) {
      dom.badgeBackupJsonCount.textContent = '0 tài khoản nhận diện';
      dom.badgeBackupJsonCount.style.background = 'rgba(255, 255, 255, 0.1)';
      dom.badgeBackupJsonCount.style.color = 'var(--text-muted)';
      return;
    }
    try {
      const list = parseBackupAccountsFromText(val);
      dom.badgeBackupJsonCount.textContent = `${list.length} tài khoản hợp lệ`;
      dom.badgeBackupJsonCount.style.background = 'rgba(16, 185, 129, 0.2)';
      dom.badgeBackupJsonCount.style.color = '#34d399';
    } catch (err) {
      dom.badgeBackupJsonCount.textContent = '⚠️ Cú pháp JSON chưa đúng';
      dom.badgeBackupJsonCount.style.background = 'rgba(239, 68, 68, 0.2)';
      dom.badgeBackupJsonCount.style.color = '#f87171';
    }
  }

  if (dom.btnOpenImportBackupModal) {
    dom.btnOpenImportBackupModal.addEventListener('click', () => {
      requireAuth(async () => {
        // Nạp danh sách Lô Dự Phòng hiện có để xem/chỉnh sửa nếu khung đang trống
        if (!dom.textareaBackupJson.value.trim()) {
          try {
            const res = await fetch('/api/backup-lot');
            const data = await res.json();
            if (data.success && Array.isArray(data.accounts) && data.accounts.length > 0) {
              const preview = data.accounts.map(a => ({
                username: a.username,
                password: a.password,
                error: a.error || undefined
              }));
              dom.textareaBackupJson.value = JSON.stringify(preview, null, 2);
            }
          } catch (e) {
            console.warn('Lỗi đọc backup lot:', e);
          }
        }
        updateBackupJsonBadge();
        dom.modalImportBackupLot.classList.remove('hidden');
      });
    });
  }

  if (dom.btnCloseImportBackupModal) {
    dom.btnCloseImportBackupModal.addEventListener('click', () => {
      dom.modalImportBackupLot.classList.add('hidden');
    });
  }

  if (dom.btnCancelImportBackup) {
    dom.btnCancelImportBackup.addEventListener('click', () => {
      dom.modalImportBackupLot.classList.add('hidden');
    });
  }

  if (dom.fileImportBackupJson) {
    dom.fileImportBackupJson.addEventListener('change', (e) => {
      const file = e.target.files?.[0];
      if (!file) return;
      if (dom.labelBackupFileName) {
        dom.labelBackupFileName.textContent = `📄 ${file.name} (${(file.size / 1024).toFixed(1)} KB)`;
        dom.labelBackupFileName.style.color = '#38bdf8';
      }
      const reader = new FileReader();
      reader.onload = (event) => {
        dom.textareaBackupJson.value = event.target?.result || '';
        updateBackupJsonBadge();
      };
      reader.onerror = () => {
        alert('Không thể đọc file: ' + reader.error);
      };
      reader.readAsText(file);
    });
  }

  if (dom.btnClearBackupTextarea) {
    dom.btnClearBackupTextarea.addEventListener('click', () => {
      dom.textareaBackupJson.value = '';
      if (dom.labelBackupFileName) {
        dom.labelBackupFileName.textContent = 'Chưa chọn file nào';
        dom.labelBackupFileName.style.color = 'var(--text-muted)';
      }
      if (dom.fileImportBackupJson) dom.fileImportBackupJson.value = '';
      updateBackupJsonBadge();
    });
  }

  if (dom.textareaBackupJson) {
    dom.textareaBackupJson.addEventListener('input', updateBackupJsonBadge);
  }

  if (dom.btnConfirmImportBackup) {
    dom.btnConfirmImportBackup.addEventListener('click', async () => {
      try {
        const accounts = parseBackupAccountsFromText(dom.textareaBackupJson.value);
        if (accounts.length === 0) {
          return alert('Chưa tìm thấy tài khoản hợp lệ nào trong nội dung JSON!');
        }

        const isReplace = dom.chkReplaceBackupLot?.checked || false;
        dom.btnConfirmImportBackup.disabled = true;
        const originalText = dom.btnConfirmImportBackup.textContent;
        dom.btnConfirmImportBackup.textContent = '⏳ Đang nạp...';

        const res = await fetch('/api/backup-lot/add', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ accounts, replace: isReplace }),
        });
        const data = await res.json();

        if (data.success) {
          dom.modalImportBackupLot.classList.add('hidden');
          await loadLots();

          // Chuyển bộ lọc bảng sang Lô Dự Phòng và nạp dữ liệu hiển thị ngay
          if (dom.selectTableLotFilter) {
            dom.selectTableLotFilter.value = 'lot_backup';
            state.selectedLotFilter = 'lot_backup';
          }
          const resBackup = await fetch('/api/accounts?lotId=lot_backup');
          const dataBackup = await resBackup.json();
          if (dataBackup.success) {
            state.accounts = dataBackup.accounts;
            renderAccountsTable();
            updateAccountCounts();
          }

          alert(`✅ ${data.message}`);
        } else {
          alert('Lỗi nạp Lô Dự Phòng: ' + (data.message || 'Thất bại'));
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      } finally {
        dom.btnConfirmImportBackup.disabled = false;
        dom.btnConfirmImportBackup.textContent = '⚡ Nạp Vào Lô Dự Phòng';
      }
    });
  }

  if (dom.btnEmptyBackupLotDirect) {
    dom.btnEmptyBackupLotDirect.addEventListener('click', async () => {
      if (!confirm('Bạn có chắc chắn muốn XÓA SẠCH toàn bộ tài khoản trong Lô Dự Phòng?')) return;
      try {
        const res = await fetch('/api/backup-lot', { method: 'DELETE' });
        const data = await res.json();
        if (data.success) {
          dom.textareaBackupJson.value = '';
          if (dom.labelBackupFileName) dom.labelBackupFileName.textContent = 'Chưa chọn file nào';
          updateBackupJsonBadge();
          await loadLots();

          if (state.selectedLotFilter === 'lot_backup') {
            state.accounts = [];
            renderAccountsTable();
            updateAccountCounts();
          }
          alert('Đã xóa sạch tài khoản trong Lô Dự Phòng!');
        } else {
          alert('Lỗi xóa: ' + data.message);
        }
      } catch (err) {
        alert('Lỗi: ' + err.message);
      }
    });
  }


  // ============================================================
  // DEVICES
  // ============================================================
  async function loadDevices() {
    try {
      const res = await fetch('/api/devices');
      const data = await res.json();
      if (!data.success) return;

      state.devices = data.devices;
      if (dom.selectDevice) {
        dom.selectDevice.innerHTML = `
          <option value="mac_native" selected>🍏 App macOS Native (Thanh niên VN)</option>
        `;
      }
    } catch (err) {
      console.error('Lỗi quét thiết bị:', err);
    }
  }

  if (dom.btnReconnectAdb) {
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
  }

  if (dom.btnTriggerLdplayerConnect) {
    dom.btnTriggerLdplayerConnect.addEventListener('click', () => dom.btnReconnectAdb.click());
  }

  // ============================================================
  // EXECUTION CONTROLLER (START / STOP / RESUME)
  // ============================================================
  async function startExecution(customOptions = {}) {
    try {
      const bannerId = customOptions.bannerId || dom.selectBanner?.value || state.currentBannerId;
      const lotId = customOptions.lotId || undefined;
      const banners = customOptions.banners || undefined;

      // Xác định danh sách tài khoản muốn chạy
      let usernamesToRun = null;
      if (customOptions.usernames && Array.isArray(customOptions.usernames) && customOptions.usernames.length > 0) {
        usernamesToRun = customOptions.usernames;
      } else if (customOptions.limit !== 1 && state.batchSelectedUsernames.size > 0) {
        usernamesToRun = Array.from(state.batchSelectedUsernames);
      }

      let selectedAccounts = undefined;
      if (usernamesToRun && usernamesToRun.length > 0) {
        const accMap = new Map(state.accounts.map((a) => [a.username.toLowerCase(), a]));
        selectedAccounts = usernamesToRun.map((u) => accMap.get(u.toLowerCase()) || { username: u });
      }

      // Đọc chính xác giá trị từ dropdown Bắt Đầu Từ
      let startFromIndex = customOptions.startFromIndex;
      if (!startFromIndex) {
        const val = dom.selectStartAccount?.value;
        if (val) startFromIndex = parseInt(val, 10);
      }
      if (!startFromIndex || isNaN(startFromIndex)) {
        // Fallback đọc từ text option đang chọn nếu value rỗng
        const selOpt = dom.selectStartAccount?.selectedOptions?.[0];
        if (selOpt) {
          const m = selOpt.textContent.match(/#(\d+)/);
          if (m) startFromIndex = parseInt(m[1], 10);
        }
      }
      if (!startFromIndex || isNaN(startFromIndex)) startFromIndex = 1;

      console.log('🚀 [startExecution] Bắt đầu chạy:', { bannerId, banners, startFromIndex, usernamesCount: usernamesToRun?.length });

      // Luôn gọi API Mac Native (chạy script đa tài khoản thật OCR + đối chiếu đáp án chuẩn)
      dom.btnStartRun.classList.add('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.add('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.add('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.add('hidden');
      dom.btnStopRun.classList.remove('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.remove('hidden');

      const limit = customOptions.limit || undefined;
      let res = await fetch('/api/mac/flow/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bannerId,
          banners,
          startFromIndex,
          lotId,
          limit,
          usernames: usernamesToRun,
          selectedAccounts,
        }),
      });
      let data = await res.json();

      // Zero-restart fallback: nếu server cũ chưa restart và không nhận usernames, tự đẩy vào backup-lot
      if (!data.success && selectedAccounts && selectedAccounts.length > 0) {
        try {
          await fetch('/api/backup-lot/add', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ accounts: selectedAccounts, replace: true }),
          });
          res = await fetch('/api/mac/flow/start', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ bannerId, banners, lotId: 'lot_backup', startFromIndex: 1, limit }),
          });
          data = await res.json();
        } catch (e) {}
      }

      if (!data.success) {
        alert('Không thể bắt đầu: ' + data.message);
        dom.btnStartRun.classList.remove('hidden');
        if (dom.btnStartSingle) dom.btnStartSingle.classList.remove('hidden');
        if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.remove('hidden');
        if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.remove('hidden');
        dom.btnStopRun.classList.add('hidden');
        if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.add('hidden');
      } else {
        state.lastRunLimit = limit;
      }
      return;
    } catch (err) {
      alert('Lỗi gửi lệnh bắt đầu: ' + err.message);
      dom.btnStartRun.classList.remove('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.remove('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.remove('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.remove('hidden');
      dom.btnStopRun.classList.add('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.add('hidden');
    }
  }

  dom.btnStartRun.addEventListener('click', () => startExecution());

  if (dom.btnStartSingle) {
    dom.btnStartSingle.addEventListener('click', () => {
      if (state.batchSelectedUsernames.size === 1) {
        const singleUser = Array.from(state.batchSelectedUsernames)[0];
        startExecution({ usernames: [singleUser], limit: 1 });
      } else {
        startExecution({ limit: 1 });
      }
    });
  }

  // Batch Multi-Account Selector Actions
  if (dom.btnBatchSelectAll) {
    dom.btnBatchSelectAll.addEventListener('click', () => {
      const certResults = state.certResultsCache || {};
      const currentBanner = dom.selectBanner?.value || state.currentBannerId || 'banner_2';
      const query = (state.batchSearchQuery || '').toLowerCase().trim();

      state.accounts.forEach((acc) => {
        const u = (acc.username || '').toLowerCase();
        const idxStr = String(acc.index || '');
        const certInfo = certResults[acc.username];
        const hasCertThisBanner = !!(certInfo && certInfo.bannerStatus && certInfo.bannerStatus[currentBanner]);

        if (query && !u.includes(query) && idxStr !== query && `#${idxStr}` !== query) return;
        if (state.batchFilterMode === 'no_cert' && hasCertThisBanner) return;
        if (state.batchFilterMode === 'error' && acc.status !== 'error' && (!certInfo || certInfo.status !== 'FAIL')) return;

        state.batchSelectedUsernames.add(acc.username);
      });
      renderBatchAccountsGrid();
    });
  }

  if (dom.btnBatchDeselectAll) {
    dom.btnBatchDeselectAll.addEventListener('click', () => {
      state.batchSelectedUsernames.clear();
      state.batchLastClickedIndex = null;
      renderBatchAccountsGrid();
    });
  }

  if (dom.btnBatchInvert) {
    dom.btnBatchInvert.addEventListener('click', () => {
      state.accounts.forEach((acc) => {
        if (state.batchSelectedUsernames.has(acc.username)) {
          state.batchSelectedUsernames.delete(acc.username);
        } else {
          state.batchSelectedUsernames.add(acc.username);
        }
      });
      renderBatchAccountsGrid();
    });
  }

  if (dom.btnBatchSelectNoCert) {
    dom.btnBatchSelectNoCert.addEventListener('click', async () => {
      await ensureCertificatesCache();
      const certResults = state.certResultsCache || {};
      const currentBanner = dom.selectBanner?.value || state.currentBannerId || 'banner_2';
      let added = 0;
      state.accounts.forEach((acc) => {
        const certInfo = certResults[acc.username];
        const hasCert = !!(certInfo && certInfo.bannerStatus && certInfo.bannerStatus[currentBanner]);
        if (!hasCert) {
          state.batchSelectedUsernames.add(acc.username);
          added++;
        }
      });
      renderBatchAccountsGrid();
      alert(`Đã chọn ${added} tài khoản chưa có chứng chỉ cho banner đang chọn!`);
    });
  }

  if (dom.btnBatchSelectRange) {
    dom.btnBatchSelectRange.addEventListener('click', () => {
      const fromVal = parseInt(dom.inputBatchRangeFrom?.value, 10);
      const toVal = parseInt(dom.inputBatchRangeTo?.value, 10);
      if (isNaN(fromVal) || isNaN(toVal) || fromVal > toVal) {
        return alert('Vui lòng nhập khoảng STT hợp lệ (ví dụ: Từ #1 Đến #20)');
      }
      state.accounts.forEach((acc) => {
        if (acc.index >= fromVal && acc.index <= toVal) {
          state.batchSelectedUsernames.add(acc.username);
        }
      });
      renderBatchAccountsGrid();
    });
  }

  if (dom.btnBatchDeselectRange) {
    dom.btnBatchDeselectRange.addEventListener('click', () => {
      const fromVal = parseInt(dom.inputBatchRangeFrom?.value, 10);
      const toVal = parseInt(dom.inputBatchRangeTo?.value, 10);
      if (isNaN(fromVal) || isNaN(toVal) || fromVal > toVal) return;
      state.accounts.forEach((acc) => {
        if (acc.index >= fromVal && acc.index <= toVal) {
          state.batchSelectedUsernames.delete(acc.username);
        }
      });
      renderBatchAccountsGrid();
    });
  }

  if (dom.btnBatchPasteList) {
    dom.btnBatchPasteList.addEventListener('click', () => {
      const raw = prompt('Dán danh sách tài khoản (SĐT, Email, hoặc khoảng STT ví dụ: 1-20, 25, 30):');
      if (!raw) return;
      const tokens = raw.split(/[\n,;\t ]+/).map((t) => t.trim()).filter(Boolean);
      const userMap = new Map(state.accounts.map((a) => [a.username.toLowerCase(), a]));
      const indexMap = new Map(state.accounts.map((a) => [a.index, a]));
      let matched = 0;

      tokens.forEach((tok) => {
        const rangeMatch = tok.match(/^#?(\d+)\s*[-~]\s*#?(\d+)$/);
        if (rangeMatch) {
          const start = parseInt(rangeMatch[1], 10);
          const end = parseInt(rangeMatch[2], 10);
          const min = Math.min(start, end);
          const max = Math.max(start, end);
          for (let i = min; i <= max; i++) {
            const acc = indexMap.get(i);
            if (acc) {
              state.batchSelectedUsernames.add(acc.username);
              matched++;
            }
          }
          return;
        }

        const numMatch = tok.match(/^#?(\d+)$/);
        if (numMatch) {
          const num = parseInt(numMatch[1], 10);
          const acc = indexMap.get(num);
          if (acc) {
            state.batchSelectedUsernames.add(acc.username);
            matched++;
            return;
          }
        }

        const acc = userMap.get(tok.toLowerCase());
        if (acc) {
          state.batchSelectedUsernames.add(acc.username);
          matched++;
        }
      });

      alert(`Đã nhận diện và chọn ${matched} tài khoản phù hợp!`);
      renderBatchAccountsGrid();
    });
  }

  if (dom.inputBatchSearch) {
    dom.inputBatchSearch.addEventListener('input', (e) => {
      state.batchSearchQuery = e.target.value;
      if (dom.btnBatchSearchClear) {
        dom.btnBatchSearchClear.style.display = e.target.value ? 'block' : 'none';
      }
      renderBatchAccountsGrid();
    });

    dom.inputBatchSearch.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        dom.inputBatchSearch.value = '';
        state.batchSearchQuery = '';
        if (dom.btnBatchSearchClear) dom.btnBatchSearchClear.style.display = 'none';
        renderBatchAccountsGrid();
      }
    });
  }

  if (dom.btnBatchSearchClear) {
    dom.btnBatchSearchClear.addEventListener('click', () => {
      if (dom.inputBatchSearch) {
        dom.inputBatchSearch.value = '';
        state.batchSearchQuery = '';
        dom.btnBatchSearchClear.style.display = 'none';
        dom.inputBatchSearch.focus();
        renderBatchAccountsGrid();
      }
    });
  }

  if (dom.batchFilterChips) {
    dom.batchFilterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        dom.batchFilterChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.batchFilterMode = chip.getAttribute('data-batch-filter') || 'all';
        renderBatchAccountsGrid();
      });
    });
  }

  if (dom.selectBanner) {
    dom.selectBanner.addEventListener('change', () => {
      renderBatchAccountsGrid();
    });
  }

  dom.btnStopRun.addEventListener('click', async () => {
    await fetch('/api/mac/flow/stop', { method: 'POST' }).catch(() => {});
    await fetch('/api/action/stop', { method: 'POST' }).catch(() => {});
    dom.btnStartRun.classList.remove('hidden');
    if (dom.btnStartSingle) dom.btnStartSingle.classList.remove('hidden');
    if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.remove('hidden');
    if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.remove('hidden');
    dom.btnStopRun.classList.add('hidden');
    if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.add('hidden');
  });

  if (dom.btnStopSingleMulti) {
    dom.btnStopSingleMulti.addEventListener('click', async () => {
      await fetch('/api/mac/flow/stop', { method: 'POST' }).catch(() => {});
      await fetch('/api/action/stop', { method: 'POST' }).catch(() => {});
      dom.btnStartRun.classList.remove('hidden');
      if (dom.btnStartSingle) dom.btnStartSingle.classList.remove('hidden');
      if (dom.btnStartSingleMulti) dom.btnStartSingleMulti.classList.remove('hidden');
      if (dom.btnRunFailedOnly) dom.btnRunFailedOnly.classList.remove('hidden');
      dom.btnStopRun.classList.add('hidden');
      if (dom.btnStopSingleMulti) dom.btnStopSingleMulti.classList.add('hidden');
    });
  }

  // Chế độ 2: Chạy đơn thi nhiều banner
  if (dom.btnStartSingleMulti) {
    dom.btnStartSingleMulti.addEventListener('click', () => {
      if (!dom.singleMultiBannersGrid) return;
      const checkedBoxes = Array.from(dom.singleMultiBannersGrid.querySelectorAll('input[type="checkbox"]:checked'));
      const selectedBanners = checkedBoxes.map((cb) => cb.value);

      if (selectedBanners.length === 0) {
        alert('⚠️ Vui lòng tích chọn ít nhất 1 banner để thi liên hoàn!');
        return;
      }

      let selectedAccIdx = 1;
      if (dom.selectSingleAcc && dom.selectSingleAcc.value) {
        const val = dom.selectSingleAcc.value;
        const num = parseInt(val, 10);
        if (!isNaN(num)) selectedAccIdx = num;
      }

      startExecution({
        startFromIndex: selectedAccIdx,
        limit: 1,
        banners: selectedBanners,
        bannerId: selectedBanners[0],
      });
    });
  }

  // Area Tab Switcher
  if (dom.btnModeTabBatch && dom.btnModeTabSingleMulti) {
    dom.btnModeTabBatch.addEventListener('click', () => {
      dom.btnModeTabBatch.className = 'btn-area-tab active-batch';
      dom.btnModeTabSingleMulti.className = 'btn-area-tab';
      if (dom.panelModeBatch) dom.panelModeBatch.classList.remove('hidden');
      if (dom.panelModeSingleMulti) dom.panelModeSingleMulti.classList.add('hidden');
      if (dom.activeModeIndicator) {
        dom.activeModeIndicator.textContent = 'Chế Độ 1: Chạy Hàng Loạt';
        dom.activeModeIndicator.style.color = '#38bdf8';
        dom.activeModeIndicator.style.background = 'rgba(6, 182, 212, 0.15)';
        dom.activeModeIndicator.style.borderColor = 'rgba(6, 182, 212, 0.3)';
      }
    });

    dom.btnModeTabSingleMulti.addEventListener('click', () => {
      dom.btnModeTabBatch.className = 'btn-area-tab';
      dom.btnModeTabSingleMulti.className = 'btn-area-tab active-single';
      if (dom.panelModeBatch) dom.panelModeBatch.classList.add('hidden');
      if (dom.panelModeSingleMulti) dom.panelModeSingleMulti.classList.remove('hidden');
      if (dom.activeModeIndicator) {
        dom.activeModeIndicator.textContent = 'Chế Độ 2: Chạy Đơn (Thi Nhiều Banner)';
        dom.activeModeIndicator.style.color = '#fbbf24';
        dom.activeModeIndicator.style.background = 'rgba(245, 158, 11, 0.15)';
        dom.activeModeIndicator.style.borderColor = 'rgba(245, 158, 11, 0.35)';
      }
      renderMultiBannerCards();
      updateSingleAccLabel();
    });
  }

  // Banner Checkbox Select/Deselect All
  if (dom.btnSelectAllBanners) {
    dom.btnSelectAllBanners.addEventListener('click', () => {
      if (!dom.singleMultiBannersGrid) return;
      dom.singleMultiBannersGrid.querySelectorAll('.multi-banner-card').forEach((card) => {
        card.classList.add('checked');
        const cb = card.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = true;
      });
      updateSelectedBannersCount();
    });
  }

  if (dom.btnDeselectAllBanners) {
    dom.btnDeselectAllBanners.addEventListener('click', () => {
      if (!dom.singleMultiBannersGrid) return;
      dom.singleMultiBannersGrid.querySelectorAll('.multi-banner-card').forEach((card) => {
        card.classList.remove('checked');
        const cb = card.querySelector('input[type="checkbox"]');
        if (cb) cb.checked = false;
      });
      updateSelectedBannersCount();
    });
  }

  // Account selector sync & Prev/Next buttons
  if (dom.selectSingleAcc) {
    dom.selectSingleAcc.addEventListener('change', () => {
      updateSingleAccLabel();
      if (dom.selectStartAccount) dom.selectStartAccount.value = dom.selectSingleAcc.value;
    });
  }
  if (dom.selectStartAccount) {
    dom.selectStartAccount.addEventListener('change', () => {
      if (dom.selectSingleAcc) {
        dom.selectSingleAcc.value = dom.selectStartAccount.value;
        updateSingleAccLabel();
      }
    });
  }
  if (dom.btnSinglePrevAcc) {
    dom.btnSinglePrevAcc.addEventListener('click', () => {
      if (dom.selectSingleAcc && dom.selectSingleAcc.selectedIndex > 0) {
        dom.selectSingleAcc.selectedIndex -= 1;
        updateSingleAccLabel();
        if (dom.selectStartAccount) dom.selectStartAccount.value = dom.selectSingleAcc.value;
      }
    });
  }
  if (dom.btnSingleNextAcc) {
    dom.btnSingleNextAcc.addEventListener('click', () => {
      if (dom.selectSingleAcc && dom.selectSingleAcc.selectedIndex < dom.selectSingleAcc.options.length - 1) {
        dom.selectSingleAcc.selectedIndex += 1;
        updateSingleAccLabel();
        if (dom.selectStartAccount) dom.selectStartAccount.value = dom.selectSingleAcc.value;
      }
    });
  }

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
      document.getElementById('tab-nav-dashboard')?.click();
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
    // Chống trình duyệt tự động điền (autofill) tài khoản đã lưu vào ô tìm kiếm
    const resetSearchInput = () => {
      if (dom.inputBatchSearch && document.activeElement !== dom.inputBatchSearch) {
        dom.inputBatchSearch.value = '';
        state.batchSearchQuery = '';
        if (dom.btnBatchSearchClear) dom.btnBatchSearchClear.style.display = 'none';
      }
    };
    resetSearchInput();
    setTimeout(resetSearchInput, 100);
    setTimeout(resetSearchInput, 300);
    setTimeout(resetSearchInput, 700);

    await loadBanners();
    // Tự động kết nối các port LDPlayer khi tải trang (giống bấm nút Quét Máy Ảo)
    try {
      await fetch('/api/devices/scan', { method: 'POST' });
    } catch {}
    await loadDevices();
    await loadLots();
    await loadAccounts();
    connectSse();

    // Khi đổi lô ở Dashboard → load lại danh sách tài khoản theo lô
    if (dom.selectLot) {
      dom.selectLot.addEventListener('change', () => loadAccounts());
    }

    // Khi đổi lô ở bảng Tài khoản → lọc trực tiếp
    if (dom.selectTableLotFilter) {
      dom.selectTableLotFilter.addEventListener('change', async (e) => {
        state.selectedLotFilter = e.target.value;
        if (state.selectedLotFilter === 'lot_backup') {
          try {
            const res = await fetch('/api/accounts?lotId=lot_backup');
            const data = await res.json();
            if (data.success) {
              state.accounts = data.accounts;
              renderAccountsTable();
              updateAccountCounts();
              return;
            }
          } catch (err) {
            console.error('Lỗi nạp Lô Dự Phòng:', err);
          }
        } else {
          await loadAccounts();
          return;
        }
        renderAccountsTable();
      });
    }
  }


  init();
})();
