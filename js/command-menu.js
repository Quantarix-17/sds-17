// ========================================================================
// COMMAND MENU - @ command system for intent selection and chips
// ========================================================================

// ===== STATE =====
const AT_MENU_STATE = {
  open: false,
  mode: 'button',
  triggerStart: -1,
  highlightIndex: 0,
  filtered: getOrderedAtCommands(AT_COMMANDS)
};

// ===== OPEN / CLOSE =====
function toggleAtCommandMenu() {
  if (AT_MENU_STATE.open) {
    closeAtCommandMenu();
  } else {
    openAtCommandMenu('button');
    if (!isMobilePreviewMode()) {
      const ta = document.getElementById('chat-input-textarea');
      if (ta) ta.focus();
    }
  }
}

function openAtCommandMenu(mode) {
  AT_MENU_STATE.open = true;
  AT_MENU_STATE.mode = mode || 'button';
  AT_MENU_STATE.filtered = getOrderedAtCommands(AT_COMMANDS);
  AT_MENU_STATE.highlightIndex = 0;
  const btn = document.getElementById('at-command-btn');
  if (btn) btn.classList.add('active');
  const menu = document.getElementById('at-command-menu');
  const backdrop = document.getElementById('at-command-menu-backdrop');
  if (menu) menu.classList.add('open');
  if (backdrop) backdrop.classList.add('open');
  renderAtCommandMenuList();
}

function closeAtCommandMenu() {
  AT_MENU_STATE.open = false;
  AT_MENU_STATE.mode = 'button';
  AT_MENU_STATE.triggerStart = -1;
  const btn = document.getElementById('at-command-btn');
  if (btn) btn.classList.remove('active');
  const menu = document.getElementById('at-command-menu');
  const backdrop = document.getElementById('at-command-menu-backdrop');
  if (menu) menu.classList.remove('open');
  if (backdrop) backdrop.classList.remove('open');
}

// ===== KEYBOARD / POINTER DISMISSAL =====
if (!window.__atCommandDismissalInstalled) {
  window.__atCommandDismissalInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (!AT_MENU_STATE.open) return;
    if (e.code === 'Space' || e.key === ' ') {
      const target = e.target;
      const isMenuControl = target && (target.closest?.('#at-command-menu') || target.closest?.('#at-command-btn'));
      if (!isMenuControl) {
        e.preventDefault();
        e.stopPropagation();
        closeAtCommandMenu();
      }
    }
  }, true);
  document.addEventListener('pointerdown', (e) => {
    if (!AT_MENU_STATE.open) return;
    const target = e.target;
    if (!target || target.closest?.('#at-command-menu') || target.closest?.('#at-command-btn')) return;
    closeAtCommandMenu();
  }, true);
}

// ===== COMMAND HELPERS =====
function getCommandAutoParent(cmd) {
  return cmd && cmd.autoParent ? getAtCommandById(cmd.autoParent) : null;
}

function hasSelectedCommand(id) {
  if (!window.APP_STATE) return false;
  return window.APP_STATE.selectedCommands.some(c => c.id === id);
}

function hasDocumentContentForAtCommands() {
  try {
    const pages = Array.from(document.querySelectorAll('.doc-page-canvas'));
    if (!pages.length) return false;
    const text = pages.map(p => (p.innerText || '').trim()).join('\n').trim();
    return !!text && !/^Start typing here\s*$/i.test(text);
  } catch (e) {
    return false;
  }
}

function getPrimaryIntent(sel = window.APP_STATE?.selectedCommands || []) {
  return sel.find(c => c.category === 'intent' && !['chat'].includes(c.id) && !c.implicit) ||
         sel.find(c => c.category === 'intent' && !['chat'].includes(c.id)) || null;
}

function isDocumentOperationIntent(id) {
  return ['edit', 'refine', 'refine_equation', 'redesign_diagram', 'beautify', 'refine_pagination'].includes(id);
}

// ===== DEPENDENCY MANAGEMENT =====
function ensureCommandDependencies(cmd, { silent = false } = {}) {
  if (!cmd) return false;
  if (!window.APP_STATE) return false;
  const sel = window.APP_STATE.selectedCommands;
  const hasChat = sel.some(c => c.id === 'chat');
  const hasExam = sel.some(c => c.id === 'exam');
  const hasCreatePdf = sel.some(c => c.id === 'create_pdf');

  if (cmd.id === 'chat') {
    window.APP_STATE.selectedCommands = [{
      id: 'chat', category: 'intent', label: 'Chat', icon: 'chat', param: null, implicit: false
    }];
    return true;
  }
  if (hasChat) {
    if (!silent) showAtCommandToast('Remove @Chat before selecting a document command.');
    return false;
  }

  if (cmd.id === 'exercise' && !hasExam && !hasCreatePdf) {
    const cp = getAtCommandById('create_pdf');
    if (cp) {
      window.APP_STATE.selectedCommands.unshift({
        id: cp.id, category: cp.category, label: cp.label,
        icon: cp.icon, param: null, implicit: true
      });
      if (!silent) displayToastNotification('Settings @Create PDF enabled for @Exercise');
    }
  }

  if (cmd.id === 'exam') {
    window.APP_STATE.selectedCommands = window.APP_STATE.selectedCommands.filter(c => c.id !== 'create_pdf');
  }
  if (cmd.id === 'create_pdf') {
    window.APP_STATE.selectedCommands = window.APP_STATE.selectedCommands.filter(c => c.id !== 'exam');
  }

  if (cmd.requiresDocument && !hasDocumentContentForAtCommands()) {
    if (!silent) showAtCommandToast(`@${cmd.label} requires an existing document first.`);
    return false;
  }

  const parent = getCommandAutoParent(cmd);
  if (parent && !sel.some(c => c.id === parent.id)) {
    if (parent.id === 'create_pdf' && hasExam) {
      if (!silent) showAtCommandToast(`@${cmd.label} cannot be used with @Exam.`);
      return false;
    }
    window.APP_STATE.selectedCommands.push({
      id: parent.id, category: parent.category, label: parent.label,
      icon: parent.icon, param: null, implicit: true
    });
    if (!silent) displayToastNotification(`Settings @${parent.label} enabled for @${cmd.label}`);
  }
  return true;
}

