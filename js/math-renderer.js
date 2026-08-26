// ========================================================================
// MATH RENDERER - KaTeX equation processing and rendering
// ========================================================================

// ===== PROCESS MATH EQUATIONS IN CONTAINER =====
function processMathEquationsInContainer(container) {
  if (!container) return;
  normalizeAIHTMLTextArtifacts(container);
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      if (!node.nodeValue || (node.parentElement && node.parentElement.closest('.katex-eq, script, style, textarea, input')))
        return NodeFilter.FILTER_REJECT;
      return NodeFilter.FILTER_ACCEPT;
    }
  });
  const textNodes = [];
  let node;
  while ((node = walker.nextNode())) textNodes.push(node);

  const delimiterRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\})/g;
  const bareMathRegex = /(?:^|[\s(:=;,-])((?:\\(?:frac|dfrac|tfrac|sqrt|sum|int|lim|vec|bar|hat|dot|cdot|times|leq|geq|neq|approx|infty|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|sin|cos|tan|log|ln|left|right|text|mathrm|mathbf|mathbb)\b)[^\n]{0,260})(?=$|[\s.,;:!?)]|\n)/g;

  textNodes.forEach(textNode => {
    const text = textNode.nodeValue;
    if (!/[$\\√∑∫πθλµσΩαβγδ^=<>≤≥≠≈×÷]/.test(text)) return;

    let splitParts = text.split(delimiterRegex);
    const hasDelimitedMath = splitParts.length > 1;
    const hasRawLatex = /\\[A-Za-z]/.test(text);
    const hasBareMath = /(?:^|[\s])(?:[A-Za-z]\s*=|\d+\s*[+\-*/=])/.test(text) && /[=^√∑∫πθλµσΩαβγδ]/.test(text);
    if (!hasDelimitedMath && !hasRawLatex && !hasBareMath) return;

    const fragment = document.createDocumentFragment();

    if (hasDelimitedMath) {
      splitParts.forEach(part => {
        if (!part) return;
        if (part.startsWith('$$') || part.startsWith('\\[') || part.startsWith('\\begin{')) {
          let mathPart = part;
          if (part.startsWith('$$')) mathPart = part.replace(/^\$\$|\$\$$/g, '');
          else if (part.startsWith('\\[')) mathPart = part.replace(/^\\\[|\\\]$/g, '');
          fragment.appendChild(createKatexSpanElement(mathPart, true));
        } else if (part.startsWith('$') || part.startsWith('\\(')) {
          fragment.appendChild(createKatexSpanElement(part.replace(/^\$|^\\\(|\$|\\\)$/g, ''), false));
        } else {
          appendAutoWrappedLatex(fragment, part);
        }
      });
    } else {
      let last = 0;
      let matched = false;
      text.replace(bareMathRegex, (full, expr, offset) => {
        const exprStart = full.indexOf(expr);
        const absoluteStart = offset + Math.max(0, exprStart);
        if (absoluteStart > last) fragment.appendChild(document.createTextNode(text.slice(last, absoluteStart)));
        fragment.appendChild(document.createTextNode(full.slice(0, exprStart)));
        fragment.appendChild(createKatexSpanElement(expr.trim(), false));
        last = absoluteStart + expr.length;
        matched = true;
        return full;
      });
      if (!matched) {
        appendAutoWrappedLatex(fragment, text);
        last = text.length;
      } else if (last < text.length) {
        fragment.appendChild(document.createTextNode(text.slice(last)));
      }
    }
    textNode.parentNode.replaceChild(fragment, textNode);
  });
}

// ===== MATH ARTIFACT REPAIR =====
function repairVisibleEscapeSequencesInText(text) {
  let value = String(text || '');
  value = value.replace(/\\\\r\\\\n/g, '\n').replace(/\\\\n(?=[A-Za-z])/g, '\\n').replace(/\\\\r(?=[A-Za-z])/g, '\\r').replace(/\\\\t(?=[A-Za-z])/g, '\\t');
  value = value.replace(/\\r\\n/g, '\n').replace(/\\r/g, '\n').replace(/\\t/g, '\t');
  value = value.replace(/\\([A-Za-z]+)/g, (full, cmd) => {
    if (isKnownLatexCommand(cmd)) return full;
    if (cmd.startsWith('n')) return '\n' + cmd.slice(1);
    if (cmd.startsWith('t')) return '\t' + cmd.slice(1);
    if (cmd.startsWith('r')) return '\n' + cmd.slice(1);
    return full;
  });
  return value;
}

