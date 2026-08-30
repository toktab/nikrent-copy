/**
 * detectionWorker.ts
 *
 * Runs detection entirely off the main thread. Spawned by DetectDialog as a
 * module worker (`new Worker(new URL(...), { type: 'module' })`). It
 * self-loads opencv.js (the worker has no <script> tag — see ensureCv), points
 * pdf.js at its bundled module worker, and processes one PDF page at a time,
 * posting each PageResult back to the UI.
 *
 * Two-phase protocol so the UI can ask the user which pages to process:
 *
 *   UI -> worker  { type: 'detect', ... }   open the PDF, count pages
 *   worker -> UI  { type: 'ready' }         opencv.js is ready
 *   worker -> UI  { type: 'pages', pageCount }
 *   UI -> worker  { type: 'run', pages: [1,3] }   process only those pages
 *   worker -> UI  { type: 'progress' | 'page' | 'done' }
 *
 * Only JSON crosses the postMessage boundary — never a cv.Mat or other WASM
 * handle. The worker is created per job and terminated by the UI when the job
 * settles, which is what returns WASM memory to baseline.
 */

import type {
  AlgorithmName,
  DetectDoneMessage,
  DetectRequestMessage,
  DetectRunMessage,
  PageAlgorithms,
  PageResult,
  RenderBgMessage,
  VerifyMessage,
  WorkerMessage,
} from './types';
import { ensureCv } from './opencv';
import { getPageText, initPdfJs, openPdf, renderPage } from './pdf';
import { detectPage } from './detector_pdf';
import { detectSuperPage } from './super_detector_pdf';
import { autoDetectScale } from './unified_detector_v2_pdf';
import { compileCustom, type CustomEntry, verifyCustomSource } from './customRunner';

/** Minimal worker-scope typing (the DOM lib has no DedicatedWorkerGlobalScope). */
const ctx = self as unknown as {
  postMessage(message: WorkerMessage): void;
  onmessage: ((event: MessageEvent) => void) | null;
};

/**
 * State kept between the `detect` (open) and `run` messages. A worker instance
 * handles exactly one job, so module-level state is safe here.
 */
interface PendingJob {
  req: DetectRequestMessage;
  cv: any;
  pdf: any;
  /** detector.py's auto_detect_scale result, computed up front over all pages */
  effScale: number;
}

let pending: PendingJob | null = null;

ctx.onmessage = async (event: MessageEvent) => {
  const msg = event.data;
  if (!msg || typeof msg !== 'object') return;
  if (msg.type === 'detect') {
    try {
      await openJob(msg);
    } catch (e) {
      postError(msg.id, (e as Error)?.message ?? String(e), (e as Error)?.stack ?? '');
    }
  } else if (msg.type === 'run') {
    if (!pending || msg.id !== pending.req.id) return;
    try {
      await runPages(msg);
    } catch (e) {
      postError(msg.id, (e as Error)?.message ?? String(e), (e as Error)?.stack ?? '');
    } finally {
      await cleanup();
    }
  } else if (msg.type === 'verify') {
    // Upload-time live test: no PDF, no pending job — just the real
    // opencv.js + the user's transpiled detector on a synthetic page.
    try {
      const cv = await ensureCv();
      const outcome = await verifyCustomSource(msg.source, msg.fileName, cv);
      ctx.postMessage(
        outcome.ok
          ? { type: 'verifyResult', id: msg.id, ok: true }
          : {
              type: 'verifyResult',
              id: msg.id,
              ok: false,
              message: outcome.error,
              detail: outcome.detail,
            },
      );
    } catch (e) {
      ctx.postMessage({
        type: 'verifyResult',
        id: msg.id,
        ok: false,
        message: (e as Error)?.message ?? String(e),
      });
    }
  } else if (msg.type === 'renderBg') {
    // Render a single PDF page as a colour PNG data URL for the background
    // overlay. Requires a pending job (PDF already opened by `detect`).
    if (!pending || msg.id !== pending.req.id) {
      console.error('[worker] renderBg: no matching pending job', { msgId: msg.id, hasPending: !!pending });
      return;
    }
    console.log('[worker] renderBg: rendering page', { pageNo: msg.pageNo, pxWidth: msg.pxWidth, pxHeight: msg.pxHeight });
    try {
      const bg = await renderBackground(
        pending.pdf,
        msg.pageNo,
        msg.pxWidth,
        msg.pxHeight,
      );
      console.log('[worker] renderBg: done, dataUrl length', bg.dataUrl.length);
      ctx.postMessage({
        type: 'bgImage',
        id: msg.id,
        dataUrl: bg.dataUrl,
        pagePtW: bg.pagePtW,
        pagePtH: bg.pagePtH,
      });
    } catch (e) {
      console.error('[worker] renderBg: failed', e);
      postError(msg.id, (e as Error)?.message ?? 'Background render failed', (e as Error)?.stack ?? '');
    }
  }
};

