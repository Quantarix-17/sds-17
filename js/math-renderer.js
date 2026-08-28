// ========================================================================
// MATH RENDERER - KaTeX equation processing and rendering
// Fixed: custom macros with correct syntax, improved fallback
// ========================================================================

// ===== CUSTOM KATEX MACROS (CORRECTED) =====
// Keys must be WITHOUT backslash (e.g., "extker" not "\\extker")
function getCustomKaTeXMacros() {
    return {
        // Linear algebra / extension notation (user-requested)
        "extker": "\\operatorname{ext\\,ker}",
        "extrange": "\\operatorname{ext\\,range}",
        "ext": "\\operatorname{ext}",
        
        // Common math operators (optional but safe)
        "R": "\\mathbb{R}",
        "C": "\\mathbb{C}",
        "Q": "\\mathbb{Q}",
        "Z": "\\mathbb{Z}",
        "N": "\\mathbb{N}",
        "F": "\\mathbb{F}",
        "K": "\\mathbb{K}",
        "P": "\\mathbb{P}",
        "E": "\\mathbb{E}",
        "V": "\\mathbb{V}",
        "U": "\\mathbb{U}",
        "O": "\\mathcal{O}",
        "I": "\\mathcal{I}",
        "J": "\\mathcal{J}",
        "L": "\\mathcal{L}",
        "M": "\\mathcal{M}",
        "S": "\\mathcal{S}",
        "T": "\\mathcal{T}",
        "W": "\\mathcal{W}",
        "X": "\\mathcal{X}",
        "Y": "\\mathcal{Y}"
    };
}

// ===== KNOWN LATEX COMMAND CHECK =====
// Used to distinguish real LaTeX commands (\frac, \alpha, ...) from
// escape-sequence artifacts (\n, \t, \r) and plain text during cleanup.
const KNOWN_LATEX_COMMANDS = new Set([
    // fractions / binomials
    'frac', 'dfrac', 'tfrac', 'cfrac', 'binom', 'dbinom', 'tbinom',
    // roots
    'sqrt',
    // big operators
    'sum', 'prod', 'coprod', 'int', 'iint', 'iiint', 'oint',
    'bigcup', 'bigcap', 'bigoplus', 'bigotimes', 'bigvee', 'bigwedge',
    // limits / named functions
    'lim', 'limsup', 'liminf', 'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
    'sinh', 'cosh', 'tanh', 'coth', 'log', 'ln', 'exp', 'max', 'min',
    'sup', 'inf', 'det', 'dim', 'ker', 'deg', 'gcd', 'arg', 'Pr',
    // accents
    'vec', 'bar', 'hat', 'dot', 'ddot', 'tilde', 'widehat', 'widetilde',
    'overline', 'underline', 'overrightarrow', 'overleftarrow', 'overbrace', 'underbrace',
    // relations
    'leq', 'geq', 'neq', 'ne', 'approx', 'equiv', 'sim', 'simeq', 'cong',
    'propto', 'parallel', 'perp', 'll', 'gg',
    'subset', 'subseteq', 'supset', 'supseteq', 'in', 'notin', 'ni',
    'cup', 'cap', 'setminus', 'emptyset', 'varnothing',
    // arrows
    'to', 'rightarrow', 'leftarrow', 'leftrightarrow', 'Rightarrow',
    'Leftarrow', 'Leftrightarrow', 'mapsto', 'implies', 'iff', 'longrightarrow', 'longleftarrow',
    // logic
    'forall', 'exists', 'neg', 'lnot', 'wedge', 'vee', 'land', 'lor',
    // misc symbols
    'infty', 'partial', 'nabla', 'angle', 'triangle', 'circ', 'bullet',
    'star', 'ast', 'pm', 'mp', 'times', 'cdot', 'div',
    'oplus', 'ominus', 'otimes', 'oslash', 'odot',
    'top', 'bot', 'aleph', 'hbar', 'ell', 'wp', 'Re', 'Im', 'prime', 'dagger', 'ddagger',
    // greek (lowercase)
    'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta',
    'eta', 'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu',
    'xi', 'omicron', 'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma',
    'tau', 'upsilon', 'phi', 'varphi', 'chi', 'psi', 'omega',
    // greek (uppercase)
    'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon',
    'Phi', 'Psi', 'Omega',
    // text / formatting / sizing
    'text', 'mathrm', 'mathbf', 'mathit', 'mathsf', 'mathtt', 'mathcal',
    'mathbb', 'mathfrak', 'mathscr', 'boldsymbol', 'operatorname',
    'left', 'right', 'big', 'Big', 'bigg', 'Bigg',
    'quad', 'qquad', 'displaystyle', 'textstyle', 'scriptstyle', 'scriptscriptstyle',
    'cdots', 'ldots', 'vdots', 'ddots', 'dots',
    'pmod', 'bmod', 'not',
    // custom macros defined in getCustomKaTeXMacros()
    'ext', 'extker', 'extrange'
]);

