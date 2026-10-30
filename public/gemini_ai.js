/**
 * Quản lý Trợ lý Gemini AI trên Web Dashboard
 * Hỗ trợ cấu hình đa key (Pool keys) & Tự động xoay vòng khi quá tải
 */
(function () {
  'use strict';

  const dom = {
    card: document.getElementById('gemini-ai-card'),
    statusBadge: document.getElementById('gemini-status-badge'),
    cacheStats: document.getElementById('gemini-cache-stats'),
    btnToggleModal: document.getElementById('btn-toggle-gemini-modal'),

    modal: document.getElementById('modal-gemini-settings'),
    modalBackdrop: document.getElementById('modal-gemini-backdrop'),
    btnCloseModal: document.getElementById('btn-close-gemini-modal'),
    btnCancelModal: document.getElementById('btn-cancel-gemini-modal'),

    chkEnabled: document.getElementById('chk-gemini-enabled'),
    inputKey: document.getElementById('input-gemini-key'),
    keysCount: document.getElementById('gemini-keys-count'),
    selectModel: document.getElementById('select-gemini-model'),
    chkAutoLearn: document.getElementById('chk-gemini-autolearn'),

    testResult: document.getElementById('gemini-test-result'),
    btnTest: document.getElementById('btn-test-gemini'),
    btnSave: document.getElementById('btn-save-gemini-config'),
  };

  let currentConfig = null;

  async function loadConfig() {
    try {
      const res = await fetch('/api/gemini/config');
      const data = await res.json();
      if (data.success && data.config) {
        currentConfig = data.config;
        renderCard(data.config, data.cacheCount || 0);
      }
    } catch (err) {
      console.warn('[Gemini AI] Không thể nạp cấu hình:', err);
    }
  }

  function renderCard(cfg, cacheCount) {
    if (!dom.statusBadge) return;
    const keys = cfg.api_keys || (cfg.api_key ? [cfg.api_key] : []);
    const keyCount = keys.length;

    if (cfg.enabled) {
      dom.statusBadge.textContent = keyCount > 1 ? `🟢 Đang Bật (${keyCount} Keys Dự Phòng)` : '🟢 Đang Bật';
      dom.statusBadge.style.background = 'rgba(16, 185, 129, 0.2)';
      dom.statusBadge.style.color = '#10b981';
      dom.statusBadge.style.borderColor = 'rgba(16, 185, 129, 0.4)';
    } else {
      dom.statusBadge.textContent = '⚪ Đang Tắt';
      dom.statusBadge.style.background = 'rgba(148, 163, 184, 0.2)';
      dom.statusBadge.style.color = '#94a3b8';
      dom.statusBadge.style.borderColor = 'rgba(148, 163, 184, 0.4)';
    }

    if (dom.cacheStats) {
      dom.cacheStats.textContent = `Đã học & giải cứu: ${cacheCount} câu`;
    }
  }

  function openModal() {
    if (!dom.modal) return;
    if (currentConfig) {
      if (dom.chkEnabled) dom.chkEnabled.checked = !!currentConfig.enabled;

      // Hiển thị danh sách keys mỗi key 1 dòng
      const keys = currentConfig.api_keys || (currentConfig.api_key ? [currentConfig.api_key] : []);
      if (dom.inputKey) {
        dom.inputKey.value = keys.join('\n');
      }
      if (dom.keysCount) {
        dom.keysCount.textContent = `${keys.length} Keys`;
      }

      if (dom.selectModel && currentConfig.models && currentConfig.models.length) {
        dom.selectModel.value = currentConfig.models[0];
      }
      if (dom.chkAutoLearn) dom.chkAutoLearn.checked = currentConfig.auto_learn !== false;
    }
    if (dom.testResult) {
      dom.testResult.style.display = 'none';
      dom.testResult.textContent = '';
    }
    dom.modal.classList.remove('hidden');
  }

  function closeModal() {
    if (!dom.modal) return;
    dom.modal.classList.add('hidden');
  }

  async function testGemini() {
    if (!dom.btnTest || !dom.testResult) return;
    dom.btnTest.disabled = true;
    dom.btnTest.innerHTML = '<span class="icon">⏳</span> Đang test các keys...';
    dom.testResult.style.display = 'block';
    dom.testResult.style.background = 'rgba(6, 182, 212, 0.1)';
    dom.testResult.style.border = '1px solid rgba(6, 182, 212, 0.3)';
    dom.testResult.style.color = '#38bdf8';
    dom.testResult.textContent = '🚀 Đang gửi truy vấn kiểm tra toàn bộ API Keys trong danh sách...';

    // Đọc danh sách keys từ ô nhập
    const rawText = dom.inputKey ? dom.inputKey.value : '';
    const keys = rawText.split('\n').map(k => k.trim()).filter(k => k.length > 0);

    // Lưu cấu hình tạm thời trước khi test
    try {
      await fetch('/api/gemini/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          api_keys: keys,
          api_key: keys[0] || '',
          models: [dom.selectModel ? dom.selectModel.value : 'gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'],
        }),
      });

      const res = await fetch('/api/gemini/test', { method: 'POST' });
      const data = await res.json();
      if (data.success) {
        dom.testResult.style.background = 'rgba(16, 185, 129, 0.15)';
        dom.testResult.style.border = '1px solid rgba(16, 185, 129, 0.4)';
        dom.testResult.style.color = '#34d399';
        dom.testResult.innerHTML = `<b>✅ Toàn Bộ Keys Đều Sẵn Sàng Hoạt Động!</b><br><pre style="margin-top:6px; font-size:0.78rem; white-space:pre-wrap; font-family:'JetBrains Mono',monospace;">${data.output || data.message}</pre>`;
      } else {
        dom.testResult.style.background = 'rgba(239, 68, 68, 0.15)';
        dom.testResult.style.border = '1px solid rgba(239, 68, 68, 0.4)';
        dom.testResult.style.color = '#f87171';
        dom.testResult.textContent = `❌ Lỗi: ${data.error || 'Không kết nối được Gemini'}`;
      }
    } catch (err) {
      dom.testResult.style.background = 'rgba(239, 68, 68, 0.15)';
      dom.testResult.style.border = '1px solid rgba(239, 68, 68, 0.4)';
      dom.testResult.style.color = '#f87171';
      dom.testResult.textContent = `❌ Lỗi: ${err.message}`;
    } finally {
      dom.btnTest.disabled = false;
      dom.btnTest.innerHTML = '<span class="icon">⚡</span> Test Kết Nối AI';
    }
  }

  async function saveConfig() {
    if (!dom.btnSave) return;
    const rawText = dom.inputKey ? dom.inputKey.value : '';
    const keys = rawText.split('\n').map(k => k.trim()).filter(k => k.length > 0);
    const enabled = dom.chkEnabled ? dom.chkEnabled.checked : true;
    const model = dom.selectModel ? dom.selectModel.value : 'gemini-flash-lite-latest';
    const autoLearn = dom.chkAutoLearn ? dom.chkAutoLearn.checked : true;

    if (keys.length === 0) {
      alert('Vui lòng nhập ít nhất 1 API Key Gemini!');
      return;
    }

    // Sắp xếp models sao cho model người dùng chọn nằm đầu tiên
    const otherModels = ['gemini-flash-lite-latest', 'gemini-3.5-flash-lite', 'gemini-3.8-flash'].filter(m => m !== model);
    const models = [model, ...otherModels];

    dom.btnSave.disabled = true;
    dom.btnSave.innerHTML = '<span class="icon">⏳</span> Đang lưu...';

    try {
      const res = await fetch('/api/gemini/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          enabled,
          api_keys: keys,
          api_key: keys[0],
          models,
          auto_learn: autoLearn,
        }),
      });
      const data = await res.json();
      if (data.success) {
        currentConfig = data.config;
        await loadConfig();
        closeModal();
      } else {
        alert('Lỗi khi lưu: ' + (data.error || 'Không rõ nguyên nhân'));
      }
    } catch (err) {
      alert('Lỗi kết nối máy chủ: ' + err.message);
    } finally {
      dom.btnSave.disabled = false;
      dom.btnSave.innerHTML = '<span class="icon">💾</span> Lưu Cấu Hình';
    }
  }

  // Gắn sự kiện
  function bindEvents() {
    if (dom.btnToggleModal) dom.btnToggleModal.addEventListener('click', openModal);
    if (dom.btnCloseModal) dom.btnCloseModal.addEventListener('click', closeModal);
    if (dom.btnCancelModal) dom.btnCancelModal.addEventListener('click', closeModal);
    if (dom.modalBackdrop) dom.modalBackdrop.addEventListener('click', closeModal);
    if (dom.inputKey) {
      dom.inputKey.addEventListener('input', () => {
        const count = dom.inputKey.value.split('\n').map(k => k.trim()).filter(k => k.length > 0).length;
        if (dom.keysCount) dom.keysCount.textContent = `${count} Keys`;
      });
    }
    if (dom.btnTest) dom.btnTest.addEventListener('click', testGemini);
    if (dom.btnSave) dom.btnSave.addEventListener('click', saveConfig);
  }

  document.addEventListener('DOMContentLoaded', () => {
    bindEvents();
    loadConfig();
  });

  if (document.readyState === 'complete' || document.readyState === 'interactive') {
    bindEvents();
    loadConfig();
  }
})();
