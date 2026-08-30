/**
 * Shared types for the in-browser detection port.
 *
 * These mirror the three Python detectors (britania_detector.py,
 * unified_detector_v2.py, detector.py) so that a page processed in the browser
 * produces exactly the legacy `{source, all_pages}` JSON shape the rest of the
 * app already imports. Do not rename fields here without renaming them in
 * src/lib/detectImport.ts too.
 */

export type AlgorithmName = 'britania' | 'glassworks' | 'super' | 'custom';

/** Shared S1 routing threshold: dark fills / all filled drawings above this
 * ratio marks a page as a britania-style plan. Used by the auto probe
 * (detector_pdf.probeBritaniaVectorSignals) AND the SUPER sniff, so the two
 * routers can never drift apart. */
export const BRITANIA_S1_DARK_RATIO = 0.8;

/** Shared S1 dark-fill definition: a normalized fill below this value counts
 * as "dark" for the S1 ratio. Pinned next to BRITANIA_S1_DARK_RATIO because
 * the same loop logic (normFill < 0.25 -> dark) is duplicated across the auto
 * probe and the SUPER sniff. */
export const BRITANIA_S1_DARK_FILL_MAX = 0.25;

/**
 * A user-supplied algorithm: the raw `.ts` source of a detector. Sent with
 * the `run` message; the worker transpiles it in-browser (sucrase) and calls
 * its `detectPage(page, rasterAt, options)` — the same contract the built-in
 * detectors expose. The module may `import` the built-in helpers
 * (./opencv, ./pdf, ./types, ./britania_detector_pdf, ...); anything else is
 * rejected with a clear error.
 */
export interface CustomAlgorithmSource {
  fileName: string;
  source: string;
}
export type AlgorithmChoice = 'auto' | AlgorithmName;
export type DrawingType = 'auto' | 'plan' | 'section';
export type PlanMode = 'auto' | 'vector' | 'raster';

/** A detection box in PDF page points (y-down, top-left origin). */
export interface PtBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
}

/** Column entry of the legacy plan shape (`w_mm`/`h_mm` at the scale).
 * `id` is present on britania output; the unified v2 detector emits none. */
export interface PlanColumn {
  id?: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  w_mm?: number;
  h_mm?: number;
}

/** Wall entry of the legacy plan shape. `id` only on britania output. */
export interface PlanWall {
  id?: number;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  kind: string;
}

/** One detected section element, in world centimetres (y-up). */
export interface SectionElement {
  id: number;
  cx: number;
  cy: number;
  confidence: number;
  tier: string;
  label: string;
  lengthCm?: number;
  thicknessCm?: number;
  rotation?: number;
  widthCm?: number;
  depthCm?: number;
}

/** The plan page result (legacy shape, page points y-down). */
export interface PlanPageResult {
  drawing_type: 'plan';
  scale?: number;
  columns: PlanColumn[];
  walls: PlanWall[];
  corners?: Array<{ cx: number; cy: number }>;
}

/** The section page result (world cm, y-up). */
export interface SectionPageResult {
  drawing_type: 'section';
  scale: number;
  detectedWalls: SectionElement[];
  detectedColumns: SectionElement[];
  foundations: SectionElement[];
}

export type PageResult = PlanPageResult | SectionPageResult;

/** Per-page algorithm choice made by detector_pdf, for the `algorithms` map. */
export type PageAlgorithms = Record<string, AlgorithmName>;

/** The legacy document shape — what the CLI --json writes and the UI imports. */
export interface LegacyDetectedDoc {
  source: { pdf: string; n_pages: number };
  algorithms?: PageAlgorithms;
  all_pages: Record<string, PageResult>;
}

/** Request sent from the UI to the detection worker. */
export interface DetectRequest {
  id: string;
  /** The PDF bytes; transferred to the worker (not copied). */
  pdf: ArrayBuffer;
  fileName: string;
  /** Only a fallback now — the algorithm is chosen in the page-pick panel,
   * which appears after this message, so the real choice arrives on the
   * `run` message (DetectRunMessage.algorithm). */
  algorithm: AlgorithmChoice;
  drawingType: DrawingType;
  mode: PlanMode;
  scale: number;
}

/** Main -> worker message (one job per worker instance). */
export type DetectRequestMessage = { type: 'detect' } & DetectRequest;

