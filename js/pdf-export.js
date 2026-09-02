// ========================================================================
// PDF EXPORT - True PDF (native print), Image PDF (rasterized), Word export,
// and live PDF iframe preview with enhanced UX and scroll fix
// ========================================================================

// ===== PDF LIBRARY LOADER =====
const PDF_LIBRARY_URLS = Object.freeze({
  html2canvas: 'https://cdnjs.cloudflare.com/ajax/libs/html2canvas/1.4.1/html2canvas.min.js',
  jspdf: 'https://cdnjs.cloudflare.com/ajax/libs/jspdf/2.5.1/jspdf.umd.min.js'
});
let _pdfLibrariesPromise = null;

function _loadScriptOnce(src, test) {
  return new Promise((resolve, reject) => {
    if (test()) return resolve(true);
    const existing = document.querySelector(`script[data-pdf-lib-src="${src}"]`);
    if (existing) {
      existing.addEventListener('load', () => test() ? resolve(true) : reject(new Error('PDF library loaded but global is unavailable.')), { once: true });
      existing.addEventListener('error', () => reject(new Error('Unable to load PDF library.')), { once: true });
      return;
    }
    const script = document.createElement('script');
    script.src = src;
    script.async = true;
    script.dataset.pdfLibSrc = src;
    script.onload = () => test() ? resolve(true) : reject(new Error('PDF library loaded but global is unavailable.'));
    script.onerror = () => reject(new Error('Unable to load PDF library.'));
    document.head.appendChild(script);
  });
}

async function ensurePDFRenderLibraries() {
  if (_pdfLibrariesPromise) return _pdfLibrariesPromise;
  _pdfLibrariesPromise = (async () => {
    const results = await Promise.allSettled([
      _loadScriptOnce(PDF_LIBRARY_URLS.html2canvas, () => typeof window.html2canvas === 'function'),
      _loadScriptOnce(PDF_LIBRARY_URLS.jspdf, () => !!(window.jspdf && typeof window.jspdf.jsPDF === 'function'))
    ]);
    const htmlOK = results[0].status === 'fulfilled' && typeof window.html2canvas === 'function';
    const jsPDFOK = results[1].status === 'fulfilled' && !!(window.jspdf && typeof window.jspdf.jsPDF === 'function');
    return { htmlOK, jsPDFOK };
  })().catch(err => {
    _pdfLibrariesPromise = null;
    throw err;
  });
  return _pdfLibrariesPromise;
}

function _assertPDFRenderLibraries(libs, requireRaster = true) {
  if (!libs || !libs.jsPDFOK) throw new Error('PDF engine is unavailable. Please keep the page online briefly and try again.');
  if (requireRaster && !libs.htmlOK) throw new Error('Image PDF renderer is unavailable. Please keep the page online briefly and try again.');
}

function _getPDFRenderScale() {
  return typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() ? 1.15 : 1.55;
}

function _yieldToBrowser() {
  return new Promise(resolve => {
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => setTimeout(resolve, 0));
    } else {
      setTimeout(resolve, 0);
    }
  });
}

function _pdfCanUseNativePrint() {
  try {
    return !!window.print;
  } catch (_) {
    return false;
  }
}

// ===== EXPORT BUTTON STATE =====
function _setExportButtonBusy(btn, busy, label) {
  if (!btn) return;
  if (busy) {
    if (!btn.dataset.exportOriginalHtml) btn.dataset.exportOriginalHtml = btn.innerHTML;
    btn.disabled = true;
    btn.classList.add('btn-exporting');
    btn.innerHTML = `<span class="btn-spinner" aria-hidden="true"></span><span class="btn-export-label">${label || 'Working'}</span>`;
  } else {
    btn.disabled = false;
    btn.classList.remove('btn-exporting');
    if (btn.dataset.exportOriginalHtml) {
      btn.innerHTML = btn.dataset.exportOriginalHtml;
      delete btn.dataset.exportOriginalHtml;
    }
  }
}

function _updateExportButtonProgress(btn, text) {
  if (!btn || !btn.classList.contains('btn-exporting')) return;
  const label = btn.querySelector('.btn-export-label');
  if (label) label.textContent = text;
}

// ===== PRE-EXPORT QUALITY PASS =====
async function runPreExportLocalQualityPass() {
  try {
    if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
    const currentHTML = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
    const cleaned = typeof professionalizeDocumentHTML === 'function' ? professionalizeDocumentHTML(currentHTML) : currentHTML;
    if (cleaned && cleaned !== currentHTML && typeof setDocumentHTMLAndPaginate === 'function') {
      setDocumentHTMLAndPaginate(cleaned, false);
    }
    const container = document.getElementById('document-view-container');
    if (container) {
      container.querySelectorAll('.figure-pro, .fc-wrapper').forEach(el => {
        const hasVisual = !!el.querySelector('svg, canvas, img, table');
        const text = (el.innerText || '').trim();
        if (!hasVisual && !text) el.remove();
      });
    }
    if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
    return true;
  } catch (e) {
    console.warn('Local pre-export quality pass failed; continuing with current document:', e);
    return false;
  }
}

// ===== COLLECT RENDERABLE EDITOR PAGES =====
function _collectRenderableEditorPages() {
  const container = document.getElementById('document-view-container');
  if (!container) return [];
  return Array.from(container.querySelectorAll('.doc-page-canvas')).filter(page => {
    const text = (page.innerText || '').replace(/\s+/g, ' ').trim();
    const hasVisual = !!page.querySelector('img,svg,canvas,table,figure,.figure-pro,.fc-wrapper');
    return text || hasVisual;
  });
}

// ===== GET DOCUMENT TOPIC NAME =====
function getDocumentTopicName() {
  const container = document.getElementById('document-view-container');
  if (!container) return 'Document';
  const heading = container.querySelector('h1, h2, h3');
  if (heading && heading.innerText.trim() && !heading.innerText.includes('Start typing here')) {
    return heading.innerText.trim().replace(/[^a-zA-Z0-9\u0980-\u09FF\s_-]/g, '').trim().replace(/\s+/g, '_');
  }
  return 'Document';
}

