/**
 * OpenCV WASM bootstrap + tiny Mat hygiene helpers for the in-browser
 * detectors.
 *
 * Loading
 * -------
 * opencv.js (see public/opencv/) is an Emscripten UMD build. On `globalThis`
 * it exposes `cv` as an ASYNC FACTORY FUNCTION: `const cv = await cv()`
 * resolves to the module object carrying the cv.* API. This file never
 * bundles it through Vite (the known "Module is not defined" failure), it
 * only reaches it on `globalThis` — set by the <script> tag in the main
 * thread, or self-loaded here with a same-origin fetch + eval in the worker.
 *
 * Memory
 * ------
 * opencv.js compiles to WebAssembly and never garbage-collects Mats. Every
 * Mat a pipeline allocates must be `.delete()`d. The `track`/`releaseMats`
 * helpers make that mechanical: allocate through a tracker, then release the
 * whole page's mats in a `finally`. Each page run is one tracker.
 */

/** Absolute URL of the same-origin OpenCV build. Never a CDN. */
export const OPENCV_SRC = '/opencv/opencv.js';

/** A growing list of Mats owned by one pipeline run. */
export interface MatTracker {
  mats: any[];
}

export function newTracker(): MatTracker {
  return { mats: [] };
}

/** Record `m` so it is `.delete()`d when the tracker releases. */
export function track<T>(t: MatTracker, m: T): T {
  t.mats.push(m as any);
  return m;
}

/** Delete every tracked Mat; safe to call twice. */
export function releaseMats(t: MatTracker): void {
  for (const m of t.mats) {
    try {
      m?.delete?.();
    } catch {
      /* double-delete or already-freed Mats can throw — ignore */
    }
  }
  t.mats.length = 0;
}

/**
 * Resolve the cv module from `globalThis.cv`. Handles the three shapes the
 * build can leave behind: the module itself (already initialised), a Promise
 * resolving to it, or the async factory function.
 */
export function getCv(): Promise<any> {
  const g = globalThis as any;
  const cv = g.cv;
  if (!cv) return Promise.reject(new Error('opencv.js არ არის ჩატვირთული'));
  if (cv.Mat) return Promise.resolve(cv);
  if (typeof cv === 'function') return Promise.resolve(cv());
  if (cv && typeof cv.then === 'function') return Promise.resolve(cv);
  return Promise.reject(new Error('opencv.js არასწორი ფორმატი'));
}

/**
 * Make sure opencv.js is available on `globalThis`, loading it ourselves when
 * the script tag has not (worker has no script tag at all).
 */
export async function ensureCv(): Promise<any> {
  const g = globalThis as any;
  if (g.cv) return getCv();
  const res = await fetch(OPENCV_SRC);
  if (!res.ok) throw new Error(`opencv.js ვერ ჩაიტვირთა (HTTP ${res.status})`);
  const src = await res.text();
  (0, eval)(src);
  return getCv();
}

/**
 * Resolve once OpenCV is ready in the MAIN thread. Polls for the script tag's
 * `globalThis.cv` (loaded with `async`, so it can arrive long after `load`),
 * then waits for the factory/Promise. The `Module.onRuntimeInitialized`
 * fallback covers builds that expose the classic Emscripten global instead.
 */
