// ========================================================================
// UI HELPERS - Toast, Progress, Theme, and General UI Utilities
// ========================================================================

// ===== TOAST NOTIFICATION =====
let toastHideTimer = null;

function displayToastNotification(msg) {
  const toast = document.getElementById('toast-notification');
  if (!toast) return;
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastHideTimer);
  toastHideTimer = setTimeout(() => toast.classList.remove('show'), 3000);
}

// ===== GLOBAL PROGRESS UI (MODERN WHITE DESIGN) =====
const ProgressUI = {
  _interval: null,
  _startTime: 0,
  _estimatedMs: 0,
  _stepStartTime: 0,
  _totalSteps: 0,
  _stepDone: 0,
  _lastPct: 0,
  _mode: 'idle',
  _stageStartPct: 0,
  _stageEndPct: 0,
  _stageStartedAt: 0,
  _previewContainer: null,
  _fileProgressItems: new Map(),
  _pageCount: 0,
  _totalPages: 0,

  _els() {
    return {
      overlay: document.getElementById('global-progress-overlay'),
      title: document.getElementById('progress-overlay-title'),
      subtitle: document.getElementById('progress-overlay-subtitle'),
      fill: document.getElementById('progress-bar-fill'),
      percent: document.getElementById('progress-bar-percent'),
      time: document.getElementById('progress-bar-time'),
      preview: document.getElementById('progress-live-preview'),
      badge: document.getElementById('progress-model-badge'),
      scope: document.getElementById('progress-scope'),
      steps: document.getElementById('progress-steps'),
      pageCount: document.getElementById('progress-page-count')
    };
  },

  _formatTime(ms) {
    const sec = Math.max(0, Math.round((Number(ms) || 0) / 1000));
    if (sec < 60) return sec + 's';
    return Math.floor(sec / 60) + 'm ' + String(sec % 60).padStart(2, '0') + 's';
  },

  _elapsed() {
    return this._formatTime(Date.now() - this._startTime);
  },

  _setPercent(p, force = false) {
    p = Math.max(0, Math.min(100, Number(p) || 0));
    if (!force && p < this._lastPct) p = this._lastPct;
    this._lastPct = p;
    const { fill, percent } = this._els();
    if (fill) {
      fill.classList.remove('indeterminate');
      fill.style.width = p + '%';
      fill.style.transform = '';
    }
    if (percent) percent.textContent = Math.round(p) + '%';
  },

  _setIndeterminate() {
    const fill = this._els().fill;
    if (fill) fill.classList.add('indeterminate');
  },

  _setVisualStage(n) {
    const wrap = this._els().steps;
    if (!wrap) return;
    const spans = Array.from(wrap.querySelectorAll('[data-step]'));
    const lines = Array.from(wrap.querySelectorAll('i'));
    spans.forEach(el => {
      const step = Number(el.dataset.step || 0);
      el.classList.toggle('done', step < n);
      el.classList.toggle('active', step === n);
    });
    lines.forEach((el, i) => el.classList.toggle('done', i + 1 < n));
  },

  _startTicker() {
    if (this._interval) clearInterval(this._interval);
    this._interval = setInterval(() => {
      if (typeof isCancellationRequested !== 'undefined' && isCancellationRequested) return;
      if (!this._startTime) return;
      const now = Date.now(),
        elapsed = now - this._startTime;
      const { time, fill } = this._els();

      if (this._mode === 'indeterminate') {
        if (fill) fill.classList.add('indeterminate');
        if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • AI processing…`;
      } else if (this._mode === 'steps') {
        const remain = Math.max(0, this._totalSteps - this._stepDone);
        if (this._stepDone > 0 && remain > 0) {
          const avg = (now - this._stepStartTime) / this._stepDone;
          if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • ~${this._formatTime(avg * remain)} remaining`;
        } else if (time) {
          time.textContent = `Elapsed ${this._formatTime(elapsed)} • ${remain ? 'Estimating…' : 'Finishing…'}`;
        }
      } else if (this._mode === 'estimate') {
        const rem = Math.max(0, this._estimatedMs - elapsed);
        const span = Math.max(1, this._stageEndPct - this._stageStartPct);
        const target = this._stageStartPct + span * (1 - Math.exp(-elapsed / Math.max(6500, this._estimatedMs * 0.65)));
        this._setPercent(Math.max(this._lastPct, target));
        if (time) {
          time.textContent = rem > 1000 ?
            `Elapsed ${this._formatTime(elapsed)} • estimated ~${this._formatTime(rem)} remaining` :
            `Elapsed ${this._formatTime(elapsed)} • finishing…`;
        }
      } else {
        const span = Math.max(1, this._stageEndPct - this._stageStartPct);
        const stageElapsed = now - this._stageStartedAt;
        const target = this._stageStartPct + Math.min(span * 0.82, span * (1 - Math.exp(-stageElapsed / 9000)));
        this._setPercent(Math.max(this._lastPct, target));
        if (time) time.textContent = `Elapsed ${this._formatTime(elapsed)} • Working…`;
      }
      
      // Update page count if set
      this._updatePageCountDisplay();
    }, 250);
  },

  _updatePageCountDisplay() {
    const el = document.getElementById('progress-page-count');
    if (!el) return;
    if (this._totalPages > 0) {
      el.textContent = `📄 Page ${this._pageCount} of ${this._totalPages}`;
      el.style.display = 'block';
    } else {
      el.style.display = 'none';
    }
  },

  show(title, subtitle) {
    const e = this._els();
    e.overlay.style.display = 'flex';
    e.title.textContent = title || 'Working...';
    e.subtitle.textContent = subtitle || '';
    if (e.badge) e.badge.textContent = '';
    if (e.scope) e.scope.textContent = '';
    if (e.time) e.time.textContent = 'Elapsed 0s';

    this._startTime = Date.now();
    this._stepStartTime = this._startTime;
    this._estimatedMs = 0;
    this._totalSteps = 0;
    this._stepDone = 0;
    this._lastPct = 0;
    this._mode = 'stage';
    this._stageStartPct = 0;
    this._stageEndPct = 0;
    this._stageStartedAt = this._startTime;
    this._pageCount = 0;
    this._totalPages = 0;
    this._setPercent(0, true);
    this._fileProgressItems.clear();
    if (e.preview) e.preview.innerHTML = '';
    this._previewContainer = e.preview;
    this._setVisualStage(1);
    this._updatePageCountDisplay();

    const cancel = document.getElementById('cancel-processing-btn');
    if (cancel) cancel.disabled = false;
    if (typeof resetCancellationState === 'function') resetCancellationState();
  },

  setLabel(t) {
    const e = this._els().subtitle;
    if (e) e.textContent = t || '';
  },

  setScope(t) {
    const e = this._els().scope;
    if (e) e.textContent = t || '';
  },

  setStage(label, startPct, endPct, { indeterminate = false } = {}) {
    this._mode = indeterminate ? 'indeterminate' : 'stage';
    this._stageStartPct = Math.max(0, Math.min(100, startPct || 0));
    this._stageEndPct = Math.max(this._stageStartPct, Math.min(100, endPct || 0));
    this._stageStartedAt = Date.now();
    const stage = this._stageStartPct < 25 ? 1 : (this._stageStartPct < 72 ? 2 : (this._stageStartPct < 94 ? 3 : 4));
    this._setVisualStage(stage);
    if (label) this.setLabel(label);
    this._setPercent(this._stageStartPct);
    if (indeterminate) this._setIndeterminate();
    this._startTicker();
  },

  startAutoEstimate(seconds) {
    this._setVisualStage(1);
    this._estimatedMs = Math.max(Number(seconds) || 1, 1) * 1000;
    this._totalSteps = 0;
    this._mode = 'estimate';
    this._stageStartPct = 0;
    this._stageEndPct = 92;
    this._stageStartedAt = this._startTime;
    this._startTicker();
  },

  startStepEstimate(total) {
    this._setVisualStage(2);
    if (this._interval) clearInterval(this._interval);
    this._totalSteps = Math.max(Number(total) || 1, 1);
    this._stepDone = 0;
    this._stepStartTime = Date.now();
    this._mode = 'steps';
    this._setPercent(0, true);
    this._startTicker();
  },

  reportStepComplete(done) {
    if (typeof isCancellationRequested !== 'undefined' && isCancellationRequested) return;
    if (Number(done) >= this._totalSteps) this._setVisualStage(3);
    this._stepDone = Math.max(0, Math.min(this._totalSteps, Number(done) || 0));
    this._setPercent((this._stepDone / this._totalSteps) * 100);
    const remain = this._totalSteps - this._stepDone;
    const now = Date.now(),
      elapsed = now - this._startTime;
    const e = this._els().time;
    if (e) {
      e.textContent = remain ?
        `Elapsed ${this._formatTime(elapsed)} • ~${this._formatTime(((now - this._stepStartTime) / Math.max(this._stepDone, 1)) * remain)} remaining` :
        `Elapsed ${this._formatTime(elapsed)} • Finishing…`;
    }
  },

  finish() {
    if (this._interval) { clearInterval(this._interval);
      this._interval = null; }
    this._setVisualStage(4);
    this._mode = 'done';
    this._setPercent(100, true);
    const e = this._els();
    if (e.fill) e.fill.classList.remove('indeterminate');
    if (e.time) e.time.textContent = `Done • ${this._elapsed()}`;
    this._updatePageCountDisplay();
  },

  setActiveModel(name) {
    const e = this._els().badge;
    if (e) e.textContent = name ? 'Model: ' + name : '';
  },

  updatePausedState() {},

  hide() {
    if (this._interval) { clearInterval(this._interval);
      this._interval = null; }
    const e = this._els();
    e.overlay.style.display = 'none';
    if (e.badge) e.badge.textContent = '';
    if (e.scope) e.scope.textContent = '';
    if (e.fill) e.fill.classList.remove('indeterminate');
    this._pageCount = 0;
    this._totalPages = 0;
    this._updatePageCountDisplay();
  },

  // === PDF PAGE COUNT TRACKING ===
  setPageCount(current, total) {
    this._pageCount = Math.max(0, Number(current) || 0);
    this._totalPages = Math.max(0, Number(total) || 0);
    this._updatePageCountDisplay();
  },

  incrementPage() {
    if (this._totalPages > 0 && this._pageCount < this._totalPages) {
      this._pageCount++;
      this._updatePageCountDisplay();
    }
  },

  // === FILE PROGRESS ===
  addFileProgress(key, fileName, phase = 'Queued', meta = '') {
    if (!this._previewContainer) return null;
    const existing = this._fileProgressItems.get(key);
    if (existing) return existing;

    const div = document.createElement('div');
    div.className = 'progress-file-item';
    div.dataset.progressFileKey = String(key);
    div.innerHTML = `
      <div class="progress-file-head">
        <span class="progress-file-name"></span>
        <span class="progress-file-status">Queued</span>
      </div>
      <div class="progress-file-meta"></div>
      <div class="progress-file-track"><div class="progress-file-fill"></div></div>
    `;
    div.querySelector('.progress-file-name').textContent = fileName || 'File';
    div.querySelector('.progress-file-status').textContent = phase || 'Queued';
    div.querySelector('.progress-file-meta').textContent = meta || '';

    this._previewContainer.appendChild(div);
    this._fileProgressItems.set(key, div);
    this._previewContainer.scrollTop = this._previewContainer.scrollHeight;
    return div;
  },

  updateFileProgress(key, pct, phase, meta = '', state = 'working') {
    const div = this._fileProgressItems.get(key);
    if (!div) return;
    pct = Math.max(0, Math.min(100, Number(pct) || 0));

    const fill = div.querySelector('.progress-file-fill');
    const status = div.querySelector('.progress-file-status');
    const metaEl = div.querySelector('.progress-file-meta');

    if (fill) fill.style.width = pct + '%';
    if (status) {
      status.className = 'progress-file-status' +
        (state === 'done' ? ' done' : state === 'error' ? ' error' : state === 'fallback' ? ' fallback' : '');
      status.textContent = phase || (state === 'done' ? 'Done' : state === 'error' ? 'Error' : 'Working');
    }
    if (metaEl) metaEl.textContent = (meta || '') + (meta ? ' • ' : '') + Math.round(pct) + '%';
  },

  addPagePreview(label, content, status) {
    if (!this._previewContainer) return;
    const div = document.createElement('div');
    div.className = 'progress-page-thumb' + (status === 'active' ? ' active' : '') + (status === 'done' ? ' done' : '');
    div.innerHTML = `
      <span class="thumb-label"></span>
      <span class="thumb-text"></span>
      <span class="thumb-badge"></span>
    `;
    div.querySelector('.thumb-label').textContent = label || '';
    div.querySelector('.thumb-text').textContent = (content || '').slice(0, 220) || '(no text detected)';
    div.querySelector('.thumb-badge').textContent = status === 'active' ? 'Working' : '';
    this._previewContainer.appendChild(div);
    this._previewContainer.scrollTop = this._previewContainer.scrollHeight;
  },

  clearPreview() {
    if (this._previewContainer) this._previewContainer.innerHTML = '';
    this._fileProgressItems.clear();
  }
};