function isKnownLatexCommand(cmd) {
    if (!cmd) return false;
    return KNOWN_LATEX_COMMANDS.has(String(cmd));
}

// ===== KATEX READY HELPER =====
function isKatexReady() {
    return typeof katex !== 'undefined' && typeof katex.render === 'function';
}

function waitForKatex(maxMs) {
    if (isKatexReady()) return Promise.resolve(true);
    const budget = Math.max(200, Number(maxMs) || 4000);
    const start = Date.now();
    return new Promise(resolve => {
        const tick = () => {
            if (isKatexReady()) return resolve(true);
            if (Date.now() - start >= budget) return resolve(false);
            setTimeout(tick, 40);
        };
        tick();
    });
}

// ===== PROCESS MATH EQUATIONS IN CONTAINER =====
function processMathEquationsInContainer(container) {
    if (!container) return;
    normalizeAIHTMLTextArtifacts(container);
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
        acceptNode(node) {
            if (!node.nodeValue || (node.parentElement && node.parentElement.closest('.katex-eq, .katex, script, style, textarea, input')))
                return NodeFilter.FILTER_REJECT;
            return NodeFilter.FILTER_ACCEPT;
        }
    });
    const textNodes = [];
    let node;
    while ((node = walker.nextNode())) textNodes.push(node);

    const delimiterRegex = /(\$\$[\s\S]*?\$\$|\\\[[\s\S]*?\\\]|\$[\s\S]*?\$|\\\([\s\S]*?\\\)|\\begin\{[A-Za-z*]+\}[\s\S]*?\\end\{[A-Za-z*]+\})/g;
    // Include custom commands in bare math detection
    // BUG FIX: this used to be `(?:\\...\b)[^\n]{0,260}` followed by a lookahead
    // for the *next* delimiter/punctuation. Because the `[^\n]{0,260}` quantifier
    // is greedy, the regex engine attempts the longest possible match first and
    // only backtracks until the lookahead is satisfied — and since ordinary
    // English prose contains spaces/punctuation every few characters, it would
    // almost always backtrack only as far as the LAST qualifying delimiter within
    // the 260-char window, not the first one after the command. In practice this
    // meant a single recognized command anywhere in a sentence (e.g. "\text",
    // "\sin", "\left") would swallow the rest of that sentence — and often the
    // next one too — into a single KaTeX span, rendering entire paragraphs as
    // broken/garbled math instead of the intended short expression.
    // FIX: instead of "command + free text until some later delimiter", match
    // the command plus only its actual brace-delimited argument(s), e.g.
    // \text{ mL}, \frac{a}{b}, \sqrt{x+1}, \operatorname{ext ker}. This correctly
    // captures commands with arguments containing spaces/punctuation (which a
    // naive "stop at first delimiter" lazy-quantifier fix would truncate too
    // early) while never spilling over into surrounding prose.
    const bareMathRegex = /(?:^|[\s(:=;,-])(\\(?:frac|dfrac|tfrac|sqrt|sum|int|lim|vec|bar|hat|dot|cdot|times|leq|geq|neq|approx|infty|alpha|beta|gamma|delta|theta|lambda|mu|sigma|pi|sin|cos|tan|log|ln|left|right|text|mathrm|mathbf|mathbb|ext|extker|extrange|operatorname)\b(?:\s*\{[^{}]*\}){0,4})/g;

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
                // NOTE: text.slice(last, absoluteStart) already includes the leading
                // delimiter char(s) captured by the regex (space, "(", ":", "-", etc.),
                // so re-appending full.slice(0, exprStart) here duplicated that
                // character (e.g. produced "  x=5" or "((x=5" around bare math).
                if (absoluteStart > last) fragment.appendChild(document.createTextNode(text.slice(last, absoluteStart)));
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
        if (textNode.parentNode) textNode.parentNode.replaceChild(fragment, textNode);
    });
}

