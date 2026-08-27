// ========================================================================
// DOCUMENT EDITOR - History, Pagination, Page Management, and Core Editing
// ========================================================================

// ===== DOM REFS =====
const docContainer = document.getElementById('document-view-container');
const chatHistoryArea = document.getElementById('chat-history');

// ===== HISTORY (Undo/Redo) =====
const HISTORY = {
  undoStack: [],
  redoStack: [],
  maxSize: 30,

  saveState() {
    const currentHTML = getAllCanvasHTML();
    if (this.undoStack.length > 0 && this.undoStack[this.undoStack.length - 1] === currentHTML) return;
    this.undoStack.push(currentHTML);
    if (this.undoStack.length > this.maxSize) this.undoStack.shift();
    this.redoStack = [];
    if (typeof saveStateToLocalStorage === 'function') saveStateToLocalStorage();
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  },

  undo() {
    if (this.undoStack.length <= 1) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to undo.");
      return;
    }
    const currentState = this.undoStack.pop();
    this.redoStack.push(currentState);
    const previousState = this.undoStack[this.undoStack.length - 1];
    setDocumentHTMLAndPaginate(previousState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↶ Undone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  },

  redo() {
    if (this.redoStack.length === 0) {
      if (typeof displayToastNotification === 'function') displayToastNotification("ℹ Nothing to redo.");
      return;
    }
    const nextState = this.redoStack.pop();
    this.undoStack.push(nextState);
    setDocumentHTMLAndPaginate(nextState, false);
    if (typeof displayToastNotification === 'function') displayToastNotification("↷ Redone");
    if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
      TAB_MANAGER._captureCurrentState(TAB_MANAGER.activeId);
      TAB_MANAGER._persist();
    }
  }
};

// ===== KEYBOARD SHORTCUTS =====
document.addEventListener('keydown', (e) => {
  const activeTag = document.activeElement ? document.activeElement.tagName : '';
  if (activeTag === 'INPUT' || activeTag === 'TEXTAREA') return;
  if (e.ctrlKey && e.key === 'z') { e.preventDefault();
    HISTORY.undo(); } else if (e.ctrlKey && (e.key === 'y' || (e.shiftKey && e.key === 'Z'))) {
    e.preventDefault();
    HISTORY.redo();
  }
});

// ===== CANVAS HTML HELPERS =====
function getAllCanvasHTML() {
  if (!docContainer) return '';
  let combinedHTML = '';
  Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
    combinedHTML += clone.innerHTML;
  });
  return combinedHTML;
}

// ===== SET DOCUMENT HTML WITH PAGINATION =====
let autoSaveTimer = null;
let paginationDebounceTimer = null;

function debouncedAutoSaveAndPaginate() {
  clearTimeout(autoSaveTimer);
  autoSaveTimer = setTimeout(() => { HISTORY.saveState(); }, 1200);
  scheduleReflow();
}

function scheduleReflow() {
  clearTimeout(paginationDebounceTimer);
  paginationDebounceTimer = setTimeout(() => {
    reflowDocument();
  }, 300);
}

function saveCaretPosition() {
  const selection = window.getSelection();
  if (!selection.rangeCount) return null;
  const range = selection.getRangeAt(0);
  const activePage = range.startContainer.nodeType === 3 ?
    range.startContainer.parentNode.closest('.doc-page-canvas') :
    range.startContainer.closest('.doc-page-canvas');
  if (!activePage) return null;
  const markerId = 'caret-marker-' + Date.now();
  const marker = document.createElement('span');
  marker.id = markerId;
  marker.style.display = 'none';
  range.insertNode(marker);
  return markerId;
}

function restoreCaretPosition(markerId) {
  if (!markerId) return;
  const marker = document.getElementById(markerId);
  if (marker) {
    const selection = window.getSelection();
    const range = document.createRange();
    range.setStartBefore(marker);
    range.setEndBefore(marker);
    selection.removeAllRanges();
    selection.addRange(range);
    const page = marker.closest('.doc-page-canvas');
    if (page) page.focus();
    marker.parentNode.removeChild(marker);
  }
}

function flattenContentTopLevelNodes(tempSource) {
  const topLevelNodes = [];
  Array.from(tempSource.childNodes).forEach(node => {
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) return;
    if (node.nodeType === Node.ELEMENT_NODE &&
      node.tagName === 'DIV' &&
      !node.className.includes('block-') &&
      !node.className.includes('fc-') &&
      !node.className.includes('toc-') &&
      !node.className.includes('quiz-') &&
      !node.className.includes('manual-page-break')) {
      Array.from(node.childNodes).forEach(child => topLevelNodes.push(child));
    } else {
      topLevelNodes.push(node);
    }
  });
  return topLevelNodes;
}

function setDocumentHTMLAndPaginate(rawHtml, triggerSave = true) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (!docContainer) return;
  const savedScrollPos = docContainer.scrollTop;
  const markerId = saveCaretPosition();
  docContainer.innerHTML = '';
  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(rawHtml)) : rawHtml;
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(tempSource);

  function createNewPageElement() {
    const page = document.createElement('div');
    page.className = 'doc-page-canvas';
    page.setAttribute('contenteditable', 'true');
    page.setAttribute('spellcheck', 'false');
    page.addEventListener('input', handleCanvasInput);
    page.addEventListener('keydown', handlePageKeydown);
    page.addEventListener('blur', handlePageBlur);
    docContainer.appendChild(page);
    return page;
  }

  let currentPage = createNewPageElement();
  const createdPages = [currentPage];
  const topLevelNodes = flattenContentTopLevelNodes(tempSource);

  // --- Pagination logic with proper spacing ---
  // We use a temporary offscreen page to measure content height accurately.
  // The page has fixed A4 dimensions with proper padding.
  // We also account for margin/padding of child elements to avoid unnecessary page breaks.

  const measurePage = document.createElement('div');
  measurePage.className = 'doc-page-canvas pdf-export-measure-page';
  measurePage.style.position = 'absolute';
  measurePage.style.left = '-9999px';
  measurePage.style.top = '0';
  measurePage.style.width = EDITOR_A4_WIDTH + 'px';
  measurePage.style.height = EDITOR_A4_HEIGHT + 'px';
  measurePage.style.padding = `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`;
  measurePage.style.boxSizing = 'border-box';
  measurePage.style.overflow = 'hidden';
  measurePage.style.visibility = 'hidden';
  measurePage.style.pointerEvents = 'none';
  document.body.appendChild(measurePage);

  // Helper to check if content fits in a page
  function contentFits(pageElement, extraNode) {
    // Clone the page content and add the extra node, then measure
    const clone = pageElement.cloneNode(true);
    // Remove footer if any
    const footer = clone.querySelector('.page-footer-number');
    if (footer) footer.remove();
    // Append the extra node
    if (extraNode) {
      clone.appendChild(extraNode.cloneNode(true));
    }
    // Reset measurement page and copy content
    measurePage.innerHTML = '';
    // Copy all children except footer
    Array.from(clone.childNodes).forEach(child => {
      if (!child.classList || !child.classList.contains('page-footer-number')) {
        measurePage.appendChild(child.cloneNode(true));
      }
    });
    // Force layout
    measurePage.style.display = 'block';
    void measurePage.offsetHeight;
    const fits = measurePage.scrollHeight <= EDITOR_A4_HEIGHT + 1;
    measurePage.style.display = '';
    measurePage.innerHTML = '';
    return fits;
  }

  // Main pagination loop
  let currentPageElement = currentPage;
  for (let i = 0; i < topLevelNodes.length; i++) {
    const node = topLevelNodes[i];
    if (node.nodeType === Node.TEXT_NODE && !node.textContent.trim()) continue;
    if (node.nodeType === Node.ELEMENT_NODE && node.classList && node.classList.contains('manual-page-break')) {
      if (currentPageElement.childNodes.length > 0) {
        currentPageElement = createNewPageElement();
        createdPages.push(currentPageElement);
      }
      continue;
    }

    // Check if the node fits in the current page
    if (contentFits(currentPageElement, node)) {
      // It fits, add it
      const clone = node.cloneNode(true);
      currentPageElement.appendChild(clone);
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
    } else {
      // It doesn't fit. If the current page is empty or only has a footer, we still need to place it.
      // But if there is any content, we start a new page.
      const hasContent = Array.from(currentPageElement.childNodes).some(n => {
        if (n.nodeType === Node.TEXT_NODE) return n.textContent.trim().length > 0;
        if (n.nodeType === Node.ELEMENT_NODE) {
          if (n.classList && n.classList.contains('page-footer-number')) return false;
          return true;
        }
        return false;
      });

      if (hasContent) {
        // Try to split the node if it's a block element (like a paragraph, heading, list, table, etc.)
        // For simple text nodes or inline elements, we may need to split differently.
        if (node.nodeType === Node.ELEMENT_NODE && node.children.length === 0 && node.textContent.trim().length > 0) {
          // This is a text-only element (like a paragraph). We can split by words.
          const words = node.textContent.trim().split(/\s+/);
          if (words.length > 1) {
            // Find how many words fit on the current page
            let fitWords = 0;
            let testText = '';
            for (let w = 0; w < words.length; w++) {
              const testClone = node.cloneNode(false);
              testClone.textContent = (testText ? testText + ' ' : '') + words[w];
              if (contentFits(currentPageElement, testClone)) {
                testText = (testText ? testText + ' ' : '') + words[w];
                fitWords++;
              } else {
                break;
              }
            }
            if (fitWords > 0 && fitWords < words.length) {
              // Put the fitting words on current page
              const fitPart = node.cloneNode(false);
              fitPart.textContent = testText;
              currentPageElement.appendChild(fitPart);
              if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(fitPart);
              if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(fitPart);

              // Remaining words go to a new page
              const remainingText = words.slice(fitWords).join(' ');
              const remainingPart = node.cloneNode(false);
              remainingPart.textContent = remainingText;
              // Start a new page
              currentPageElement = createNewPageElement();
              createdPages.push(currentPageElement);
              currentPageElement.appendChild(remainingPart);
              if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(remainingPart);
              if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(remainingPart);
              continue;
            }
          }
        }

        // If we cannot split, start a new page and put the whole node there.
        currentPageElement = createNewPageElement();
        createdPages.push(currentPageElement);
        const clone = node.cloneNode(true);
        currentPageElement.appendChild(clone);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
      } else {
        // Current page is empty, just place the node.
        const clone = node.cloneNode(true);
        currentPageElement.appendChild(clone);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(clone);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(clone);
      }
    }

    // After adding, check if the page overflowed due to tall content (like a table or image)
    // and if so, we may need to move some content to the next page.
    // But we already checked with contentFits, so it should be okay.
  }

  // Clean up measurement page
  document.body.removeChild(measurePage);

  // Ensure all pages are properly sized and have footers
  normalizeAllEditorPagesToA4();
  docContainer.scrollTop = savedScrollPos;
  restoreCaretPosition(markerId);
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof applyPDFVisualFormat === 'function') applyPDFVisualFormat(typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default');
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
  if (triggerSave) HISTORY.saveState();
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER.activeId) {
    const tab = TAB_MANAGER.getActive();
    if (tab) {
      const newName = TAB_MANAGER._getTabNameFromHtml(getAllCanvasHTML());
      if (newName && newName !== 'Untitled') {
        tab.name = newName;
        TAB_MANAGER._persist();
        TAB_MANAGER.renderTabBar();
      }
    }
  }
}