function normalizeAtCommandSelection() {
  if (!window.APP_STATE) return;
  const sel = window.APP_STATE.selectedCommands;
  const primary = getPrimaryIntent(sel);
  if (!primary) return;
  const parent = getCommandAutoParent(primary);
  if (parent && !sel.some(c => c.id === parent.id)) {
    sel.unshift({
      id: parent.id, category: parent.category, label: parent.label, icon: parent.icon,
      param: null, implicit: true
    });
  }
}

function getAtCommandDisabledReason(cmd) {
  if (!window.APP_STATE) return 'Application state unavailable';
  const sel = window.APP_STATE.selectedCommands;
  const hasChat = sel.some(c => c.id === 'chat');
  const hasExam = sel.some(c => c.id === 'exam');
  const hasCreatePdf = sel.some(c => c.id === 'create_pdf');
  const primary = getPrimaryIntent(sel);
  const hasExistingDocument = hasDocumentContentForAtCommands();

  if (hasChat) return cmd.id === 'chat' ? null : 'Remove @Chat first — @Chat is standalone';
  if (cmd.id === 'chat' && sel.length > 0) return 'Remove the current command(s) first — @Chat is standalone';

  if (cmd.category === 'intent' && !['chat'].includes(cmd.id)) {
    if (primary && primary.id !== cmd.id) {
      return `Remove @${primary.label} first — only one primary action is allowed`;
    }
    if (cmd.id === 'create_pdf' && hasExam) return 'Remove @Exam first';
    if (cmd.id === 'exam' && hasCreatePdf) return 'Remove @Create PDF first';
    if (cmd.requiresDocument && !hasExistingDocument) return 'Create/open a document first';
  }

  if (cmd.category === 'length') {
    if (hasExam) return 'Length options apply to @Create PDF, not @Exam';
    if (!hasCreatePdf) return 'Select @Create PDF first';
    const other = sel.find(c => c.category === 'length' && c.id !== cmd.id);
    if (other) return `Remove @${other.label} first — choose one length`;
  }

  if (cmd.category === 'target') {
    if (!hasExistingDocument) return 'Create/open a document first';
    if (!primary || !isDocumentOperationIntent(primary.id)) {
      return 'Select @Edit, @Refine, @Refine Equation, @Redesign Diagram, @Beautify, or @Refine Pagination first';
    }
  }

  if (cmd.category === 'language') {
    if (!primary) return 'Select @Create PDF, @Exam, or a document-editing action first';
    const same = sel.find(c => c.category === 'language' && c.id !== cmd.id);
    if (same) return `Remove @${same.label} first`;
  }

  if (cmd.category === 'visual') {
    if (!(hasCreatePdf || hasExam)) return 'Select @Create PDF or @Exam first';
  }

  if (cmd.category === 'content') {
    return hasExam ? null : 'Select @Exam first';
  }

  if (cmd.id === 'exercise' || cmd.category === 'practice') {
    if (hasExam || hasCreatePdf || (primary && isDocumentOperationIntent(primary.id))) return null;
    return null;
  }

  if (cmd.category === 'difficulty') {
    if (!hasExam) return 'Select @Exam first';
    const other = sel.find(c => c.category === 'difficulty' && c.id !== cmd.id);
    if (other) return `Remove @${other.label} first — choose one difficulty`;
  }

  if (hasCreatePdf && primary && isDocumentOperationIntent(primary.id)) {
    if (cmd.id === 'long_pdf' || cmd.id === 'short_pdf' || cmd.id === 'canvas') {
      return 'Remove the current editing action first';
    }
  }

  return null;
}

function isAtCommandDisabled(cmd) {
  if (!cmd) return true;
  return !!getAtCommandDisabledReason(cmd);
}