// ===== MATH ARTIFACT REPAIR =====
function repairVisibleEscapeSequencesInText(text) {
    let value = String(text || '');
    // Collapse a literal escaped CRLF ("\r\n" as two chars, not a real newline)
    // into an actual newline.
    value = value.replace(/\\r\\n/g, '\n');
    // Collapse double-escaped \\n \\r \\t (from JSON/AI double-escaping) down to
    // a single backslash form, but only defer the decision to the whitelist
    // check below — never strip here.
    value = value.replace(/\\\\([nrt])(?=[A-Za-z])/g, '\\$1');
    // PERMANENT FIX: previously there was an extra unconditional pass here
    // (`.replace(/\\r/g, '\n').replace(/\\t/g, '\t')`) that stripped every
    // literal "\r" / "\t" BEFORE the known-LaTeX-command check below ever ran.
    // That silently destroyed the backslash on every real command starting
    // with r/t — \text, \times, \right, \rightarrow, \tan, \theta, \tau,
    // \tilde, \to, \triangle, \tfrac, \tbinom, etc. — turning "\text{ mL}"
    // into a tab character followed by "ext{ mL}", which is exactly the
    // "ext{...}" / "imes" / "ightarrow" / "ight)" corruption seen in KaTeX
    // fallback boxes. All n/t/r escape-artifact handling now goes through the
    // single whitelist-aware pass below, so no known LaTeX command is ever
    // mistaken for a stray escape sequence.
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
    // Collapse accidental double-escaping from JSON / AI output, but keep real commands
    value = value.replace(/\\\\([a-zA-Z]+)/g, '\\$1');
    value = value.replace(/\\\\/g, '\\');
    value = value.replace(/^\$\$([\s\S]*?)\$\$$/, '$1').trim();
    value = value.replace(/^\\\[([\s\S]*?)\\\]$/, '$1').trim();
    value = value.replace(/^\$([\s\S]*?)\$$/, '$1').trim();
    value = value.replace(/^\\\(([\s\S]*?)\\\)$/, '$1').trim();
    // Common AI artifacts
    value = value.replace(/\\operatorname\s*\{/g, '\\operatorname{');
    value = value.replace(/\u00a0/g, ' ');
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

// ===== SPAN STATE HELPERS =====
function isKatexSpanBroken(spanElement) {
    if (!spanElement) return true;
    if (spanElement.classList.contains('katex-render-failed')) return true;
    if (spanElement.getAttribute('data-render-pending') === 'true') return true;
    if (spanElement.querySelector('.katex-error')) return true;
    if (!spanElement.querySelector('.katex')) return true;
    return false;
}

function showLatexFallback(spanElement, latexString) {
    if (!spanElement) return;
    const isDisplay = spanElement.getAttribute('data-display') === 'true';
    spanElement.innerHTML = '';
    const fallback = document.createElement(isDisplay ? 'div' : 'span');
    fallback.className = 'katex-fallback';
    fallback.style.cssText = isDisplay
        ? 'font-family:Cambria Math,STIX Two Math,serif;font-style:italic;text-align:center;padding:4px 0;color:inherit;opacity:0.92;'
        : 'font-family:Cambria Math,STIX Two Math,serif;font-style:italic;color:inherit;opacity:0.92;';
    fallback.textContent = latexString || spanElement.getAttribute('data-latex') || '';
    spanElement.appendChild(fallback);
}

// ===== KATEX RENDERING WITH MACROS (CORRECTED) =====
function renderKatexSpanWithRecovery(spanElement, force = false) {
    if (!spanElement) return false;
    if (!isKatexReady()) {
        spanElement.setAttribute('data-render-pending', 'true');
        return false;
    }

    const original = normalizeEquationLatexSource(spanElement.getAttribute('data-latex') || '');
    if (!original) {
        spanElement.classList.add('katex-render-failed');
        return false;
    }

    // Skip if already healthy and not forced
    if (!force && !isKatexSpanBroken(spanElement)) return true;

    const isDisplayMode = spanElement.getAttribute('data-display') === 'true';
    const candidates = [];
    const push = v => {
        const x = String(v || '').trim();
        if (x && !candidates.includes(x)) candidates.push(x);
    };
    push(original);
    push(original.replace(/\\displaystyle\s*/g, ''));
    push(original.replace(/\\left\s*/g, '\\left').replace(/\\right\s*/g, '\\right'));
    push(original.replace(/\\dfrac/g, '\\frac').replace(/\\tfrac/g, '\\frac'));
    push(original.replace(/\\left\b/g, '').replace(/\\right\b/g, ''));
    if (/^\{[\s\S]+\}$/.test(original)) push(original.slice(1, -1));

    // Get custom macros (keys WITHOUT backslash)
    const macros = getCustomKaTeXMacros();

    for (const latexString of candidates) {
        try {
            spanElement.innerHTML = '';
            katex.render(latexString, spanElement, {
                throwOnError: false,
                displayMode: isDisplayMode,
                trust: true,
                strict: 'ignore',
                output: 'htmlAndMathml',
                macros: macros  // <-- CORRECT: macros object with keys without backslash
            });
            if (spanElement.querySelector('.katex') && !spanElement.querySelector('.katex-error')) {
                spanElement.setAttribute('data-latex', latexString);
                spanElement.classList.remove('katex-render-failed');
                spanElement.removeAttribute('data-render-pending');
                return true;
            }
        } catch (e) {
            console.warn('[KaTeX] render attempt failed:', latexString, e);
        }
    }

    // All candidates failed — keep latex visible as fallback
    spanElement.classList.add('katex-render-failed');
    spanElement.setAttribute('data-render-pending', 'true');
    showLatexFallback(spanElement, original);
    return false;
}

function renderAllKatexVisuals(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return;
    if (!isKatexReady()) {
        containerElement.querySelectorAll('.katex-eq').forEach(span => {
            if (isKatexSpanBroken(span)) span.setAttribute('data-render-pending', 'true');
        });
        return;
    }
    containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
        if (isKatexSpanBroken(spanElement)) {
            renderKatexSpanWithRecovery(spanElement, true);
        }
    });
}