// ===== PAGE EVENT HANDLERS =====
function handlePageKeydown(e) {
  if (!docContainer) return;
  const page = e.currentTarget;
  const selection = window.getSelection();
  if (!selection.rangeCount) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const pageIndex = pages.indexOf(page);

  if ((e.key === 'Backspace' || e.key === 'ArrowUp' || e.key === 'ArrowLeft') && selection.focusOffset === 0) {
    const range = selection.getRangeAt(0);
    const preCaretRange = range.cloneRange();
    preCaretRange.selectNodeContents(page);
    preCaretRange.setEnd(range.endContainer, range.endOffset);
    if (preCaretRange.toString().trim() === '') {
      if (pageIndex > 0) {
        e.preventDefault();
        const prevPage = pages[pageIndex - 1];
        prevPage.focus();
        const newRange = document.createRange();
        newRange.selectNodeContents(prevPage);
        newRange.collapse(false);
        const footer = prevPage.querySelector('.page-footer-number');
        if (footer) { newRange.setStartBefore(footer);
          newRange.setEndBefore(footer); }
        selection.removeAllRanges();
        selection.addRange(newRange);
        if (e.key === 'Backspace') {
          scheduleReflow();
        }
      }
    }
  }
}

function handleCanvasInput(event) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  scheduleReflow();
  debouncedAutoSaveAndPaginate();
}

function handlePageBlur(event) {
  const page = event.currentTarget;
  if (!/[$\\]/.test(page.textContent || '')) return;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
  debouncedAutoSaveAndPaginate();
}

// ===== REFLOW DOCUMENT =====
function reflowDocument() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return;

  const markerId = saveCaretPosition();
  let pageIndex = 0;
  while (pageIndex < pages.length) {
    const page = pages[pageIndex];
    const zoomFactor = parseFloat(page.style.zoom) || 1;
    if ((page.scrollHeight / zoomFactor) > 1123) {
      const overflow = getOverflowNodes(page);
      if (overflow.length > 0) {
        const newPage = createNewPageAfter(page);
        const fragment = document.createDocumentFragment();
        overflow.forEach(node => fragment.appendChild(node));
        newPage.prepend(fragment);
        // Recheck the same page index because we inserted a new page
        continue;
      }
    }
    pageIndex++;
  }
  normalizeAllEditorPagesToA4();
  restoreCaretPosition(markerId);
  HISTORY.saveState();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
}

function getOverflowNodes(page) {
  // We need to find nodes that overflow the page height.
  // Use a more accurate method: temporarily remove footer, measure.
  const maxHeight = 1123;
  const children = Array.from(page.childNodes);
  const footer = page.querySelector('.page-footer-number');
  const childrenWithoutFooter = children.filter(c => c !== footer);

  // If there's only footer or no content, return empty.
  if (childrenWithoutFooter.length === 0) return [];

  // Clone the page to measure without mutating the DOM
  const clonePage = page.cloneNode(true);
  clonePage.style.position = 'absolute';
  clonePage.style.left = '-9999px';
  clonePage.style.top = '0';
  clonePage.style.width = '794px';
  clonePage.style.height = 'auto';
  clonePage.style.overflow = 'visible';
  clonePage.style.zoom = '1';
  document.body.appendChild(clonePage);
  const footerClone = clonePage.querySelector('.page-footer-number');
  if (footerClone) footerClone.remove();

  const cloneChildren = Array.from(clonePage.childNodes);
  let removeCount = 0;
  while (clonePage.scrollHeight > maxHeight && cloneChildren.length > 0) {
    const last = cloneChildren.pop();
    if (last) last.remove();
    removeCount++;
  }
  document.body.removeChild(clonePage);

  if (removeCount > 0) {
    const pageChildren = Array.from(page.childNodes).filter(c => c !== footer);
    const overflow = pageChildren.slice(-removeCount);
    overflow.forEach(n => n.remove());
    return overflow;
  }
  return [];
}

// ===== A4 PAGE SAFETY =====
function resetPageToA4(page) {
  if (!page) return;
  page.style.width = EDITOR_A4_WIDTH + 'px';
  page.style.height = EDITOR_A4_HEIGHT + 'px';
  page.style.minHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
  page.style.overflow = 'hidden';
  delete page.dataset.oversized;
  page.style.zoom = '';
}

function tightenPageContentToA4(page) {
  if (!page) return false;
  resetPageToA4(page);
  const footer = page.querySelector('.page-footer-number');
  const contentNodes = Array.from(page.childNodes).filter(n => n !== footer);
  if (!contentNodes.length) return true;

  for (const scale of EDITOR_A4_FIT_STEPS) {
    page.style.fontSize = (12 * scale) + 'pt';
    page.style.lineHeight = String(1.6 * Math.max(scale, 0.86));
    page.querySelectorAll('table').forEach(table => {
      table.style.fontSize = (scale < 0.95 ? scale : 1) * 100 + '%';
    });
    page.querySelectorAll('th, td').forEach(cell => {
      cell.style.padding = scale < 0.9 ? '4px 6px' : '';
    });
    page.querySelectorAll('img, canvas').forEach(media => {
      media.style.maxHeight = Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px';
      media.style.width = 'auto';
    });
    page.querySelectorAll('svg').forEach(svg => {
      const parent = svg.closest('.figure-frame, .fc-svg-wrapper');
      if (parent) parent.style.maxHeight = Math.max(180, Math.floor(EDITOR_A4_HEIGHT * 0.72 * scale)) + 'px';
    });
    if (page.scrollHeight <= EDITOR_A4_HEIGHT + 1) {
      delete page.dataset.oversized;
      return true;
    }
  }
  page.dataset.oversized = 'true';
  return false;
}

function normalizeAllEditorPagesToA4() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(page => {
    resetPageToA4(page);
    if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
      tightenPageContentToA4(page);
    }
  });
  updatePageFooters();
}

function createNewPageAfter(referencePage) {
  const newPage = document.createElement('div');
  newPage.className = 'doc-page-canvas';
  newPage.setAttribute('contenteditable', 'true');
  newPage.setAttribute('spellcheck', 'false');
  newPage.addEventListener('input', handleCanvasInput);
  newPage.addEventListener('keydown', handlePageKeydown);
  newPage.addEventListener('blur', handlePageBlur);
  referencePage.parentNode.insertBefore(newPage, referencePage.nextSibling);
  return newPage;
}

// ===== PAGE FOOTERS =====
function updatePageFooters() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach((page, index) => {
    let footer = page.querySelector('.page-footer-number');
    if (!footer) {
      footer = document.createElement('div');
      footer.className = 'page-footer-number';
      footer.setAttribute('contenteditable', 'false');
      page.appendChild(footer);
    }
    footer.textContent = `Page ${index + 1} of ${pages.length}`;
  });
  if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
}