// ===== WORD EXPORT =====
function exportToWordDocument() {
  const rawContent = typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '';
  if (!rawContent || rawContent.includes('Start typing here')) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Document is empty.");
    return;
  }

  const temp = document.createElement('div');
  temp.innerHTML = rawContent;
  temp.querySelectorAll('.page-footer-number').forEach(f => f.remove());
  temp.querySelectorAll('.katex-eq').forEach(eq => {
    const mathText = document.createElement('span');
    mathText.style.cssText = 'font-family:Cambria Math,serif;font-style:italic;background-color:#f1f5f9;padding:2pt 4pt;border:1pt solid #cbd5e1;';
    mathText.textContent = ` [ Math: ${eq.getAttribute('data-latex') || eq.innerText} ] `;
    eq.parentNode.replaceChild(mathText, eq);
  });
  temp.querySelectorAll('.fc-wrapper').forEach(fc => {
    const title = fc.querySelector('.fc-title')?.innerText || 'Diagram / Chart';
    const svgNodes = Array.from(fc.querySelectorAll('.fc-node-text, .chart-label, .chart-val-label, .chart-legend-text'))
      .map(n => n.textContent.trim()).filter(Boolean);
    const table = document.createElement('table');
    table.style.cssText = 'width:100%; border-collapse:collapse; margin:10pt 0;';
    let tableHTML = `<tr><th colspan="${Math.max(svgNodes.length, 1)}" style="text-align:left; background-color:#fff; color:#000; padding:8pt 0; font-size:16pt; border:none;">${title}</th></tr>`;
    if (svgNodes.length > 0) {
      tableHTML += `<tr>`;
      svgNodes.forEach(sn => tableHTML += `<td style="text-align:center; border:1pt solid #cbd5e1; padding:6pt; color:#000; font-family:Arial;">${sn}</td>`);
      tableHTML += `</tr>`;
    }
    table.innerHTML = tableHTML;
    fc.parentNode.replaceChild(table, fc);
  });
  Array.from(temp.querySelectorAll('*')).forEach(el => {
    el.removeAttribute('contenteditable');
    el.removeAttribute('spellcheck');
  });

  const documentHtml = `<html xmlns:w='urn:schemas-microsoft-com:office:word'><head><meta charset='utf-8'><title>${getDocumentTopicName()}</title></head><body>${temp.innerHTML}</body></html>`;
  const blob = new Blob(['\ufeff', documentHtml], { type: 'application/msword;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = getDocumentTopicName() + '.doc';
  link.click();
  URL.revokeObjectURL(link.href);
  if (typeof displayToastNotification === 'function') displayToastNotification("✅ Word Document Saved");
}

// ===== TRUE PDF (NATIVE PRINT) =====
async function exportToHighQualityPDF(btn) {
  const pages = _collectRenderableEditorPages();
  if (!pages.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    if (typeof displayToastNotification === 'function') displayToastNotification("⚠️ Document is empty.");
    return;
  }

  _setExportButtonBusy(btn, true, 'PDF');

  if (!_pdfCanUseNativePrint()) {
    _setExportButtonBusy(btn, false);
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ True PDF requires the browser Print / Save as PDF engine.');
    return;
  }

  await runPreExportLocalQualityPass();

  const pdfView = document.getElementById('pdf-view-container');
  const iframe = document.getElementById('pdf-iframe');
  if (!iframe || !pdfView) {
    _setExportButtonBusy(btn, false);
    if (typeof displayToastNotification === 'function') displayToastNotification('Error PDF preview frame is unavailable.');
    return;
  }

  const restorePdfViewStyle = pdfView.getAttribute('style');
  pdfView.style.cssText = (restorePdfViewStyle || '') +
    ';display:flex !important;position:fixed !important;left:-10000px !important;top:0 !important;' +
    `width:${window.innerWidth}px !important;height:${window.innerHeight}px !important;` +
    'visibility:visible !important;pointer-events:none !important;';

  let viewRestored = false;
  const restoreView = () => {
    if (viewRestored) return;
    viewRestored = true;
    if (restorePdfViewStyle === null) pdfView.removeAttribute('style');
    else pdfView.setAttribute('style', restorePdfViewStyle);
    _pdfLastRenderedSignature = '';
    _pdfLastRenderedMode = '';
    const resyncAndFit = () => {
      if (typeof window.__resyncMobileViewportHeight === 'function') window.__resyncMobileViewportHeight();
      try { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); } catch (_) {}
      try {
        if (pdfView.style.display !== 'none' && getComputedStyle(pdfView).display !== 'none') {
          if (typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
        }
      } catch (_) {}
    };
    resyncAndFit();
    setTimeout(resyncAndFit, 250);
    setTimeout(resyncAndFit, 700);
    _setExportButtonBusy(btn, false);
  };
  window.addEventListener('afterprint', restoreView, { once: true });
  window.addEventListener('focus', restoreView, { once: true });
  document.addEventListener('visibilitychange', function onVis() {
    if (!document.hidden) { document.removeEventListener('visibilitychange', onVis);
      restoreView(); }
  });
  setTimeout(restoreView, 6000);

  let printReady = false;
  try {
    const signature = typeof hashPDFPreviewSignature === 'function' ? hashPDFPreviewSignature() : '';
    if (typeof prepareDocumentForPDFPreview === 'function') prepareDocumentForPDFPreview(signature);
    // NOTE: True PDF now reuses the SAME already-paginated editor pages that the
    // on-screen Editor/Preview tabs show (_collectRenderableEditorPages), instead of
    // recomputing page breaks from scratch via computeTruePDFPageChunks(). Running two
    // independent pagination algorithms (the live editor's vs. computeTruePDFPages'
    // own appendNodeWithPagination/pageFits pass) could disagree by a few pixels near a
    // page boundary, which is what produced the blank page followed by an extra page at
    // the end. Reusing the editor's own page boundaries removes that entire class of bug.
    let pageChunks = typeof _collectRenderableEditorPages === 'function' ?
      _collectRenderableEditorPages().map(page => page.innerHTML) : [];
    if (!pageChunks.length && typeof computeTruePDFPageChunks === 'function') {
      pageChunks = await computeTruePDFPageChunks({ signature, allowCache: true });
    }
    const printHTML = typeof buildUnifiedPDFPreviewDocument === 'function' ?
      buildUnifiedPDFPreviewDocument(pageChunks, document.body.classList.contains('photocopy-mode')) :
      '';
    iframe.onload = null;
    iframe.removeAttribute('src');
    iframe.srcdoc = printHTML;
    printReady = true;
  } catch (printBuildError) {
    console.warn('True PDF print document build failed:', printBuildError);
    restoreView();
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('Error True PDF preparation failed: ' + (printBuildError?.message || 'Unknown error') + '. Image PDF remains available separately.');
    }
    _setExportButtonBusy(btn, false);
    return;
  }

  let printed = false;
  let timeoutId = null;
  let messageHandler = null;
  let loadHandler = null;

  const cleanup = () => {
    if (timeoutId) clearTimeout(timeoutId);
    if (messageHandler) window.removeEventListener('message', messageHandler);
    if (loadHandler) iframe.removeEventListener('load', loadHandler);
  };

  const runPrint = () => {
    if (printed || !printReady) return;
    printed = true;
    cleanup();
    try {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
    } catch (error) {
      restoreView();
      if (typeof displayToastNotification === 'function') {
        displayToastNotification("Error True PDF print failed: " + (error?.message || 'Unknown error') + '. Image PDF remains available separately.');
      }
    }
  };

  messageHandler = (e) => {
    if (e.source === iframe.contentWindow && e.data === 'pdf-iframe-ready') runPrint();
  };
  // These are both fallbacks in case the 'pdf-iframe-ready' postMessage never arrives.
  // They're intentionally longer than before: the iframe now waits for its <img> tags to
  // finish loading before sending that message (see waitForImagesThenReady in
  // buildUnifiedPDFPreviewDocument), and firing print earlier than that reintroduces the
  // exact "page grows after pagination was decided -> overflow page" bug this patch fixes.
  loadHandler = () => setTimeout(() => { if (!printed) runPrint(); }, 600);

  window.addEventListener('message', messageHandler);
  iframe.addEventListener('load', loadHandler, { once: true });
  timeoutId = setTimeout(() => runPrint(), 3500);
}

// ===== IMAGE PDF (RASTERIZED) =====
async function exportToImagePDF(btn) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  if (typeof ensureAllPagesMathRendered === 'function') ensureAllPagesMathRendered();
  const editorPagesBefore = _collectRenderableEditorPages();
  if (!editorPagesBefore.length || (typeof docContainer !== 'undefined' && docContainer && docContainer.innerText && docContainer.innerText.includes('Start typing here'))) {
    if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ Document is empty.');
    return;
  }

  const analyticsStart = Date.now();
  const modelsUsed = new Set();
  let renderPages = null;
  let renderHost = null;

  const staleHost = document.getElementById('image-pdf-render-host');
  if (staleHost && staleHost.parentNode) staleHost.parentNode.removeChild(staleHost);

  _setExportButtonBusy(btn, true, 'PDF');

  try {
    const libs = await ensurePDFRenderLibraries();
    _assertPDFRenderLibraries(libs, true);
    await runPreExportLocalQualityPass();

    renderPages = typeof _buildImagePDFRenderPages === 'function' ? await _buildImagePDFRenderPages() : { pages: [] };
    const pageList = renderPages.pages || [];
    if (!pageList.length) throw new Error('No renderable pages were produced.');

    renderHost = document.createElement('div');
    renderHost.id = 'image-pdf-render-host';
    renderHost.style.cssText = [
      'position:fixed',
      'left:-10000px',
      'top:0',
      `width:${PDF_LAYOUT.width}px`,
      `height:${PDF_LAYOUT.height}px`,
      'overflow:hidden',
      'visibility:visible',
      'opacity:1',
      'pointer-events:none',
      'z-index:9998',
      'background:#fff'
    ].join(';');
    document.body.appendChild(renderHost);

    const pdf = new window.jspdf.jsPDF({
      unit: 'mm',
      format: 'a4',
      orientation: 'portrait',
      compress: true
    });

    let exportedPages = 0;
    for (let i = 0; i < pageList.length; i++) {
      if (isCancellationRequested) {
        if (typeof displayToastNotification === 'function') displayToastNotification(`Stopped at page ${i} – partial PDF saved.`);
        break;
      }

      _updateExportButtonProgress(btn, `${i + 1}/${pageList.length}`);
      const sourcePage = pageList[i].el;
      if (!sourcePage) throw new Error(`Page ${i + 1} has no renderable DOM.`);

      const canvas = await _renderImagePDFPage(sourcePage, renderHost, i + 1, _getPDFRenderScale());
      if (i > 0) pdf.addPage('a4', 'portrait');
      const imageData = canvas.toDataURL('image/jpeg', typeof isMobileDeviceLayout === 'function' && isMobileDeviceLayout() ? 0.84 : 0.90);
      pdf.addImage(imageData, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      exportedPages++;

      canvas.width = 0;
      canvas.height = 0;
      renderHost.innerHTML = '';

      if (i < pageList.length - 1 && i % 2 === 1) await _yieldToBrowser();
    }

    if (!exportedPages) throw new Error('No pages were exported.');
    pdf.save(getDocumentTopicName() + '.pdf');
    if (typeof displayToastNotification === 'function') {
      displayToastNotification(`✅ Saved Image PDF — raster pages, no text layer — ${exportedPages} page${exportedPages === 1 ? '' : 's'}.`);
    }

    if (document.getElementById('analytics-toggle')?.checked) {
      try {
        const analytics = typeof computeDocumentAnalytics === 'function' ? await computeDocumentAnalytics(analyticsStart, modelsUsed) : null;
        if (analytics && typeof appendChatMessageToUI === 'function') {
          appendChatMessageToUI('ai', typeof formatAnalyticsChatMessage === 'function' ? formatAnalyticsChatMessage(analytics) : '');
        }
      } catch (analyticsErr) {
        console.warn('Analytics failed:', analyticsErr);
      }
    }
  } catch (error) {
    console.error('Image PDF export failed:', error);
    if (typeof displayToastNotification === 'function') {
      displayToastNotification('Error Image PDF Error: ' + error.message);
    }
  } finally {
    if (renderHost && renderHost.parentNode) renderHost.parentNode.removeChild(renderHost);
    if (renderPages && typeof renderPages.dispose === 'function') renderPages.dispose();
    _setExportButtonBusy(btn, false);
  }
}