function postError(id: string, message: string, stack: string): void {
  ctx.postMessage({ type: 'error', id, message, stack });
}

async function cleanup(): Promise<void> {
  if (pending) {
    try {
      await pending.pdf.destroy();
    } catch {
      /* already destroyed */
    }
    pending = null;
  }
}

/** Phase 1: load opencv.js, open the PDF, count pages, and wait for `run`. */
async function openJob(req: DetectRequestMessage): Promise<void> {
  console.log('[worker] openJob: opening PDF', { fileName: req.fileName, scale: req.scale });
  initPdfJs();
  const cv = await ensureCv();
  ctx.postMessage({ type: 'ready' });

  const pdf = await openPdf(req.pdf, req.fileName);
  const pageCount = pdf.pageCount;
  console.log('[worker] openJob: PDF opened', { pageCount });
  // Registered before the text scan so a mid-open failure still gets cleaned
  // up (cleanup() destroys the pdf and clears the job).
  pending = { req, cv, pdf, effScale: 0 };

  try {
    // detector.py's auto_detect_scale scans the whole document's text layer
    // up front, so the worker does the same before the page loop.
    const texts: string[] = [];
    for (let i = 1; i <= pageCount; i++) {
      const page = await pdf.page(i);
      try {
        texts.push(await getPageText(page));
      } finally {
        page.cleanup?.();
      }
    }
    pending.effScale = autoDetectScale(texts, req.scale);
    ctx.postMessage({ type: 'pages', id: req.id, pageCount });
  } catch (e) {
    await cleanup();
    throw e;
  }
}

/** Phase 2: run the detectors on exactly the selected pages. */
async function runPages(msg: DetectRunMessage): Promise<void> {
  if (!pending) {
    console.error('[worker] runPages: no pending job');
    return;
  }
  const { req, cv, pdf, effScale } = pending;
  // An explicit run-time scale overrides the auto-detected value (the Python
  // CLI's `scale` argument plays the same role).
  const scale = typeof msg.scale === 'number' && msg.scale > 0 ? msg.scale : effScale;
  console.log('[worker] runPages: scale', { scale, effScale, manual: msg.scale });
  const wanted = [...new Set(msg.pages)]
    .filter((p) => p >= 1 && p <= pdf.pageCount)
    .sort((a, b) => a - b);
  if (!wanted.length) throw new Error('არჩეული გვერდი არ არის.');
  console.log('[worker] runPages: starting detection', { pages: wanted, algorithm: msg.algorithm, custom: !!msg.custom });

  const pages: PageResult[] = [];
  const pageNos: number[] = [];
  const algorithms: PageAlgorithms = {};
  const counts: DetectDoneMessage['counts'] = [];
  const pageTimesMs: number[] = [];
  const runStart = performance.now();

  // The algorithm is chosen in the page-pick panel, which appears AFTER the
  // `detect` message — so the run message carries the real choice, and the
  // detect-time value only survives as a fallback for older message shapes.
  const algoChoice = msg.algorithm ?? req.algorithm;

  // Compile the user's .ts once, before the page loop. Any transpile error
  // surfaces here with the file name in the message.
  let custom: CustomEntry | null = null;
  if (msg.custom?.source) {
    try {
      custom = compileCustom(msg.custom.source, msg.custom.fileName);
    } catch (e) {
      throw new Error(`${msg.custom.fileName}: ${(e as Error).message}`);
    }
  }

  for (const pageNo of wanted) {
    const pageStart = performance.now();
    const page = await pdf.page(pageNo);
    const pagePtH = page.getViewport({ scale: 1 }).height;
    const rasterAt = async (dpi: number) => {
      const rendered = await renderPage(cv, page, dpi);
      rendered.rgba?.delete?.();
      return rendered.gray; // caller owns and frees (detectPage / unified)
    };

    ctx.postMessage({ type: 'progress', id: req.id, pageNo, pageCount: wanted.length });

    let algo: AlgorithmName;
    let result: PageResult;
    const opts = {
      cv,
      algorithm: algoChoice,
      drawingType: req.drawingType,
      mode: req.mode,
      scale,
      pagePtH,
    };
    if (custom) {
      result = await custom.detectPage(page, rasterAt, opts);
      algo = custom.algo;
    } else {
      const r = await detectPage(page, rasterAt, opts);
      algo = r.algo;
      result = r.result;
    }

    pages.push(result);
    pageNos.push(pageNo);
    algorithms[`page_${pageNo}`] = algo;
    // Direct narrowing (not an aliased boolean) so TS discriminates the union
    // for the `let`-assigned result; the aliased ternary form does not narrow.
    let columns: number;
    let walls: number;
    if (result.drawing_type === 'section') {
      columns = result.detectedColumns.length;
      walls = result.detectedWalls.length;
    } else {
      columns = result.columns.length;
      walls = result.walls.length;
    }
    counts.push({ pageNo, algo, columns, walls });

    const elapsedMs = Math.round(performance.now() - pageStart);
    pageTimesMs.push(elapsedMs);
    console.log('[worker] page done', { pageNo, algo, columns, walls, elapsedMs });

    ctx.postMessage({ type: 'page', id: req.id, pageNo, pageCount: wanted.length, algo, result, elapsedMs });
    try {
      page.cleanup?.();
    } catch {
      /* already cleaned */
    }
  }

  // Detect + background mode: render the requested page as a PNG BEFORE `done`
  // is posted, so the main thread always has the image when it places it on
  // the stage. Rendered inside the same async flow (not as a concurrent
  // onmessage) so there is no race with `done` and no cleanup race on `pending`.
  if (msg.bg) {
    try {
      const bg = await renderBackground(
        pdf,
        msg.bg.pageNo,
        msg.bg.pxWidth,
        msg.bg.pxHeight,
      );
      console.log('[worker] runPages: bg rendered', {
        pageNo: msg.bg.pageNo,
        pxWidth: msg.bg.pxWidth,
        pxHeight: msg.bg.pxHeight,
        dataUrlLen: bg.dataUrl.length,
      });
      ctx.postMessage({
        type: 'bgImage',
        id: req.id,
        dataUrl: bg.dataUrl,
        pagePtW: bg.pagePtW,
        pagePtH: bg.pagePtH,
      });
    } catch (e) {
      console.error('[worker] runPages: bg render failed', e);
      // Background failure must not discard the detection result — the drawing
      // is already placed by the main thread on `done`; just log it.
    }
  }

  const totalMs = Math.round(performance.now() - runStart);
  console.log('[worker] runPages: done', { pages: wanted.length, totalMs });
  ctx.postMessage({
    type: 'done',
    id: req.id,
    pages,
    pageNos,
    pageCount: pdf.pageCount,
    algorithms,
    counts,
    pageTimesMs,
    totalMs,
  });
}