function normalizeAIHTMLTextArtifacts(root) {
  if (!root || typeof root.querySelectorAll !== 'function') return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (!parent || ['SCRIPT', 'STYLE'].includes(parent.tagName) || parent.closest('.katex, .katex-eq'))
        return NodeFilter.FILTER_REJECT;
      return /\\[nrt]/.test(node.nodeValue) || /\\[A-Za-z]+/.test(node.nodeValue) ?
        NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT;
    }
  });
  const nodes = [];
  let n;
  while ((n = walker.nextNode())) nodes.push(n);
  nodes.forEach(node => {
    const fixed = repairVisibleEscapeSequencesInText(node.nodeValue);
    if (fixed !== node.nodeValue) node.nodeValue = fixed;
  });

  root.querySelectorAll('.katex-eq').forEach(eq => {
    const latex = eq.getAttribute('data-latex') || '';
    if (/^\\n[A-Za-z][A-Za-z0-9]*(?:\s+[A-Za-z][A-Za-z0-9]*)*$/.test(latex)) {
      eq.replaceWith(document.createTextNode(latex.replace(/^\\n/, '').trim()));
    }
  });
}

function processMathEquationsToHTML(rawHtmlString) {
  if (!rawHtmlString) return '';
  const container = document.createElement('div');
  container.innerHTML = rawHtmlString;
  normalizeAIHTMLTextArtifacts(container);
  processMathEquationsInContainer(container);
  normalizeAIHTMLTextArtifacts(container);
  return container.innerHTML;
}

// ===== KATEX SPAN CREATION =====
function normalizeEquationLatexSource(latex) {
  let value = String(latex || '').trim();
  if (!value) return '';
  value = value.replace(/\\\\/g, '\\');
  value = value.replace(/^\$\$([\s\S]*?)\$\$$/, '$1').trim();
  value = value.replace(/^\\\[([\s\S]*?)\\\]$/, '$1').trim();
  value = value.replace(/^\$([\s\S]*?)\$$/, '$1').trim();
  value = value.replace(/^\\\(([\s\S]*?)\\\)$/, '$1').trim();
  return value;
}

function createKatexSpanElement(latex, isDisplayMode) {
  const span = document.createElement('span');
  span.className = 'katex-eq';
  span.setAttribute('data-latex', normalizeEquationLatexSource(latex));
  span.setAttribute('data-display', isDisplayMode ? 'true' : 'false');
  span.setAttribute('contenteditable', 'false');
  span.setAttribute('translate', 'no');
  span.setAttribute('spellcheck', 'false');
  return span;
}