// ===== CANVAS VISIBILITY CHECK =====
function _canvasHasVisibleInk(canvas) {
  try {
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx || !canvas.width || !canvas.height) return false;
    const sampleW = Math.min(canvas.width, 160);
    const sampleH = Math.min(canvas.height, 220);
    const data = ctx.getImageData(0, 0, sampleW, sampleH).data;
    let nonWhite = 0;
    let strong = 0;
    for (let i = 0; i < data.length; i += 4) {
      const a = data[i + 3];
      if (a < 8) continue;
      const r = data[i],
        g = data[i + 1],
        b = data[i + 2];
      const lum = (r * 0.299) + (g * 0.587) + (b * 0.114);
      if (lum < 248) nonWhite++;
      if (lum < 220) strong++;
    }
    const pixels = Math.max(1, (data.length / 4));
    return (nonWhite / pixels) > 0.0015 || (strong / pixels) > 0.0005;
  } catch (_) {
    return true;
  }
}

// ===== RENDER IMAGE PDF PAGE =====
async function _renderImagePDFPage(sourcePage, host, pageNumber, requestedScale) {
  const libs = await ensurePDFRenderLibraries();
  _assertPDFRenderLibraries(libs, true);
  const prepare = (el) => {
    el.style.setProperty('visibility', 'visible', 'important');
    el.style.setProperty('display', 'block', 'important');
    el.style.setProperty('opacity', '1', 'important');
    el.style.setProperty('filter', 'none', 'important');
    el.style.setProperty('transform', 'none', 'important');
    el.style.setProperty('contain', 'none', 'important');
    el.style.setProperty('content-visibility', 'visible', 'important');
    el.style.setProperty('width', PDF_LAYOUT.width + 'px', 'important');
    el.style.setProperty('height', PDF_LAYOUT.height + 'px', 'important');
    el.style.setProperty('max-height', PDF_LAYOUT.height + 'px', 'important');
    el.style.setProperty('padding', `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`, 'important');
    el.style.setProperty('box-sizing', 'border-box', 'important');
    el.style.setProperty('overflow', 'hidden', 'important');
    el.style.setProperty('margin', '0', 'important');
    el.style.setProperty('position', 'relative', 'important');
    el.style.setProperty('background', '#fff', 'important');
  };

  const capture = async (el, scale) => {
    prepare(el);
    host.innerHTML = '';
    host.appendChild(el);
    if (typeof waitForPDFLayoutStable === 'function') await waitForPDFLayoutStable(el);
    if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(el);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(el);
    if (typeof nextFrame === 'function') await nextFrame();
    if (typeof nextFrame === 'function') await nextFrame();
    const canvas = await window.html2canvas(el, {
      scale,
      useCORS: true,
      allowTaint: false,
      backgroundColor: '#fff',
      width: PDF_LAYOUT.width,
      height: PDF_LAYOUT.height,
      windowWidth: PDF_LAYOUT.width,
      windowHeight: PDF_LAYOUT.height,
      scrollX: 0,
      scrollY: 0,
      logging: false,
      removeContainer: true,
      onclone: (clonedDoc) => {
        const clonedEl = clonedDoc.querySelector('.doc-page-canvas');
        if (clonedEl) {
          clonedEl.style.visibility = 'visible';
          clonedEl.style.opacity = '1';
          clonedEl.style.display = 'block';
          clonedEl.style.filter = 'none';
          clonedEl.style.transform = 'none';
          clonedEl.style.contain = 'none';
        }
      }
    });
    return canvas;
  };

  const cloneForCapture = () => {
    const clone = sourcePage.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    clone.className = 'doc-page-canvas pdf-export-measure-page';
    const srcCanvases = Array.from(sourcePage.querySelectorAll('canvas'));
    const dstCanvases = Array.from(clone.querySelectorAll('canvas'));
    srcCanvases.forEach((src, idx) => {
      const dst = dstCanvases[idx];
      if (!dst) return;
      try {
        dst.width = src.width;
        dst.height = src.height;
        const ctx = dst.getContext('2d');
        if (ctx) ctx.drawImage(src, 0, 0);
      } catch (_) {}
    });
    return clone;
  };

  const targetScale = Number.isFinite(requestedScale) ? requestedScale : _getPDFRenderScale();
  let working = cloneForCapture();
  let canvas = await capture(working, targetScale);

  if (!_canvasHasVisibleInk(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
    working = cloneForCapture();
    working.style.setProperty('overflow', 'visible', 'important');
    canvas = await capture(working, Math.max(1.15, targetScale * 0.82));
  }

  if (!_canvasHasVisibleInk(canvas)) {
    canvas.width = 0;
    canvas.height = 0;
    throw new Error(`Image PDF page ${pageNumber} rendered blank. Export was stopped to prevent a blank PDF.`);
  }
  return canvas;
}

// ===== BUILD IMAGE PDF RENDER PAGES =====
async function _buildImagePDFRenderPages() {
  const result = typeof computeTruePDFPages === 'function' ? await computeTruePDFPages() : { pages: [], offscreen: null };
  if (typeof applyLocalMarginSafetyFixes === 'function') applyLocalMarginSafetyFixes(result);

  const computedPages = result.pages ? result.pages.filter(p => p.html && p.html.trim()) : [];
  const editorPages = _collectRenderableEditorPages();

  if (editorPages.length > 1 && computedPages.length < editorPages.length) {
    const fallbackPages = editorPages.map(el => ({
      el: el.cloneNode(true),
      html: el.innerHTML,
      overflow: false,
      brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
      brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
    }));
    if (typeof disposeTruePDFPages === 'function') disposeTruePDFPages(result);
    return { pages: fallbackPages };
  }

  return {
    pages: computedPages.map(p => ({
      el: p.el,
      html: p.html,
      overflow: p.overflow,
      brokenEquations: p.brokenEquations,
      brokenDiagrams: p.brokenDiagrams
    })),
    dispose: () => { if (typeof disposeTruePDFPages === 'function') disposeTruePDFPages(result); }
  };
}

// ===== LIVE PDF IFRAME PREVIEW (Enhanced UX + Scroll Fix) =====
let _pdfPreviewGenerationToken = 0;
let _pdfPreviewDebounceTimer = null;
let _pdfPreviewRunning = false;
let _pdfPreviewPending = false;
let _pdfLayoutCache = { signature: '', chunks: null };
let _pdfMathPreparedSignature = '';
let _pdfDocumentRevision = 0;
let _pdfLastRenderedSignature = '';
let _pdfLastRenderedMode = '';
let _pdfPreviewRetryCount = 0;
const MAX_PREVIEW_RETRIES = 3;

function invalidatePDFPreviewCache() {
  _pdfDocumentRevision++;
  _pdfLayoutCache.signature = '';
  _pdfLayoutCache.chunks = null;
  _pdfMathPreparedSignature = '';
  _pdfLastRenderedSignature = '';
  _pdfLastRenderedMode = '';
  _pdfPreviewRetryCount = 0;
}

function hashPDFPreviewSignature() {
  let hash = 2166136261;
  const container = document.getElementById('document-view-container');
  const pages = container ? container.querySelectorAll('.doc-page-canvas') : [];
  for (let i = 0; i < pages.length; i++) {
    const html = pages[i].innerHTML || '';
    hash ^= html.length;
    hash = Math.imul(hash, 16777619);
    for (let j = 0; j < html.length; j += 193) {
      hash ^= html.charCodeAt(j);
      hash = Math.imul(hash, 16777619);
    }
  }
  return `${_pdfDocumentRevision}:${pages.length}:${(hash >>> 0).toString(16)}`;
}

function prepareDocumentForPDFPreview(signature) {
  if (_pdfMathPreparedSignature === signature && typeof findBrokenEquations === 'function' && !findBrokenEquations(document.getElementById('document-view-container')).length) return;
  const container = document.getElementById('document-view-container');
  if (!container) return;
  if (typeof normalizeAIHTMLTextArtifacts === 'function') normalizeAIHTMLTextArtifacts(container);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(container);
  if (typeof forceRenderAllEquations === 'function') forceRenderAllEquations();
  if (typeof prepareEquationsForPDF === 'function') prepareEquationsForPDF(container);
  _pdfMathPreparedSignature = signature;
}

function generateLivePDFIframePreview() {
  if (_pdfPreviewDebounceTimer) clearTimeout(_pdfPreviewDebounceTimer);
  const delay = typeof isMobilePreviewMode === 'function' && isMobilePreviewMode() ? 60 : 40;
  const scheduledToken = ++_pdfPreviewGenerationToken;
  _pdfPreviewPending = true;
  _pdfPreviewDebounceTimer = setTimeout(() => {
    _pdfPreviewDebounceTimer = null;
    _pdfPreviewPending = false;
    _runLivePDFIframePreview(scheduledToken);
  }, delay);
}

function _buildSimplePDFPageChunksFallback() {
  try {
    return _collectRenderableEditorPages().map(page => page.innerHTML).filter(html => html && html.trim());
  } catch (_) {
    return [];
  }
}

let _pdfPreviewObjectURL = null;

function _revokePDFPreviewObjectURL() {
  if (_pdfPreviewObjectURL) {
    try { URL.revokeObjectURL(_pdfPreviewObjectURL); } catch (_) {}
    _pdfPreviewObjectURL = null;
  }
}

function _setPDFPreviewFrameHTML(iframe, html) {
  try {
    _revokePDFPreviewObjectURL();
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    _pdfPreviewObjectURL = URL.createObjectURL(blob);
    iframe.src = _pdfPreviewObjectURL;
    return true;
  } catch (err) {
    console.warn('Blob PDF preview failed; falling back to srcdoc.', err);
    try {
      iframe.srcdoc = html;
      return true;
    } catch (_) {
      return false;
    }
  }
}

async function _runLivePDFIframePreview(requestedToken) {
  const myToken = requestedToken || ++_pdfPreviewGenerationToken;
  if (myToken !== _pdfPreviewGenerationToken) return;
  const iframe = document.getElementById('pdf-iframe');
  const loadingEl = document.getElementById('pdf-preview-loading');
  const loadingStatusEl = document.getElementById('pdf-preview-loading-status');
  const pdfViewContainer = document.getElementById('pdf-view-container');
  if (pdfViewContainer) {
    pdfViewContainer.style.overflowY = 'auto';
    pdfViewContainer.style.overflowX = 'hidden';
    pdfViewContainer.style.webkitOverflowScrolling = 'touch';
    pdfViewContainer.style.height = '100%';
    pdfViewContainer.style.flex = '1 1 auto';
  }
  if (!iframe) return;

  if (_pdfPreviewRunning) {
    _pdfPreviewPending = true;
    return;
  }

  const earlySignature = hashPDFPreviewSignature();
  const earlyIsMonochromeMode = document.body.classList.contains('photocopy-mode');
  const earlyPreviewMode = earlyIsMonochromeMode ? 'mono' : 'color';
  if (_pdfLastRenderedSignature === earlySignature && _pdfLastRenderedMode === earlyPreviewMode && (iframe.src || iframe.srcdoc)) {
    if (loadingEl) {
      loadingEl.classList.remove('active');
      loadingEl.style.display = 'none';
      loadingEl.setAttribute('aria-busy', 'false');
    }
    iframe.classList.remove('pdf-loading');
    iframe.style.opacity = '1';
    return;
  }

  _pdfPreviewRunning = true;
  
  if (loadingEl) {
    loadingEl.classList.add('active');
    loadingEl.setAttribute('aria-busy', 'true');
    loadingEl.style.display = 'flex';
  }
  if (loadingStatusEl) {
    loadingStatusEl.textContent = '📄 Preparing PDF preview...';
  }
  iframe.classList.add('pdf-loading');
  iframe.style.opacity = '0.3';
  iframe.style.height = '100%';
  iframe.style.width = '100%';
  iframe.style.border = 'none';
  iframe.style.display = 'block';

  try {
    const signature = hashPDFPreviewSignature();
    const isMonochromeMode = document.body.classList.contains('photocopy-mode');
    const previewMode = isMonochromeMode ? 'mono' : 'color';

    prepareDocumentForPDFPreview(signature);

    let pageChunks = _collectRenderableEditorPages().map(page => page.innerHTML);
    if (!pageChunks.length) {
      pageChunks = _buildSimplePDFPageChunksFallback();
    }
    if (!pageChunks.length) throw new Error('No renderable document pages available.');
    if (myToken !== _pdfPreviewGenerationToken) return;

    if (loadingStatusEl) {
      loadingStatusEl.textContent = `📄 Rendering ${pageChunks.length} page${pageChunks.length === 1 ? '' : 's'}...`;
    }

    let loadResolve, loadReject;
    const loadPromise = new Promise((resolve, reject) => {
      loadResolve = resolve;
      loadReject = reject;
    });

    const onLoad = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      loadResolve();
    };

    const onError = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      loadReject(new Error('Iframe failed to load'));
    };

    iframe.onload = onLoad;
    iframe.onerror = onError;

    const previewHTML = typeof buildUnifiedPDFPreviewDocument === 'function' ?
      buildUnifiedPDFPreviewDocument(pageChunks, isMonochromeMode) :
      _buildFallbackPreviewHTML(pageChunks, isMonochromeMode);

    if (!_setPDFPreviewFrameHTML(iframe, previewHTML)) {
      throw new Error('Unable to initialize PDF preview frame.');
    }

    await Promise.race([
      loadPromise,
      new Promise((_, reject) => setTimeout(() => reject(new Error('Preview load timeout')), 12000))
    ]);

    _pdfLastRenderedSignature = signature;
    _pdfLastRenderedMode = previewMode;
    _pdfPreviewRetryCount = 0;

    if (loadingStatusEl) loadingStatusEl.textContent = '✅ PDF preview ready';
    if (loadingEl) {
      loadingEl.classList.remove('active');
      loadingEl.style.display = 'none';
      loadingEl.setAttribute('aria-busy', 'false');
    }
    iframe.classList.remove('pdf-loading');
    iframe.style.opacity = '1';

  } catch (error) {
    console.error('PDF preview generation failed:', error);
    if (myToken === _pdfPreviewGenerationToken) {
      _pdfPreviewRetryCount++;
      if (_pdfPreviewRetryCount <= MAX_PREVIEW_RETRIES) {
        if (loadingStatusEl) {
          loadingStatusEl.textContent = `🔄 Retrying preview (${_pdfPreviewRetryCount}/${MAX_PREVIEW_RETRIES})...`;
        }
        setTimeout(() => {
          if (_pdfPreviewGenerationToken === myToken) {
            _pdfPreviewRunning = false;
            _runLivePDFIframePreview(myToken);
          }
        }, 1500 * _pdfPreviewRetryCount);
        return;
      }
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.style.display = 'none';
        loadingEl.setAttribute('aria-busy', 'false');
      }
      if (loadingStatusEl) {
        loadingStatusEl.textContent = '⚠️ Preview failed to render. Please try refreshing.';
      }
      iframe.classList.remove('pdf-loading');
      iframe.style.opacity = '1';
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('⚠️ PDF preview failed: ' + (error && error.message ? error.message : 'unknown error'));
      }
    }
  } finally {
    _pdfPreviewRunning = false;
    if (_pdfPreviewPending) {
      _pdfPreviewPending = false;
      _runLivePDFIframePreview(_pdfPreviewGenerationToken);
    }
  }
}