// ===== FIT EDITOR PAGES TO SCREEN =====
function fitEditorPagesToScreen() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (!pages.length) return;

  const narrowByWidth = window.innerWidth <= 850 || (document.documentElement.clientWidth || 0) <= 850;
  const isNarrow = narrowByWidth; // width-only: more reliable than pointer media queries

  if (!isNarrow) {
    pages.forEach(p => {
      p.style.zoom = '';
      p.style.transform = '';
      p.style.transformOrigin = '';
      p.style.margin = '';
      p.style.marginBottom = '30px';
      p.style.marginLeft = 'auto';
      p.style.marginRight = 'auto';
      p.style.width = EDITOR_A4_WIDTH + 'px';
      p.style.height = EDITOR_A4_HEIGHT + 'px';
      p.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.minHeight = EDITOR_A4_HEIGHT + 'px';
      p.style.maxWidth = '';
    });
    docContainer.style.setProperty('--editor-page-scale', '1');
    docContainer.style.alignItems = 'center';
    return;
  }

  docContainer.style.alignItems = 'flex-start';
  docContainer.style.overflowX = 'hidden';
  docContainer.style.width = '100%';

  const rect = docContainer.getBoundingClientRect();
  const containerWidth = Math.max(1, Math.floor(rect.width || docContainer.clientWidth || window.innerWidth || 360));
  const available = Math.max(1, containerWidth - 4);
  const scale = Math.min(1, Math.max(0.48, available / EDITOR_A4_WIDTH));

  const scaledW = EDITOR_A4_WIDTH * scale;
  const scaledH = EDITOR_A4_HEIGHT * scale;
  const offsetX = Math.max(0, Math.round((containerWidth - scaledW) / 2));
  const gap = Math.max(12, Math.round(16 * scale));

  // Layout compensation so the flow box matches the visual scaled size:
  // width 794 + marginRight (794*(scale-1)) => layout width ≈ scaledW
  const marginRightComp = Math.round(EDITOR_A4_WIDTH * (scale - 1));
  const marginBottomComp = Math.round(EDITOR_A4_HEIGHT * (scale - 1) + gap);

  pages.forEach(p => {
    p.style.zoom = '';
    p.style.boxSizing = 'border-box';
    p.style.width = EDITOR_A4_WIDTH + 'px';
    p.style.height = EDITOR_A4_HEIGHT + 'px';
    p.style.minHeight = EDITOR_A4_HEIGHT + 'px';
    p.style.maxHeight = EDITOR_A4_HEIGHT + 'px';
    p.style.maxWidth = 'none';
    p.style.transformOrigin = 'top left';
    p.style.transform = 'scale(' + scale + ')';
    p.style.marginTop = '0';
    p.style.marginLeft = offsetX + 'px';
    p.style.marginRight = marginRightComp + 'px';
    p.style.marginBottom = marginBottomComp + 'px';
  });
  docContainer.style.setProperty('--editor-page-scale', String(scale));
}

if (!window.__editorPageFitResizeBound) {
  window.__editorPageFitResizeBound = true;
  let _fitTimer = null;
  const scheduleFit = () => {
    clearTimeout(_fitTimer);
    _fitTimer = setTimeout(() => {
      try { fitEditorPagesToScreen(); } catch (_) {}
    }, 50);
  };
  window.addEventListener('resize', scheduleFit, { passive: true });
  window.addEventListener('orientationchange', () => setTimeout(scheduleFit, 160), { passive: true });
  if (window.visualViewport) {
    window.visualViewport.addEventListener('resize', scheduleFit, { passive: true });
  }
  document.addEventListener('click', (e) => {
    const t = e.target;
    if (!t || !t.closest) return;
    if (t.closest('#mob-btn-editor, #tab-editor-btn, #tab-editor-btn-desktop, #mob-btn-pdf, #tab-pdf-btn')) {
      setTimeout(scheduleFit, 80);
      setTimeout(scheduleFit, 300);
    }
  }, true);

  // ---- Robustness net -----------------------------------------------------
  // A plain 'resize' event does NOT fire when a hidden mobile panel (the
  // Editor/PDF tab) is switched to visible via display:none -> display:flex.
  // That let the A4 page get stuck at its un-scaled 794px width on first
  // view, so on narrow screens only a slice of the page was visible.
  // A ResizeObserver on the container catches every real size change,
  // including becoming visible for the first time or the sidebar collapsing.
  if (docContainer && typeof ResizeObserver === 'function') {
    let _lastObservedW = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
      if (w > 0 && w !== _lastObservedW) {
        _lastObservedW = w;
        scheduleFit();
      }
    });
    ro.observe(docContainer);
    if (docContainer.parentElement) ro.observe(docContainer.parentElement);
  }

  // Also re-fit shortly after new page content is added (covers pagination
  // / regeneration paths that don't already call updatePageFooters()).
  if (docContainer && typeof MutationObserver === 'function') {
    const mo = new MutationObserver(() => scheduleFit());
    mo.observe(docContainer, { childList: true });
  }

  // Guarantee at least one fit pass as soon as this script runs, plus a few
  // follow-up passes to catch late layout/visibility changes on first load.
  scheduleFit();
  setTimeout(scheduleFit, 300);
  setTimeout(scheduleFit, 1000);
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', scheduleFit);
  }
}

// ===== UPDATE PAGE BY NUMBER =====
function updateSpecificPageByNumber(pageNumber, newHtml) {
  const pageNum = Number.parseInt(pageNumber, 10);
  if (!Number.isInteger(pageNum) || pageNum < 1 || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const page = pages[pageNum - 1];
  if (!page) return false;

  try {
    const existingFooter = page.querySelector('.page-footer-number');
    if (existingFooter) existingFooter.remove();

    const cleanHtml = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(newHtml)) : newHtml;
    page.innerHTML = cleanHtml;
    if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);

    page.setAttribute('contenteditable', 'true');
    page.setAttribute('spellcheck', 'false');

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);

    resetPageToA4(page);
    if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
      tightenPageContentToA4(page);
    }

    updatePageFooters();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    return true;
  } catch (error) {
    console.error('updateSpecificPageByNumber failed:', error);
    return false;
  }
}

function updateSpecificPagesByNumber(updates) {
  if (!Array.isArray(updates) || !updates.length) return false;
  if (!docContainer) return false;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const prepared = [];
  const seen = new Set();
  for (const item of updates) {
    const n = parseInt(item && item.page_number, 10);
    if (!Number.isInteger(n) || n < 1 || !pages[n - 1] || typeof item.new_html !== 'string' || seen.has(n)) return false;
    seen.add(n);
    prepared.push({ n, page: pages[n - 1], html: typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(item.new_html)) : item.new_html });
  }
  try {
    prepared.forEach(({ page, html }) => {
      const footer = page.querySelector('.page-footer-number');
      if (footer) footer.remove();
      page.innerHTML = html;
      page.setAttribute('contenteditable', 'true');
      page.setAttribute('spellcheck', 'false');
      if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
      resetPageToA4(page);
      if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) tightenPageContentToA4(page);
    });
    updatePageFooters();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    return true;
  } catch (e) {
    console.error('updateSpecificPagesByNumber failed:', e);
    return false;
  }
}

// ===== UPDATE SECTION BY HEADING =====
function updateSpecificSectionByHeading(targetHeading, newHtml) {
  if (typeof targetHeading !== 'string' || !targetHeading.trim() || typeof newHtml !== 'string') {
    return false;
  }
  if (!docContainer) return false;

  const target = targetHeading.trim().replace(/\s+/g, ' ').toLowerCase();
  const headings = Array.from(docContainer.querySelectorAll('.doc-page-canvas h1, .doc-page-canvas h2, .doc-page-canvas h3'));
  let heading = headings.find(h => h.innerText.trim().replace(/\s+/g, ' ').toLowerCase() === target);
  if (!heading) {
    const candidates = headings.map(h => ({ h, text: h.innerText.trim().replace(/\s+/g, ' ').toLowerCase() }))
      .filter(x => x.text.includes(target) || target.includes(x.text));
    heading = candidates.sort((a, b) => Math.abs(a.text.length - target.length) - Math.abs(b.text.length - target.length))[0]?.h || null;
  }
  if (!heading) return false;

  try {
    const level = Number(heading.tagName.substring(1));
    const ownerPage = heading.closest('.doc-page-canvas');
    if (!ownerPage) return false;

    const nodes = [];
    let cursor = heading;
    let stop = false;
    const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
    const startPageIndex = pages.indexOf(ownerPage);
    if (startPageIndex < 0) return false;

    for (let pIdx = startPageIndex; pIdx < pages.length && !stop; pIdx++) {
      const page = pages[pIdx];
      const pageNodes = Array.from(page.childNodes);
      const startIndex = pIdx === startPageIndex ? pageNodes.indexOf(heading) : -1;
      const begin = pIdx === startPageIndex ? Math.max(0, startIndex) : 0;
      for (let i = begin + 1; i < pageNodes.length; i++) {
        const node = pageNodes[i];
        if (node.nodeType === Node.ELEMENT_NODE) {
          const m = /^H([1-3])$/.exec(node.tagName);
          if (m && Number(m[1]) <= level) {
            stop = true;
            break;
          }
        }
        if (!(node.nodeType === Node.ELEMENT_NODE && node.classList.contains('page-footer-number'))) {
          nodes.push(node);
        }
      }
    }

    nodes.forEach(node => node.parentNode && node.parentNode.removeChild(node));

    const temp = document.createElement('div');
    temp.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(newHtml)) : newHtml;
    const fragment = document.createDocumentFragment();
    Array.from(temp.childNodes).forEach(node => fragment.appendChild(node));

    heading.parentNode.insertBefore(fragment, heading.nextSibling);

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(docContainer);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(docContainer);
    if (typeof paginateDocumentCanvas === 'function') paginateDocumentCanvas();
    updatePageFooters();
    if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
    return true;
  } catch (error) {
    console.error('updateSpecificSectionByHeading failed:', error);
    return false;
  }
}

