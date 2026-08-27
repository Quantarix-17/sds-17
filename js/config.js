// ========================================================================
// CONFIGURATION
// ========================================================================

const APP_CONFIG = {
  TEMPERATURE: 0.3,
  
  PDF_TOKEN_BUDGETS: Object.freeze({
    SHORT: 40000,
    DEFAULT_SINGLE: 32000,
    STANDARD_BATCH: 14000,
    LONG_BATCH: 16000,
    LONG_DIRECT: 64000,
    EXPANSION: 12000,
    BEAUTIFY: 64000
  }),

  DEFAULT_SINGLE_MAX_PAGES: 8,
  DEFAULT_SECTIONED_MIN_PAGES: 9,
  STEP_MODE_STANDARD_MIN_SECTIONS: 2,
  STEP_MODE_STANDARD_MAX_SECTIONS: 24,
  STEP_MODE_SHORT_MIN_SECTIONS: 2,
  STEP_MODE_SHORT_MAX_SECTIONS: 8,
  STEP_MODE_SECTIONS_PER_BATCH: 1,
  STEP_MODE_BATCH_DELAY_MS: 0,
  LONG_PDF_MIN_SECTIONS: 10,
  LONG_PDF_MAX_SECTIONS: 24,
  LONG_PDF_SECTIONS_PER_BATCH: 1,
  LONG_PDF_MIN_PAGES: 20,
  LONG_PDF_MAX_PAGES_SOFT: 50,
  LONG_PDF_MAX_PAGES_HARD: 52,

  OCR_LANGS: 'ben+eng',
  OCR_RENDER_SCALE: 2.0,
  OCR_MIN_TEXT_LEN_PER_PAGE: 25,
  OCR_MIN_TEXT_ITEMS_PER_PAGE: 5,
  OCR_MAX_PARALLEL_WORKERS: Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 4) - 1)),
  OCR_HIGH_ACCURACY_PASSES: 4,
  OCR_MAX_IMAGE_PIXELS: 18000000,
  OCR_TARGET_LONG_EDGE: 4200,
  OCR_SMALL_TEXT_SCALE: 3.2,
  OCR_MIN_CONFIDENCE_FOR_SINGLE_PASS: 82,
  OCR_MAX_ATTEMPTS_PER_PASS: 1,
  OCR_PASS_TIMEOUT_MS: 5000,
  OCR_PDF_PAGE_TIMEOUT_MS: 4500,
  OCR_FAST_TRIAGE_TIMEOUT_MS: 2200,
  OCR_FAST_TRIAGE_PASSES: 2,
  OCR_MAX_TOTAL_PASSES: 4,
  ATTACHMENT_MAX_TEXT_CHARS: 100000,

  SINGLE_SHOT_ESTIMATED_SECONDS: 16,
  PLAN_MAX_OUTPUT_TOKENS: 1800,
  ROUTER_MAX_OUTPUT_TOKENS: 1200,
  CONTINUATION_MAX_LOOPS: 8,
  LONG_EXPANSION_MAX_ROUNDS: 6
};

// ========================================================================
// PDF LAYOUT CONSTANTS
// ========================================================================

const PDF_LAYOUT = Object.freeze({
  width: 794,
  height: 1123,
  padTop: 62,
  padRight: 58,
  padBottom: 58,
  padLeft: 58,
  footerBottom: 22,
  gap: 30,
  contentWidth: 794 - 58 - 58,
  contentHeight: 1123 - 62 - 58
});

const EDITOR_A4_WIDTH = 794;
const EDITOR_A4_HEIGHT = 1123;
const EDITOR_A4_CONTENT_HEIGHT = 1000;
const EDITOR_A4_FIT_STEPS = [1, 0.97, 0.94, 0.91, 0.88, 0.85, 0.82, 0.78, 0.74];

// ========================================================================
// AI THINKING POLICY
// ========================================================================

const THINKING_POLICY = Object.freeze({
  MAX_CYCLES: 3,
  MAX_ATTEMPTS_PER_MODEL: 1,
  MAX_LOCAL_RETRIES: 0,
  LOCAL_RETRY_DELAY_MS: 700
});

const THINKING_COOLDOWN_MS = 60000;

// ========================================================================
// STORAGE KEYS
// ========================================================================

const TAB_STORAGE_KEY = 'aiDocTabs_v1';
const AI_MODELS_STORAGE_KEY = 'aiModelsConfig_v1';
const AI_MODEL_AUTOSWITCH_KEY = 'aiModelAutoSwitchEnabled_v1';
const OCR_PREFERRED_MODEL_ID_KEY = 'OCR_PREFERRED_MODEL_ID';
const PDF_VISUAL_FORMAT_KEY = 'aiPdfStudio.visualFormat';
const PDF_TEXT_FORMAT_KEY = 'aiPdfStudio.textFormat';
const STORAGE_KEY = 'aiDocProState_v22'; // legacy, kept for compatibility

// ========================================================================
// HELPER FUNCTIONS
// ========================================================================

function getPDFTokenBudget(lengthMode) {
  switch (lengthMode) {
    case 'short_pdf': return APP_CONFIG.PDF_TOKEN_BUDGETS.SHORT;
    case 'long_pdf': return APP_CONFIG.PDF_TOKEN_BUDGETS.LONG_BATCH;
    case 'standard': return APP_CONFIG.PDF_TOKEN_BUDGETS.STANDARD_BATCH;
    default: return APP_CONFIG.PDF_TOKEN_BUDGETS.DEFAULT_SINGLE;
  }
}

function getGenerationMaxTokens(lengthMode, singleShot = false) {
  if (!singleShot) return getPDFTokenBudget(lengthMode);
  if (lengthMode === 'short_pdf') return APP_CONFIG.PDF_TOKEN_BUDGETS.SHORT;
  if (lengthMode === 'long_pdf') return APP_CONFIG.PDF_TOKEN_BUDGETS.LONG_DIRECT;
  return APP_CONFIG.PDF_TOKEN_BUDGETS.DEFAULT_SINGLE;
}

function getDynamicSectionBatchSize(lengthMode, totalSections, estimatedPages = 0) {
  if (totalSections <= 0) return 1;
  return 1;
}

function isMobileDeviceLayout() {
  try {
    return window.matchMedia('(max-width: 850px) and (pointer: coarse)').matches ||
      (window.innerWidth <= 850 && Number(navigator.maxTouchPoints || 0) > 0);
  } catch (_) {
    return window.innerWidth <= 850;
  }
}

function isMobilePreviewMode() {
  return isMobileDeviceLayout();
}