const RAW_LATEX_COMMAND_REGEX = /\\([A-Za-z]+)/;
const MATH_CHARSET_RUN_REGEX = /[A-Za-z0-9+\-*/=<>≤≥.,;:(){}\[\]^_|'"~&×÷·°√∞≠≈∑∫πθλµσΩαβγδ\\ \t]+/g;

function appendAutoWrappedLatex(fragment, textPart) {
  let lastIndex = 0;
  textPart.replace(MATH_CHARSET_RUN_REGEX, (run, offset) => {
    const matches = Array.from(run.matchAll(/\\([A-Za-z]+)/g));
    const hasKnownCommand = matches.some(m => isKnownLatexCommand(m[1]));
    if (hasKnownCommand) {
      const trimmed = run.trim();
      if (trimmed) {
        const leadingWs = run.match(/^\s*/)[0];
        const trailingWs = run.match(/\s*$/)[0];
        if (offset > lastIndex) fragment.appendChild(document.createTextNode(textPart.slice(lastIndex, offset)));
        if (leadingWs) fragment.appendChild(document.createTextNode(leadingWs));
        fragment.appendChild(createKatexSpanElement(trimmed, false));
        if (trailingWs) fragment.appendChild(document.createTextNode(trailingWs));
        lastIndex = offset + run.length;
      }
    }
    return run;
  });
  if (lastIndex < textPart.length) fragment.appendChild(document.createTextNode(textPart.slice(lastIndex)));
}

// ===== KATEX RENDERING =====
function renderKatexSpanWithRecovery(spanElement, force = false) {
  if (typeof katex === 'undefined' || !spanElement) return false;
  const original = normalizeEquationLatexSource(spanElement.getAttribute('data-latex') || '');
  if (!original) return false;
  const isDisplayMode = spanElement.getAttribute('data-display') === 'true';
  const candidates = [];
  const push = v => { const x = String(v || '').trim(); if (x && !candidates.includes(x)) candidates.push(x); };
  push(original);
  push(original.replace(/\\displaystyle\s*/g, ''));
  push(original.replace(/\\left\s*/g, '\\left').replace(/\\right\s*/g, '\\right'));
  push(original.replace(/\\dfrac/g, '\\frac').replace(/\\tfrac/g, '\\frac'));

  for (const latexString of candidates) {
    try {
      if (force || !spanElement.querySelector('.katex')) spanElement.innerHTML = '';
      katex.render(latexString, spanElement, {
        throwOnError: false,
        displayMode: isDisplayMode,
        trust: true,
        strict: 'ignore',
        output: 'htmlAndMathml'
      });
      spanElement.setAttribute('data-latex', latexString);
      spanElement.classList.remove('katex-render-failed');
      return !!spanElement.querySelector('.katex');
    } catch (e) {
      console.warn('[KaTeX] render attempt failed:', latexString, e);
    }
  }
  spanElement.classList.add('katex-render-failed');
  spanElement.setAttribute('data-render-pending', 'true');
  spanElement.textContent = '';
  return false;
}

function renderAllKatexVisuals(containerElement) {
  if (typeof katex === 'undefined' || !containerElement || typeof containerElement.querySelectorAll !== 'function') return;
  containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
    if (!spanElement.querySelector('.katex')) renderKatexSpanWithRecovery(spanElement, false);
  });
}

function forceRenderAllKatexVisuals(containerElement) {
  if (typeof katex === 'undefined' || !containerElement || typeof containerElement.querySelectorAll !== 'function') return;
  containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
    renderKatexSpanWithRecovery(spanElement, true);
  });
}

// ===== FIND BROKEN EQUATIONS =====
function findBrokenEquations(containerElement) {
  if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return [];
  return Array.from(containerElement.querySelectorAll('.katex-eq')).filter(eq =>
    !eq.querySelector('.katex') || eq.querySelector('.katex-error')
  ).map(eq => eq.getAttribute('data-latex') || '').filter(Boolean);
}

// ===== SHRINK OVERFLOWING EQUATIONS =====
function shrinkOverflowingKatexEquations(rootEl) {
  if (!rootEl || typeof rootEl.querySelectorAll !== 'function') return;
  const displays = rootEl.querySelectorAll('.katex-display');
  displays.forEach(function(disp) {
    disp.style.fontSize = '';
    disp.style.overflow = 'visible';
    disp.style.overflowX = 'visible';
    disp.style.overflowY = 'visible';
    disp.style.scrollbarWidth = 'none';
    const wrapper = disp.closest('.katex-eq') || disp.parentElement;
    if (wrapper) {
      wrapper.style.overflow = 'visible';
      wrapper.style.background = 'transparent';
      wrapper.style.boxShadow = 'none';
      wrapper.style.border = 'none';
    }
    const available = (wrapper && wrapper.clientWidth) || disp.clientWidth;
    const content = disp.scrollWidth;
    if (available > 0 && content > available + 1) {
      let ratio = available / content;
      ratio = Math.max(0.4, Math.min(ratio, 1));
      const baseSize = parseFloat(window.getComputedStyle(disp).fontSize) || 16;
      disp.style.fontSize = (baseSize * ratio) + 'px';
    }
  });
}