// ===== THEME MANAGEMENT =====
function applyCurrentTheme() {
  const icon = document.getElementById('theme-toggle-icon');
  const isDark = window.APP_STATE && APP_STATE.theme === 'dark';
  if (isDark) {
    document.body.classList.add('dark');
    if (icon) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M12 2.5v2M12 19.5v2M4.2 4.2l1.4 1.4M18.4 18.4l1.4 1.4M2.5 12h2M19.5 12h2M4.2 19.8l1.4-1.4M18.4 5.6l1.4-1.4" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
    }
  } else {
    document.body.classList.remove('dark');
    if (icon) {
      icon.innerHTML = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M19 14.5A7.5 7.5 0 1 1 9.5 5a6 6 0 0 0 9.5 9.5Z" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linejoin="round"/></svg>';
    }
  }
}

function toggleDarkMode() {
  if (typeof APP_STATE === 'undefined') {
    window.APP_STATE = window.APP_STATE || { theme: 'light' };
  }
  APP_STATE.theme = APP_STATE.theme === 'light' ? 'dark' : 'light';
  applyCurrentTheme();
  if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
    TAB_MANAGER._persist();
  }
}

// ===== MODE BUTTON =====
function updateModeButtonText() {
  const btn = document.getElementById('mode-toggle-btn');
  if (!btn) return;
  const isMono = document.body.classList.contains('photocopy-mode');
  const icon = document.getElementById('mode-toggle-icon');
  const label = document.getElementById('mode-toggle-label');

  if (icon) {
    icon.innerHTML = isMono ?
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M8 8l8 8M16 8l-8 8" stroke="currentColor" stroke-width="1.6" stroke-linecap="round"/></svg>' :
      '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="8.5" fill="none" stroke="currentColor" stroke-width="1.7"/><circle cx="9" cy="10" r=".9" fill="currentColor"/><circle cx="15" cy="10" r=".9" fill="currentColor"/><path d="M8.5 14.5c2 1.8 5 1.8 7 0" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/></svg>';
  }
  if (label) label.textContent = isMono ? 'Monochrome' : 'Color';
  btn.setAttribute('aria-pressed', isMono ? 'true' : 'false');
  btn.title = isMono ? 'Switch to Color mode' : 'Switch to Monochrome mode';
}