// ===== PAGE OPERATIONS =====
function getSelectedPage() {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length === 0) return null;
  if (window.APP_STATE && window.APP_STATE.selectedPage && docContainer.contains(window.APP_STATE.selectedPage)) {
    return window.APP_STATE.selectedPage;
  }
  const activeEl = document.activeElement;
  if (activeEl && activeEl.classList && activeEl.classList.contains('doc-page-canvas')) return activeEl;
  if (activeEl && activeEl.closest && activeEl.closest('.doc-page-canvas')) return activeEl.closest('.doc-page-canvas');
  const sel = window.getSelection();
  if (sel && sel.rangeCount > 0) {
    const node = sel.getRangeAt(0).startContainer;
    if (node) {
      const page = node.nodeType === 3 ? node.parentElement.closest('.doc-page-canvas') : node.closest('.doc-page-canvas');
      if (page) return page;
    }
  }
  return pages[pages.length - 1];
}

function getPageIndex(page) {
  if (!docContainer) return -1;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  return pages.indexOf(page);
}

function addPageAfterCurrent() {
  const currentPage = getSelectedPage();
  if (!currentPage) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ No page selected.");
    return;
  }
  HISTORY.saveState();
  const newPage = createNewPageAfter(currentPage);
  newPage.focus();
  const range = document.createRange();
  range.selectNodeContents(newPage);
  range.collapse(true);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);
  updatePageFooters();
  if (typeof displayToastNotification === 'function') displayToastNotification("✅ Page added after current page.");
  HISTORY.saveState();
}

function removeCurrentPage() {
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pages.length <= 1) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Cannot remove the only page.");
    return;
  }
  const currentPage = getSelectedPage();
  if (!currentPage) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ No page selected to remove.");
    return;
  }
  if (!confirm(`Remove page ${getPageIndex(currentPage) + 1}? This cannot be undone.`)) return;
  HISTORY.saveState();
  const index = getPageIndex(currentPage);
  const nextPage = pages[index + 1] || pages[index - 1];
  currentPage.remove();
  if (nextPage) {
    nextPage.focus();
    const range = document.createRange();
    range.selectNodeContents(nextPage);
    range.collapse(true);
    const sel = window.getSelection();
    sel.removeAllRanges();
    sel.addRange(range);
  }
  updatePageFooters();
  if (typeof displayToastNotification === 'function') displayToastNotification(`🗑️ Page ${index + 1} removed.`);
  HISTORY.saveState();
}

function paginateDocumentCanvas() {
  const currentHTML = getAllCanvasHTML();
  if (currentHTML && !currentHTML.includes('Start typing here')) {
    setDocumentHTMLAndPaginate(currentHTML);
    if (typeof displayToastNotification === 'function') displayToastNotification("📄 Document Paginated!");
  }
}

// ===== GET PAGE RANGE CONTEXT =====
function convertBengaliDigitsToEnglish(str) {
  const bengaliDigits = '০১২৩৪৫৬৭৮৯';
  return str.replace(/[০-৯]/g, d => String(bengaliDigits.indexOf(d)));
}