// ===== MENU ITEM SELECTION =====
function chooseAtCommandFromMenu(cmd) {
  const ta = document.getElementById('chat-input-textarea');
  if (!cmd) return;
  const disabledReason = getAtCommandDisabledReason(cmd);
  if (disabledReason) {
    showAtCommandToast(disabledReason);
    return;
  }

  if (cmd && !cmd.hasParam && cmd.id !== 'edit' && !ensureCommandDependencies(cmd, { silent: false })) return;

  if (ta && AT_MENU_STATE.mode === 'type' && AT_MENU_STATE.triggerStart > -1) {
    const cursorPos = ta.selectionStart;
    const before = ta.value.slice(0, AT_MENU_STATE.triggerStart);
    const after = ta.value.slice(cursorPos);
    ta.value = before + after;
    ta.selectionStart = ta.selectionEnd = before.length;
  }

  // Special handling for @edit: open page selection modal if no pageTarget yet
  if (cmd.id === 'edit') {
    if (!ensureCommandDependencies(cmd, { silent: false })) return;
    const existing = window.APP_STATE.selectedCommands.find(c => c.id === 'edit');
    if (existing && existing.param) {
      attemptAddAtCommand(cmd, existing.param);
      renderAtCommandMenuList();
      if (ta) { autoResizeTextarea(ta);
        if (!isMobilePreviewMode()) ta.focus(); }
      return;
    }
    openEditPageModal().then(pages => {
      if (pages && pages.length > 0) {
        const pageString = pages.join(' ');
        const existingCmd = window.APP_STATE.selectedCommands.find(c => c.id === 'edit');
        if (existingCmd) {
          existingCmd.param = pageString;
        } else {
          attemptAddAtCommand(cmd, pageString);
        }
        renderSelectedCommandChips();
        renderAtCommandMenuList();
        if (ta) { autoResizeTextarea(ta);
          if (!isMobilePreviewMode()) ta.focus(); }
      } else {
        if (ta) ta.focus();
      }
    });
    return;
  }

  if (cmd.hasParam) {
    if (!ensureCommandDependencies(cmd, { silent: false })) return;
    if (ta) {
      const pos = ta.selectionStart;
      const before = ta.value.slice(0, pos);
      const after = ta.value.slice(pos);
      ta.value = before + cmd.insertText + after;
      const newPos = pos + cmd.insertText.length;
      ta.selectionStart = ta.selectionEnd = newPos;
      autoResizeTextarea(ta);
    }
    closeAtCommandMenu();
    if (cmd.id === 'refine_pagination') {
      displayToastNotification('Please type only the page number in English digits (e.g. 5)');
    }
    if (ta) ta.focus();
    return;
  }

  attemptAddAtCommand(cmd, null);
  if (cmd.id === 'chat') {
    closeAtCommandMenu();
  } else {
    const menu = document.getElementById('at-command-menu');
    const preservedScrollTop = menu ? menu.scrollTop : 0;
    renderAtCommandMenuList();
    requestAnimationFrame(() => {
      const currentMenu = document.getElementById('at-command-menu');
      if (currentMenu) currentMenu.scrollTop = preservedScrollTop;
      AT_MENU_STATE.highlightIndex = 0;
    });
  }
  if (ta) {
    autoResizeTextarea(ta);
    if (!isMobilePreviewMode() || AT_MENU_STATE.mode === 'type') ta.focus();
  }
}

function showAtCommandToast(msg) {
  displayToastNotification(msg);
  const btn = document.getElementById('at-command-btn');
  if (btn) {
    btn.style.animation = 'none';
    void btn.offsetWidth;
    btn.style.animation = 'shakeError 0.4s var(--ease)';
  }
}

function shakeChatInputField() {
  const ta = document.getElementById('chat-input-textarea');
  if (!ta) return;
  ta.classList.remove('shake-error');
  void ta.offsetWidth;
  ta.classList.add('shake-error');
  setTimeout(() => ta.classList.remove('shake-error'), 450);
}

// ===== ADD / REMOVE COMMANDS =====
function attemptAddAtCommand(cmd, param, options = {}) {
  if (!cmd || !window.APP_STATE) return false;
  const sel = window.APP_STATE.selectedCommands;

  if (cmd.id === 'chat') {
    if (sel.length > 0) {
      showAtCommandToast('@Chat cannot be combined with document commands. Remove the current commands first.');
      return false;
    }
    sel.push({ id: cmd.id, category: cmd.category, label: cmd.label, icon: cmd.icon, param: null, implicit: false });
    renderSelectedCommandChips();
    return true;
  }

  if (sel.some(c => c.id === 'chat')) {
    showAtCommandToast('@Chat cannot be combined with document commands.');
    return false;
  }

  if (!ensureCommandDependencies(cmd, { silent: options.silentParent !== false })) return false;

  if (cmd.category === 'intent') {
    const existingPrimary = sel.find(c => c.category === 'intent' && c.id !== cmd.id && c.id !== 'create_pdf' && c.id !== cmd.autoParent);
    if (existingPrimary && existingPrimary.id !== 'exam') {
      window.APP_STATE.selectedCommands = sel.filter(c => c.id !== existingPrimary.id);
    }
    if (cmd.id === 'exam') {
      window.APP_STATE.selectedCommands = sel.filter(c => c.id !== 'create_pdf');
    }
  }

  if (cmd.category !== 'content') {
    const existingSameCategory = sel.find(c => c.category === cmd.category && c.id !== cmd.id && !c.implicit);
    if (existingSameCategory) {
      window.APP_STATE.selectedCommands.splice(sel.indexOf(existingSameCategory), 1);
      displayToastNotification(`Replaced '@${existingSameCategory.label}' with '@${cmd.label}'`);
    }
  }

  const already = sel.find(c => c.id === cmd.id);
  const normalizedParam = param != null ? String(param) : (cmd.category === 'content' ? String(cmd.defaultCount || 5) : null);
  if (already) {
    if (param != null || (cmd.category === 'content' && !already.param)) already.param = normalizedParam;
    already.implicit = already.implicit && param == null ? true : false;
  } else {
    sel.push({
      id: cmd.id, category: cmd.category, label: cmd.label, icon: cmd.icon,
      param: normalizedParam, implicit: false
    });
  }

  normalizeAtCommandSelection();
  pruneDependentAtCommandSelections();
  renderSelectedCommandChips();
  return true;
}

