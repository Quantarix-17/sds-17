// ========================================================================
// PDF EXPORT - True PDF (native print), Image PDF (rasterized), Word export,
// and live PDF iframe preview
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
    const pageChunks = typeof computeTruePDFPageChunks === 'function' ? await computeTruePDFPageChunks({ signature, allowCache: true }) : [];
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
  loadHandler = () => setTimeout(() => { if (!printed) runPrint(); }, 80);

  window.addEventListener('message', messageHandler);
  iframe.addEventListener('load', loadHandler, { once: true });
  timeoutId = setTimeout(() => runPrint(), 1800);
}

// ===== IMAGE PDF (RASTERIZED) =====
async function exportToImagePDF(btn) {
  if (typeof invalidatePDFPreviewCache === 'function') invalidatePDFPreviewCache();
  const libs = await ensurePDFRenderLibraries();
  _assertPDFRenderLibraries(libs, true);
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

  _setExportButtonBusy(btn, true, 'PDF');

  try {
    await runPreExportLocalQualityPass();

    renderPages = typeof _buildImagePDFRenderPages === 'function' ? await _buildImagePDFRenderPages() : { pages: [] };
    const pageList = renderPages.pages || [];
    if (!pageList.length) throw new Error('No renderable pages were produced.');

    renderHost = document.createElement('div');
    renderHost.id = 'image-pdf-render-host';
    renderHost.style.cssText = [
      'position:fixed',
      'left:0',
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

// ===== LIVE PDF IFRAME PREVIEW =====
let _pdfPreviewGenerationToken = 0;
let _pdfPreviewDebounceTimer = null;
let _pdfPreviewRunning = false;
let _pdfPreviewPending = false;
let _pdfLayoutCache = { signature: '', chunks: null };
let _pdfMathPreparedSignature = '';
let _pdfDocumentRevision = 0;
let _pdfLastRenderedSignature = '';
let _pdfLastRenderedMode = '';

function invalidatePDFPreviewCache() {
  _pdfDocumentRevision++;
  _pdfLayoutCache.signature = '';
  _pdfLayoutCache.chunks = null;
  _pdfMathPreparedSignature = '';
  _pdfLastRenderedSignature = '';
  _pdfLastRenderedMode = '';
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
  if (!iframe) return;

  if (_pdfPreviewRunning) {
    _pdfPreviewPending = true;
    return;
  }
  _pdfPreviewRunning = true;
  if (loadingEl) {
    loadingEl.classList.add('active');
    loadingEl.setAttribute('aria-busy', 'true');
  }
  if (loadingStatusEl) loadingStatusEl.textContent = 'Measuring pages and preparing the PDF layout…';
  iframe.classList.add('pdf-loading');

  try {
    const signature = hashPDFPreviewSignature();
    const isMonochromeMode = document.body.classList.contains('photocopy-mode');
    const previewMode = isMonochromeMode ? 'mono' : 'color';

    if (_pdfLastRenderedSignature === signature && _pdfLastRenderedMode === previewMode && (iframe.src || iframe.srcdoc)) {
      if (loadingStatusEl) loadingStatusEl.textContent = 'PDF preview ready.';
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      iframe.classList.remove('pdf-loading');
      _pdfPreviewRunning = false;
      return;
    }

    prepareDocumentForPDFPreview(signature);

    let pageChunks = _collectRenderableEditorPages().map(page => page.innerHTML);
    if (!pageChunks.length) {
      pageChunks = _buildSimplePDFPageChunksFallback();
    }
    if (!pageChunks.length) throw new Error('No renderable document pages available.');
    if (myToken !== _pdfPreviewGenerationToken) return;

    if (loadingStatusEl) loadingStatusEl.textContent = `Rendering ${pageChunks.length} page${pageChunks.length === 1 ? '' : 's'}…`;

    iframe.onerror = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      iframe.classList.remove('pdf-loading');
      if (typeof displayToastNotification === 'function') displayToastNotification('⚠️ PDF preview frame failed to load.');
    };
    iframe.onload = () => {
      if (myToken !== _pdfPreviewGenerationToken) return;
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      iframe.classList.remove('pdf-loading');
    };

    const previewHTML = typeof buildUnifiedPDFPreviewDocument === 'function' ?
      buildUnifiedPDFPreviewDocument(pageChunks, isMonochromeMode) :
      '';
    if (!_setPDFPreviewFrameHTML(iframe, previewHTML)) {
      throw new Error('Unable to initialize PDF preview frame.');
    }
    _pdfLastRenderedSignature = signature;
    _pdfLastRenderedMode = previewMode;

  } catch (error) {
    console.error('PDF preview generation failed:', error);
    if (myToken === _pdfPreviewGenerationToken) {
      if (loadingEl) {
        loadingEl.classList.remove('active');
        loadingEl.setAttribute('aria-busy', 'false');
      }
      if (loadingStatusEl) loadingStatusEl.textContent = 'Preview failed to render.';
      iframe.classList.remove('pdf-loading');
      if (typeof displayToastNotification === 'function') {
        displayToastNotification('⚠️ PDF preview failed to render: ' + (error && error.message ? error.message : 'unknown error'));
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

window.addEventListener('beforeunload', _revokePDFPreviewObjectURL);

// ===== BUILD UNIFIED PDF PREVIEW DOCUMENT =====
function buildUnifiedPDFPreviewDocument(pageChunks, isMonochromeMode) {
  const isExam = document.body.classList.contains('exam-document');
  const pagesHTML = pageChunks.map((html, idx) =>
    `<div class="pdf-page-wrap"><div class="pdf-page ${isExam ? 'exam-document' : ''}">${html}<div class="pdf-footer">Page ${idx + 1} of ${pageChunks.length}</div></div></div>`
  ).join('');

  return `<!DOCTYPE html><html><head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=5.0, user-scalable=yes">
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/katex@0.16.9/dist/katex.min.css">
    <style>
      @page { size: A4; margin: 0; }
      * { box-sizing: border-box; -webkit-print-color-adjust: exact !important; print-color-adjust: exact !important; color-adjust: exact !important; }
      html, body { margin:0; padding:0; }
      body { background:#e5e7eb; font-family:'Times New Roman',serif; line-height:1.6; font-size:12pt; display:flex; flex-direction:column; align-items:center; padding:40px 20px; }
      .pdf-page-wrap { width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; margin:0 auto 20px; overflow:hidden; flex:0 0 auto; contain:layout style paint; content-visibility:auto; contain-intrinsic-size:${PDF_LAYOUT.height}px; }
      .pdf-page { background:#fff; width:${PDF_LAYOUT.width}px; height:${PDF_LAYOUT.height}px; padding:${PDF_LAYOUT.padTop}px ${PDF_LAYOUT.padRight}px ${PDF_LAYOUT.padBottom}px ${PDF_LAYOUT.padLeft}px; box-sizing:border-box; position:relative; overflow:hidden; text-align:justify; }
      .pdf-footer { position:absolute; bottom:${PDF_LAYOUT.footerBottom}px; left:0; right:0; text-align:center; font-size:10pt; color:#666; font-family:Arial,sans-serif; }
      .katex-eq { display:inline-block; max-width:100%; background:transparent !important; border:none !important; box-shadow:none !important; padding-left:0 !important; padding-right:0 !important; overflow:visible !important; color:#000 !important; }
      .katex-display { overflow:visible !important; max-width:100%; scrollbar-width:none !important; }
      .katex-display::-webkit-scrollbar { display:none !important; width:0 !important; height:0 !important; }
      h1{font-family:Arial,sans-serif;font-size:22pt;margin-bottom:10pt;color:${isMonochromeMode?'#000':'#1e3a8a'};border-bottom:2px solid ${isMonochromeMode?'#000':'#2563eb'};padding-bottom:4px}
      h2{font-family:Arial,sans-serif;font-size:16pt;margin:12pt 0 6pt;color:${isMonochromeMode?'#000':'#1e40af'}}
      h3{font-family:Arial,sans-serif;font-size:13pt;margin:10pt 0 4pt;color:${isMonochromeMode?'#000':'#0369a1'}}
      p{margin-bottom:8pt} ul,ol{margin:6pt 0 8pt 20pt}
      table{width:100%;border-collapse:collapse;table-layout:fixed;margin:10pt 0} th{background:${isMonochromeMode?'#e5e7eb':'#2563eb'};color:${isMonochromeMode?'#000':'#fff'};padding:8px;border:1px solid #cbd5e1;text-align:left} td{border:1px solid #cbd5e1;padding:6px 8px;word-break:break-word} img{max-width:100%;height:auto;object-fit:contain}
      pre,code{max-width:100%;overflow-wrap:anywhere;white-space:pre-wrap}
      .quiz-container{counter-reset:mcq-item;margin:0;font-family:'Times New Roman',Times,serif;font-size:11.2pt;line-height:1.44;width:100%}
      .exam-document .quiz-container{column-count:2;column-gap:28px;column-fill:auto;font-size:11.2pt;line-height:1.44}
      .quiz-item{counter-increment:mcq-item;display:block;break-inside:avoid;page-break-inside:avoid;-webkit-column-break-inside:avoid;margin:0 0 8px;padding:0;border:0}
      .quiz-question{font-weight:700;color:${isMonochromeMode?'#000':'#111'};margin:0 0 3px;line-height:1.44}
      .quiz-question::before{content:counter(mcq-item) '. ';color:${isMonochromeMode?'#000':'#111'};font-weight:700}
      .quiz-options{display:grid;grid-template-columns:minmax(0,1fr) minmax(0,1fr);gap:1px 16px;margin:0 0 0 18px;padding:0;font-size:10.6pt;color:${isMonochromeMode?'#000':'#111'}}
      .quiz-option{position:relative;min-width:0;padding:0 2px 0 22px;border:0;border-radius:0;background:transparent;word-break:normal;overflow-wrap:anywhere;line-height:1.34;break-inside:avoid}
      .quiz-option::before{position:absolute;left:0;top:0;width:18px;font-weight:700;color:${isMonochromeMode?'#000':'#111'}}
      .quiz-option:nth-child(1)::before{content:'(A)'}.quiz-option:nth-child(2)::before{content:'(B)'}.quiz-option:nth-child(3)::before{content:'(C)'}.quiz-option:nth-child(4)::before{content:'(D)'}
      .quiz-item.bangla-question .quiz-option:nth-child(1)::before{content:'ক)'}
      .quiz-item.bangla-question .quiz-option:nth-child(2)::before{content:'খ)'}
      .quiz-item.bangla-question .quiz-option:nth-child(3)::before{content:'গ)'}
      .quiz-item.bangla-question .quiz-option:nth-child(4)::before{content:'ঘ)'}
      .quiz-answer-key{margin-top:18px;padding:12px 14px;background:#f8fafc;border:1px solid #cbd5e1;border-radius:8px;font-size:9.5pt;break-inside:avoid;page-break-inside:avoid}.quiz-answer-title{font-weight:800;font-size:11pt;color:${isMonochromeMode?'#000':'#1e3a8a'};margin-bottom:8px;padding-bottom:5px;border-bottom:1px solid #cbd5e1}.quiz-answer-grid{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:5px 10px;line-height:1.35}
      .block-example{background:${isMonochromeMode?'#fff':'#f0fdf4'};border-left:4px solid ${isMonochromeMode?'#000':'#10b981'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-definition{background:${isMonochromeMode?'#fff':'#eff6ff'};border-left:4px solid ${isMonochromeMode?'#000':'#3b82f6'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-warning{background:${isMonochromeMode?'#fff':'#fef2f2'};border-left:4px solid ${isMonochromeMode?'#000':'#ef4444'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-important{background:${isMonochromeMode?'#fff':'#fff7ed'};border-left:4px solid ${isMonochromeMode?'#000':'#f97316'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}.block-note{background:${isMonochromeMode?'#fff':'#fdf2f8'};border-left:4px solid ${isMonochromeMode?'#000':'#ec4899'};padding:10px 14px;margin:10px 0;border-radius:0 6px 6px 0}
      .block-accent{background:transparent !important;border:none !important;border-left:4px solid ${isMonochromeMode?'#000':'#3b82f6'} !important;padding:8px 14px;margin:10px 0}.block-solution{background:${isMonochromeMode?'#fff':'#f5f3ff'};border:1px solid ${isMonochromeMode?'#000':'#ddd6fe'};border-radius:8px;padding:14px 16px 10px;margin:14px 0}
      .toc-container{background:${isMonochromeMode?'#fff':'#f8fafc'};border:2px solid #000;padding:16px;margin-bottom:20px}
      .exam-header-block{border:0;border-bottom:2px solid #111;border-radius:0;padding:0 0 10px;margin:0 0 14px;font-family:'Times New Roman',Times,serif;page-break-inside:avoid;break-inside:avoid}
      .exam-header-title{text-align:center;font-size:17pt;font-weight:800;color:#111;margin:0 0 3px;line-height:1.2}
      .exam-header-subtitle{text-align:center;font-size:11pt;color:#111;margin:0 0 8px;line-height:1.25}
      .exam-header-rule{border:none;border-top:1px solid #111;margin:0 0 8px}
      .exam-header-row{display:grid;grid-template-columns:2fr 1fr 1fr;gap:5px 18px;font-size:10.5pt;margin-bottom:5px}
      .exam-header-row+.exam-header-row{grid-template-columns:1fr 1fr}
      .exam-header-field{display:flex;align-items:baseline;gap:6px;white-space:nowrap}
      .exam-header-field .label{font-weight:700;color:${isMonochromeMode?'#000':'#16233f'}}
      .exam-header-field .blank{flex:1;border-bottom:1px solid #64748b;min-width:40px;min-height:1.1em;display:inline-block}
      .omr-sheet-page{padding-top:4px}
      .omr-sheet-title{text-align:center;font-size:14pt;font-weight:800;letter-spacing:.06em;color:${isMonochromeMode?'#000':'#1e3a8a'};margin:0 0 4px}
      .omr-sheet-subtitle{text-align:center;font-size:9.5pt;color:${isMonochromeMode?'#000':'#64748b'};margin:0 0 14px}
      .omr-sheet-header{border:2px solid #16233f;border-radius:10px;padding:10px 16px;margin-bottom:16px;display:grid;grid-template-columns:2fr 1fr 1fr;gap:8px 18px;font-size:10.5pt}
      .omr-grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:6px 10px;border:1px solid #cbd5e1;border-radius:10px;padding:12px 14px}
      .omr-row{display:flex;align-items:center;gap:6px;break-inside:avoid;page-break-inside:avoid;font-size:9.5pt}
      .omr-qnum{width:20px;font-weight:700;color:${isMonochromeMode?'#000':'#16233f'};flex-shrink:0}
      .omr-bubble{width:15px;height:15px;border-radius:50%;border:1.4px solid #334155;display:inline-flex;align-items:center;justify-content:center;font-size:7pt;font-weight:700;color:#334155;flex-shrink:0}
      .omr-instructions{margin-top:12px;font-size:8.8pt;color:#64748b;font-style:italic}
      @media print { .pdf-page-wrap{contain:none !important} body{padding:0 !important;background:#fff !important} .pdf-page-wrap{width:${PDF_LAYOUT.width}px !important;height:${PDF_LAYOUT.height}px !important;margin:0 !important;overflow:hidden !important;page-break-after:always} .pdf-page-wrap:last-child{page-break-after:auto} .pdf-page{transform:none !important;box-shadow:none !important} .exam-document .quiz-container{column-count:2 !important;column-fill:auto !important} }
      @media (max-width:850px) { body{padding:14px 8px}.pdf-page-wrap{transform-origin:top center} }
    </style>
    <style id="mobile-ui-size-fix">
      @media (max-width:850px){:root{--mobile-topbar:56px !important;--mobile-tabbar:42px !important}
      #topbar{height:56px !important;min-height:56px !important;padding-left:max(10px,env(safe-area-inset-left)) !important;padding-right:max(10px,env(safe-area-inset-right)) !important;gap:8px !important;backdrop-filter:none !important;-webkit-backdrop-filter:none !important}
      .logo{font-size:1.05rem !important;gap:8px !important}.logo-mark{width:32px !important;height:32px !important;font-size:16px !important}
      #topbar-more-btn,#topbar-newtab-fab-btn{width:42px !important;min-width:42px !important;height:42px !important;padding:0 !important;font-size:1.15rem !important}
      #topbar-actions{top:64px !important;right:10px !important;left:10px !important}
      #topbar-actions .topbar-btn,#topbar-actions .mode-toggle-btn,#topbar-actions .topbar-toggle-label{min-height:44px !important;padding:11px 14px !important;font-size:.94rem !important}
      #tab-bar{height:42px !important;min-height:42px !important;padding:0 7px !important}
      .tab-item{min-height:32px !important;padding:5px 9px 5px 11px !important;font-size:.74rem !important}
      .tab-item .tab-close{width:22px !important;height:22px !important;min-width:22px !important}
      #tab-new-btn{width:30px !important;height:30px !important;font-size:1rem !important}
      #mobile-nav-bar{min-height:48px !important;padding:6px 9px max(6px,env(safe-area-inset-bottom,6px)) 9px !important}
      .mobile-nav-btn{min-height:42px !important;padding:9px 10px !important;font-size:.86rem !important}
      #main-container{height:calc(var(--mobile-vh) - var(--mobile-topbar) - var(--mobile-tabbar) - 48px) !important}
      #preview-tabs{flex-basis:44px !important;min-height:44px !important;padding:4px 7px 0 !important}
      #preview-tabs .tab-btn{min-height:40px !important;padding:9px 11px !important;font-size:.86rem !important}
      #editor-toolbar{min-height:48px !important;padding:7px 9px !important;gap:5px !important}
      #editor-toolbar .tool-btn{min-width:38px !important;min-height:38px !important;padding:6px 9px !important;font-size:.92rem !important}
      #editor-toolbar .tool-select{min-height:38px !important;font-size:.86rem !important}
      .color-btn-container{width:38px !important;height:36px !important}
      #chat-history{padding:14px 12px !important;gap:11px !important}
      .chat-message{font-size:.94rem !important;line-height:1.52 !important;padding:11px 13px !important}
      #chat-form{min-height:58px !important;padding:8px 9px !important;padding-bottom:max(8px,env(safe-area-inset-bottom,8px)) !important;gap:6px !important}
      .icon-btn{width:44px !important;min-width:44px !important;height:44px !important;min-height:44px !important;font-size:1.08rem !important}
      #chat-input-textarea{min-height:44px !important;padding:10px 13px !important;font-size:16px !important}
      #file-attach-btn,#at-command-btn,#send-message-btn{width:44px !important;min-width:44px !important;height:44px !important}
      #active-model-select{font-size:.78rem !important;min-height:30px !important}
      #at-command-menu{font-size:.9rem !important;max-height:min(calc(var(--mobile-vh) - 84px),600px) !important;padding:8px 8px max(14px,env(safe-area-inset-bottom,14px)) !important}
      .at-command-category{padding:9px 12px !important;font-size:.76rem !important}
      .at-command-item{min-height:52px !important;padding:13px 11px !important}
      .at-command-item .at-cmd-label{font-size:.9rem !important}
      .at-command-item .at-cmd-desc{font-size:.76rem !important}
      #document-view-container{padding:12px 6px 24px !important}
      #pdf-view-container{padding:8px 5px max(14px,env(safe-area-inset-bottom,14px)) !important}}
      @media (max-width:520px){.mobile-nav-btn{font-size:.84rem !important}#file-attach-btn,#at-command-btn,#send-message-btn{width:44px !important;min-width:44px !important}}
      @media (max-width:380px){.mobile-nav-btn{font-size:.82rem !important;padding-left:8px !important;padding-right:8px !important}.tab-item{font-size:.7rem !important}#chat-form{gap:5px !important}#chat-input-textarea{padding-left:11px !important;padding-right:11px !important}}
      @media (min-width:851px){:root{--mobile-topbar:60px !important;--mobile-tabbar:44px !important;--mobile-vh:100dvh !important}
      html,body{width:100% !important;min-width:0 !important;max-width:none !important;height:100% !important;height:100dvh !important}
      body{overflow:hidden !important}
      #topbar{height:60px !important;min-height:60px !important;padding:0 22px !important;gap:10px !important}
      #tab-bar{height:44px !important;min-height:44px !important;padding:0 12px !important;gap:4px !important}
      #mobile-nav-bar{display:none !important}
      #main-container{height:auto !important;min-height:0 !important;flex:1 1 auto !important}
      #sidebar{width:380px !important;min-width:300px !important;max-width:550px !important}
      #preview-tabs{display:flex !important}
      #preview-tabs-desktop{display:none !important}
      #editor-toolbar{padding:9px 16px !important;gap:6px !important}
      .tool-btn{min-width:30px !important;min-height:0 !important;padding:6px 10px !important;font-size:.85rem !important}
      .tab-item{min-height:0 !important;padding:6px 12px 6px 14px !important;font-size:.78rem !important}
      #document-view-container{padding:40px 20px !important}
      #pdf-view-container{padding:20px !important}
      #chat-form{padding:14px 16px !important}
      #chat-input-textarea{font-size:.9rem !important;min-height:44px !important}}
    </style>
  </head><body>${pagesHTML}
  <script>
    function fitPagesToScreen(){
      var vw=document.documentElement.clientWidth, pageWidth=${PDF_LAYOUT.width}, pageHeight=${PDF_LAYOUT.height};
      var horizontalPad=vw<=850?16:80, available=Math.max(1,vw-horizontalPad);
      var scale=Math.min(1,Math.max(0.1,available/pageWidth));
      document.querySelectorAll('.pdf-page-wrap').forEach(function(wrap){
        var page=wrap.querySelector('.pdf-page'); if(!page)return;
        page.style.transform='scale('+scale+')';
        page.style.transformOrigin='top left';
        wrap.style.width=(pageWidth*scale)+'px'; wrap.style.height=(pageHeight*scale)+'px';
      });
    }
    function shrinkKatexToFit(){document.querySelectorAll('.katex-display').forEach(function(d){d.style.overflow='visible';var w=d.closest('.katex-eq')||d.parentElement;if(w){w.style.overflow='visible';w.style.background='transparent';w.style.border='none';w.style.boxShadow='none'}var a=(w&&w.clientWidth)||d.clientWidth,c=d.scrollWidth;if(a>0&&c>a+1){var r=Math.max(.4,Math.min(a/c,1)),b=parseFloat(getComputedStyle(d).fontSize)||16;d.style.fontSize=(b*r)+'px'}})}
    var readySent=false;
    function notifyPrintReady(){if(readySent)return;readySent=true;shrinkKatexToFit();requestAnimationFrame(function(){try{parent.postMessage('pdf-iframe-ready','*')}catch(e){}})}
    fitPagesToScreen(); window.addEventListener('resize',function(){requestAnimationFrame(fitPagesToScreen)}); window.addEventListener('orientationchange',function(){requestAnimationFrame(fitPagesToScreen)});
    if(document.fonts&&document.fonts.ready) document.fonts.ready.then(notifyPrintReady).catch(notifyPrintReady); else window.addEventListener('load',notifyPrintReady);
    window.addEventListener('load',notifyPrintReady,{once:true});
  <\/script></body></html>`;
}

// ===== COMPUTE TRUE PDF PAGES =====
async function computeTruePDFPages(htmlOverride) {
  const isExam = document.body.classList.contains('exam-document');
  const rawHtml = htmlOverride !== undefined ? htmlOverride : (typeof getAllCanvasHTML === 'function' ? getAllCanvasHTML() : '');

  const container = document.getElementById('document-view-container');
  if (isExam && htmlOverride === undefined && container) {
    const offscreen = document.createElement('div');
    offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_LAYOUT.width}px;pointer-events:none;visibility:hidden;z-index:-1;`;
    document.body.appendChild(offscreen);
    const sourcePages = Array.from(container.querySelectorAll('.doc-page-canvas'));
    const pageEls = sourcePages.map(source => {
      const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(offscreen) : null;
      if (page) {
        page.classList.add('exam-document');
        page.innerHTML = source.innerHTML;
      }
      return page;
    }).filter(Boolean);
    if (!pageEls.length && typeof createPDFMeasurePage === 'function') {
      pageEls.push(createPDFMeasurePage(offscreen));
    }
    await Promise.all(pageEls.map(el => typeof waitForPDFLayoutStable === 'function' ? waitForPDFLayoutStable(el) : Promise.resolve()));
    return {
      offscreen,
      pages: pageEls.map(el => ({
        el,
        html: el.innerHTML,
        overflow: typeof pageFits === 'function' ? !pageFits(el) : false,
        brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
        brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
      })).filter(p => p.html && p.html.trim())
    };
  }

  const offscreen = document.createElement('div');
  offscreen.style.cssText = `position:fixed;left:-10000px;top:0;width:${PDF_LAYOUT.width}px;pointer-events:none;visibility:hidden;z-index:-1;`;
  document.body.appendChild(offscreen);

  const tempSource = document.createElement('div');
  tempSource.innerHTML = typeof processMathEquationsToHTML === 'function' ? processMathEquationsToHTML(typeof sanitizeHTML === 'function' ? sanitizeHTML(rawHtml) : rawHtml) : rawHtml;
  const topLevelNodes = typeof flattenContentTopLevelNodes === 'function' ? flattenContentTopLevelNodes(tempSource) : Array.from(tempSource.childNodes);

  const pageEls = [];
  const createPage = () => {
    const page = typeof createPDFMeasurePage === 'function' ? createPDFMeasurePage(offscreen) : null;
    if (page) pageEls.push(page);
    return page;
  };

  let currentPage = createPage();
  for (let i = 0; i < topLevelNodes.length; i++) {
    if (typeof appendNodeWithPagination === 'function') {
      currentPage = await appendNodeWithPagination(topLevelNodes[i], currentPage, createPage);
    }
    if (i % (typeof isMobilePreviewMode === 'function' && isMobilePreviewMode() ? 2 : 6) === 5) await new Promise(r => setTimeout(r, 0));
  }

  await Promise.all(pageEls.map(el => typeof waitForPDFLayoutStable === 'function' ? waitForPDFLayoutStable(el) : Promise.resolve()));

  const pages = pageEls.map(el => ({
    el,
    html: el.innerHTML,
    overflow: typeof pageFits === 'function' ? !pageFits(el) : false,
    brokenEquations: typeof findBrokenEquations === 'function' ? findBrokenEquations(el) : [],
    brokenDiagrams: typeof findBrokenDiagrams === 'function' ? findBrokenDiagrams(el) : []
  })).filter(p => p.html && p.html.trim());

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
    p.overflow = p.el.scrollHeight > PDF_LAYOUT.height;
    p.html = p.el.innerHTML;
    if (extraPages && extraPages.length) {
      const extraEntries = extraPages.map(el => ({
        el,
        html: el.innerHTML,
        overflow: el.scrollHeight > PDF_LAYOUT.height,
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

  if (tabName === 'editor') {
    if (docView) docView.style.display = 'flex';
    if (toolbar) toolbar.style.display = 'flex';
    if (pdfView) pdfView.style.display = 'none';
    if (typeof requestAnimationFrame === 'function') {
      requestAnimationFrame(() => { if (typeof fitEditorPagesToScreen === 'function') fitEditorPagesToScreen(); });
    }
  } else {
    if (docView) docView.style.display = 'none';
    if (toolbar) toolbar.style.display = 'none';
    if (pdfView) pdfView.style.display = 'flex';
    if (typeof generateLivePDFIframePreview === 'function') generateLivePDFIframePreview();
  }
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
  const shrinkSteps = steps || [1, 0.94, 0.88, 0.82, 0.76, 0.7];
  for (const scale of shrinkSteps) {
    wrapper.style.fontSize = (scale * 100) + '%';
    wrapper.style.lineHeight = String(1.6 * Math.max(scale, 0.85));
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

// ===== APPEND NODE WITH PAGINATION =====
async function appendNodeWithPagination(node, currentPage, createPage) {
  if (node.nodeType === Node.TEXT_NODE) {
    if (!node.textContent.trim()) return currentPage;
    const wrapper = document.createElement('p');
    wrapper.textContent = node.textContent.trim();
    const result = await splitPlainTextElement(wrapper, currentPage, createPage);
    return result.page;
  }
  if (node.nodeType !== Node.ELEMENT_NODE) return currentPage;
  if (node.classList && node.classList.contains('manual-page-break')) {
    return pageHasContent(currentPage) ? createPage() : currentPage;
  }

  const testClone = appendClone(currentPage, node);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(testClone);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(testClone);
  await waitForImagesToLoad(testClone);
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(testClone);

  if (pageFits(currentPage)) return currentPage;

  currentPage.removeChild(testClone);

  if (node.classList && node.classList.contains('quiz-container')) {
    if (pageHasContent(currentPage)) currentPage = createPage();
    return (await splitQuizContainer(node, currentPage, createPage)).page;
  }

  if (/^(UL|OL)$/i.test(node.tagName)) {
    if (pageHasContent(currentPage)) currentPage = createPage();
    return (await splitListElement(node, currentPage, createPage)).page;
  }

  const childElements = Array.from(node.children || []);
  const hasOnlyText = childElements.length === 0;
  const isBreakableText = /^(P|LI|BLOCKQUOTE|PRE|CODE)$/i.test(node.tagName);
  if (hasOnlyText && isBreakableText) {
    if (pageHasContent(currentPage)) currentPage = createPage();
    return (await splitPlainTextElement(node, currentPage, createPage)).page;
  }

  if (childElements.length && !/^(IMG|SVG|CANVAS|TABLE|HR)$/i.test(node.tagName)) {
    if (pageHasContent(currentPage)) currentPage = createPage();
    return (await splitChildFlowElement(node, currentPage, createPage)).page;
  }

  if (pageHasContent(currentPage)) currentPage = createPage();
  const finalClone = appendClone(currentPage, node);
  if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(finalClone);
  if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(finalClone);
  await waitForImagesToLoad(finalClone);
  if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(finalClone);
  return currentPage;
}

function pageHasContent(page) {
  return Array.from(page.childNodes).some(n => {
    if (n.nodeType === Node.TEXT_NODE) return !!n.textContent.trim();
    if (n.nodeType !== Node.ELEMENT_NODE) return false;
    return !n.classList.contains('page-footer-number') || n.textContent.trim();
  });
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

async function splitPlainTextElement(node, currentPage, createPage) {
  const words = (node.textContent || '').trim().split(/\s+/).filter(Boolean);
  if (!words.length) return { page: currentPage, didSplit: false };

  let page = currentPage;
  let chunk = cloneElementShell(node);
  page.appendChild(chunk);
  let text = '';
  let didSplit = false;

  for (let i = 0; i < words.length; i++) {
    const candidate = text ? `${text} ${words[i]}` : words[i];
    chunk.textContent = candidate;
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(chunk);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(chunk);
    await waitForImagesToLoad(chunk);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(chunk);
    if (!pageFits(page)) {
      if (!text) {
        text = candidate;
        break;
      }
      chunk.textContent = text;
      page = createPage();
      chunk = cloneElementShell(node);
      page.appendChild(chunk);
      text = words[i];
      chunk.textContent = text;
      didSplit = true;
    } else {
      text = candidate;
    }
  }
  return { page, didSplit };
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
      list = cloneElementShell(node);
      page.appendChild(list);
      list.appendChild(itemClone);
      didSplit = true;
    }
  }
  return { page, didSplit };
}

async function splitQuizContainer(node, currentPage, createPage) {
  const items = Array.from(node.querySelectorAll(':scope > .quiz-item'));
  if (!items.length) return { page: currentPage, didSplit: false };
  let page = currentPage;
  let quiz = null;
  let didSplit = false;

  const startQuiz = () => {
    quiz = cloneElementShell(node);
    page.appendChild(quiz);
    quiz.innerHTML = '';
  };
  if (!quiz) startQuiz();

  for (const item of items) {
    const itemClone = item.cloneNode(true);
    quiz.appendChild(itemClone);
    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(itemClone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(itemClone);
    await waitForImagesToLoad(itemClone);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(itemClone);

    if (pageFits(page)) continue;

    quiz.removeChild(itemClone);
    if (pageHasContent(page)) {
      page = createPage();
      startQuiz();
      quiz.appendChild(itemClone);
      didSplit = true;
    } else {
      quiz.appendChild(itemClone);
    }

    if (typeof processMathEquationsInContainer === 'function') processMathEquationsInContainer(itemClone);
    if (typeof renderAllKatexVisuals === 'function') renderAllKatexVisuals(itemClone);
    await waitForImagesToLoad(itemClone);
    if (typeof shrinkOverflowingKatexEquations === 'function') shrinkOverflowingKatexEquations(itemClone);
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
      shell = cloneElementShell(node);
      page.appendChild(shell);
      shell.appendChild(childClone);
      didSplit = true;
    }
  }
  return { page, didSplit };
  // ============================================================
// WINDOW EXPOSURE – PDF Export
// ============================================================
window.exportToHighQualityPDF = exportToHighQualityPDF;
window.exportToImagePDF = exportToImagePDF;
window.exportToWordDocument = exportToWordDocument;
window.generateLivePDFIframePreview = generateLivePDFIframePreview;
window.invalidatePDFPreviewCache = invalidatePDFPreviewCache;
}