function detectRequestedPageNumber(promptText) {
  if (!promptText) return null;
  const normalized = convertBengaliDigitsToEnglish(promptText);
  const patterns = [
    /\bpage\s*(?:number|no\.?|#)?\s*(\d+)\b/i,
    /(\d+)\s*(?:নম্বর|নং)?\s*(?:পেজ|পৃষ্ঠা|পাতা)/,
    /(?:পেজ|পৃষ্ঠা|পাতা)\s*(?:নম্বর|নং)?\s*(\d+)/
  ];
  for (const re of patterns) {
    const m = normalized.match(re);
    if (m && m[1]) {
      const n = parseInt(m[1], 10);
      if (n > 0) return n;
    }
  }
  return null;
}

function getPageRangeContext(pageNumber) {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const totalPages = pages.length;
  if (totalPages === 0 || pageNumber < 1 || pageNumber > totalPages) return null;
  const startIdx = Math.max(1, pageNumber - 1);
  const endIdx = Math.min(totalPages, pageNumber + 1);
  let contextString = '';
  for (let i = startIdx; i <= endIdx; i++) {
    const clone = pages[i - 1].cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    const cleanHTML = typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(clone.innerHTML) : clone.innerHTML;
    contextString += `\n[PAGE ${i}${i === pageNumber ? ' — TARGET, EDIT THIS ONE' : ' — context only, do not rewrite'}]\n${cleanHTML}\n[/PAGE ${i}]\n`;
  }
  return { contextString, startIdx, endIdx, totalPages, targetPage: pageNumber };
}

function getMultiPageEditContext(pageNumbers) {
  if (!docContainer) return null;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  const totalPages = pages.length;
  const nums = [...new Set((pageNumbers || []).map(n => parseInt(n, 10)).filter(n => n >= 1 && n <= totalPages))].sort((a, b) => a - b);
  if (!nums.length) return null;
  const selected = new Set(nums);
  let contextString = '';
  nums.forEach(n => {
    const clone = pages[n - 1].cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    const cleanHTML = typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(clone.innerHTML) : clone.innerHTML;
    contextString += `\n[PAGE ${n} — TARGET, EDIT ONLY THIS PAGE]\n${cleanHTML}\n[/PAGE ${n}]\n`;
    for (const neighbor of [n - 1, n + 1]) {
      if (neighbor >= 1 && neighbor <= totalPages && !selected.has(neighbor)) {
        const nc = pages[neighbor - 1].cloneNode(true);
        nc.querySelectorAll('.page-footer-number').forEach(f => f.remove());
        contextString += `\n[PAGE ${neighbor} — CONTEXT ONLY, DO NOT MODIFY]\n${typeof convertKatexSpansToLatexSource === 'function' ? convertKatexSpansToLatexSource(nc.innerHTML) : nc.innerHTML}\n[/PAGE ${neighbor}]\n`;
      }
    }
  });
  return { contextString, totalPages, targetPages: nums };
}

// ===== EXAM FINALIZATION =====
function buildExamHeaderBlockHTML(subjectGuess) {
  const title = (subjectGuess || 'Examination').trim();
  return `<div class="exam-header-block" contenteditable="true">` +
    `<div class="exam-header-title">${escapeHTMLForHeader(title)}</div>` +
    `<div class="exam-header-subtitle">Full Marks: <span class="blank" style="display:inline-block;min-width:60px;border-bottom:1px solid #64748b;">&nbsp;</span>` +
    `&nbsp;&nbsp;&nbsp;Time: <span class="blank" style="display:inline-block;min-width:80px;border-bottom:1px solid #64748b;">&nbsp;</span></div>` +
    `<hr class="exam-header-rule">` +
    `<div class="exam-header-row">` +
    `<div class="exam-header-field"><span class="label">Name:</span><span class="blank">&nbsp;</span></div>` +
    `<div class="exam-header-field"><span class="label">Roll:</span><span class="blank">&nbsp;</span></div>` +
    `<div class="exam-header-field"><span class="label">Section:</span><span class="blank">&nbsp;</span></div>` +
    `</div>` +
    `<div class="exam-header-row">` +
    `<div class="exam-header-field"><span class="label">Class/Subject:</span><span class="blank">&nbsp;</span></div>` +
    `<div class="exam-header-field"><span class="label">Date:</span><span class="blank">&nbsp;</span></div>` +
    `</div>` +
    `</div>`;
}

function escapeHTMLForHeader(s) {
  const d = document.createElement('div');
  d.textContent = String(s || '');
  return d.innerHTML;
}

function countMCQItemsInHTML(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  let count = temp.querySelectorAll('.quiz-container .quiz-item').length;
  if (!count) {
    count = temp.querySelectorAll('.quiz-container').length ? Math.max(0, temp.querySelectorAll('.quiz-question').length) : 0;
  }
  return count;
}

function buildOMRSheetHTML(mcqCount, isBangla = false) {
  const count = Math.max(1, Math.min(200, mcqCount || 0));
  const labels = isBangla ? ['ক', 'খ', 'গ', 'ঘ'] : ['A', 'B', 'C', 'D'];
  const rows = [];
  for (let q = 1; q <= count; q++) {
    rows.push(
      `<div class="omr-row"><span class="omr-qnum">${q}.</span>` +
      labels.map(x => `<span class="omr-bubble">${x}</span>`).join('') +
      `</div>`
    );
  }
  return `<div class="omr-sheet-page">` +
    `<div class="omr-sheet-title">Answer / OMR</div>` +
    `<div class="omr-sheet-header">` +
    `<div class="exam-header-field"><span class="label">Name:</span><span class="blank">&nbsp;</span></div>` +
    `<div class="exam-header-field"><span class="label">Roll:</span><span class="blank">&nbsp;</span></div>` +
    `<div class="exam-header-field"><span class="label">Section:</span><span class="blank">&nbsp;</span></div>` +
    `</div>` +
    `<div class="omr-grid">${rows.join('')}</div>` +
    `</div>`;
}

function guessExamTitleFromHTML(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  const heading = temp.querySelector('h1, h2');
  const text = heading ? heading.textContent.trim() : '';
  return text ? `${text} — Examination` : 'Examination';
}

function tempTextForExamLanguage(html) {
  const temp = document.createElement('div');
  temp.innerHTML = html || '';
  return temp.textContent || '';
}

function normalizeGeneratedMCQs(rawHtml) {
  if (!rawHtml || !/quiz-container/i.test(rawHtml)) return rawHtml;
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;
  temp.querySelectorAll('.quiz-container').forEach(container => {
    const items = Array.from(container.children).filter(el => el.classList && el.classList.contains('quiz-item'));
    items.forEach((item) => {
      const q = item.querySelector(':scope > .quiz-question');
      const wrap = item.querySelector(':scope > .quiz-options');
      if (!q || !wrap) return;
      const qText = q.textContent || '';
      if (/[\u0980-\u09FF]/.test(qText)) item.classList.add('bangla-question');
      else item.classList.remove('bangla-question');
      const opts = Array.from(wrap.children).filter(el => el.classList && el.classList.contains('quiz-option'));
      opts.slice(4).forEach(el => el.remove());
    });
    let key = container.querySelector(':scope > .quiz-answer-key');
    if (!key && items.length) {
      key = document.createElement('div');
      key.className = 'quiz-answer-key';
      key.innerHTML = '<div class="quiz-answer-title">Answer Key</div><div class="quiz-answer-grid"></div>';
      container.appendChild(key);
    }
  });
  return temp.innerHTML;
}

function finalizeExamDocumentIfNeeded() {
  try {
    document.body.classList.add('exam-document');
    const currentHTML = getAllCanvasHTML();
    if (!currentHTML || currentHTML.includes('Start typing here')) return;

    const hasHeader = docContainer.querySelector('.exam-header-block');
    const hasOMR = docContainer.querySelector('.omr-sheet-page');
    const mcqCount = countMCQItemsInHTML(currentHTML);

    let html = normalizeGeneratedMCQs(currentHTML);
    let changed = html !== currentHTML;

    if (!hasHeader) {
      html = buildExamHeaderBlockHTML(guessExamTitleFromHTML(currentHTML)) + html;
      changed = true;
    }
    if (!hasOMR && mcqCount > 0) {
      const hasBangla = /[\u0980-\u09FF]/.test(tempTextForExamLanguage(html));
      html = html + buildOMRSheetHTML(mcqCount, hasBangla);
      changed = true;
    }

    if (changed) {
      setDocumentHTMLAndPaginate(html, false);
      docContainer.scrollTop = 0;
    }
  } catch (e) {
    console.warn('Exam finalization skipped:', e);
  }
}

// ===== GET EXISTING HEADINGS =====
function getExistingHeadings(options = {}) {
  const { unique = true } = options;
  if (!docContainer) return [];
  const headings = [];
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(page => {
    page.querySelectorAll('h1, h2, h3').forEach(h => {
      const t = h.innerText.trim();
      if (t) headings.push(t);
    });
  });
  if (!unique) return headings;
  const seen = new Set();
  return headings.filter(h => {
    const key = h.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function checkForDuplicateHeadings() {
  const headings = getExistingHeadings({ unique: false });
  const seen = new Map();
  headings.forEach(h => {
    const key = h.toLowerCase();
    seen.set(key, (seen.get(key) || 0) + 1);
  });
  const duplicates = [];
  for (const [key, count] of seen.entries()) {
    if (count > 1) {
      const original = headings.find(h => h.toLowerCase() === key);
      duplicates.push(original);
    }
  }
  if (duplicates.length > 0) {
    const msg = `⚠️ Possible duplicate section(s) detected: "${duplicates.slice(0, 3).join('", "')}"${duplicates.length > 3 ? ' and more' : ''} — please review.`;
    if (typeof displayToastNotification === 'function') displayToastNotification(msg);
  }
}

// ===== DOCUMENT PROFESSIONALIZATION =====
function professionalizeDocumentHTML(rawHtml) {
  if (!rawHtml) return '';
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;
  if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(temp);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(temp);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(temp);
  return temp.innerHTML;
}

// ===== EXECUTE EDITOR COMMAND =====
function executeEditorCommand(command, value = null) {
  document.execCommand(command, false, value);
  updateToolbarButtonStates();
  debouncedAutoSaveAndPaginate();
}

function updateToolbarButtonStates() {
  ['bold', 'italic', 'underline', 'justifyLeft', 'justifyCenter', 'justifyRight', 'justifyFull'].forEach(cmd => {
    const btn = document.getElementById('btn-' + cmd);
    if (btn) btn.classList.toggle('active', document.queryCommandState(cmd));
  });
}
if (docContainer) {
  docContainer.addEventListener('keyup', updateToolbarButtonStates);
  docContainer.addEventListener('mouseup', updateToolbarButtonStates);
}

// ===== DIAGRAM CANDIDATES =====
function getDiagramCandidates(pageContext = null) {
  if (!docContainer) return [];
  let roots = [];
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  if (pageContext && Number.isFinite(pageContext.targetPage)) {
    const page = pages[pageContext.targetPage - 1];
    if (page) roots = Array.from(page.querySelectorAll('.fc-wrapper, .figure-pro'));
  }
  if (!roots.length) roots = Array.from(docContainer.querySelectorAll('.fc-wrapper, .figure-pro'));
  return roots.map((el, index) => {
    const title = el.querySelector('.fc-title, .figure-title, .figure-caption')?.textContent?.trim() || `Diagram ${index + 1}`;
    const ownerPage = el.closest('.doc-page-canvas');
    const pageNumber = ownerPage ? pages.indexOf(ownerPage) + 1 : null;
    let heading = '';
    let n = el.previousElementSibling;
    while (n) {
      if (/^H[1-3]$/.test(n.tagName)) { heading = n.textContent.trim(); break; }
      n = n.previousElementSibling;
    }
    return { index, title, pageNumber, heading, html: el.outerHTML, element: el };
  });
}

function extractDiagramWrapperFromAIHTML(rawHtml) {
  if (!rawHtml || typeof rawHtml !== 'string') return '';
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml.trim();
  const wrapper = temp.querySelector('.fc-wrapper, .figure-pro');
  if (wrapper) return wrapper.outerHTML;
  const svg = temp.querySelector('svg');
  if (svg) {
    const wrap = document.createElement('div');
    wrap.className = 'fc-wrapper';
    wrap.innerHTML = '<div class="fc-svg-wrapper"></div>';
    wrap.querySelector('.fc-svg-wrapper').appendChild(svg);
    return wrap.outerHTML;
  }
  return '';
}

function replaceExistingDiagramBlock(targetElement, newHtml) {
  const wrapperHTML = extractDiagramWrapperFromAIHTML(newHtml);
  if (!targetElement || !wrapperHTML || !targetElement.parentNode) return false;
  const temp = document.createElement('div');
  temp.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(sanitizeHTML(wrapperHTML)) : wrapperHTML;
  const replacement = temp.querySelector('.fc-wrapper, .figure-pro');
  if (!replacement) return false;
  targetElement.parentNode.replaceChild(replacement, targetElement);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(docContainer);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(docContainer);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(docContainer);
  paginateDocumentCanvas();
  updatePageFooters();
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(180);
  return true;
}

function rankDiagramCandidatesForPrompt(candidates, promptText, pageContext = null) {
  const p = String(promptText || '').toLowerCase();
  const tokens = p.split(/[^\p{L}\p{N}]+/u).filter(t => t.length >= 3);
  return candidates.map((d, i) => {
    let score = 0;
    if (pageContext && d.pageNumber === pageContext.targetPage) score += 1000;
    const hay = `${d.title} ${d.heading}`.toLowerCase();
    tokens.forEach(t => { if (hay.includes(t)) score += 20; });
    if (/diagram|figure|flowchart|concept map|mind map|schematic|chart|চিত্র|ডায়াগ্রাম|ডায়াগ্রাম|ফিগার|ফ্লোচার্ট/i.test(p)) score += 5;
    score -= i * 0.01;
    return { ...d, _score: score };
  }).sort((a, b) => b._score - a._score);
}

function validateDiagramReplacementAgainstOriginal(originalHtml, replacementHtml, promptText) {
  const tempOld = document.createElement('div');
  const tempNew = document.createElement('div');
  tempOld.innerHTML = originalHtml || '';
  tempNew.innerHTML = replacementHtml || '';
  const oldSvg = tempOld.querySelector('svg');
  const newSvg = tempNew.querySelector('svg');
  if (!newSvg) return { ok: false, reason: 'replacement has no SVG' };
  const oldLabels = Array.from(tempOld.querySelectorAll('svg text, .fc-node-text, .fc-node-note')).map(x => x.textContent.trim()).filter(Boolean);
  const newText = (newSvg.textContent || '').replace(/\s+/g, ' ').trim().toLowerCase();
  const explicitChange = /(?:rename|change label|replace label|remove node|delete node|change value|নাম বদল|লেবেল বদল|মুছে|বাদ)/i.test(promptText || '');
  if (!explicitChange && oldLabels.length >= 3) {
    const preserved = oldLabels.filter(t => newText.includes(t.replace(/\s+/g, ' ').toLowerCase())).length;
    const ratio = preserved / oldLabels.length;
    if (ratio < 0.65) return { ok: false, reason: `only ${Math.round(ratio * 100)}% of original labels preserved` };
  }
  return { ok: true };
}

function isDiagramEditRequest(promptText, intentPayload) {
  const p = String(promptText || '');
  if (intentPayload && intentPayload.intent === 'redesign_diagram') return true;
  return /(?:diagram|figure|flowchart|flow chart|concept map|mind map|schematic|visual|ডায়াগ্রাম|ডায়াগ্রাম|ফিগার|ফ্লোচার্ট|ফ্লো চার্ট|কনসেপ্ট ম্যাপ|মাইন্ড ম্যাপ|চিত্র|চার্ট|গ্রাফ)/i.test(p) &&
    !!(intentPayload && ['edit', 'refine'].includes(intentPayload.intent));
}

// ===== BEAUTIFY =====
// Single-pass only (no batch splitting). High output budget + auto-continue.
function textContentLengthFromHTML(html) {
  const t = document.createElement('div');
  t.innerHTML = html || '';
  return (t.innerText || t.textContent || '').replace(/\s+/g, ' ').trim().length;
}

function beautifyOutputLooksSafe(sourceHtml, outputHtml) {
  if (!outputHtml || !String(outputHtml).trim()) return false;
  const srcText = textContentLengthFromHTML(sourceHtml);
  const outText = textContentLengthFromHTML(outputHtml);
  if (srcText < 120) return outText > 0;
  return outText >= Math.floor(srcText * 0.82);
}

function extractBeautifyHtmlFromAIResponse(rawContent) {
  if (!rawContent) return '';
  const parsed = typeof safeParseAIJson === 'function' ? safeParseAIJson(rawContent, null) : null;
  if (parsed && typeof parsed.html_content === 'string' && parsed.html_content.trim()) {
    return parsed.html_content.trim();
  }
  const m = String(rawContent).match(/"html_content"\s*:\s*"((?:\\.|[^"\\])*)"/);
  if (m && m[1]) {
    try {
      return JSON.parse('"' + m[1] + '"');
    } catch (_) {
      return m[1]
        .replace(/\\n/g, '\n')
        .replace(/\\r/g, '')
        .replace(/\\t/g, '\t')
        .replace(/\\"/g, '"')
        .replace(/\\\\/g, '\\');
    }
  }
  const trimmed = String(rawContent).trim();
  if (/<(?:h[1-6]|p|div|table|ul|ol|section)\b/i.test(trimmed)) {
    return trimmed.replace(/^```(?:html)?\s*/i, '').replace(/\s*```$/i, '').trim();
  }
  return '';
}

/** Local (no-AI) structural polish so Beautify always does something useful. */
function localBeautifyHTML(rawHtml) {
  if (!rawHtml) return '';
  const temp = document.createElement('div');
  temp.innerHTML = rawHtml;

  if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(temp);
  if (typeof cleanupEmptyVisualContainers === 'function') cleanupEmptyVisualContainers(temp);

  temp.querySelectorAll('p, div, li, h1, h2, h3, h4').forEach(el => {
    if (!(el.innerText || '').trim() && !el.querySelector('img,svg,table,canvas,br,.katex-eq')) {
      if (!el.classList.contains('manual-page-break')) el.remove();
    }
  });

  temp.querySelectorAll('p > h1, p > h2, p > h3, p > h4').forEach(h => {
    const parent = h.parentElement;
    if (parent) parent.parentNode.insertBefore(h, parent);
  });

  temp.querySelectorAll('table').forEach(table => {
    table.style.width = table.style.width || '100%';
    table.style.borderCollapse = 'collapse';
    table.querySelectorAll('th, td').forEach(cell => {
      if (!cell.style.border) cell.style.border = '1px solid #cbd5e1';
      if (!cell.style.padding) cell.style.padding = '6px 8px';
    });
  });

  temp.querySelectorAll('ul, ol').forEach(list => {
    if (!list.style.margin) list.style.margin = '8px 0 12px 1.2em';
  });

  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(temp);
  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(temp);

  return temp.innerHTML;
}

function getBeautifySourceHTML() {
  if (!docContainer) return '';
  const parts = [];
  Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    if (typeof stripEmojiFromNode === 'function') stripEmojiFromNode(clone);
    let html = clone.innerHTML || '';
    if (typeof convertKatexSpansToLatexSource === 'function') {
      html = convertKatexSpansToLatexSource(html);
    }
    const textLen = (clone.innerText || '').replace(/\s+/g, ' ').trim().length;
    if (textLen >= 2 || clone.querySelector('img,svg,table,canvas')) {
      parts.push(html);
    }
  });
  return parts.join('\n');
}

function getBeautifyMaxTokens() {
  // Prefer the largest practical single-shot budget — no artificial beautify cap
  if (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.PDF_TOKEN_BUDGETS) {
    const b = APP_CONFIG.PDF_TOKEN_BUDGETS;
    return b.LONG_DIRECT || b.DEFAULT_SINGLE || b.BEAUTIFY || 64000;
  }
  return 64000;
}

function detectOutputLanguage(promptText) {
  const text = (promptText || '').toString();
  if (/\b(in\s+english|everything\s+(should\s+be\s+)?in\s+english|english\s+only|reply\s+in\s+english|write\s+in\s+english)\b/i.test(text)) return 'en';
  if (/(বাংলায়|বাংলা\s*ভাষায়)/i.test(text)) return 'bn';
  const bengaliChars = (text.match(/[\u0980-\u09FF]/g) || []).length;
  const latinChars = (text.match(/[a-zA-Z]/g) || []).length;
  return bengaliChars > latinChars ? 'bn' : 'en';
}

async function beautifyDocument(options = {}) {
  const currentFullHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
  if (!currentFullHTML || currentFullHTML.includes('Start typing here')) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ Document is empty.');
    return;
  }
  if (window.APP_STATE && window.APP_STATE.isAIGenerating && !options.allowDuringAIGeneration) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⏳ Please wait for the current AI task to finish first.');
    return;
  }

  let hasAIModel = false;
  try {
    if (typeof getActiveAIModel === 'function') hasAIModel = !!getActiveAIModel();
  } catch (_) {}

  const requestSessionId = window.APP_STATE?.activeSessionId;
  if (window.APP_STATE) window.APP_STATE.isAIGenerating = true;
  const sendBtn = document.getElementById('send-message-btn');
  if (sendBtn) sendBtn.disabled = true;
  const isMonochromeMode = document.body.classList.contains('photocopy-mode');
  const sourceForAI = typeof getCanvasContentWithLatexSource === 'function' ? getCanvasContentWithLatexSource() : currentFullHTML;
  const outputLanguage = detectOutputLanguage(sourceForAI || currentFullHTML);
  const modelsUsed = new Set();

  const applyResult = (html, toastMsg, chatMsg) => {
    if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
    if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(html, false);
    if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
    if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(200);
    if (typeof ProgressUI !== 'undefined' && ProgressUI.finish) ProgressUI.finish();
    setTimeout(() => { if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide(); }, 150);
    if (toastMsg && typeof displayToastNotification === 'function') displayToastNotification(toastMsg);
    if (chatMsg && typeof appendChatMessageToUI === 'function') appendChatMessageToUI('ai', chatMsg);
  };

  // LOCAL-ONLY PATH (no model)
  if (!hasAIModel) {
    try {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
        ProgressUI.show('Beautifying…', 'Local formatting (no AI model configured)…');
        ProgressUI.startAutoEstimate(3);
      }
      applyResult(
        localBeautifyHTML(currentFullHTML) || currentFullHTML,
        '✅ Local beautify applied. Add an AI model for richer formatting.',
        '✅ Document polished locally (no AI model configured).'
      );
    } catch (localErr) {
      if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Error Beautify failed: ' + (localErr && localErr.message ? localErr.message : 'unknown'));
      }
    } finally {
      if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
      if (sendBtn) sendBtn.disabled = false;
    }
    return;
  }

  const source = getBeautifySourceHTML() || sourceForAI || currentFullHTML;
  const maxTokens = getBeautifyMaxTokens();

  if (typeof ProgressUI !== 'undefined' && ProgressUI.show) {
    ProgressUI.show('Beautifying…', 'Single-pass full-document formatting…');
    ProgressUI.startAutoEstimate(18);
  }

  try {
    if (requestSessionId !== window.APP_STATE?.activeSessionId) throw new Error('Beautify session changed.');
    if (typeof callAIAPI !== 'function') throw new Error('AI API unavailable');

    const systemPrompt =
      `You are a Document Beautification AI. MODE: ${isMonochromeMode ? 'MONOCHROME' : 'COLORFUL'}.\n` +
      `Return ONLY valid JSON: {"html_content":"<full beautified HTML>"}. No markdown fences, no commentary.\n` +
      `Preserve ALL supplied content exactly in substance and order: every fact, number, formula, example, heading, list item, table value and diagram markup. NEVER summarize, shorten, omit or invent content.\n` +
      `Only improve presentation: typography hierarchy, spacing, headings, callouts, table formatting and math markup ($...$ / $$...$$).\n` +
      `Keep existing class names for diagrams (.fc-wrapper, .figure-pro) and quiz blocks when present.\n` +
      `Output language of text content must stay unchanged (${outputLanguage || 'same as source'}).\n` +
      `Return the COMPLETE document in one response — do not split into sections or batches.\n` +
      `${typeof buildSharedRules === 'function' ? buildSharedRules(isMonochromeMode, outputLanguage) : ''}`;

    let result = await callAIAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `Beautify the full document below. Preserve every element. Return complete html_content in one shot.\n\n${source}` }
    ], { forceJson: true, modelsUsedSet: modelsUsed, maxTokens });

    if (requestSessionId !== window.APP_STATE?.activeSessionId) throw new Error('Beautify session changed.');
    if (!result) throw new Error('Empty AI response');

    let html = extractBeautifyHtmlFromAIResponse(result.content);

    // Auto-continue if the model hit the output limit mid-document
    if (result.finishReason === 'length' && html && typeof generateHtmlContentWithAutoContinue === 'function') {
      try {
        if (typeof ProgressUI !== 'undefined' && ProgressUI.setLabel) {
          ProgressUI.setLabel('Beautifying… continuing long output…');
        }
        html = await generateHtmlContentWithAutoContinue(
          'Continue beautifying the remaining HTML. Output only the continuation of html_content (valid HTML fragment). Do not repeat already returned content. Keep all facts and structure.',
          html,
          result.finishReason,
          modelsUsed,
          (typeof APP_CONFIG !== 'undefined' && APP_CONFIG.CONTINUATION_MAX_LOOPS) || 8,
          result.modelConfig || null
        );
      } catch (contErr) {
        console.warn('Beautify continuation failed:', contErr);
      }
    }

    let usedLocal = false;
    let safeHtml = html;
    if (!beautifyOutputLooksSafe(source, html)) {
      console.warn('Beautify: AI output failed safety check; applying local polish.');
      safeHtml = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      usedLocal = true;
    }

    const modelNames = Array.from(modelsUsed).filter(Boolean);
    if (usedLocal) {
      applyResult(
        safeHtml,
        '✅ Beautify applied (local polish — AI output was incomplete).',
        `✅ Document polished locally after AI safety check.${modelNames.length ? ' Models tried: ' + modelNames.join(', ') : ''}`
      );
    } else {
      applyResult(
        safeHtml,
        '✅ Beautify completed successfully!',
        `✅ Document beautified${modelNames.length ? ' using ' + modelNames.join(', ') : ''}.`
      );
    }
  } catch (error) {
    if (typeof ProgressUI !== 'undefined' && ProgressUI.hide) ProgressUI.hide();
    try {
      const polished = localBeautifyHTML(currentFullHTML) || currentFullHTML;
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(polished, false);
      if (typeof scheduleEquationRecovery === 'function') scheduleEquationRecovery(200);
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Beautify AI failed — applied local formatting instead.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('error', `⚠️ Beautify AI failed: ${error.message}. Local polish applied.`);
      }
    } catch (e2) {
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('Error Beautify failed: ' + error.message + ' — original content kept.');
      }
      if (typeof appendChatMessageToUI === 'function') {
        appendChatMessageToUI('error', `⚠️ Beautify failed: ${error.message}`);
      }
      if (typeof HISTORY !== 'undefined' && HISTORY.saveState) HISTORY.saveState();
      if (typeof setDocumentHTMLAndPaginate === 'function') setDocumentHTMLAndPaginate(currentFullHTML, false);
    }
  } finally {
    if (window.APP_STATE) window.APP_STATE.isAIGenerating = false;
    if (sendBtn) sendBtn.disabled = false;
  }
}