function pruneDependentAtCommandSelections() {
  if (!window.APP_STATE) return;
  let sel = window.APP_STATE.selectedCommands.slice();
  const removed = [];
  const hasExam = sel.some(c => c.id === 'exam');
  const hasCreatePdf = sel.some(c => c.id === 'create_pdf');

  if (sel.some(c => c.id === 'chat')) {
    const chat = sel.find(c => c.id === 'chat');
    const extras = sel.filter(c => c.id !== 'chat');
    if (extras.length) removed.push(...extras);
    sel = [chat];
  }

  if (sel.some(c => c.id === 'exam') && sel.some(c => c.id === 'create_pdf')) {
    sel = sel.filter(c => c.id !== 'create_pdf');
    removed.push({ id: 'create_pdf', label: 'Create PDF' });
  }

  const effectiveExam = sel.some(c => c.id === 'exam');
  const effectiveCreatePdf = sel.some(c => c.id === 'create_pdf');
  const primary = getPrimaryIntent(sel);

  if (primary) {
    const primaries = sel.filter(c => c.category === 'intent' && c.id !== primary.id && c.id !== 'chat' && !c.implicit);
    if (primaries.length) {
      removed.push(...primaries);
      sel = sel.filter(c => !primaries.includes(c));
    }
  }

  if (!effectiveExam) {
    const examOnly = sel.filter(c => c.category === 'content' || c.category === 'difficulty');
    if (examOnly.length) removed.push(...examOnly);
    sel = sel.filter(c => c.category !== 'content' && c.category !== 'difficulty');
  }

  const hasExercise = sel.some(c => c.id === 'exercise');
  const hasDocOperation = sel.some(c => c.category === 'intent' && isDocumentOperationIntent(c.id));
  if (hasExercise && !effectiveExam && !effectiveCreatePdf && !hasDocOperation) {
    const ex = sel.find(c => c.id === 'exercise');
    removed.push(ex);
    sel = sel.filter(c => c.id !== 'exercise');
  }

  if (!effectiveCreatePdf) {
    const invalid = sel.filter(c => c.category === 'length' || c.id === 'canvas' || c.id === 'language');
    if (invalid.length && !effectiveExam) removed.push(...invalid);
    sel = effectiveExam ? sel.filter(c => c.category !== 'length' && c.id !== 'canvas') :
                         sel.filter(c => c.category !== 'length' && c.id !== 'canvas' && c.id !== 'language');
  }

  const docOp = sel.find(c => c.category === 'intent' && isDocumentOperationIntent(c.id));
  const hasDoc = hasDocumentContentForAtCommands();
  if (sel.some(c => c.category === 'target') && (!hasDoc || !docOp)) {
    const targets = sel.filter(c => c.category === 'target');
    removed.push(...targets);
    sel = sel.filter(c => c.category !== 'target');
  }

  window.APP_STATE.selectedCommands = sel;
  if (removed.length) {
    const names = [...new Map(removed.filter(Boolean).map(c => [c.id || c.label, '@' + (c.label || c.id)])).values()];
    displayToastNotification(`Removed ${names.slice(0, 3).join(', ')} because its required mode was not active.`);
  }
}

function removeSelectedAtCommand(id) {
  if (!window.APP_STATE) return;
  window.APP_STATE.selectedCommands = window.APP_STATE.selectedCommands.filter(c => c.id !== id);
  pruneDependentAtCommandSelections();
  normalizeAtCommandSelection();
  renderSelectedCommandChips();
  if (AT_MENU_STATE.open) renderAtCommandMenuList();
}

// ===== RENDER CHIPS =====
function renderSelectedCommandChips() {
  const wrap = document.getElementById('at-command-chips');
  if (!wrap) return;
  wrap.innerHTML = '';
  if (!window.APP_STATE) return;
  window.APP_STATE.selectedCommands.forEach(c => {
    const chip = document.createElement('span');
    chip.className = 'at-chip';
    const countedQuestion = (c.id === 'mcq' || c.id === 'cq') && c.param;
    const labelText = countedQuestion ? `@${c.label}` : (c.param ? `@${c.label.replace(/\s*\[.*?\]/, '')}:${c.param}` : `@${c.label}`);
    if (c.implicit) chip.classList.add('at-chip-implicit');
    const labelSpan = document.createElement('span');
    labelSpan.innerHTML = `<span class="at-chip-icon">${renderCommandIcon(c.icon)}</span><span>${labelText}</span>` +
      (countedQuestion ? `<span class="at-chip-count">${parseInt(c.param, 10)} questions</span>` : '');
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'at-chip-remove';
    removeBtn.setAttribute('aria-label', `Remove ${c.label}`);
    removeBtn.textContent = '×';
    removeBtn.onclick = () => removeSelectedAtCommand(c.id);
    chip.appendChild(labelSpan);
    chip.appendChild(removeBtn);
    wrap.appendChild(chip);
  });
}