function togglePhotocopyMode() {
  const isNowMonochrome = !document.body.classList.contains('photocopy-mode');
  document.body.classList.toggle('photocopy-mode', isNowMonochrome);

  updateModeButtonText();
  if (typeof applyMonochromeDocumentStyles === 'function') applyMonochromeDocumentStyles();

  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
    TAB_MANAGER._persist();
  }
  displayToastNotification(isNowMonochrome ? 'Monochrome Mode Enabled' : 'Color Mode Enabled');
}

// ===== TEXTAREA AUTO-RESIZE =====
function autoResizeTextarea(ta) {
  if (!ta) return;
  ta.style.height = 'auto';
  ta.style.height = Math.min(ta.scrollHeight, 120) + 'px';
}

// ===== SIDEBAR RESIZE =====
function initializeSidebarResize(event) {
  const sidebar = document.getElementById('sidebar');
  if (!sidebar) return;
  const startX = event.clientX;
  const startWidth = sidebar.offsetWidth;

  function onMouseMove(ev) {
    const newWidth = startWidth + (ev.clientX - startX);
    if (newWidth >= 300 && newWidth <= 550) sidebar.style.width = newWidth + 'px';
  }

  function onMouseUp() {
    document.removeEventListener('mousemove', onMouseMove);
    document.removeEventListener('mouseup', onMouseUp);
  }
  document.addEventListener('mousemove', onMouseMove);
  document.addEventListener('mouseup', onMouseUp);
}