// ===== DIAGRAM EDIT / REFINE =====
async function handleDiagramEditOrRefine(promptText, intentPayload, pageContext, modelsUsedSet) {
  const rawCandidates = getDiagramCandidates(pageContext);
  const candidates = rankDiagramCandidatesForPrompt(rawCandidates, promptText, pageContext);
  if (!candidates.length) return { handled: false };

  const candidateList = candidates.slice(0, 6).map((d, i) =>
    `DIAGRAM ${i + 1}${i === 0 ? ' ← BEST MATCH' : ''}\nTitle: ${d.title}\nPage: ${d.pageNumber || 'unknown'}\nSection: ${d.heading || 'unknown'}\nHTML:\n${d.html}`
  ).join('\n\n---\n\n');

  const systemPrompt =
    `You are a specialist modern academic diagram editor. Modify ONLY the existing diagram most relevant to the user's request.\n` +
    `Do not rewrite surrounding prose. Preserve factual meaning, labels, values, relationships and equations unless the user explicitly asks to change them.\n` +
    `Choose the most semantically appropriate visual structure instead of blindly keeping a box-arrow layout. If the user's request is only about styling, preserve the diagram's information architecture while modernizing its visual language.\n` +
    `Use responsive inline SVG with a clean editorial/academic design: clear whitespace, rounded cards where appropriate, restrained shadows, consistent typography, strong hierarchy, clean connector routing, print-safe labels, and A4-safe proportions.\n` +
    `Return ONLY valid JSON: {"target_index":1,"html_content":"<complete diagram wrapper HTML>","chat_summary":"..."}.\n` +
    `target_index is 1-based. Prefer DIAGRAM 1 unless another candidate is clearly a better semantic match. html_content MUST contain one COMPLETE .fc-wrapper or .figure-pro block with the COMPLETE SVG/visual markup, including all required nodes, connectors, labels, definitions and captions. Never return only a partial SVG or placeholder. Preserve all existing labels/values/relationships unless the user explicitly requests a content change.\n` +
    `Use the application's diagram classes where appropriate: .fc-wrapper, .fc-title, .fc-svg-wrapper, .fc-svg, .fc-node-rect, .fc-node-text, .fc-line.`;

  try {
    const result = await typeof callAIAPI === 'function' ? callAIAPI([
      { role: 'system', content: systemPrompt },
      { role: 'user', content: `USER REQUEST:\n${promptText}\n\nAVAILABLE DIAGRAMS:\n${candidateList}` }
    ], { forceJson: true, modelsUsedSet: modelsUsedSet }) : null;

    if (!result) return { handled: false };
    const parsed = typeof safeParseAIJson === 'function' ? safeParseAIJson(result.content, null) : null;
    const idx = parsed ? Number(parsed.target_index) - 1 : -1;
    const target = Number.isInteger(idx) ? candidates[idx] : null;
    const wrapperHTML = parsed && typeof parsed.html_content === 'string' ? extractDiagramWrapperFromAIHTML(parsed.html_content) : '';
    if (!target || !wrapperHTML) return { handled: false };
    const validation = validateDiagramReplacementAgainstOriginal(target.html, wrapperHTML, promptText);
    if (!validation.ok) {
      console.warn('[Diagram Edit] replacement rejected:', validation.reason);
      return { handled: false };
    }
    HISTORY.saveState();
    if (!replaceExistingDiagramBlock(target.element, wrapperHTML)) return { handled: false };
    return { handled: true, summary: parsed.chat_summary || 'Diagram updated successfully.' };
  } catch (e) {
    console.warn('[Diagram Edit] specialized flow failed:', e);
    return { handled: false };
  }
}