/**
 * Render a single PDF page (1-based) to a colour PNG data URL using canvas 2D
 * — the page as it physically looks, for the background overlay. The filename
 * collision with the standalone `renderBg` handler is intentional: both share
 * this implementation, the run-flow variant just calls it inline so it can run
 * before `done` without racing the worker's own message cleanup.
 */
async function renderBackground(
  pdf: any,
  pageNo: number,
  targetW: number,
  targetH: number,
): Promise<{ dataUrl: string; pagePtW: number; pagePtH: number }> {
  const page = await pdf.page(pageNo);
  try {
    const base = page.getViewport({ scale: 1 });

    // OffscreenCanvas has a hard per-edge limit (~32767 px in Chromium and
    // Firefox); beyond it the canvas is created but `convertToBlob` throws
    // "Failed to execute 'convertToBlob'". The background is an <img> scaled
    // by the browser to its cm size, so a 150-dpi raster buys nothing here —
    // clamp to a safe, ample edge size while preserving the aspect ratio.
    const MAX_EDGE = 8192;
    let w = targetW;
    let h = targetH;
    if (!(w > 0) || !(h > 0)) {
      w = base.width;
      h = base.height;
    }
    const shrink = Math.min(1, MAX_EDGE / w, MAX_EDGE / h);
    w = Math.max(1, Math.round(w * shrink));
    h = Math.max(1, Math.round(h * shrink));

    const viewport = page.getViewport({ scale: w / base.width });
    const canvas = new OffscreenCanvas(w, h);
    const context = canvas.getContext('2d');
    if (!context) throw new Error('OffscreenCanvas 2D context-ი ვერ შეიქმნა');
    await page.render({ canvasContext: context, viewport }).promise;
    const blob = await canvas.convertToBlob({ type: 'image/png' });
    const dataUrl = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as string);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    return { dataUrl, pagePtW: base.width, pagePtH: base.height };
  } finally {
    page.cleanup?.();
  }
}