// ===== MOBILE / DESKTOP TOPBAR MORE MENU =====
let __topbarMenuOpen = false;

function setTopbarMenuOpen(open) {
  const menu = document.getElementById('topbar-actions');
  const btn = document.getElementById('topbar-more-btn');
  if (!menu || !btn) return;
  __topbarMenuOpen = !!open;
  menu.classList.toggle('open', __topbarMenuOpen);
  btn.classList.toggle('active', __topbarMenuOpen);
  btn.setAttribute('aria-expanded', __topbarMenuOpen ? 'true' : 'false');
  menu.setAttribute('aria-hidden', __topbarMenuOpen ? 'false' : 'true');
  if (isMobileDeviceLayout()) document.body.classList.toggle('topbar-menu-open', __topbarMenuOpen);
}

function toggleTopbarMenu(forceClose) {
  if (forceClose === true) { setTopbarMenuOpen(false); return; }
  setTopbarMenuOpen(!__topbarMenuOpen);
}

function closeTopbarMenu() { setTopbarMenuOpen(false); }

function bindTopbarMoreMenu() {
  const btn = document.getElementById('topbar-more-btn');
  const menu = document.getElementById('topbar-actions');
  if (!btn || !menu || btn.dataset.moreMenuBound === '1') return;
  btn.dataset.moreMenuBound = '1';
  btn.type = 'button';
  btn.setAttribute('aria-expanded', 'false');
  menu.setAttribute('aria-hidden', 'true');

  btn.addEventListener('click', (e) => {
    e.preventDefault();
    e.stopPropagation();
    toggleTopbarMenu();
  }, false);

  btn.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault();
      toggleTopbarMenu(); } else if (e.key === 'Escape') closeTopbarMenu();
  });

  document.addEventListener('pointerdown', (e) => {
    if (!__topbarMenuOpen) return;
    const target = e.target;
    if (target && (btn.contains(target) || menu.contains(target))) return;
    closeTopbarMenu();
  }, false);

  document.addEventListener('click', (e) => {
    if (!__topbarMenuOpen) return;
    const target = e.target;
    if (target && (btn.contains(target) || menu.contains(target))) return;
    closeTopbarMenu();
  }, false);

  window.addEventListener('resize', () => {
    if (!isMobileDeviceLayout()) closeTopbarMenu();
  }, { passive: true });
}