// ===== LOCAL POST-PROCESS =====
async function repairEquationsInNewContent(modelsUsedSet) {
  try {
    if (!docContainer) return;
    const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
    let touched = 0;
    for (let i = 0; i < pages.length; i++) {
      const page = pages[i];
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(page);
      if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(page);
      if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(page);
      if (page.scrollHeight > EDITOR_A4_HEIGHT + 1) {
        tightenPageContentToA4(page);
        touched++;
      }
      if (i % 6 === 5) await new Promise(r => setTimeout(r, 0));
    }
    if (touched) updatePageFooters();
  } catch (e) {
    console.warn('Local post-process skipped:', e);
  }
}

// ===== RUN DOCUMENT INTEGRITY PASS =====
function runDocumentOutputIntegrityPass(root = docContainer) {
  if (!root) return { repaired: 0, brokenEquations: [] };
  let repaired = 0;
  if (typeof normalizeAIHTMLTextArtifacts === 'function') normalizeAIHTMLTextArtifacts(root);
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let node;
  while ((node = walker.nextNode())) nodes.push(node);
  nodes.forEach(n => {
    if (n.parentElement && n.parentElement.closest('.katex, .katex-eq')) return;
    const fixed = typeof repairVisibleEscapeSequencesInText === 'function' ? repairVisibleEscapeSequencesInText(n.nodeValue) : n.nodeValue;
    if (fixed !== n.nodeValue) { n.nodeValue = fixed;
      repaired++; }
  });
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(root);
  if (typeof forceRenderAllKatexVisuals === 'function') forceRenderAllKatexVisuals(root);
  if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(root);
  return { repaired, brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(root) : [] };
}

// ===== STRIP EMOJI =====
function stripEmojiFromNode(root) {
  if (!root) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const parent = node.parentElement;
    if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName)) return;
    node.nodeValue = node.nodeValue.replace(EMOJI_RE, '');
  });
}

// ===== CLEANUP EMPTY VISUAL CONTAINERS =====
function cleanupEmptyVisualContainers(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  root.querySelectorAll('.figure-pro').forEach(fig => {
    const frame = fig.querySelector('.figure-frame');
    const hasVisual = !!(frame && frame.querySelector('svg,canvas,img'));
    if (!hasVisual) fig.remove();
  });
  root.querySelectorAll('.fc-wrapper').forEach(wrapper => {
    const svg = wrapper.querySelector('svg.fc-svg, svg');
    const hasDrawable = !!(svg && svg.querySelector('rect, circle, ellipse, line, path, polyline, polygon, text, image, foreignObject'));
    if (!svg || !hasDrawable) wrapper.remove();
  });
  root.querySelectorAll('.figure-frame').forEach(frame => {
    if (!frame.querySelector('svg,canvas,img')) frame.remove();
  });
  root.querySelectorAll('.fc-svg-wrapper').forEach(frame => {
    if (!frame.querySelector('svg,canvas,img')) frame.remove();
  });
}

