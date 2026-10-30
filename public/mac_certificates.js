/**
 * mac_certificates.js — Module Kiểm Tra & Tổng Hợp Chứng Chỉ Hàng Loạt
 * Tự động đăng nhập, truy cập Học và thi -> Chứng chỉ, OCR đếm số chứng chỉ và xuất file tổng hợp.
 */
(function () {
  'use strict';

  // ── State ──────────────────────────────────────────────────────────────────
  const state = {
    isRunning: false,
    currentAccount: '',
    stats: { total: 0, checked: 0, withCerts: 0, noCerts: 0, fail: 0, totalCertsCount: 0 },
    accounts: [],
    lots: [],
    results: {}, // username -> { status, error, checked_at, index, lotId, password, fullName, certCount, certificates }
    filter: 'all', // 'all' | 'has_certs' | 'no_certs' | 'fail'
    searchQuery: '',
    logCount: 0,
  };

  // ── DOM Elements Cache ─────────────────────────────────────────────────────
  let dom = {};

  function initDom() {
    dom = {
      tabNavBtn: document.getElementById('tab-nav-certificates'),
      badgeCertsCount: document.getElementById('badge-certs-count'),

      // Controls
      selectLot: document.getElementById('select-cert-lot'),
      selectStart: document.getElementById('select-cert-start'),
      selectLimit: document.getElementById('select-cert-limit'),
      chkRecheckEmpty: document.getElementById('chk-recheck-empty-certs'),
      chkRecheckFailed: document.getElementById('chk-recheck-failed-certs'),
      btnStart: document.getElementById('btn-start-certs'),
      btnStop: document.getElementById('btn-stop-certs'),

      // Status Box
      statusBadge: document.getElementById('cert-status-badge'),
      currentAccText: document.getElementById('cert-current-acc'),
      currentLotText: document.getElementById('cert-current-lot'),
      lastDetectedName: document.getElementById('cert-last-detected-name'),
      lastDetectedCount: document.getElementById('cert-last-detected-count'),

      // Live Console Log
      certConsoleOutput: document.getElementById('cert-console-output'),
      chkCertAutoscroll: document.getElementById('chk-cert-autoscroll'),
      btnCopyCertLogs: document.getElementById('btn-copy-cert-logs'),
      btnClearCertLogs: document.getElementById('btn-clear-cert-logs'),
      badgeCertLogCount: document.getElementById('badge-cert-log-count'),

      // Stats Cards
      statTotal: document.getElementById('stat-cert-total'),
      statDone: document.getElementById('stat-cert-done'),
      statWithCerts: document.getElementById('stat-cert-with-certs'),
      statTotalCerts: document.getElementById('stat-cert-total-certs'),
      statFail: document.getElementById('stat-cert-fail'),

      // Filters
      inputSearch: document.getElementById('input-search-cert'),
      filterChips: document.querySelectorAll('[data-cert-filter]'),
      filterAllCount: document.getElementById('filter-cert-all-count'),
      filterWithCertsCount: document.getElementById('filter-cert-with-certs-count'),
      filterMissingCount: document.getElementById('filter-cert-missing-count'),
      filterNoCertsCount: document.getElementById('filter-cert-no-certs-count'),
      filterFailCount: document.getElementById('filter-cert-fail-count'),

      // Table
      tbody: document.getElementById('tbody-cert-results'),

      // Action Buttons
      btnExportCsv: document.getElementById('btn-export-certs-csv'),
      btnDownloadJson: document.getElementById('btn-download-certs-json'),
      btnCopyClipboard: document.getElementById('btn-copy-certs-clipboard'),
      btnClearHistory: document.getElementById('btn-clear-certs-history'),
    };
  }

  // ── Certificate & Banner Mapping Helper ────────────────────────────────────
  function mapCertificatesToBanners(certList) {
    if (!certList || !Array.isArray(certList)) return { list: [], map: {} };
    const completed = new Set();
    certList.forEach((c) => {
      const p = (c || '')
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .replace(/[đĐ]/g, 'd')
        .toUpperCase();

      if (p.includes('PHAM HUU LAU') || p.includes('HUU LAU')) {
        completed.add('banner_4');
      } else if (p.includes('CB DOAN') || p.includes('CAN BO DOAN') || p.includes('CAN BO')) {
        completed.add('banner_6');
      } else if (
        (p.includes('DVTN') ||
          p.includes('DVIN') ||
          p.includes('HO CHI MINH') ||
          p.includes('TU TUONG') ||
          p.includes('PHONG CACH') ||
          p.includes('DOAN VIEN THANH NIEN') ||
          p.includes('DOAN VIEN') ||
          p.includes('THANH NIEN')) &&
        !p.includes('CB') &&
        !p.includes('CAN BO')
      ) {
        completed.add('banner_3');
      } else if (p.includes('XIV') || p.includes('DAI HOI XIV') || p.includes('NGHI QUYET XIV')) {
        completed.add('banner_2');
      } else if (p.includes('XIII') || p.includes('XII') || p.includes('DAI HOI DOAN') || p.includes('NGHIEN CUU') || p.includes('NGHI QUYET DOAN')) {
        completed.add('banner_1');
      }
    });

    return {
      list: Array.from(completed).sort(),
      map: {
        banner_1: completed.has('banner_1'),
        banner_2: completed.has('banner_2'),
        banner_3: completed.has('banner_3'),
        banner_4: completed.has('banner_4'),
        banner_6: completed.has('banner_6'),
      },
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

    toast.style.borderColor = isError ? '#f43f5e' : '#f59e0b';
    toast.innerHTML = `${isError ? '⚠️' : '🏅'} <span>${message}</span>`;
    toast.style.transform = 'translateY(0)';
    toast.style.opacity = '1';

    clearTimeout(toast._timer);
    toast._timer = setTimeout(() => {
      toast.style.transform = 'translateY(20px)';
      toast.style.opacity = '0';
    }, 3200);
  }

  function escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  // ── Data Fetching ──────────────────────────────────────────────────────────
  async function loadAccountsAndLots() {
    try {
      const res = await fetch('/api/accounts');
      const data = await res.json();
      state.accounts = data.accounts || data || [];

      // Phân lô
      const lotSet = new Set();
      state.accounts.forEach((acc) => {
        if (acc.lotId) lotSet.add(acc.lotId);
      });
      state.lots = Array.from(lotSet);

      populateLotSelect();
      populateStartSelect();
    } catch (err) {
      console.warn('[Certificates] Không thể tải danh sách tài khoản:', err);
    }
  }

  function populateLotSelect() {
    if (!dom.selectLot) return;
    const currentVal = dom.selectLot.value;
    dom.selectLot.innerHTML = '<option value="">Tất cả các lô</option>';
    state.lots.forEach((lot) => {
      const opt = document.createElement('option');
      opt.value = lot;
      opt.textContent = `Lô: ${lot}`;
      dom.selectLot.appendChild(opt);
    });
    if (currentVal && state.lots.includes(currentVal)) {
      dom.selectLot.value = currentVal;
    }
  }

  function populateStartSelect() {
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

  async function loadCertificateResults() {
    try {
      const res = await fetch('/api/mac/certificates/results');
      const data = await res.json();
      if (data.success && data.results) {
        state.results = data.results;
        updateStats();
        renderTable();
      }
    } catch (err) {
      console.warn('[Certificates] Không thể tải kết quả chứng chỉ:', err);
    }
  }

  async function checkInitialStatus() {
    try {
      const res = await fetch('/api/mac/certificates/status');
      const data = await res.json();
      updateRunningUI(data.running, data.currentAccount, data.stats);
    } catch (err) {
      console.warn('[Certificates] Không thể kiểm tra status:', err);
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
        dom.statusBadge.style.background = 'rgba(245, 158, 11, 0.25)';
        dom.statusBadge.style.color = '#fbbf24';
        dom.statusBadge.style.border = '1px solid rgba(245, 158, 11, 0.5)';
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
    const withCertsCount = items.filter((i) => (i.certCount || 0) > 0).length;
    const noCertsCount = items.filter((i) => i.status === 'OK' && (i.certCount || 0) === 0).length;
    const failCount = items.filter((i) => i.status !== 'OK').length;
    const totalCertsSum = items.reduce((sum, i) => sum + (i.certCount || 0), 0);

    const missingAnyCount = items.filter((i) => {
      if (i.status !== 'OK') return false;
      const bMap = i.bannerStatus || mapCertificatesToBanners(i.certificates).map;
      return !bMap.banner_1 || !bMap.banner_2 || !bMap.banner_3 || !bMap.banner_4 || !bMap.banner_6;
    }).length;

    const totalCount = state.stats.total > 0 ? state.stats.total : (state.accounts.length || items.length);
    const doneCount = state.stats.checked > 0 ? state.stats.checked : items.length;

    if (dom.statTotal) dom.statTotal.textContent = totalCount;
    if (dom.statDone) dom.statDone.textContent = `${doneCount} (${totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0}%)`;
    if (dom.statWithCerts) dom.statWithCerts.textContent = `${withCertsCount} acc`;
    if (dom.statTotalCerts) dom.statTotalCerts.textContent = `${totalCertsSum} chứng chỉ`;
    if (dom.statFail) dom.statFail.textContent = failCount;

    if (dom.filterAllCount) dom.filterAllCount.textContent = items.length;
    if (dom.filterWithCertsCount) dom.filterWithCertsCount.textContent = withCertsCount;
    if (dom.filterMissingCount) dom.filterMissingCount.textContent = missingAnyCount;
    if (dom.filterNoCertsCount) dom.filterNoCertsCount.textContent = noCertsCount;
    if (dom.filterFailCount) dom.filterFailCount.textContent = failCount;

    if (dom.badgeCertsCount) {
      if (withCertsCount > 0) {
        dom.badgeCertsCount.style.display = 'inline-flex';
        dom.badgeCertsCount.textContent = `${totalCertsSum} CC`;
        dom.badgeCertsCount.style.background = 'rgba(245, 158, 11, 0.25)';
        dom.badgeCertsCount.style.color = '#fbbf24';
      } else {
        dom.badgeCertsCount.style.display = 'none';
      }
    }
  }

  // ── Render Results Table ───────────────────────────────────────────────────
  function renderTable() {
    if (!dom.tbody) return;

    let items = Object.entries(state.results || {}).map(([username, val]) => ({
      username,
      ...val,
    }));

    // Sắp xếp theo STT
    items.sort((a, b) => (a.index || 999999) - (b.index || 999999));

    // Bộ lọc tab filter
    if (state.filter === 'has_certs') {
      items = items.filter((i) => (i.certCount || 0) > 0);
    } else if (state.filter === 'missing_any') {
      items = items.filter((i) => {
        if (i.status !== 'OK') return false;
        const bMap = i.bannerStatus || mapCertificatesToBanners(i.certificates).map;
        return !bMap.banner_1 || !bMap.banner_2 || !bMap.banner_3 || !bMap.banner_4 || !bMap.banner_6;
      });
    } else if (state.filter === 'missing_b1') {
      items = items.filter((i) => !(i.bannerStatus || mapCertificatesToBanners(i.certificates).map).banner_1);
    } else if (state.filter === 'missing_b2') {
      items = items.filter((i) => !(i.bannerStatus || mapCertificatesToBanners(i.certificates).map).banner_2);
    } else if (state.filter === 'missing_b3') {
      items = items.filter((i) => !(i.bannerStatus || mapCertificatesToBanners(i.certificates).map).banner_3);
    } else if (state.filter === 'missing_b4') {
      items = items.filter((i) => !(i.bannerStatus || mapCertificatesToBanners(i.certificates).map).banner_4);
    } else if (state.filter === 'missing_b6') {
      items = items.filter((i) => !(i.bannerStatus || mapCertificatesToBanners(i.certificates).map).banner_6);
    } else if (state.filter === 'no_certs') {
      items = items.filter((i) => i.status === 'OK' && (i.certCount || 0) === 0);
    } else if (state.filter === 'fail') {
      items = items.filter((i) => i.status !== 'OK');
    }

    // Tìm kiếm
    if (state.searchQuery) {
      const q = state.searchQuery.toLowerCase();
      items = items.filter(
        (i) =>
          (i.username && i.username.toLowerCase().includes(q)) ||
          (i.fullName && i.fullName.toLowerCase().includes(q)) ||
          (i.lotId && i.lotId.toLowerCase().includes(q)) ||
          (i.error && i.error.toLowerCase().includes(q)) ||
          (i.certificates && i.certificates.some((c) => c.toLowerCase().includes(q)))
      );
    }

    if (items.length === 0) {
      dom.tbody.innerHTML = `
        <tr>
          <td colspan="10" class="text-center text-muted py-4">
            ${Object.keys(state.results || {}).length === 0 ? 'Chưa có dữ liệu kiểm tra chứng chỉ. Hãy bấm "Bắt Đầu Quét" ở trên.' : 'Không tìm thấy tài khoản phù hợp với bộ lọc.'}
          </td>
        </tr>
      `;
      return;
    }

    dom.tbody.innerHTML = items
      .map((item, idx) => {
        const certCount = item.certCount || 0;
        const certList = item.certificates || [];
        const isOk = item.status === 'OK';

        // Badge số lượng chứng chỉ (Vàng nổi bật như trong app)
        let certBadgeHtml = '';
        if (isOk) {
          if (certCount > 0) {
            certBadgeHtml = `
              <div style="display: inline-flex; align-items: center; gap: 6px; padding: 4px 12px; border-radius: 8px; background: linear-gradient(135deg, rgba(245, 158, 11, 0.25), rgba(217, 119, 6, 0.15)); border: 1px solid rgba(245, 158, 11, 0.5); color: #fbbf24; font-weight: 800; font-size: 0.95rem; box-shadow: 0 2px 8px rgba(245, 158, 11, 0.2);">
                <span>🎖️</span> <span>${certCount}</span>
              </div>
            `;
          } else {
            certBadgeHtml = `
              <span style="display: inline-block; padding: 3px 10px; border-radius: 6px; background: rgba(148, 163, 184, 0.12); border: 1px solid rgba(148, 163, 184, 0.3); color: #94a3b8; font-weight: 600; font-size: 0.85rem;">
                0
              </span>
            `;
          }
        } else {
          certBadgeHtml = `<span class="text-muted">-</span>`;
        }

        // Cột Banner đã hoàn thành
        const bMap = item.bannerStatus || mapCertificatesToBanners(certList).map;
        const bannerDefs = [
          { id: 'banner_1', name: 'B1: ĐH Đoàn' },
          { id: 'banner_2', name: 'B2: ĐH XIV' },
          { id: 'banner_3', name: 'B3: ĐVTN' },
          { id: 'banner_4', name: 'B4: Hữu Lầu' },
          { id: 'banner_6', name: 'B6: CB Đoàn' },
        ];

        let bannersCellHtml = '';
        if (isOk) {
          bannersCellHtml = `
            <div style="display: flex; flex-wrap: wrap; gap: 4px; max-width: 270px;">
              ${bannerDefs
                .map((b) => {
                  const done = !!bMap[b.id];
                  if (done) {
                    return `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #10b981; border: 1px solid rgba(16, 185, 129, 0.45); font-weight: 700; font-size: 0.73rem; padding: 2px 6px; border-radius: 4px;" title="Đã có chứng chỉ ${b.name}">✅ ${b.name}</span>`;
                  } else {
                    return `<span class="badge" style="background: rgba(148, 163, 184, 0.08); color: #64748b; border: 1px dashed rgba(148, 163, 184, 0.25); font-weight: 500; font-size: 0.73rem; padding: 2px 6px; border-radius: 4px;" title="Chưa có chứng chỉ ${b.name}">⚪ ${b.name}</span>`;
                  }
                })
                .join('')}
            </div>
          `;
        } else {
          bannersCellHtml = `<span class="text-muted">-</span>`;
        }

        // Mô phỏng các khối chứng chỉ màu vàng nhạt như trong ảnh thật của người dùng
        let certCardsHtml = '';
        if (certList.length > 0) {
          certCardsHtml = `
            <div style="display: flex; flex-direction: column; gap: 6px; max-width: 520px;">
              ${certList
                .map(
                  (c, cIdx) => `
                <div style="background: rgba(254, 243, 199, 0.12); border: 1px solid rgba(245, 158, 11, 0.35); border-left: 4px solid #f59e0b; border-radius: 6px; padding: 6px 10px; font-size: 0.82rem; line-height: 1.35; color: #fef3c7;">
                  <div style="font-size: 0.72rem; font-weight: 800; color: #fbbf24; letter-spacing: 0.05em; margin-bottom: 2px;">
                    📜 CHỨNG NHẬN #${cIdx + 1}
                  </div>
                  <div style="color: #f8fafc; font-weight: 500;">
                    ${escapeHtml(c)}
                  </div>
                </div>
              `
                )
                .join('')}
            </div>
          `;
        } else if (isOk) {
          certCardsHtml = `<span style="color: #94a3b8; font-size: 0.82rem; font-style: italic;">Chưa có chứng chỉ nào</span>`;
        } else {
          certCardsHtml = `<span style="color: #f87171; font-size: 0.82rem;">${escapeHtml(item.error || 'Lỗi kiểm tra')}</span>`;
        }

        // Trạng thái badge
        let statusBadgeHtml = '';
        if (isOk) {
          if (certCount > 0) {
            statusBadgeHtml = `<span class="badge" style="background: rgba(16, 185, 129, 0.2); color: #34d399; border: 1px solid rgba(16, 185, 129, 0.4); font-weight: 700;">✅ Có ${certCount} CC</span>`;
          } else {
            statusBadgeHtml = `<span class="badge" style="background: rgba(56, 189, 248, 0.15); color: #38bdf8; border: 1px solid rgba(56, 189, 248, 0.3);">⚪ 0 CC</span>`;
          }
        } else if (item.status === 'OVERLOAD') {
          statusBadgeHtml = `<span class="badge" style="background: rgba(245, 158, 11, 0.2); color: #fbbf24; border: 1px solid rgba(245, 158, 11, 0.4);">⏳ Quá tải</span>`;
        } else {
          statusBadgeHtml = `<span class="badge" style="background: rgba(244, 63, 94, 0.2); color: #f87171; border: 1px solid rgba(244, 63, 94, 0.4); font-weight: 700;">❌ Lỗi</span>`;
        }

        return `
          <tr data-username="${escapeHtml(item.username)}">
            <td style="text-align: center; font-weight: 700; color: #94a3b8;">#${item.index || idx + 1}</td>
            <td style="font-family: monospace; font-weight: 600; color: #38bdf8;">
              ${escapeHtml(item.username)}
            </td>
            <td style="font-family: monospace; font-size: 0.82rem; color: #94a3b8;">
              ${escapeHtml(item.password || '••••••')}
            </td>
            <td class="lot-feature-hidden">
              <span class="badge badge-secondary" style="font-size: 0.78rem;">${escapeHtml(item.lotId || '-')}</span>
            </td>
            <td style="font-weight: 700; color: #f1f5f9;">
              ${escapeHtml(item.fullName || (isOk ? 'Chưa nhận diện' : '-'))}
            </td>
            <td style="text-align: center;">
              ${certBadgeHtml}
            </td>
            <td>
              ${bannersCellHtml}
            </td>
            <td>
              ${certCardsHtml}
            </td>
            <td style="text-align: center;">
              ${statusBadgeHtml}
            </td>
            <td style="font-size: 0.8rem; color: #94a3b8; white-space: nowrap;">
              ${escapeHtml(item.checked_at || '-')}
            </td>
            <td style="text-align: right; white-space: nowrap;">
              <button class="btn btn-ghost btn-xs text-cyan btn-copy-one-cert" data-acc="${escapeHtml(item.username)}" title="Sao chép thông tin tài khoản này">
                📋 Copy
              </button>
            </td>
          </tr>
        `;
      })
      .join('');

    // Gắn sự kiện copy từng tài khoản
    dom.tbody.querySelectorAll('.btn-copy-one-cert').forEach((btn) => {
      btn.addEventListener('click', (e) => {
        const u = e.currentTarget.getAttribute('data-acc');
        const item = state.results[u];
        if (!item) return;
        const bMap = item.bannerStatus || mapCertificatesToBanners(item.certificates).map;
        const bannerStr = Object.entries(bMap).filter(([k, v]) => v).map(([k]) => k.toUpperCase().replace('_', ' ')).join(', ') || 'Chưa có';
        const text = `Tài khoản: ${item.username} | Mật khẩu: ${item.password || ''} | Họ tên: ${item.fullName || ''} | Số CC: ${item.certCount || 0} | Banners: ${bannerStr}\nChứng chỉ:\n${(item.certificates || []).map((c, i) => `  ${i + 1}. ${c}`).join('\n')}`;
        navigator.clipboard.writeText(text).then(() => {
          showToast(`Đã chép thông tin ${item.username}`);
        });
      });
    });
  }

  // ── Event Handlers ─────────────────────────────────────────────────────────
  async function startCheckCertificates() {
    if (state.isRunning) return;

    const startFromIndex = parseInt(dom.selectStart?.value || '1', 10);
    const lotId = dom.selectLot?.value || '';
    const limit = dom.selectLimit?.value ? parseInt(dom.selectLimit.value, 10) : undefined;
    const recheckEmpty = !!dom.chkRecheckEmpty?.checked;
    const recheckFailed = !!dom.chkRecheckFailed?.checked;

    try {
      const res = await fetch('/api/mac/certificates/start', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          startFromIndex,
          lotId,
          limit,
          recheckEmpty,
          recheckFailed,
        }),
      });
      const data = await res.json();
      if (data.success) {
        showToast('Bắt đầu kiểm tra và tổng hợp chứng chỉ!');
        updateRunningUI(true, 'Đang khởi động...');
      } else {
        showToast(data.message || 'Không thể bắt đầu', true);
      }
    } catch (err) {
      showToast('Lỗi kết nối Server: ' + err.message, true);
    }
  }

  async function stopCheckCertificates() {
    try {
      const res = await fetch('/api/mac/certificates/stop', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        showToast('Đã gửi yêu cầu dừng quét chứng chỉ!');
        updateRunningUI(false, 'Đã dừng');
      }
    } catch (err) {
      showToast('Lỗi gửi lệnh dừng: ' + err.message, true);
    }
  }

  function downloadCsvFile() {
    window.location.href = '/api/mac/certificates/export';
  }

  function downloadJsonFile() {
    const dataStr = 'data:text/json;charset=utf-8,' + encodeURIComponent(JSON.stringify(state.results, null, 2));
    const a = document.createElement('a');
    a.href = dataStr;
    a.download = `ket_qua_chung_chi_${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    showToast('Đã tải file JSON kết quả!');
  }

  function copyTableToClipboard() {
    const items = Object.values(state.results || {});
    if (items.length === 0) {
      showToast('Chưa có dữ liệu để sao chép', true);
      return;
    }

    items.sort((a, b) => (a.index || 999999) - (b.index || 999999));
    const header = [
      'STT', 'Tài Khoản', 'Mật Khẩu', 'Họ Và Tên', 'Số Chứng Chỉ',
      'Banner 1 (ĐH Đoàn)', 'Banner 2 (ĐH XIV)', 'Banner 3 (ĐVTN)', 'Banner 4 (Phạm Hữu Lầu)', 'Banner 6 (CB Đoàn)',
      'Các Banner Đã Thi', 'Danh Sách Chứng Chỉ', 'Lô', 'Trạng Thái', 'Thời Gian'
    ].join('\t');

    const rows = items.map((i) => {
      const bMap = i.bannerStatus || mapCertificatesToBanners(i.certificates).map;
      const completedList = Object.entries(bMap).filter(([k, v]) => v).map(([k]) => k.toUpperCase().replace('_', ' '));
      const completedStr = completedList.join(', ') || 'Chưa có';

      return [
        i.index || '',
        i.username || '',
        i.password || '',
        i.fullName || '',
        i.certCount || 0,
        bMap.banner_1 ? 'ĐÃ THI' : 'CHƯA THI',
        bMap.banner_2 ? 'ĐÃ THI' : 'CHƯA THI',
        bMap.banner_3 ? 'ĐÃ THI' : 'CHƯA THI',
        bMap.banner_4 ? 'ĐÃ THI' : 'CHƯA THI',
        bMap.banner_6 ? 'ĐÃ THI' : 'CHƯA THI',
        completedStr,
        (i.certificates || []).join(' ; '),
        i.lotId || '',
        i.status || '',
        i.checked_at || '',
      ].join('\t');
    });

    const fullText = header + '\n' + rows.join('\n');
    navigator.clipboard.writeText(fullText).then(() => {
      showToast(`Đã chép ${items.length} tài khoản đầy đủ các cột Banner vào clipboard!`);
    });
  }

  async function clearHistory() {
    if (!confirm('Bạn có chắc muốn xóa toàn bộ lịch sử và kết quả quét chứng chỉ đã lưu?')) {
      return;
    }
    try {
      const res = await fetch('/api/mac/certificates/clear', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        state.results = {};
        state.stats = { total: 0, checked: 0, withCerts: 0, noCerts: 0, fail: 0, totalCertsCount: 0 };
        updateStats();
        renderTable();
        showToast('Đã xóa sạch kết quả quét chứng chỉ!');
      }
    } catch (err) {
      showToast('Lỗi khi xóa: ' + err.message, true);
    }
  }

  // ── Live Console Log Helpers ──────────────────────────────────────────────
  function appendCertLog(entry) {
    if (!dom.certConsoleOutput) return;
    if (!entry || !entry.message) return;

    // Nếu là log đầu tiên, xóa thông điệp chờ sẵn
    if (state.logCount === 0) {
      dom.certConsoleOutput.innerHTML = '';
    }

    state.logCount++;
    if (dom.badgeCertLogCount) {
      dom.badgeCertLogCount.textContent = `${state.logCount} dòng`;
    }

    const lineEl = document.createElement('div');
    lineEl.className = 'log-line';

    const timeStr = entry.time || new Date().toLocaleTimeString('vi-VN');
    const colorClass = entry.color ? `log-${entry.color}` : 'log-white';

    lineEl.innerHTML = `<span class="log-time">[${escapeHtml(timeStr)}]</span> <span class="${colorClass}">${escapeHtml(entry.message)}</span>`;
    dom.certConsoleOutput.appendChild(lineEl);

    // Giới hạn 1000 dòng để tối ưu DOM
    while (dom.certConsoleOutput.children.length > 1000) {
      dom.certConsoleOutput.removeChild(dom.certConsoleOutput.firstChild);
    }

    // Tự động cuộn xuống dưới cùng nếu checkbox được bật
    if (dom.chkCertAutoscroll && dom.chkCertAutoscroll.checked) {
      dom.certConsoleOutput.scrollTop = dom.certConsoleOutput.scrollHeight;
    }
  }

  function clearCertLogs() {
    if (dom.certConsoleOutput) {
      dom.certConsoleOutput.innerHTML = '<div class="log-line text-muted">[Đã xóa log] Bấm "Bắt Đầu Quét" để tiếp tục xem tiến trình trực tiếp...</div>';
    }
    state.logCount = 0;
    if (dom.badgeCertLogCount) {
      dom.badgeCertLogCount.textContent = '0 dòng';
    }
    showToast('Đã xóa màn hình log chứng chỉ!');
  }

  function copyCertLogs() {
    if (!dom.certConsoleOutput) return;
    const text = dom.certConsoleOutput.innerText;
    if (!text || text.includes('[Sẵn sàng]')) {
      showToast('Chưa có log để sao chép', true);
      return;
    }
    navigator.clipboard.writeText(text).then(() => {
      showToast('Đã sao chép toàn bộ nhật ký quét chứng chỉ!');
    });
  }

  // ── SSE Handler ────────────────────────────────────────────────────────────
  function handleCertEvent(eventData) {
    if (!eventData) return;

    if (eventData.type === 'start') {
      updateRunningUI(true, 'Bắt đầu quét...', { total: eventData.total });
      appendCertLog({
        message: `🚀 Bắt đầu quét & tổng hợp chứng chỉ cho ${eventData.total} tài khoản...`,
        color: 'cyan',
      });
    } else if (eventData.type === 'account_start') {
      state.currentAccount = `${eventData.username} (#${eventData.index})`;
      if (dom.currentAccText) dom.currentAccText.textContent = state.currentAccount;
      if (dom.statusBadge) dom.statusBadge.textContent = `Đang check #${eventData.index}`;
      appendCertLog({
        message: `▶️ [${eventData.current || 1}/${eventData.total}] Bắt đầu tài khoản #${eventData.index}: ${eventData.username}`,
        color: 'cyan',
      });
    } else if (eventData.type === 'account_done') {
      // Cập nhật kết quả vào state
      state.results[eventData.username] = {
        username: eventData.username,
        fullName: eventData.fullName || '',
        certCount: eventData.certCount || 0,
        certificates: eventData.certificates || [],
        status: eventData.status,
        error: eventData.error || '',
        checked_at: eventData.checked_at,
        index: eventData.index,
        lotId: eventData.lotId || '',
        password: state.accounts.find((a) => a.username === eventData.username)?.password || '',
      };

      if (dom.lastDetectedName && eventData.fullName) {
        dom.lastDetectedName.textContent = eventData.fullName;
      }
      if (dom.lastDetectedCount !== undefined) {
        dom.lastDetectedCount.textContent = `${eventData.certCount || 0} CC`;
      }

      state.stats.checked = eventData.current;
      if (eventData.withCertsCount !== undefined) state.stats.withCerts = eventData.withCertsCount;
      if (eventData.noCertsCount !== undefined) state.stats.noCerts = eventData.noCertsCount;
      if (eventData.failCount !== undefined) state.stats.fail = eventData.failCount;
      if (eventData.totalCertsCount !== undefined) state.stats.totalCertsCount = eventData.totalCertsCount;

      const bMap = eventData.bannerStatus || mapCertificatesToBanners(eventData.certificates).map;
      const bDone = Object.entries(bMap).filter(([k, v]) => v).map(([k]) => k.toUpperCase().replace('_', ' ')).join(', ') || 'Chưa có banner';
      appendCertLog({
        message: `✅ [#${eventData.index}] ${eventData.username}: ${eventData.certCount} CC (${bDone}) | Họ tên: ${eventData.fullName || 'N/A'}`,
        color: (eventData.certCount || 0) > 0 ? 'green' : (eventData.status === 'OK' ? 'yellow' : 'red'),
      });

      updateStats();
      renderTable();
    } else if (eventData.type === 'finish' || eventData.type === 'stopped') {
      updateRunningUI(false, eventData.type === 'finish' ? 'Hoàn tất' : 'Đã dừng');
      appendCertLog({
        message: eventData.type === 'finish' ? `🏁 Quá trình quét chứng chỉ đã hoàn tất!` : `🛑 Quá trình quét chứng chỉ đã dừng lại.`,
        color: eventData.type === 'finish' ? 'green' : 'yellow',
      });
      loadCertificateResults();
    } else if (eventData.type === 'cleared') {
      state.results = {};
      state.stats = { total: 0, checked: 0, withCerts: 0, noCerts: 0, fail: 0, totalCertsCount: 0 };
      updateStats();
      renderTable();
    }
  }

  // ── Init ───────────────────────────────────────────────────────────────────
  function init() {
    initDom();

    // Controls
    if (dom.btnStart) dom.btnStart.addEventListener('click', startCheckCertificates);
    if (dom.btnStop) dom.btnStop.addEventListener('click', stopCheckCertificates);
    if (dom.btnExportCsv) dom.btnExportCsv.addEventListener('click', downloadCsvFile);
    if (dom.btnDownloadJson) dom.btnDownloadJson.addEventListener('click', downloadJsonFile);
    if (dom.btnCopyClipboard) dom.btnCopyClipboard.addEventListener('click', copyTableToClipboard);
    if (dom.btnClearHistory) dom.btnClearHistory.addEventListener('click', clearHistory);

    // Live Console buttons
    if (dom.btnClearCertLogs) dom.btnClearCertLogs.addEventListener('click', clearCertLogs);
    if (dom.btnCopyCertLogs) dom.btnCopyCertLogs.addEventListener('click', copyCertLogs);

    // Search
    if (dom.inputSearch) {
      dom.inputSearch.addEventListener('input', (e) => {
        state.searchQuery = e.target.value.trim();
        renderTable();
      });
    }

    // Filter Chips
    dom.filterChips.forEach((chip) => {
      chip.addEventListener('click', () => {
        dom.filterChips.forEach((c) => c.classList.remove('active'));
        chip.classList.add('active');
        state.filter = chip.getAttribute('data-cert-filter');
        renderTable();
      });
    });

    // Lắng nghe SSE từ app.js hoặc trực tiếp
    const evtSource = new EventSource('/api/events');
    evtSource.addEventListener('certificates_event', (e) => {
      try {
        const data = JSON.parse(e.data);
        handleCertEvent(data);
      } catch (err) {
        console.error('[SSE Certs Error]', err);
      }
    });

    evtSource.addEventListener('certificates_log', (e) => {
      try {
        const entry = JSON.parse(e.data);
        appendCertLog(entry);
      } catch (err) {
        console.error('[SSE Cert Log Error]', err);
      }
    });

    evtSource.addEventListener('log', (e) => {
      try {
        const entry = JSON.parse(e.data);
        if (entry.source === 'certs' || (entry.message && (entry.message.includes('[Chứng Chỉ]') || entry.message.includes('CHỨNG NHẬN')))) {
          appendCertLog(entry);
        }
      } catch (err) {}
    });

    // Nạp dữ liệu ban đầu
    loadAccountsAndLots();
    loadCertificateResults();
    checkInitialStatus();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