// ===== PAGE RANGE MODAL =====
let pageRangeResolve = null;

function promptForPageRange(totalPages) {
  return new Promise((resolve) => {
    const modal = document.getElementById('page-range-modal');
    if (!modal) {
      resolve(null);
      return;
    }
    document.getElementById('range-start').value = 1;
    document.getElementById('range-end').value = totalPages;
    modal.style.display = 'flex';
    pageRangeResolve = resolve;
    modal.dataset.totalPages = totalPages;
  });
}

function closePageRangeModal() {
  const modal = document.getElementById('page-range-modal');
  if (!modal) return;
  modal.style.display = 'none';
  if (pageRangeResolve) {
    pageRangeResolve(null);
    pageRangeResolve = null;
  }
}

function confirmPageRange() {
  const modal = document.getElementById('page-range-modal');
  if (!modal) return;
  const start = parseInt(document.getElementById('range-start').value) || 1;
  const end = parseInt(document.getElementById('range-end').value) || 1;
  const total = parseInt(modal.dataset.totalPages) || 1;
  const validStart = Math.max(1, Math.min(start, total));
  const validEnd = Math.max(validStart, Math.min(end, total));
  modal.style.display = 'none';
  if (pageRangeResolve) {
    pageRangeResolve({ start: validStart, end: validEnd });
    pageRangeResolve = null;
  }
}

// ===== EDIT PAGE MODAL =====
let _editModalResolve = null;

function openEditPageModal() {
  return new Promise((resolve) => {
    const modal = document.getElementById('edit-page-modal');
    if (!modal) {
      resolve(null);
      return;
    }
    const input = document.getElementById('edit-page-input');
    input.value = '';
    modal.style.display = 'flex';
    _editModalResolve = resolve;
    setTimeout(() => input.focus(), 100);
  });
}

function closeEditPageModal() {
  const modal = document.getElementById('edit-page-modal');
  if (!modal) return;
  modal.style.display = 'none';
  if (_editModalResolve) {
    _editModalResolve(null);
    _editModalResolve = null;
  }
}

function confirmEditPages() {
  const input = document.getElementById('edit-page-input');
  if (!input) return;
  const raw = input.value.trim();
  if (!raw) {
    displayToastNotification('⚠️ Please enter at least one page number.');
    return;
  }
  const parts = raw.split(/\s+/).filter(p => p.length > 0);
  const numbers = parts.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
  if (numbers.length === 0) {
    displayToastNotification('⚠️ Invalid page numbers. Use numbers separated by spaces (e.g., 9 10 11).');
    return;
  }
  const modal = document.getElementById('edit-page-modal');
  if (modal) modal.style.display = 'none';
  if (_editModalResolve) {
    _editModalResolve(numbers);
    _editModalResolve = null;
  }
}