// ===== RENDER MENU LIST =====
function renderAtCommandMenuList() {
  const menu = document.getElementById('at-command-menu');
  if (!menu) return;
  const preservedScrollTop = menu.scrollTop;
  menu.innerHTML = '';

  const closeBtn = document.createElement('button');
  closeBtn.id = 'at-command-menu-close';
  closeBtn.setAttribute('aria-label', 'Close menu');
  closeBtn.innerHTML = renderCommandIcon('close');
  closeBtn.onclick = () => closeAtCommandMenu();
  menu.appendChild(closeBtn);

  if (AT_MENU_STATE.filtered.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'at-command-empty';
    empty.textContent = 'No matching commands';
    menu.appendChild(empty);
    return;
  }

  const hint = document.createElement('div');
  hint.className = 'at-command-menu-hint';
  hint.textContent = 'Select an @ command';
  menu.appendChild(hint);

  // Single unified command list — no category tabs, everything in one section.

  // Command items
  AT_MENU_STATE.filtered.forEach((cmd, idx) => {
    const disabled = isAtCommandDisabled(cmd);
    const disabledReason = disabled ? getAtCommandDisabledReason(cmd) : null;
    const isSelected = window.APP_STATE && window.APP_STATE.selectedCommands.some(c => c.id === cmd.id);

    const item = document.createElement('div');
    item.className = 'at-command-item' +
      (idx === AT_MENU_STATE.highlightIndex ? ' highlighted' : '') +
      (disabled ? ' disabled' : '') +
      (isSelected ? ' selected' : '');
    item.setAttribute('role', 'option');
    item.setAttribute('aria-selected', isSelected ? 'true' : 'false');

    if (disabled) {
      item.setAttribute('aria-disabled', 'true');
      if (disabledReason) item.title = disabledReason;
    } else {
      item.onclick = () => chooseAtCommandFromMenu(cmd);
    }

    const iconSpan = document.createElement('span');
    iconSpan.className = 'at-cmd-icon';
    iconSpan.innerHTML = renderCommandIcon(cmd.icon);

    const textWrap = document.createElement('span');
    textWrap.className = 'at-cmd-text';

    const labelSpan = document.createElement('span');
    labelSpan.className = 'at-cmd-label';
    labelSpan.textContent = '@' + cmd.label;

    const descSpan = document.createElement('span');
    descSpan.className = 'at-cmd-desc';
    descSpan.textContent = disabledReason || cmd.description;

    textWrap.appendChild(labelSpan);
    textWrap.appendChild(descSpan);
    item.appendChild(iconSpan);
    item.appendChild(textWrap);

    if (isSelected && !disabled && cmd.category === 'content') {
      const selectedCmd = window.APP_STATE.selectedCommands.find(c => c.id === cmd.id);
      const parsedDefault = parseInt(cmd.defaultCount, 10);
      const defaultCount = Number.isFinite(parsedDefault) && parsedDefault > 0 ? parsedDefault : 5;
      const countWrap = document.createElement('span');
      countWrap.className = 'at-question-count-control';
      const countLabel = document.createElement('label');
      countLabel.textContent = 'Questions';
      const countInput = document.createElement('input');
      countInput.type = 'number';
      countInput.min = '1';
      countInput.max = '200';
      countInput.step = '1';
      countInput.value = String(Math.max(1, Math.min(200, parseInt(selectedCmd && selectedCmd.param || defaultCount, 10) || defaultCount)));
      countInput.setAttribute('aria-label', `Number of ${cmd.label} questions`);
      countInput.title = `Number of @${cmd.label} questions`;
      const commitQuestionCount = () => {
        const parsed = parseInt(countInput.value || String(defaultCount), 10);
        const value = Number.isFinite(parsed) ? Math.max(1, Math.min(200, parsed)) : defaultCount;
        countInput.value = String(value);
        const target = window.APP_STATE.selectedCommands.find(c => c.id === cmd.id);
        if (target) { target.param = String(value);
          renderSelectedCommandChips(); }
      };
      countInput.oninput = commitQuestionCount;
      countInput.onchange = commitQuestionCount;
      countInput.onclick = e => e.stopPropagation();
      countInput.onpointerdown = e => e.stopPropagation();
      countInput.ontouchstart = e => e.stopPropagation();
      countInput.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') e.stopPropagation(); };
      countWrap.appendChild(countLabel);
      countWrap.appendChild(countInput);
      item.appendChild(countWrap);
    }
    if (isSelected && !disabled) {
      const removeBtn = document.createElement('button');
      removeBtn.type = 'button';
      removeBtn.className = 'at-cmd-remove';
      removeBtn.innerHTML = renderCommandIcon('close');
      removeBtn.setAttribute('aria-label', `Remove ${cmd.label}`);
      removeBtn.onclick = (e) => {
        e.stopPropagation();
        removeSelectedAtCommand(cmd.id);
      };
      item.appendChild(removeBtn);
    }

    menu.appendChild(item);
  });

  // Format section (PDF visual & text formats)
  const formatWrap = document.createElement('div');
  formatWrap.className = 'at-format-section';

  const formatTitle = document.createElement('div');
  formatTitle.className = 'at-format-title';
  formatTitle.textContent = 'PDF Visual / Background Formats';
  formatWrap.appendChild(formatTitle);

  const currentFormat = typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default';
  [
    { id: 'default', label: 'Default', desc: 'Original PDF appearance' },
    { id: 'aurora', label: 'Aurora Flow', desc: 'Teal · fresh · modern' },
    { id: 'editorial', label: 'Editorial', desc: 'Cream · terracotta · book style' },
    { id: 'midnight', label: 'Midnight Canvas', desc: 'Indigo · modern · high contrast' },
    { id: 'blueprint', label: 'Blueprint Grid', desc: 'Technical · grid · structured' },
    { id: 'sage', label: 'Sage Minimal', desc: 'Soft green · calm · clean' }
  ].forEach(f => {
    const row = document.createElement('div');
    row.className = 'at-format-item' + (currentFormat === f.id ? ' active' : '');
    row.onclick = () => {
      if (typeof choosePDFVisualFormat === 'function') choosePDFVisualFormat(f.id);
    };
    const sw = document.createElement('span');
    sw.className = 'at-format-swatch ' + f.id;
    const info = document.createElement('span');
    info.className = 'at-cmd-text';
    const label = document.createElement('span');
    label.className = 'at-cmd-label';
    label.textContent = f.label;
    const desc = document.createElement('span');
    desc.className = 'at-cmd-desc';
    desc.textContent = f.desc;
    info.append(label, desc);
    row.append(sw, info);
    formatWrap.appendChild(row);
  });

  const textTitle = document.createElement('div');
  textTitle.className = 'at-format-title';
  textTitle.style.marginTop = '8px';
  textTitle.textContent = 'Text / Typography Formats';
  formatWrap.appendChild(textTitle);

  const currentTextFormat = typeof getActivePDFTextFormat === 'function' ? getActivePDFTextFormat() : 'default';
  [
    { id: 'default', label: 'Default', desc: 'Original text styling' },
    { id: 'academic', label: 'Academic', desc: 'Serif · formal · spacious' },
    { id: 'modern', label: 'Modern', desc: 'Sans-serif · bold · clean' },
    { id: 'compact', label: 'Compact', desc: 'Tighter text · space efficient' }
  ].forEach(f => {
    const row = document.createElement('div');
    row.className = 'at-format-item' + (currentTextFormat === f.id ? ' active' : '');
    row.onclick = () => {
      if (typeof choosePDFTextFormat === 'function') choosePDFTextFormat(f.id);
    };
    const sw = document.createElement('span');
    sw.className = 'at-text-swatch ' + f.id;
    sw.textContent = 'Aa';
    const info = document.createElement('span');
    info.className = 'at-cmd-text';
    const label = document.createElement('span');
    label.className = 'at-cmd-label';
    label.textContent = f.label;
    const desc = document.createElement('span');
    desc.className = 'at-cmd-desc';
    desc.textContent = f.desc;
    info.append(label, desc);
    row.append(sw, info);
    formatWrap.appendChild(row);
  });

  const resetBtn = document.createElement('button');
  resetBtn.type = 'button';
  resetBtn.className = 'at-format-reset';
  resetBtn.textContent = 'Reset all formats to Default';
  resetBtn.onclick = () => {
    if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat('default');
    if (typeof applyPDFTextFormat === 'function') applyPDFTextFormat('default');
    renderAtCommandMenuList();
    displayToastNotification('PDF background and text restored to Default');
  };
  formatWrap.appendChild(resetBtn);
  menu.appendChild(formatWrap);

  menu.scrollTop = preservedScrollTop;
  requestAnimationFrame(() => { menu.scrollTop = preservedScrollTop; });
}