// ===== PREPARE EQUATIONS FOR PDF =====
function prepareEquationsForPDF(rootEl) {
  if (!rootEl) return;
  rootEl.querySelectorAll('.katex-eq').forEach(function(eq) {
    eq.style.background = 'transparent';
    eq.style.border = 'none';
    eq.style.boxShadow = 'none';
    eq.style.overflow = 'visible';
  });
  rootEl.querySelectorAll('.katex-display').forEach(function(disp) {
    disp.style.overflow = 'visible';
    disp.style.overflowX = 'visible';
    disp.style.overflowY = 'visible';
    disp.style.scrollbarWidth = 'none';
    disp.style.maxWidth = '100%';
  });
  shrinkOverflowingKatexEquations(rootEl);
}

// ===== FORCE RENDER ALL EQUATIONS IN DOCUMENT =====
function forceRenderAllEquations() {
  const docContainer = document.getElementById('document-view-container');
  if (!docContainer) return;
  const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
  pages.forEach(page => {
    processMathEquationsInContainer(page);
  });
  for (let pass = 0; pass < 3; pass++) {
    pages.forEach(page => {
      renderAllKatexVisuals(page);
      if (page.querySelector('.katex-render-failed')) {
        page.querySelectorAll('.katex-render-failed').forEach(eq => renderKatexSpanWithRecovery(eq, true));
      }
      shrinkOverflowingKatexEquations(page);
    });
  }
  const broken = findBrokenEquations(docContainer);
  if (broken.length) {
    console.warn(`[KaTeX] ${broken.length} equation(s) still need recovery.`);
    docContainer.querySelectorAll('.katex-render-failed').forEach(eq => {
      const latex = normalizeEquationLatexSource(eq.getAttribute('data-latex') || '');
      if (latex) eq.setAttribute('aria-label', latex);
    });
  }
}

// ===== CONVERT KATEX SPANS TO LATEX SOURCE =====
function convertKatexSpansToLatexSource(htmlString) {
  const temp = document.createElement('div');
  temp.innerHTML = htmlString;
  temp.querySelectorAll('.katex-eq').forEach(eq => {
    const latex = eq.getAttribute('data-latex') || eq.textContent || '';
    const isDisplay = eq.getAttribute('data-display') === 'true';
    eq.parentNode.replaceChild(document.createTextNode(isDisplay ? `$$${latex}$$` : `$${latex}$`), eq);
  });
  return temp.innerHTML;
}

function getCanvasContentWithLatexSource() {
  const docContainer = document.getElementById('document-view-container');
  if (!docContainer) return '';
  let combinedHTML = '';
  Array.from(docContainer.querySelectorAll('.doc-page-canvas')).forEach(page => {
    const clone = page.cloneNode(true);
    clone.querySelectorAll('.page-footer-number').forEach(f => f.remove());
    combinedHTML += clone.innerHTML;
  });
  return convertKatexSpansToLatexSource(combinedHTML);
}
// ============================================================
// WINDOW EXPOSURE – Math Renderer
// ============================================================
window.processMathEquationsInContainer = processMathEquationsInContainer;
window.renderAllKatexVisuals = renderAllKatexVisuals;
window.forceRenderAllEquations = forceRenderAllEquations;
window.processMathEquationsToHTML = processMathEquationsToHTML;
window.convertKatexSpansToLatexSource = convertKatexSpansToLatexSource;
window.shrinkOverflowingKatexEquations = shrinkOverflowingKatexEquations;
window.prepareEquationsForPDF = prepareEquationsForPDF;
window.normalizeAIHTMLTextArtifacts = normalizeAIHTMLTextArtifacts;
window.findBrokenEquations = findBrokenEquations;
window.findBrokenDiagrams = findBrokenDiagrams;
window.enforceDiagramVisualStyles = enforceDiagramVisualStyles;
window.cleanupEmptyVisualContainers = cleanupEmptyVisualContainers;
window.ensureAllPagesMathRendered = ensureAllPagesMathRendered;
window.repairVisibleEscapeSequencesInText = repairVisibleEscapeSequencesInText;