/**
 * UI -> worker: the PDF was opened and counted, the user picked which pages
 * to process; run detection on exactly those 1-based page numbers.
 */
export interface DetectRunMessage {
  type: 'run';
  id: string;
  pages: number[];
  /**
   * The algorithm chosen in the page-pick panel — sent at run time, because
   * the pick panel appears after the `detect` message (the worker keeps the
   * detect-time value as a fallback for older message shapes).
   */
  algorithm?: AlgorithmChoice;
  /** When present, run the user's transpiled detector instead of the built-ins. */
  custom?: CustomAlgorithmSource;
  /** Optional explicit mm-per-point scale override. When set, it wins over
   * the auto-detected scale. */
  scale?: number;
  /** When present (detect + background mode), render this PDF page as a
   * colour PNG background right after detection completes, and post it as a
   * `bgImage` message BEFORE `done` — so the main thread always has the image
   * in hand when it places it on the stage. Folding it into the run message
   * (instead of a separate concurrent `renderBg`) removes a race where the
   * background could be lost when `done` arrived ahead of the image. */
  bg?: { pageNo: number; pxWidth: number; pxHeight: number };
}

/** Worker -> UI: the PDF is open; here is how many pages it has. */
export interface DetectPagesMessage {
  type: 'pages';
  id: string;
  pageCount: number;
}

/** One page finished processing (the worker posts one per page). */
export interface DetectPageMessage {
  id: string;
  pageNo: number;
  pageCount: number;
  /** which algorithm actually produced this page (auto-probe decision) */
  algo: AlgorithmName;
  result: PageResult;
  /** elapsed time for this page in milliseconds */
  elapsedMs: number;
}

export interface DetectDoneMessage {
  id: string;
  pages: PageResult[];
  /** the real 1-based page number of each entry in `pages` (parallel array) */
  pageNos: number[];
  /** the PDF's total page count (legacy source.n_pages is the whole file) */
  pageCount: number;
  algorithms: PageAlgorithms;
  counts: Array<{ pageNo: number; algo: AlgorithmName; columns: number; walls: number }>;
  /** elapsed ms per processed page (parallel to `pageNos`) */
  pageTimesMs?: number[];
  /** total elapsed ms for the whole run */
  totalMs?: number;
}

export interface DetectErrorMessage {
  id: string;
  message: string;
  /** Stack trace of the failing pipeline step, surfaced in the dialog log. */
  stack?: string;
}

/**
 * UI -> worker: live-test a user's `.ts` detector before any PDF is picked.
 * The worker transpiles it and calls detectPage once on a tiny synthetic
 * page, so compile / import / runtime / contract mistakes surface the moment
 * the file is dropped instead of mid-run.
 */
export interface VerifyMessage {
  type: 'verify';
  id: string;
  source: string;
  fileName: string;
}

/** Worker -> UI: the upload-time live test finished. */
export interface VerifyResultMessage {
  type: 'verifyResult';
  id: string;
  ok: boolean;
  /** Present when !ok — a clear Georgian error to show in the dialog. */
  message?: string;
  /** Present when !ok and the failure is a compile error — the full
   * multi-line breakdown (offending source line + caret) for the tooltip. */
  detail?: string;
}

/** Worker -> main-thread message union. */
export type WorkerMessage =
  | { type: 'ready' }
  | { type: 'progress'; id: string; pageNo: number; pageCount: number }
  | ({ type: 'pages' } & DetectPagesMessage)
  | ({ type: 'page' } & DetectPageMessage)
  | ({ type: 'done' } & DetectDoneMessage)
  | ({ type: 'error' } & DetectErrorMessage)
  | ({ type: 'verifyResult' } & VerifyResultMessage)
  | ({ type: 'bgImage' } & BgImageMessage);

/**
 * UI -> worker: render a single PDF page as a colour PNG data URL for the
 * background overlay. Sent after the PDF is opened (same worker instance
 * as the detection job).
 */
export interface RenderBgMessage {
  type: 'renderBg';
  id: string;
  pageNo: number;
  /** Target width in pixels for the rendered image. */
  pxWidth: number;
  /** Target height in pixels. */
  pxHeight: number;
}

/** Worker -> UI: the rendered background page image. */
export interface BgImageMessage {
  id: string;
  dataUrl: string;
  /** The page's natural size in PDF points. */
  pagePtW: number;
  pagePtH: number;
}