// ===== FALLBACK PREVIEW HTML =====
function _buildFallbackPreviewHTML(pageChunks, isMonochromeMode) {
  const pageClasses = _getActivePDFFormatClasses(isMonochromeMode);
  const pageClassAttr = pageClasses ? ` ${pageClasses}` : '';
  const pagesHTML = pageChunks.map((html, idx) =>
    `<div class="pdf-page-wrap"><div class="pdf-page doc-page-canvas${pageClassAttr}">${html}<div class="pdf-footer">Page ${idx + 1} of ${pageChunks.length}</div></div></div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    ${_collectHostStylesheetLinksHTML()}
    <style>
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; }
      html, body { margin:0; padding:0; background:#e5e7eb; font-family:'Times New Roman',serif; line-height:1.6; font-size:12pt; display:flex; flex-direction:column; align-items:center; padding:20px; }
      .pdf-page-wrap { width:794px; height:1123px; margin:0 auto 20px; overflow:hidden; flex:0 0 auto; contain:layout style paint; content-visibility:auto; contain-intrinsic-size:1123px; }
      .pdf-page { background:#fff; width:794px; height:1123px; padding:62px 58px 58px 58px; box-sizing:border-box; position:relative; overflow:hidden; text-align:justify; }
      .pdf-footer { position:absolute; bottom:22px; left:0; right:0; text-align:center; font-size:10pt; color:#666; font-family:Arial,sans-serif; }
      .katex-eq { display:inline-block; max-width:100%; background:transparent !important; border:none !important; box-shadow:none !important; overflow:visible !important; color:#000 !important; }
      .katex-display { overflow:visible !important; max-width:100%; scrollbar-width:none !important; }
      .katex-display::-webkit-scrollbar { display:none !important; }
      .katex-eq.katex-render-failed { background-color:var(--render-failed-bg,#fee2e2); color:var(--render-failed-color,#dc2626); border:1px solid var(--render-failed-border,#fca5a5); padding:2px 6px; border-radius:4px; display:inline-block; font-weight:600; }
      .katex-eq.katex-render-failed .katex-fallback { color:var(--render-failed-color,#dc2626); font-weight:600; }
      @media (max-width:850px) { body{padding:8px 0 !important;} .pdf-page-wrap { overflow:hidden; margin:0 auto 12px; } .pdf-page { transform-origin:top left; } }
      @media print { html, body { height:auto !important; overflow:visible !important; } .pdf-page-wrap { content-visibility:visible !important; contain-intrinsic-size:auto !important; page-break-after:always; margin:0; } .pdf-page-wrap:last-of-type { page-break-after:auto !important; break-after:auto !important; } body { padding:0; background:#fff; } }
    </style>
  </head><body>${pagesHTML}
  <script>
    function fitPages(){
      var vw=document.documentElement.clientWidth||window.innerWidth||360;
      if(vw<=850){
        var scale=Math.min(1,Math.max(0.48,(vw-8)/794));
        var sw=794*scale, sh=1123*scale;
        document.body.style.padding='8px 0';
        document.body.style.alignItems='center';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(w){
          var page=w.querySelector('.pdf-page');
          if(page){ page.style.transformOrigin='top left'; page.style.transform='scale('+scale+')'; page.style.width='794px'; page.style.height='1123px'; }
          w.style.overflow='hidden'; w.style.width=sw+'px'; w.style.height=sh+'px'; w.style.margin='0 auto 12px'; w.style.transform='';
        });
      } else {
        document.querySelectorAll('.pdf-page-wrap').forEach(function(w){
          var page=w.querySelector('.pdf-page');
          if(page){ page.style.transform=''; page.style.transformOrigin=''; }
          w.style.width='794px'; w.style.height='1123px'; w.style.margin='0 auto 20px';
        });
      }
    }
    fitPages(); window.addEventListener('resize',fitPages);
    document.addEventListener('DOMContentLoaded', fitPages);
    window.addEventListener('load', function(){ fitPages(); setTimeout(fitPages,150); setTimeout(fitPages,500); });
    if (typeof ResizeObserver === 'function') {
      var __lastW2 = 0;
      var ro2 = new ResizeObserver(function(entries){
        var w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
        if (w > 0 && w !== __lastW2) { __lastW2 = w; fitPages(); }
      });
      ro2.observe(document.documentElement);
    }
    setTimeout(function(){ try{ parent.postMessage('pdf-iframe-ready','*'); }catch(e){} }, 500);
  <\/script></body></html>`;
}

// ===== FORWARD THE HOST APP'S OWN STYLESHEETS INTO THE PRINT/PREVIEW IFRAME =====
// The print iframe is a fully separate HTML document (srcdoc/blob) that previously only
// linked the KaTeX stylesheet. Any app-level CSS the editor uses to render color — most
// notably the "PDF visual format" theme classes (pdf-format-aurora/editorial/midnight/
// blueprint/sage) applied by applyPDFVisualFormat() in document-editor.js — was never
// available inside that document, so those colors always silently reverted to the
// hardcoded default blue palette below once exported. Mirroring the host page's real
// stylesheets (and the active theme/monochrome classes) into the iframe fixes that for
// every current and future CSS-driven color, not just this one theme system.
function _collectHostStylesheetLinksHTML() {
  try {
    const nodes = Array.from(document.querySelectorAll('link[rel="stylesheet"], style'));
    return nodes.map(node => {
      if (node.tagName === 'LINK') {
        if (!node.href) return '';
        return `<link rel="stylesheet" href="${node.href}">`;
      }
      return `<style>${node.textContent || ''}</style>`;
    }).join('\n');
  } catch (_) {
    return '';
  }
}

function _getActivePDFFormatClasses(isMonochromeMode) {
  const classes = [];
  try {
    const formatId = typeof getActivePDFVisualFormat === 'function' ? getActivePDFVisualFormat() : 'default';
    if (formatId && formatId !== 'default') classes.push('pdf-format-' + formatId);
  } catch (_) {}
  if (isMonochromeMode) classes.push('monochrome-document', 'photocopy-mode');
  return classes.join(' ');
}

// ===== BUILD UNIFIED PDF PREVIEW DOCUMENT (No exam/MCQ/OMR) =====
function buildUnifiedPDFPreviewDocument(pageChunks, isMonochromeMode) {
  const pageClasses = _getActivePDFFormatClasses(isMonochromeMode);
  const pageClassAttr = pageClasses ? ` ${pageClasses}` : '';
  const pagesHTML = pageChunks.map((html, idx) =>
    `<div class="pdf-page-wrap"><div class="pdf-page doc-page-canvas${pageClassAttr}">${html}<div class="pdf-footer">Page ${idx + 1} of ${pageChunks.length}</div></div></div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    ${_collectHostStylesheetLinksHTML()}
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      html, body { margin:0; padding:0; height:100%; overflow-y:auto; overflow-x:hidden; -webkit-overflow-scrolling:touch; }
      body { background:#e5e7eb; font-family:'Times New Roman',serif; line-height:1.6; font-size:12pt; display:flex; flex-direction:column; align-items:center; padding:20px 10px; }
      .pdf-page-wrap { width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; margin:0 auto 20px; overflow:hidden; flex:0 0 auto; }
      .pdf-page { background:#fff; width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; padding:${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px; box-sizing:border-box; position:relative; overflow:hidden; text-align:justify; }
      .pdf-footer { position:absolute; bottom:${PDF_LAYOUT.footerBottom}px; left:0; right:0; text-align:center; font-size:10pt; color:#666; font-family:Arial,sans-serif; }
      .katex-eq { display:inline-block; max-width:100%; background:transparent !important; border:none !important; box-shadow:none !important; padding-left:0 !important; padding-right:0 !important; overflow:visible !important; color:#000 !important; }
      .katex-display { overflow:visible !important; max-width:100%; scrollbar-width:none !important; }
      .katex-display::-webkit-scrollbar { display:none !important; width:0 !important; height:0 !important; }
      .katex-eq.katex-render-failed { background-color:var(--render-failed-bg,#fee2e2); color:var(--render-failed-color,#dc2626); border:1px solid var(--render-failed-border,#fca5a5); padding:2px 6px; border-radius:4px; display:inline-block; font-weight:600; }
      .katex-eq.katex-render-failed .katex-fallback { color:var(--render-failed-color,#dc2626); font-weight:600; }
      h1{font-family:Arial,sans-serif;font-size:22pt;margin-bottom:10pt;color:${isMonochromeMode?'#000':'#1e3a8a'};border-bottom:2px solid ${isMonochromeMode?'#000':'#2563eb'};padding-bottom:4px}
      h2{font-family:Arial,sans-serif;font-size:16pt;margin:12pt 0 6pt;color:${isMonochromeMode?'#000':'#1e40af'}}
      h3{font-family:Arial,sans-serif;font-size:13pt;margin:10pt 0 4pt;color:${isMonochromeMode?'#000':'#0369a1'}}
      p{margin-bottom:8pt} ul,ol{margin:6pt 0 8pt 20pt}
      table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10pt 0} th{background:${isMonochromeMode?'#e5e7eb':'#2563eb'};color:${isMonochromeMode?'#000':'#fff'};padding:8px;border:1px solid #cbd5e1;text-align:left} td{border:1px solid #cbd5e1;padding:6px 8px;word-break:break-word} img{max-width:100%;height:auto;object-fit:contain}
      pre,code{max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap}
      .block-example{background:${isMonochromeMode?'#fff':'#f0fdf4'};border-left:4px solid ${isMonochromeMode?'#000':'#10b981'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-definition{background:${isMonochromeMode?'#fff':'#eff6ff'};border-left:4px solid ${isMonochromeMode?'#000':'#3b82f6'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-warning{background:${isMonochromeMode?'#fff':'#fef2f2'};border-left:4px solid ${isMonochromeMode?'#000':'#ef4444'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-important{background:${isMonochromeMode?'#fff':'#fff7ed'};border-left:4px solid ${isMonochromeMode?'#000':'#f97316'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-note{background:${isMonochromeMode?'#fff':'#fdf2f8'};border-left:4px solid ${isMonochromeMode?'#000':'#ec4899'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}
      .block-accent{background:transparent !important;border:none !important;border-left:4px solid ${isMonochromeMode?'#000':'#3b82f6'} !important;padding:8px 14px;margin:10px 0}.block-solution{background:${isMonochromeMode?'#fff':'#f5f3ff'};border:1px solid ${isMonochromeMode?'#000':'#ddd6fe'};border-radius:8px;padding:14px 16px 10px;margin:14px 0}
      .photocopy-mode .quiz-answer-key { background:#fff !important; border-color:#000 !important; }
      @media print { html, body { height:auto !important; overflow:visible !important; -webkit-overflow-scrolling:auto !important; } body{padding:0 !important;background:#fff !important; display:block !important;} .pdf-page-wrap{width:${PDF_LAYOUT.width}px !important;height:${PDF_LAYOUT.height}px !important;margin:0 !important;overflow:hidden !important;page-break-after:always; break-after:page;} .pdf-page-wrap:last-of-type{page-break-after:auto !important; break-after:auto !important;} .pdf-page{transform:none !important;box-shadow:none !important} }
      @media (max-width:850px) { body{padding:8px 0 !important; align-items:center;} .pdf-page-wrap{margin:0 auto 12px; overflow:hidden;} .pdf-page{transform-origin:top left;} }
    </style>
  </head><body>${pagesHTML}
  <script>
    function fitPagesToScreen(){
      var vw = document.documentElement.clientWidth || window.innerWidth || 360;
      var pageWidth = ${PDF_LAYOUT.width};
      var pageHeight = ${PDF_LAYOUT.height};
      if (vw <= 850) {
        var available = Math.max(1, vw - 8);
        var scale = Math.min(1, Math.max(0.48, available / pageWidth));
        var scaledW = pageWidth * scale;
        var scaledH = pageHeight * scale;
        document.body.style.padding = '8px 0';
        document.body.style.alignItems = 'center';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
          var page = wrap.querySelector('.pdf-page');
          if (!page) return;
          page.style.width = pageWidth + 'px';
          page.style.height = pageHeight + 'px';
          page.style.transformOrigin = 'top left';
          page.style.transform = 'scale(' + scale + ')';
          wrap.style.overflow = 'hidden';
          wrap.style.width = scaledW + 'px';
          wrap.style.height = scaledH + 'px';
          wrap.style.margin = '0 auto 12px';
          wrap.style.transform = '';
          wrap.style.transformOrigin = '';
        });
      } else {
        document.body.style.padding = '';
        document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
          var page = wrap.querySelector('.pdf-page');
          if (!page) return;
          page.style.transform = '';
          page.style.transformOrigin = '';
          wrap.style.width = pageWidth + 'px';
          wrap.style.height = pageHeight + 'px';
          wrap.style.margin = '0 auto 20px';
          wrap.style.overflow = 'hidden';
        });
      }
    }
    function shrinkKatexToFit(){
      document.querySelectorAll('.katex-display').forEach(function(d){
        d.style.overflow = 'visible';
        var w = d.closest('.katex-eq') || d.parentElement;
        if (w) { w.style.overflow = 'visible'; w.style.background = 'transparent'; w.style.border = 'none'; w.style.boxShadow = 'none'; }
        var a = (w && w.clientWidth) || d.clientWidth;
        var c = d.scrollWidth;
        if (a > 0 && c > a + 1) {
          var r = Math.max(0.4, Math.min(a / c, 1));
          var b = parseFloat(getComputedStyle(d).fontSize) || 16;
          d.style.fontSize = (b * r) + 'px';
        }
      });
    }
    var readySent = false;
    function allImagesLoaded(){
      var imgs = document.querySelectorAll('img');
      for (var i = 0; i < imgs.length; i++) {
        if (!imgs[i].complete || imgs[i].naturalWidth === 0) return false;
      }
      return true;
    }
    function waitForImagesThenReady(){
      // Guard against firing the print-ready signal while <img> elements are still
      // loading: an image that grows a page's height AFTER pagination was decided is
      // exactly what pushes overflowing content onto an unplanned extra printed page.
      if (allImagesLoaded()) { notifyPrintReady(); return; }
      var imgs = document.querySelectorAll('img');
      var remaining = 0;
      var settle = function(){ remaining--; if (remaining <= 0) notifyPrintReady(); };
      Array.prototype.forEach.call(imgs, function(img){
        if (img.complete && img.naturalWidth > 0) return;
        remaining++;
        img.addEventListener('load', settle, { once: true });
        img.addEventListener('error', settle, { once: true });
      });
      if (remaining === 0) { notifyPrintReady(); return; }
      setTimeout(notifyPrintReady, 1500); // hard safety cap so a broken image can't block printing forever
    }
    function notifyPrintReady(){
      if (readySent) return;
      readySent = true;
      shrinkKatexToFit();
      fitPagesToScreen();
      try { parent.postMessage('pdf-iframe-ready', '*'); } catch(e) {}
    }
    fitPagesToScreen();
    window.addEventListener('resize', function(){ requestAnimationFrame(fitPagesToScreen); });
    document.addEventListener('DOMContentLoaded', fitPagesToScreen);
    window.addEventListener('load', function(){
      fitPagesToScreen();
      setTimeout(fitPagesToScreen, 150);
      setTimeout(fitPagesToScreen, 500);
    });
    if (typeof ResizeObserver === 'function') {
      var __lastW = 0;
      var ro = new ResizeObserver(function(entries){
        var w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
        if (w > 0 && w !== __lastW) { __lastW = w; fitPagesToScreen(); }
      });
      ro.observe(document.documentElement);
    }
    window.addEventListener('orientationchange', function(){ setTimeout(fitPagesToScreen, 200); });
    if (document.fonts && document.fonts.ready) {
      document.fonts.ready.then(waitForImagesThenReady).catch(waitForImagesThenReady);
    } else {
      window.addEventListener('load', waitForImagesThenReady, { once: true });
    }
    waitForImagesThenReady();
  <\/script></body></html>`;
}

// ===== COMPUTE TRUE PDF PAGES =====
async function computeTruePDFPages(htmlOverride) {
  const rawHtml = htmlOverride !== undefined ? htmlOverride : (typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '');

  const offscreen = document.createElement('div');
  offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_LAYOUT.width}px;pointer-events:none;visibility:hidden;z-index:-1;`;
  document.body.appendChild(offscreen);

  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(typeof sanitizeHTML === 'function' ? sanitizeHTML(rawHtml) : rawHtml) : rawHtml;
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(tempSource);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(tempSource);
  
  const topLevelNodes = typeof flattenContentTopLevelNodes === 'function' ? flattenContentTopLevelNodes(tempSource) : Array.from(tempSource.childNodes);

  const pageEls = [];
  const createPage = () => {
    const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(offscreen) : null;
    if (page) {
      if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
      if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
      pageEls.push(page);
    }
    return page;
  };

  let currentPage = createPage();
  for (let i = 0; i < topLevelNodes.length; i++) {
    if (typeof appendNodeWithPagination === 'function') {
      currentPage = await appendNodeWithPagination(topLevelNodes[i], currentPage, createPage);
    }
    if (i % (typeof isMobilePreviewMode === 'function' && isMobilePreviewMode() ? 2 : 6) === 5) await new Promise(r => setTimeout(r, 0));
  }

  // Force shrink every page to fit.
  // NOTE: normal body text is only ever allowed to be 12pt (default) or 10pt (compact) —
  // see shrinkPageToFit() below. We deliberately do not pass a third, more aggressive
  // steps array here anymore (it used to go down to 66%, i.e. ~7.9pt) because that was
  // producing random, too-small text in the middle of exported documents. If a page still
  // overflows at 10pt, it's left slightly overflowing here and handled by the real
  // pagination step (applyLocalMarginSafetyFixes -> splitOversizedTableToFit / the normal
  // page-break logic) instead of shrinking text further.
  for (const page of pageEls) {
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(page);
    if (typeof waitForPDFLayoutStable === 'function') await waitForPDFLayoutStable(page);
    if (typeof shrinkPageToFit === 'function') {
      shrinkPageToFit(page);
    }
  }

  // Filter out completely empty pages
  const pages = pageEls.map(el => ({
    el,
    html: el.innerHTML,
    overflow: typeof pageFits === 'function' ? !pageFits(el) : false,
    brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
    brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
  })).filter(p => {
    const clone = p.el.cloneNode(true);
    const footer = clone.querySelector('.page-footer-number');
    if (footer) footer.remove();
    const text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
    const hasVisual = !!clone.querySelector('img, svg, table, canvas, .katex-eq, .fc-wrapper, .figure-pro, .block-solution');
    const hasContent = text.length > 0 || hasVisual;
    return hasContent;
  });

  return { offscreen, pages };
}

function disposeTruePDFPages(result) {
  if (result && result.offscreen && result.offscreen.parentNode) {
    result.offscreen.parentNode.removeChild(result.offscreen);
  }
}

async function computeTruePDFPageChunks(options = {}) {
  const signature = options.signature || (typeof hashPDFPreviewSignature === 'function' ? hashPDFPreviewSignature() : '');
  if (options.allowCache !== false && _pdfLayoutCache.signature === signature && _pdfLayoutCache.chunks) {
    return _pdfLayoutCache.chunks;
  }
  const result = await computeTruePDFPages();
  try {
    if (typeof applyLocalMarginSafetyFixes === 'function') applyLocalMarginSafetyFixes(result);
    const chunks = result.pages.map(p => p.html);
    if (options.allowCache !== false) _pdfLayoutCache = { signature, chunks };
    return chunks;
  } finally {
    disposeTruePDFPages(result);
  }
}

// ===== PAGE MEASUREMENT HELPERS =====
function createPDFMeasurePage(offscreen) {
  const page = document.createElement('div');
  page.className = 'doc-page-canvas pdf-export-measure-page';
  page.style.setProperty('width', PDF_LAYOUT.width + 'px', 'important');
  page.style.setProperty('height', PDF_LAYOUT.height + 'px', 'important');
  page.style.setProperty('max-height', PDF_LAYOUT.height + 'px', 'important');
  page.style.setProperty('padding', `${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px`, 'important');
  page.style.setProperty('box-sizing', 'border-box', 'important');
  page.style.setProperty('overflow', 'hidden', 'important');
  page.style.setProperty('margin', '0', 'important');
  page.style.setProperty('position', 'relative', 'important');
  page.style.setProperty('background', '#fff', 'important');
  offscreen.appendChild(page);
  return page;
}

function pageFits(page) {
  const safeHeight = PDF_LAYOUT.height - PDF_LAYOUT.footerBottom - 28;
  return page.scrollHeight <= safeHeight + PDF_LAYOUT.padBottom + 1;
}

// ===== MARGIN SAFETY FIXES =====
function applyLocalMarginSafetyFixes(result) {
  if (!result || !result.pages) return;
  for (let i = 0; i < result.pages.length; i++) {
    const p = result.pages[i];
    if (!p.overflow) {
      if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(p.el);
      p.html = p.el.innerHTML;
      continue;
    }
    const { extraPages } = typeof autoFitPageWithinMargins === 'function' ? autoFitPageWithinMargins(p.el, () => {
      const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(result.offscreen) : null;
      return page;
    }) : { extraPages: [] };
    p.overflow = !pageFits(p.el);
    p.html = p.el.innerHTML;
    if (extraPages && extraPages.length) {
      const extraEntries = extraPages.map(el => ({
        el,
        html: el.innerHTML,
        overflow: !pageFits(el),
        brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : []
      }));
      result.pages.splice(i + 1, 0, ...extraEntries);
    }
  }
}

// ===== SWITCH PREVIEW TAB =====
function switchPreviewTab(tabName) {
  const docView = document.getElementById('document-view-container');
  const pdfView = document.getElementById('pdf-view-container');
  const toolbar = document.getElementById('editor-toolbar');
  const btnEditor = document.getElementById('tab-editor-btn');
  const btnPdf = document.getElementById('tab-pdf-btn');
  const btnEditorDesktop = document.getElementById('tab-editor-btn-desktop');
  const btnPdfDesktop = document.getElementById('tab-pdf-btn-desktop');

  if (btnEditor) btnEditor.classList.toggle('active', tabName === 'editor');
  if (btnPdf) btnPdf.classList.toggle('active', tabName === 'pdf');
  if (btnEditorDesktop) btnEditorDesktop.classList.toggle('active', tabName === 'editor');
  if (btnPdfDesktop) btnPdfDesktop.classList.toggle('active', tabName === 'pdf');

  const setDisplay = (el, display) => {
    if (el) el.style.setProperty('display', display, 'important');
  };

  if (tabName === 'editor') {
    setDisplay(docView, 'flex');
    setDisplay(toolbar, 'flex');
    setDisplay(pdfView, 'none');
    const strayHost = document.getElementById('image-pdf-render-host');
    if (strayHost && strayHost.parentNode) strayHost.parentNode.removeChild(strayHost);
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => {
        if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen();
        setTimeout(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); }, 150);
        setTimeout(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); }, 400);
      });
    }
  } else {
    setDisplay(docView, 'none');
    setDisplay(toolbar, 'none');
    setDisplay(pdfView, 'flex');
    if (pdfView) {
      pdfView.style.flexDirection = 'column';
      pdfView.style.height = '100%';
      pdfView.style.overflowY = 'auto';
      pdfView.style.overflowX = 'hidden';
      pdfView.style.webkitOverflowScrolling = 'touch';
      const iframe = document.getElementById('pdf-iframe');
      if (iframe) {
        iframe.style.height = '100%';
        iframe.style.width = '100%';
        iframe.style.border = 'none';
        iframe.style.display = 'block';
        iframe.style.flex = '1 1 auto';
      }
    }
    const iframeForCheck = document.getElementById('pdf-iframe');
    const willReuseCache = iframeForCheck && (iframeForCheck.src || iframeForCheck.srcdoc) &&
      typeof hashPDFPreviewSignature === 'function' &&
      hashPDFPreviewSignature() === _pdfLastRenderedSignature &&
      (document.body.classList.contains('photocopy-mode') ? 'mono' : 'color') === _pdfLastRenderedMode;
    const loadingEl = document.getElementById('pdf-preview-loading');
    if (loadingEl && !willReuseCache) {
      loadingEl.style.display = 'flex';
      loadingEl.classList.add('active');
      const statusEl = document.getElementById('pdf-preview-loading-status');
      if (statusEl) statusEl.textContent = '📄 Loading PDF preview...';
    }
    if (typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
    _refitPDFIframeSoon();
    setTimeout(_refitPDFIframeSoon, 300);
    setTimeout(_refitPDFIframeSoon, 700);
  }
}

function _refitPDFIframeSoon() {
  const iframe = document.getElementById('pdf-iframe');
  if (!iframe) return;
  const tryRefit = () => {
    try {
      if (iframe.contentWindow && typeof iframe.contentWindow.fitPagesToScreen === 'function') {
        iframe.contentWindow.fitPagesToScreen();
      }
    } catch (_) { /* cross-origin or not ready yet — ignore */ }
  };
  [120, 400, 900].forEach(delay => setTimeout(tryRefit, delay));
}
if (!window.__pdfPanelResizeBound && typeof ResizeObserver === 'function') {
  window.__pdfPanelResizeBound = true;
  document.addEventListener('DOMContentLoaded', () => {
    const pdfView = document.getElementById('pdf-view-container');
    if (!pdfView) return;
    let lastW = 0;
    const ro = new ResizeObserver((entries) => {
      const w = Math.round((entries[0] && entries[0].contentRect && entries[0].contentRect.width) || 0);
      if (w > 0 && w !== lastW) {
        lastW = w;
        if (typeof _refitPDFIframeSoon === 'function') _refitPDFIframeSoon();
      }
    });
    ro.observe(pdfView);
  });
}

// ===== WAIT FOR LAYOUT STABLE =====
async function waitForPDFLayoutStable(container) {
  try {
    if (document.fonts && document.fonts.ready) await document.fonts.ready;
  } catch (_) {}
  if (typeof waitForImagesToLoad === 'function') await waitForImagesToLoad(container);
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(container);
  await (typeof nextFrame === 'function' ? nextFrame() : Promise.resolve());
}

function nextFrame() {
  return new Promise(resolve => requestAnimationFrame(() => resolve()));
}

function waitForImagesToLoad(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return Promise.resolve();
  const imgs = Array.from(container.querySelectorAll('img'));
  return Promise.all(imgs.map(img => {
    if (img.complete && img.naturalWidth > 0) return Promise.resolve();
    return new Promise(resolve => {
      img.addEventListener('load', resolve, { once: true });
      img.addEventListener('error', resolve, { once: true });
      setTimeout(resolve, 2000);
    });
  }));
}

// ===== AUTO-FIT PAGE WITHIN MARGINS =====
function autoFitPageWithinMargins(pageEl, createContinuationPage, steps) {
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(pageEl);
  if (pageFits(pageEl)) return { fixed: true, extraPages: [] };
  if (typeof shrinkPageToFit === 'function' && shrinkPageToFit(pageEl, steps)) return { fixed: true, extraPages: [] };
  const extraPages = typeof splitOversizedTableToFit === 'function' ? splitOversizedTableToFit(pageEl, createContinuationPage) : [];
  if (typeof shrinkPageToFit === 'function') shrinkPageToFit(pageEl, steps);
  return { fixed: pageFits(pageEl), extraPages };
}

function shrinkPageToFit(pageEl, steps) {
  const wrapper = ensurePageFitWrapper(pageEl);
  // Normal body text is only ever allowed to be 12pt (100%, the default) or 10pt
  // (10/12 ≈ 83%) — matching standard word-processor sizing (Word-style 12/10pt). We
  // intentionally stopped scaling further down through 94%/88%/82%/76%/70%/66%: that
  // produced random, oddly-small text partway through a document. Anything that still
  // overflows at 10pt is left to real pagination (a continuation page) rather than
  // shrinking text more. This does not affect figures/diagrams — their own SVG/image
  // sizing is handled separately and is fine to vary.
  const shrinkSteps = steps || [1, 10 / 12];
  for (const scale of shrinkSteps) {
    wrapper.style.fontSize = (scale * 100) + '%';
    wrapper.style.lineHeight = String(scale >= 0.99 ? 1.6 : 1.5);
    if (pageFits(pageEl)) return true;
  }
  return pageFits(pageEl);
}

function ensurePageFitWrapper(pageEl) {
  const existing = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('pdf-fit-wrapper'));
  if (existing) return existing;
  const footer = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('page-footer-number'));
  const wrapper = document.createElement('div');
  wrapper.className = 'pdf-fit-wrapper';
  const toMove = Array.from(pageEl.childNodes).filter(n => n !== footer);
  toMove.forEach(n => wrapper.appendChild(n));
  pageEl.insertBefore(wrapper, footer || null);
  return wrapper;
}

function splitOversizedTableToFit(pageEl, createContinuationPage) {
  const newPages = [];
  if (!createContinuationPage) return newPages;
  const wrapper = Array.from(pageEl.children).find(c => c.classList && c.classList.contains('pdf-fit-wrapper')) || pageEl;
  const table = wrapper.querySelector('table');
  if (!table) return newPages;
  const thead = table.querySelector('thead');
  let headerRow = null;
  if (!thead) {
    const firstRow = table.querySelector('tr');
    if (firstRow && firstRow.querySelector('th')) headerRow = firstRow;
  }
  let guard = 0;
  while (!pageFits(pageEl) && guard < 300) {
    guard++;
    const rows = Array.from(table.querySelectorAll('tr')).filter(r => r !== headerRow && !r.closest('thead'));
    if (rows.length <= 1) break;
    const lastRow = rows[rows.length - 1];
    let targetPage = newPages[newPages.length - 1];
    let targetTable;
    if (!targetPage) {
      targetPage = createContinuationPage();
      newPages.push(targetPage);
      const targetWrapper = ensurePageFitWrapper(targetPage);
      targetTable = table.cloneNode(false);
      if (thead) targetTable.appendChild(thead.cloneNode(true));
      else if (headerRow) targetTable.appendChild(headerRow.cloneNode(true));
      targetWrapper.appendChild(targetTable);
    } else {
      targetTable = targetPage.querySelector('table');
    }
    lastRow.remove();
    const insertBeforeRow = Array.from(targetTable.querySelectorAll('tr')).find(r => r !== headerRow && !r.closest('thead'));
    if (insertBeforeRow) targetTable.insertBefore(lastRow, insertBeforeRow);
    else targetTable.appendChild(lastRow);
  }
  return newPages;
}

// ===== UPDATED splitPlainTextElement =====
async function splitPlainTextElement(node, currentPage, createPage) {
    const textContent = node.textContent || '';
    const words = textContent.trim().split(/\s+/).filter(Boolean);
    if (!words.length) {
        return { page: currentPage, didSplit: false };
    }

    let page = currentPage;
    let chunk = cloneElementShell(node);
    page.appendChild(chunk);
    let text = '';
    let didSplit = false;

    const checkFit = async (el) => {
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
        await waitForImagesToLoad(page);
        if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(page);
        return pageFits(page);
    };

    for (let i = 0; i < words.length; i++) {
        const candidate = text ? `${text} ${words[i]}` : words[i];
        chunk.textContent = candidate;
        
        if (!(await checkFit(chunk))) {
            if (!text) {
                if (candidate.length > 20) {
                    const chars = candidate.split('');
                    let subText = '';
                    let subChunk = cloneElementShell(node);
                    page.appendChild(subChunk);
                    for (let j = 0; j < chars.length; j++) {
                        const subCandidate = subText ? subText + chars[j] : chars[j];
                        subChunk.textContent = subCandidate;
                        if (!(await checkFit(subChunk))) {
                            if (subText) {
                                subChunk.remove();
                                if (pageHasContent(page)) {
                                    page = createPage();
                                    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
                                    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
                                }
                                subChunk = cloneElementShell(node);
                                page.appendChild(subChunk);
                                subText = chars[j];
                                subChunk.textContent = subText;
                            } else {
                                subChunk.remove();
                                if (pageHasContent(page)) {
                                    page = createPage();
                                    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
                                    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
                                }
                                chunk = cloneElementShell(node);
                                page.appendChild(chunk);
                                chunk.textContent = candidate;
                                didSplit = true;
                                break;
                            }
                        } else {
                            subText = subCandidate;
                        }
                    }
                    if (chunk.parentNode) chunk.remove();
                    didSplit = true;
                    break;
                } else {
                    chunk.remove();
                    if (pageHasContent(page)) {
                        page = createPage();
                        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
                        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
                    }
                    chunk = cloneElementShell(node);
                    page.appendChild(chunk);
                    chunk.textContent = candidate;
                    didSplit = true;
                    break;
                }
            } else {
                chunk.textContent = text;
                const remainingWords = words.slice(i);
                if (remainingWords.length > 0) {
                    const remainingText = remainingWords.join(' ');
                    const newPage = createPage();
                    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(newPage);
                    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(newPage);
                    const newChunk = cloneElementShell(node);
                    newPage.appendChild(newChunk);
                    newChunk.textContent = remainingText;
                    didSplit = true;
                }
                break;
            }
        } else {
            text = candidate;
        }
    }

    if (!didSplit && text) {
        if (!chunk.parentNode) {
            page.appendChild(chunk);
            chunk.textContent = text;
        }
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
        return { page, didSplit: false };
    }

    return { page, didSplit };
}

// ===== appendNodeWithPagination (UPDATED: improved pageHasContent check) =====
async function appendNodeWithPagination(node, currentPage, createPage) {
    if (node.nodeType === Node.TEXT_NODE) {
        if (!node.textContent.trim()) return currentPage;
        const wrapper = document.createElement('p');
        wrapper.textContent = node.textContent.trim();
        const result = await splitPlainTextElement(wrapper, currentPage, createPage);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(result.page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(result.page);
        return result.page;
    }
    if (node.nodeType !== Node.ELEMENT_NODE) return currentPage;
    if (node.classList && node.classList.contains('manual-page-break')) {
        return pageHasContent(currentPage) ? createPage() : currentPage;
    }

    // ---- Normal node ----
    const testClone2 = appendClone(currentPage, node);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(testClone2);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(testClone2);
    await waitForImagesToLoad(testClone2);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(testClone2);

    if (pageFits(currentPage)) return currentPage;

    currentPage.removeChild(testClone2);

    const childElements = Array.from(node.children || []);
    const hasOnlyText = childElements.length === 0;
    const isBreakableText = /^(P|LI|BLOCKQUOTE|PRE|CODE|DIV)$/i.test(node.tagName) && hasOnlyText;
    
    if (isBreakableText) {
        if (pageHasContent(currentPage)) currentPage = createPage();
        const result = await splitPlainTextElement(node, currentPage, createPage);
        return result.page;
    }

    if (childElements.length && !/^(IMG|SVG|CANVAS|TABLE|HR)$/i.test(node.tagName)) {
        if (pageHasContent(currentPage)) currentPage = createPage();
        const result = await splitChildFlowElement(node, currentPage, createPage);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(result.page);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(result.page);
        return result.page;
    }

    // For non-breakable nodes (IMG, TABLE, SVG), create new page if needed and then add
    if (pageHasContent(currentPage)) currentPage = createPage();
    const finalClone = appendClone(currentPage, node);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(finalClone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(finalClone);
    await waitForImagesToLoad(finalClone);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(finalClone);

    // If it still doesn't fit, try to shrink the whole page
    if (!pageFits(currentPage)) {
        if (typeof shrinkPageToFit === 'function') {
            shrinkPageToFit(currentPage);
        }
    }

    return currentPage;
}

// ===== IMPROVED pageHasContent =====
function pageHasContent(page) {
    if (!page) return false;
    // Check if there's any content besides the footer
    const clone = page.cloneNode(true);
    const footer = clone.querySelector('.page-footer-number');
    if (footer) footer.remove();
    const text = (clone.innerText || '').replace(/\s+/g, ' ').trim();
    const hasVisual = !!clone.querySelector('img, svg, table, canvas, .katex-eq, .fc-wrapper, .figure-pro, .block-solution');
    return text.length > 0 || hasVisual;
}

function appendClone(page, sourceNode) {
    const clone = sourceNode.cloneNode(true);
    page.appendChild(clone);
    return clone;
}

function cloneElementShell(node) {
    const shell = node.cloneNode(false);
    shell.removeAttribute('contenteditable');
    shell.removeAttribute('spellcheck');
    return shell;
}

async function splitListElement(node, currentPage, createPage) {
    const items = Array.from(node.children || []).filter(el => /^(LI)$/i.test(el.tagName));
    if (!items.length) return { page: currentPage, didSplit: false };
    let page = currentPage;
    let list = cloneElementShell(node);
    page.appendChild(list);
    list.innerHTML = '';
    let didSplit = false;

    for (const item of items) {
        const itemClone = item.cloneNode(true);
        list.appendChild(itemClone);
        if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(itemClone);
        if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(itemClone);
        await waitForImagesToLoad(itemClone);
        if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(itemClone);
        if (!pageFits(page)) {
            list.removeChild(itemClone);
            page = createPage();
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
            list = cloneElementShell(node);
            page.appendChild(list);
            list.appendChild(itemClone);
            didSplit = true;
        }
    }
    return { page, didSplit };
}

async function splitChildFlowElement(node, currentPage, createPage) {
    const children = Array.from(node.childNodes || []);
    if (!children.length) return { page: currentPage, didSplit: false };

    let page = currentPage;
    let shell = cloneElementShell(node);
    page.appendChild(shell);
    let didSplit = false;

    for (const child of children) {
        const childClone = child.cloneNode(true);
        shell.appendChild(childClone);
        if (childClone.nodeType === Node.ELEMENT_NODE) {
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(childClone);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(childClone);
            await waitForImagesToLoad(childClone);
            if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(childClone);
        }
        if (!pageFits(page)) {
            shell.removeChild(childClone);
            page = createPage();
            if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(page);
            if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(page);
            shell = cloneElementShell(node);
            page.appendChild(shell);
            shell.appendChild(childClone);
            didSplit = true;
        }
    }
    return { page, didSplit };
}

// ============================================================
// WINDOW EXPOSURE – PDF Export
// ============================================================
window.exportToHighQualityPDF = exportToHighQualityPDF;
window.exportToImagePDF = exportToImagePDF;
window.exportToWordDocument = exportToWordDocument;
window.generateLivePDFIframePreview = generateLivePDFIframePreview;
window.invalidatePDFPreviewCache = invalidatePDFPreviewCache;
window.buildUnifiedPDFPreviewDocument = buildUnifiedPDFPreviewDocument;
window.computeTruePDFPages = computeTruePDFPages;
window.disposeTruePDFPages = disposeTruePDFPages;
window.computeTruePDFPageChunks = computeTruePDFPageChunks;
window.createPDFMeasurePage = createPDFMeasurePage;
window.pageFits = pageFits;
window.applyLocalMarginSafetyFixes = applyLocalMarginSafetyFixes;
window.switchPreviewTab = switchPreviewTab;
window.waitForPDFLayoutStable = waitForPDFLayoutStable;
window.nextFrame = nextFrame;
window.waitForImagesToLoad = waitForImagesToLoad;
window.autoFitPageWithinMargins = autoFitPageWithinMargins;
window.shrinkPageToFit = shrinkPageToFit;
window.ensurePageFitWrapper = ensurePageFitWrapper;
window.splitOversizedTableToFit = splitOversizedTableToFit;
window.appendNodeWithPagination = appendNodeWithPagination;
window.pageHasContent = pageHasContent;
window.appendClone = appendClone;
window.cloneElementShell = cloneElementShell;
window.splitPlainTextElement = splitPlainTextElement;
window.splitListElement = splitListElement;
window.splitChildFlowElement = splitChildFlowElement;