// ===== VIEW TOGGLES =====
let _desktopView = 'editor';

function switchPreviewTabDesktop(view) {
  _desktopView = view;
  const btnEditor = document.getElementById('tab-editor-btn-desktop');
  const btnPdf = document.getElementById('tab-pdf-btn-desktop');
  if (btnEditor) btnEditor.classList.toggle('active', view === 'editor');
  if (btnPdf) btnPdf.classList.toggle('active', view === 'pdf');
  if (typeof switchPreviewTab === 'function') switchPreviewTab(view);
}

function setMobileView(viewName) {
  if (typeof APP_STATE !== 'undefined') APP_STATE.currentMobileView = viewName;
  const main = document.getElementById('main-container');
  if (!main) return;
  main.classList.remove('mobile-view-chat', 'mobile-view-editor', 'mobile-view-pdf');
  main.classList.add('mobile-view-' + viewName);
  document.querySelectorAll('.mobile-nav-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = document.getElementById('mob-btn-' + viewName);
  if (activeBtn) activeBtn.classList.add('active');

  if (viewName === 'pdf') {
    if (typeof switchPreviewTab === 'function') switchPreviewTab('pdf');
  } else if (viewName === 'editor') {
    if (typeof switchPreviewTab === 'function') switchPreviewTab('editor');
    requestAnimationFrame(() => {
      try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      setTimeout(() => {
        try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      }, 200);
    });
  }

  if (!isMobileDeviceLayout()) {
    if (viewName === 'pdf') switchPreviewTabDesktop('pdf');
    else if (viewName === 'editor') switchPreviewTabDesktop('editor');
  }
}

// ===== CANCELLATION =====
let isCancellationRequested = false;
let activeRequestAbortController = null;
let lastCancellationAt = 0;

function requestCancelProcessing() {
  if (isCancellationRequested) return;
  isCancellationRequested = true;
  lastCancellationAt = Date.now();
  try { if (activeRequestAbortController) activeRequestAbortController.abort(); } catch (e) {}
  try {
    if (typeof terminateOcrWorkersForCancellation === 'function') terminateOcrWorkersForCancellation();
  } catch (e) {}
  const cancelBtn = document.getElementById('cancel-processing-btn');
  if (cancelBtn) { cancelBtn.disabled = true;
    cancelBtn.textContent = 'Cancelling…'; }
  if (ProgressUI && typeof ProgressUI.hide === 'function') ProgressUI.hide();
  displayToastNotification('Cancelled — processing stopped immediately.');
}

function resetCancellationState() {
  isCancellationRequested = false;
  lastCancellationAt = 0;
  activeRequestAbortController = null;
  const cancelBtn = document.getElementById('cancel-processing-btn');
  if (cancelBtn) { cancelBtn.disabled = false;
    cancelBtn.textContent = 'Cancel'; }
}

async function waitWhilePaused() {
  // No-op - kept for compatibility
  return;
}

// ============================================================
// WINDOW EXPOSURE – UI Helpers
// ============================================================
window.toggleDarkMode = toggleDarkMode;
window.applyCurrentTheme = applyCurrentTheme;
window.displayToastNotification = displayToastNotification;
window.autoResizeTextarea = autoResizeTextarea;
window.initializeSidebarResize = initializeSidebarResize;
window.openEditPageModal = openEditPageModal;
window.closeEditPageModal = closeEditPageModal;
window.confirmEditPages = confirmEditPages;
window.promptForPageRange = promptForPageRange;
window.closePageRangeModal = closePageRangeModal;
window.confirmPageRange = confirmPageRange;
window.switchPreviewTabDesktop = switchPreviewTabDesktop;
window.setMobileView = setMobileView;
window.requestCancelProcessing = requestCancelProcessing;
window.resetCancellationState = resetCancellationState;
window.waitWhilePaused = waitWhilePaused;
window.bindTopbarMoreMenu = bindTopbarMoreMenu;
window.toggleTopbarMenu = toggleTopbarMenu;
window.closeTopbarMenu = closeTopbarMenu;
window.togglePhotocopyMode = togglePhotocopyMode;
window.updateModeButtonText = updateModeButtonText;