export function waitForOpenCV(timeoutMs = 30000): Promise<any> {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const tick = () => {
      const g = globalThis as any;
      if (g.cv) {
        getCv().then(resolve, reject);
        return;
      }
      if (g.Module) {
        const prev = g.Module.onRuntimeInitialized;
        g.Module.onRuntimeInitialized = () => {
          try {
            prev?.();
          } finally {
            resolve(g.Module);
          }
        };
        return;
      }
      if (Date.now() - started > timeoutMs) {
        reject(new Error('opencv.js ჩატვირთვის ტაიმაუტი'));
        return;
      }
      setTimeout(tick, 100);
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// Mat helpers — every allocated Mat is tracked unless the name says otherwise.
// ---------------------------------------------------------------------------

/** Same-shape Mat filled with one value — the input `cv.inRange` requires. */
export function boundsMat(cv: any, t: MatTracker, src: any, value: number): any {
  return track(t, new cv.Mat(src.rows, src.cols, cv.CV_8U, new cv.Scalar(value)));
}

/** `cv.inRange(src, lo, hi)` -> 8UC1 Mat (opencv.js needs Mat bounds, not scalars). */
export function inRangeT(cv: any, t: MatTracker, src: any, lo: number, hi: number): any {
  const lower = boundsMat(cv, t, src, lo);
  const upper = boundsMat(cv, t, src, hi);
  const dst = track(t, new cv.Mat());
  cv.inRange(src, lower, upper, dst);
  return dst;
}

/** `cv.threshold(src, thresh, maxval, type)` -> 8UC1 Mat. */
export function thresholdT(
  cv: any,
  t: MatTracker,
  src: any,
  thresh: number,
  maxval: number,
  type: number,
): any {
  const dst = track(t, new cv.Mat());
  cv.threshold(src, dst, thresh, maxval, type);
  return dst;
}

/** Rectangular structuring element, tracked. */
export function rectKernel(cv: any, t: MatTracker, w: number, h: number): any {
  return track(t, cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(w, h)));
}

/** `cv.morphologyEx(src, op, kernel)` with the opencv.js default args made explicit. */
export function morphT(cv: any, t: MatTracker, src: any, op: number, kernel: any): any {
  const dst = track(t, new cv.Mat());
  cv.morphologyEx(src, dst, op, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT);
  return dst;
}

/** `cv.dilate(src, kernel)` with explicit defaults. */
export function dilateT(cv: any, t: MatTracker, src: any, kernel: any): any {
  const dst = track(t, new cv.Mat());
  cv.dilate(src, dst, kernel, new cv.Point(-1, -1), 1, cv.BORDER_CONSTANT);
  return dst;
}

/** `cv.blur(src, ksize)` with explicit defaults. */
export function blurT(cv: any, t: MatTracker, src: any, kx: number, ky: number): any {
  const dst = track(t, new cv.Mat());
  cv.blur(src, dst, new cv.Size(kx, ky), new cv.Point(-1, -1), cv.BORDER_CONSTANT);
  return dst;
}

export function absdiffT(cv: any, t: MatTracker, a: any, b: any): any {
  const dst = track(t, new cv.Mat());
  cv.absdiff(a, b, dst);
  return dst;
}

export function bitwiseOrT(cv: any, t: MatTracker, a: any, b: any): any {
  const dst = track(t, new cv.Mat());
  cv.bitwise_or(a, b, dst);
  return dst;
}

export function bitwiseAndT(cv: any, t: MatTracker, a: any, b: any, mask?: any): any {
  const dst = track(t, new cv.Mat());
  cv.bitwise_and(a, b, dst, mask);
  return dst;
}

/** `cv.findContours(binary, RETR_EXTERNAL, CHAIN_APPROX_SIMPLE)` -> MatVector. */
export function findContoursT(cv: any, t: MatTracker, binary: any): any {
  const contours = track(t, new cv.MatVector());
  const hierarchy = track(t, new cv.Mat());
  cv.findContours(binary, contours, hierarchy, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
  return contours;
}

export interface BoxPx {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Bounding rects of every contour, in pixel space. */
export function contourBoxes(cv: any, contours: any): BoxPx[] {
  const out: BoxPx[] = [];
  for (let i = 0; i < contours.size(); i++) {
    const c = contours.get(i);
    const r = cv.boundingRect(c);
    out.push({ x: r.x, y: r.y, w: r.width, h: r.height });
  }
  return out;
}

/**
 * Paint white rects over `img` (the britania "erase columns" step: the copy is
 * whitewashed so the wall threshold does not see column fills).
 *
 * `cv` is a parameter, never the module-global: in the detection worker
 * `globalThis.cv` is the async factory's pending Promise, not the module, so
 * a bare `cv.Point` would die with "cv.Point is not a constructor". Every
 * helper here takes the resolved module as its first argument.
 */
export function paintRectsWhite(cv: any, img: any, boxes: BoxPx[], pad: number): void {
  const h = img.rows;
  const w = img.cols;
  for (const b of boxes) {
    const x0 = Math.max(0, b.x - pad);
    const y0 = Math.max(0, b.y - pad);
    const x1 = Math.min(w - 1, b.x + b.w + pad);
    const y1 = Math.min(h - 1, b.y + b.h + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    cv.rectangle(img, new cv.Point(x0, y0), new cv.Point(x1, y1), new cv.Scalar(255), -1);
  }
}

/**
 * The unified detector's `_erase_columns`: a white mask with the column boxes
 * blacked out, then `src & src with that mask`. Returns a tracked Mat.
 */
export function maskOutBoxes(
  cv: any,
  t: MatTracker,
  src: any,
  boxes: Array<{ x: number; y: number; w: number; h: number }>,
  pad: number,
): any {
  const h = src.rows;
  const w = src.cols;
  const mask = track(t, new cv.Mat(h, w, cv.CV_8U, new cv.Scalar(255)));
  for (const b of boxes) {
    const x0 = Math.max(0, Math.round(b.x) - pad);
    const y0 = Math.max(0, Math.round(b.y) - pad);
    const x1 = Math.min(w - 1, Math.round(b.x + b.w) + pad);
    const y1 = Math.min(h - 1, Math.round(b.y + b.h) + pad);
    if (x1 <= x0 || y1 <= y0) continue;
    cv.rectangle(mask, new cv.Point(x0, y0), new cv.Point(x1, y1), new cv.Scalar(0), -1);
  }
  return bitwiseAndT(cv, t, src, src, mask);
}