// ===== FILTER =====
function filterAtCommandMenu(query) {
  const q = (query || '').toLowerCase();
  AT_MENU_STATE.filtered = !q ? getOrderedAtCommands(AT_COMMANDS) :
    getOrderedAtCommands(AT_COMMANDS.filter(c => c.label.toLowerCase().includes(q) || c.id.toLowerCase().includes(q)));
  AT_MENU_STATE.highlightIndex = 0;
  renderAtCommandMenuList();
}

function moveAtCommandHighlight(delta) {
  if (!AT_MENU_STATE.filtered.length) return;
  AT_MENU_STATE.highlightIndex = (AT_MENU_STATE.highlightIndex + delta + AT_MENU_STATE.filtered.length) % AT_MENU_STATE.filtered.length;
  renderAtCommandMenuList();
}

function chooseHighlightedAtCommand() {
  const cmd = AT_MENU_STATE.filtered[AT_MENU_STATE.highlightIndex];
  if (cmd && !isAtCommandDisabled(cmd)) chooseAtCommandFromMenu(cmd);
}

// ===== CHAT INPUT HANDLING =====
function handleChatInputChanged(ta, event) {
  autoResizeTextarea(ta);
  const cursorPos = ta.selectionStart;
  const textBeforeCursor = ta.value.slice(0, cursorPos);
  const atMatch = textBeforeCursor.match(/(?:^|\s)@([a-zA-Z_]*)$/);
  if (atMatch) {
    const query = atMatch[1];
    const triggerIdx = cursorPos - query.length - 1;
    AT_MENU_STATE.mode = 'type';
    AT_MENU_STATE.triggerStart = triggerIdx;
    if (!AT_MENU_STATE.open) openAtCommandMenu('type');
    filterAtCommandMenu(query);
  } else if (AT_MENU_STATE.open && AT_MENU_STATE.mode === 'type') {
    closeAtCommandMenu();
  }
}