// ===== ENFORCE DIAGRAM VISUAL STYLES =====
function enforceDiagramVisualStyles(root = docContainer) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const monochrome = document.body.classList.contains('photocopy-mode');
  const palette = {
    base: monochrome ? '#fff' : '#f8fafc',
    primary: monochrome ? '#fff' : '#eef2ff',
    secondary: monochrome ? '#fff' : '#f8fafc',
    accent: monochrome ? '#fff' : '#ecfeff',
    yellow: monochrome ? '#fff' : '#fffbeb',
    text: '#0f172a',
    note: '#64748b',
    stroke: monochrome ? '#000' : '#94a3b8',
    primaryStroke: monochrome ? '#000' : '#6366f1',
    secondaryStroke: monochrome ? '#000' : '#cbd5e1',
    accentStroke: monochrome ? '#000' : '#06b6d4',
    yellowStroke: monochrome ? '#000' : '#f59e0b'
  };

  root.querySelectorAll('.fc-node-rect').forEach(el => {
    let fill = palette.base;
    let stroke = palette.stroke;
    if (el.classList.contains('primary')) { fill = palette.primary;
      stroke = palette.primaryStroke; } else if (el.classList.contains('secondary')) { fill = palette.secondary;
      stroke = palette.secondaryStroke; } else if (el.classList.contains('accent')) { fill = palette.accent;
      stroke = palette.accentStroke; } else if (el.classList.contains('yellow')) { fill = palette.yellow;
      stroke = palette.yellowStroke; }
    el.style.setProperty('fill', fill, 'important');
    el.style.setProperty('stroke', stroke, 'important');
    el.style.setProperty('stroke-width', el.classList.contains('primary') ? '2.2' : '1.8', 'important');
  });

  root.querySelectorAll('.fc-node-text').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#000' : '#0f172a', 'important');
    el.style.setProperty('color', monochrome ? '#000' : '#0f172a', 'important');
  });

  root.querySelectorAll('.fc-node-note').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#000' : '#64748b', 'important');
    el.style.setProperty('color', monochrome ? '#000' : '#64748b', 'important');
  });

  root.querySelectorAll('.fc-line').forEach(el => {
    const stroke = el.classList.contains('primary') ? (monochrome ? '#000' : '#4f46e5') : (monochrome ? '#000' : '#64748b');
    el.style.setProperty('stroke', stroke, 'important');
    el.style.setProperty('fill', 'none', 'important');
  });

  root.querySelectorAll('.fc-label-pill').forEach(el => {
    el.style.setProperty('fill', monochrome ? '#fff' : '#f1f5f9', 'important');
    el.style.setProperty('stroke', monochrome ? '#000' : '#e2e8f0', 'important');
  });
}

// ===== APPLY MONOCHROME DOCUMENT STYLES =====
function applyMonochromeDocumentStyles() {
  if (!docContainer) return;
  const monochrome = document.body.classList.contains('photocopy-mode');
  docContainer.classList.toggle('monochrome-document', monochrome);

  const pages = docContainer.querySelectorAll('.doc-page-canvas');
  pages.forEach(page => {
    page.style.color = monochrome ? '#000' : '';
    page.querySelectorAll('h1,h2,h3,h4,h5,h6,p,li,blockquote,dt,dd,th,td,caption,figcaption,.quiz-question,.quiz-option,.quiz-answer-title,.quiz-explanation,.sol-label,.sol-given,.math-step-label,.math-final-answer').forEach(el => {
      el.style.color = monochrome ? '#000' : '';
      if (!monochrome) el.style.removeProperty('border-color');
    });

    page.querySelectorAll('table, th, td, .block-solution, .math-final-answer, .sol-label, .quiz-option, .quiz-answer-key, .figure-pro, .figure-frame').forEach(el => {
      if (monochrome) {
        el.style.setProperty('border-color', '#000', 'important');
        el.style.setProperty('box-shadow', 'none', 'important');
      } else {
        el.style.removeProperty('border-color');
        el.style.removeProperty('box-shadow');
      }
    });

    page.querySelectorAll('img').forEach(img => {
      img.style.filter = monochrome ? 'grayscale(1) contrast(1.05)' : '';
    });
  });

  if (typeof enforceDiagramVisualStyles === 'function') enforceDiagramVisualStyles(docContainer);
}

// ===== PDF VISUAL FORMAT (background/color theme applied to exported/canvas pages) =====
const PDF_VISUAL_FORMAT_IDS = ['default', 'aurora', 'editorial', 'midnight', 'blueprint', 'sage'];
const PDF_TEXT_FORMAT_IDS = ['default', 'academic', 'modern', 'compact'];

function getActivePDFVisualFormat() {
  return (window.APP_STATE && window.APP_STATE.pdfVisualFormat) ||
    (function() { try { return localStorage.getItem(PDF_VISUAL_FORMAT_KEY) || 'default'; } catch (e) { return 'default'; } })();
}

function getActivePDFTextFormat() {
  return (window.APP_STATE && window.APP_STATE.pdfTextFormat) ||
    (function() { try { return localStorage.getItem(PDF_TEXT_FORMAT_KEY) || 'default'; } catch (e) { return 'default'; } })();
}

function applyPDFVisualFormat(formatId) {
  const id = PDF_VISUAL_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (!docContainer) return;
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    PDF_VISUAL_FORMAT_IDS.forEach(f => page.classList.remove('pdf-format-' + f));
    if (id !== 'default') page.classList.add('pdf-format-' + id);
  });
  if (window.APP_STATE) window.APP_STATE.pdfVisualFormat = id;
  try { localStorage.setItem(PDF_VISUAL_FORMAT_KEY, id); } catch (e) {}
}

function applyPDFTextFormat(formatId) {
  const id = PDF_TEXT_FORMAT_IDS.includes(formatId) ? formatId : 'default';
  if (!docContainer) return;
  docContainer.querySelectorAll('.doc-page-canvas').forEach(page => {
    PDF_TEXT_FORMAT_IDS.forEach(f => page.classList.remove('text-format-' + f));
    if (id !== 'default') page.classList.add('text-format-' + id);
  });
  if (window.APP_STATE) window.APP_STATE.pdfTextFormat = id;
  try { localStorage.setItem(PDF_TEXT_FORMAT_KEY, id); } catch (e) {}
}

function choosePDFVisualFormat(formatId) {
  applyPDFVisualFormat(formatId);
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Visual format applied');
}

function choosePDFTextFormat(formatId) {
  applyPDFTextFormat(formatId);
  if (typeof TAB_MANAGER !== 'undefined' && TAB_MANAGER._persist) TAB_MANAGER._persist();
  if (typeof closeAtCommandMenu === 'function') closeAtCommandMenu();
  if (typeof displayToastNotification === 'function') displayToastNotification('✅ Text format applied');
}

// ============================================================
// WINDOW EXPOSURE – Document Editor
// ============================================================
// Note: switchPreviewTab is defined in pdf-export.js (loaded after this file) —
// its own top-level `function` declaration attaches it to window automatically,
// so it must not be re-exported here (that would throw before pdf-export.js loads).
window.executeEditorCommand = executeEditorCommand;
window.paginateDocumentCanvas = paginateDocumentCanvas;
window.beautifyDocument = beautifyDocument;
window.addPageAfterCurrent = addPageAfterCurrent;
window.removeCurrentPage = removeCurrentPage;
window.handleCanvasInput = handleCanvasInput;
window.handlePageKeydown = handlePageKeydown;
window.setDocumentHTMLAndPaginate = setDocumentHTMLAndPaginate;
window.getAllCanvasHTML = getAllCanvasHTML;
window.getCanvasContentWithLatexSource = getCanvasContentWithLatexSource;
window.updateSpecificPageByNumber = updateSpecificPageByNumber;
window.updateSpecificPagesByNumber = updateSpecificPagesByNumber;
window.updateSpecificSectionByHeading = updateSpecificSectionByHeading;
window.checkForDuplicateHeadings = checkForDuplicateHeadings;
window.fitEditorPagesToScreen = fitEditorPagesToScreen;
window.runDocumentOutputIntegrityPass = runDocumentOutputIntegrityPass;
window.isDiagramEditRequest = isDiagramEditRequest;
window.handleDiagramEditOrRefine = handleDiagramEditOrRefine;
window.finalizeExamDocumentIfNeeded = finalizeExamDocumentIfNeeded;
window.scheduleReflow = scheduleReflow;
window.applyPDFVisualFormat = applyPDFVisualFormat;
window.applyPDFTextFormat = applyPDFTextFormat;
window.getActivePDFVisualFormat = getActivePDFVisualFormat;
window.getActivePDFTextFormat = getActivePDFTextFormat;
window.choosePDFVisualFormat = choosePDFVisualFormat;
window.choosePDFTextFormat = choosePDFTextFormat;
window.applyMonochromeDocumentStyles = applyMonochromeDocumentStyles;
window.repairEquationsInNewContent = repairEquationsInNewContent;
window.getExistingHeadings = getExistingHeadings;
window.getPageRangeContext = getPageRangeContext;
window.getMultiPageEditContext = getMultiPageEditContext;
window.detectRequestedPageNumber = detectRequestedPageNumber;