function forceRenderAllKatexVisuals(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return;
    if (!isKatexReady()) {
        containerElement.querySelectorAll('.katex-eq').forEach(span => {
            span.setAttribute('data-render-pending', 'true');
        });
        return;
    }
    containerElement.querySelectorAll('.katex-eq').forEach(spanElement => {
        renderKatexSpanWithRecovery(spanElement, true);
    });
}

// ===== FIND BROKEN DIAGRAMS =====
function findBrokenDiagrams(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return [];
    const broken = [];
    containerElement.querySelectorAll('.fc-wrapper').forEach((wrapper, i) => {
        const svg = wrapper.querySelector('svg.fc-svg, svg');
        const hasDrawable = !!(svg && svg.querySelector('rect, circle, ellipse, line, path, polyline, polygon, text, image, foreignObject'));
        if (!svg || !hasDrawable) broken.push(wrapper.getAttribute('data-diagram-id') || ('diagram_' + i));
    });
    return broken;
}

function ensureAllPagesMathRendered() {
    forceRenderAllEquations();
}

function findBrokenEquations(containerElement) {
    if (!containerElement || typeof containerElement.querySelectorAll !== 'function') return [];
    return Array.from(containerElement.querySelectorAll('.katex-eq')).filter(eq =>
        isKatexSpanBroken(eq)
    ).map(eq => eq.getAttribute('data-latex') || '').filter(Boolean);
}

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

function forceRenderAllEquations() {
    const docContainer = document.getElementById('document-view-container');
    if (!docContainer) return;

    const run = () => {
        const pages = Array.from(docContainer.querySelectorAll('.doc-page-canvas'));
        pages.forEach(page => {
            processMathEquationsInContainer(page);
        });

        for (let pass = 0; pass < 4; pass++) {
            pages.forEach(page => {
                forceRenderAllKatexVisuals(page);
                shrinkOverflowingKatexEquations(page);
            });
        }

        const broken = findBrokenEquations(docContainer);
        if (broken.length) {
            console.warn(`[KaTeX] ${broken.length} equation(s) still need recovery.`);
            docContainer.querySelectorAll('.katex-eq').forEach(eq => {
                if (isKatexSpanBroken(eq)) {
                    const latex = normalizeEquationLatexSource(eq.getAttribute('data-latex') || '');
                    if (latex) {
                        eq.setAttribute('aria-label', latex);
                        if (!eq.querySelector('.katex') && !eq.querySelector('.katex-fallback')) {
                            showLatexFallback(eq, latex);
                        }
                    }
                }
            });
        }
    };

    if (isKatexReady()) {
        run();
    } else {
        waitForKatex(5000).then(ok => {
            if (ok) run();
            else console.warn('[KaTeX] library not available after wait; equations left pending.');
        });
    }
}

let _equationRecoveryTimer = null;
function scheduleEquationRecovery(delayMs) {
    clearTimeout(_equationRecoveryTimer);
    _equationRecoveryTimer = setTimeout(() => {
        try {
            forceRenderAllEquations();
        } catch (e) {
            console.warn('[KaTeX] scheduled recovery failed:', e);
        }
    }, Math.max(0, Number(delayMs) || 120));
}

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
window.forceRenderAllKatexVisuals = forceRenderAllKatexVisuals;
window.processMathEquationsToHTML = processMathEquationsToHTML;
window.convertKatexSpansToLatexSource = convertKatexSpansToLatexSource;
window.shrinkOverflowingKatexEquations = shrinkOverflowingKatexEquations;
window.prepareEquationsForPDF = prepareEquationsForPDF;
window.normalizeAIHTMLTextArtifacts = normalizeAIHTMLTextArtifacts;
window.findBrokenEquations = findBrokenEquations;
window.findBrokenDiagrams = findBrokenDiagrams;
window.ensureAllPagesMathRendered = ensureAllPagesMathRendered;
window.repairVisibleEscapeSequencesInText = repairVisibleEscapeSequencesInText;
window.scheduleEquationRecovery = scheduleEquationRecovery;
window.isKatexReady = isKatexReady;
window.waitForKatex = waitForKatex;
window.isKatexSpanBroken = isKatexSpanBroken;
window.getCustomKaTeXMacros = getCustomKaTeXMacros;
window.isKnownLatexCommand = isKnownLatexCommand;