// ===== PARSE INLINE COMMAND TOKENS =====
function parseAndStripInlineCommandTokens(text) {
  let result = text;
  const pageCmd = getAtCommandById('page');
  const pageMatch = result.match(pageCmd.paramPattern);
  if (pageMatch) {
    attemptAddAtCommand(pageCmd, pageMatch[1]);
    result = result.replace(pageCmd.paramPattern, '').trim();
  }
  const langCmd = getAtCommandById('language');
  const langMatch = result.match(langCmd.paramPattern);
  if (langMatch) {
    attemptAddAtCommand(langCmd, langMatch[1]);
    result = result.replace(langCmd.paramPattern, '').trim();
  }
  const refineAlias = /@refine\b/i;
  if (refineAlias.test(result) && !/@refine_(equation|pagination)\b/i.test(result)) {
    attemptAddAtCommand(getAtCommandById('refine'), null, { silentParent: true });
    result = result.replace(refineAlias, '').trim();
  }
  const refinePagCmd = getAtCommandById('refine_pagination');
  const refinePagMatch = result.match(refinePagCmd.paramPattern);
  if (refinePagMatch) {
    attemptAddAtCommand(refinePagCmd, refinePagMatch[1]);
    result = result.replace(refinePagCmd.paramPattern, '').trim();
  }
  return result;
}

// ===== BUILD INTENT PAYLOAD =====
function buildIntentPayload() {
  if (!window.APP_STATE) return null;
  const sel = window.APP_STATE.selectedCommands;
  const findCat = cat => sel.find(c => c.category === cat);
  const intentCmd = sel.find(c => c.category === 'intent' && !c.implicit) || findCat('intent');
  if (!intentCmd) return null;
  const lengthCmd = findCat('length');
  const difficultyCmd = findCat('difficulty');
  const targetCmd = findCat('target');
  const languageCmd = findCat('language');
  const visualCmd = findCat('visual');
  const contentCmds = sel.filter(c => c.category === 'content' || c.category === 'practice');

  const questionCounts = {
    mcq: (() => { const c = sel.find(x => x.id === 'mcq'); const n = c && parseInt(c.param, 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
    cq: (() => { const c = sel.find(x => x.id === 'cq'); const n = c && parseInt(c.param, 10); return Number.isFinite(n) && n > 0 ? n : null; })(),
    short_question: (() => { const c = sel.find(x => x.id === 'short_question'); const n = c && parseInt(c.param, 10); return Number.isFinite(n) && n > 0 ? n : null; })()
  };

  let pageTarget = (targetCmd && targetCmd.param) ? parseInt(targetCmd.param, 10) : null;
  if (intentCmd.id === 'edit' && intentCmd.param) {
    const parts = intentCmd.param.split(/\s+/).filter(p => p.length > 0);
    const nums = parts.map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0);
    if (nums.length > 0) {
      pageTarget = nums[0];
    }
  }

  return {
    intent: intentCmd.id,
    length: lengthCmd ? lengthCmd.id : null,
    difficulty: difficultyCmd ? difficultyCmd.id : null,
    pageTarget: pageTarget,
    language: (languageCmd && languageCmd.param) ? languageCmd.param : null,
    contentTypes: contentCmds.map(c => c.id),
    questionCounts,
    visual: visualCmd ? visualCmd.id : null,
    sectionMode: typeof getSectionModeEnabled === 'function' ? getSectionModeEnabled() : false,
    refinePaginationPage: (intentCmd.id === 'refine_pagination' && intentCmd.param) ? parseInt(intentCmd.param, 10) : null,
    editPages: (intentCmd.id === 'edit' && intentCmd.param) ?
      intentCmd.param.split(/\s+/).filter(p => p.length > 0).map(n => parseInt(n, 10)).filter(n => !isNaN(n) && n > 0) : null
  };
}

// ===== BUILD INSTRUCTION TEXT =====
function buildAtCommandInstructionText(intentPayload) {
  if (!intentPayload || !intentPayload.intent) return '';
  const intentLabels = {
    chat: 'CHAT — plain conversation, reply with action "chat_reply" only, do NOT edit the document',
    create_pdf: 'CREATE PDF — create a new document/note',
    exam: 'EXAM — create an exam paper using the selected exam question types and difficulty level; @Exercise may also be included as a practice component',
    edit: 'EDIT — edit/modify the current canvas content',
    refine: 'REFINE — inspect the requested part and improve it while preserving useful information',
    refine_equation: 'REFINE EQUATION — fix ONLY the equation/KaTeX portions, leave everything else untouched',
    beautify: 'BEAUTIFY — improve styling/formatting only, do NOT change the actual wording/content',
    redesign_diagram: 'REDESIGN DIAGRAM — redesign the chart/diagram/flowchart',
    refine_pagination: 'REFINE PAGINATION — fix ONLY the pagination/page-break of the specified page, leave all actual content and wording untouched'
  };
  const parts = [`INTENT: ${intentLabels[intentPayload.intent] || intentPayload.intent}`];
  parts.push(intentPayload.sectionMode === false ?
    'GENERATION STRUCTURE MODE: DIRECT — do NOT split the response into separately generated sections. Produce the requested document as one continuous generation flow; the user is controlling the structure manually.' :
    'GENERATION STRUCTURE MODE: SECTIONED — when the request benefits from it, use the approved section-by-section generation workflow.');

  if (intentPayload.intent === 'refine_pagination' && intentPayload.refinePaginationPage) {
    parts.push(`TARGET PAGE FOR PAGINATION FIX: ${intentPayload.refinePaginationPage}`);
  }
  if (intentPayload.intent === 'edit') {
    parts.push('EDIT SAFETY: Never append, prepend, replace_all, or recreate the document. Use update_page for one selected page or update_pages for multiple selected pages. Preserve every unselected page exactly.');
    if (intentPayload.editPages && intentPayload.editPages.length) parts.push(`SELECTED EDIT PAGES: ${intentPayload.editPages.join(', ')}.`);
  }

  // LENGTH (only meaningful with @Create PDF)
  if (intentPayload.length === 'long_pdf') {
    parts.push('LENGTH: LONG — produce a genuinely long, comprehensive document with full depth, detail and examples. Do not shorten or summarize.');
  } else if (intentPayload.length === 'short_pdf') {
    parts.push('LENGTH: SHORT — produce a compact document covering only essential concepts and examples. Avoid unnecessary elaboration.');
  }

  // DIFFICULTY (exam)
  if (intentPayload.difficulty === 'easy') {
    parts.push('DIFFICULTY: EASY — use simple, accessible language and easier questions.');
  } else if (intentPayload.difficulty === 'standard') {
    parts.push('DIFFICULTY: STANDARD — use a balanced, moderate exam difficulty level.');
  } else if (intentPayload.difficulty === 'hard') {
    parts.push('DIFFICULTY: HARD — use advanced, challenging language and questions.');
  }

  // TARGET PAGE (for edit/refine-type operations other than refine_pagination, already handled above)
  if (intentPayload.pageTarget && intentPayload.intent !== 'edit' && intentPayload.intent !== 'refine_pagination') {
    parts.push(`TARGET PAGE: Apply this action only to page ${intentPayload.pageTarget}. Preserve all other pages exactly as-is.`);
  }

  // LANGUAGE
  if (intentPayload.language) {
    parts.push(`LANGUAGE: Write the entire output in "${intentPayload.language}". Do not mix in other languages unless technical terms require it.`);
  }

  // VISUAL / CANVAS
  if (intentPayload.visual === 'canvas') {
    parts.push('VISUAL SUPPORT: CANVAS — increase useful visual elements (tables, diagrams, concept maps) wherever they genuinely help understanding.');
  }

  // CONTENT TYPES (exam question types + exercise), with counts
  if (intentPayload.contentTypes && intentPayload.contentTypes.length) {
    const contentLabels = {
      mcq: 'MCQ (multiple-choice questions)',
      cq: 'CQ (creative questions)',
      short_question: 'Short Questions',
      exercise: 'Practice Exercises'
    };
    const contentParts = intentPayload.contentTypes.map(id => {
      const count = intentPayload.questionCounts ? intentPayload.questionCounts[id] : null;
      const label = contentLabels[id] || id;
      return count ? `${label}: ${count}` : label;
    });
    parts.push(`CONTENT TYPES TO INCLUDE: ${contentParts.join(', ')}.`);
  }

  return `\n\n=== USER EXPLICIT @ COMMAND SELECTION (SOURCE OF TRUTH — follow exactly, do NOT guess intent from free text) ===\nUser explicitly selected: ${parts.join('; ')}.\n=== END @ COMMAND SELECTION ===\n`;
// ============================================================
// WINDOW EXPOSURE – Command Menu
// ============================================================
window.toggleAtCommandMenu = toggleAtCommandMenu;
window.closeAtCommandMenu = closeAtCommandMenu;
window.renderAtCommandMenuList = renderAtCommandMenuList;
window.chooseAtCommandFromMenu = chooseAtCommandFromMenu;
window.filterAtCommandMenu = filterAtCommandMenu;
window.moveAtCommandHighlight = moveAtCommandHighlight;
window.chooseHighlightedAtCommand = chooseHighlightedAtCommand;
window.parseAndStripInlineCommandTokens = parseAndStripInlineCommandTokens;
window.buildIntentPayload = buildIntentPayload;
window.buildAtCommandInstructionText = buildAtCommandInstructionText;
window.renderSelectedCommandChips = renderSelectedCommandChips;
window.attemptAddAtCommand = attemptAddAtCommand;
window.removeSelectedAtCommand = removeSelectedAtCommand;
window.getAtCommandDisabledReason = getAtCommandDisabledReason;
window.isAtCommandDisabled = isAtCommandDisabled;
window.handleChatInputChanged = handleChatInputChanged;
window.showAtCommandToast = showAtCommandToast;
window.shakeChatInputField = shakeChatInputField;
window.pruneDependentAtCommandSelections = pruneDependentAtCommandSelections;
window.normalizeAtCommandSelection = normalizeAtCommandSelection;
window.ensureCommandDependencies = ensureCommandDependencies;
window.getCommandAutoParent = getCommandAutoParent;
window.hasSelectedCommand = hasSelectedCommand;
window.hasDocumentContentForAtCommands = hasDocumentContentForAtCommands;
window.getPrimaryIntent = getPrimaryIntent;
window.isDocumentOperationIntent = isDocumentOperationIntent;
window.getAtCommandById = getAtCommandById;
window.getCommandsForCategory = getCommandsForCategory;
window.getCommandCategoryKey = getCommandCategoryKey;
}
