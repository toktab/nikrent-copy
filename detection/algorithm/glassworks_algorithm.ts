/**
 * unified_detector_v2_pdf.ts
 *
 * Browser port of unified_detector_v2.py against pdf.js + opencv.js.
 *
 * Two pipelines:
 *   SECTION — raster at 300 DPI. Ink = near-black hatch OR mid-grey band;
 *     directional closing difference isolates hatch bands; blobs are
 *     classified wall (single-direction hatch) / foundation (cross-hatch);
 *     columns come from solid vector fills. Output is WORLD CENTIMETRES, y-UP.
 *   PLAN — vector-first from the operator list (columns = grey + dark solid
 *     fills, walls = grey runs + parallel stroke pairs), raster fallback at
 *     200 DPI when the vector pass finds nothing.
 *
 * Coordinate conventions follow the Python original exactly: plan output is
 * raw PDF page points y-down (which is what the operator-list walker emits),
 * section output is world cm y-up (flipped from the raster). The `_norm_fill`
 * of the Python (mean of the first three colour components) decides which
 * fills are grey/dark, and all thresholds are ported verbatim.
 */

import type {
  DrawingType,
  PageResult,
  PlanColumn,
  PlanPageResult,
  PlanWall,
  SectionPageResult,
} from './types';
import type { VectorDrawing } from './pdf';
import { normFill } from './pdf';
import {
  absdiffT,
  bitwiseOrT,
  contourBoxes,
  findContoursT,
  inRangeT,
  maskOutBoxes,
  morphT,
  newTracker,
  rectKernel,
  releaseMats,
  thresholdT,
  type BoxPx,
  type MatTracker,
} from './opencv';

// ---------------------------------------------------------------------------
// constants (mirror of the Python module-level values)
// ---------------------------------------------------------------------------

export interface UnifiedParams {
  SEC_DPI: number;
  PLAN_DPI: number;
  MM_SCALE: number;

  SEC_INK_DARK: number;
  SEC_INK_GREY_LOW: number;
  SEC_INK_GREY_HIGH: number;
  SEC_COL_FILL_MIN: number;
  SEC_COL_FILL_MAX: number;
  SEC_COL_AREA_MIN: number;
  SEC_COL_ASPECT_MAX: number;
  COL_ERASE_PAD_PX: number;
  WALL_CLOSE_KERNEL: number;
  WALL_MIN_AREA_PX: number;
  WALL_MIN_LEG_PX: number;
  WALL_SOLID_MIN_AREA_PX: number;
  SEC_WALL_THICK_MIN_CM: number;
  HOUGH_THRESHOLD: number;
  HOUGH_MIN_LEN: number;
  HOUGH_MAX_GAP: number;
  HATCH_MIN_LINES: number;
  HATCH_MIN_DENSITY: number;
  FOUND_OVERLAP_REJECT: number;
  FOUND_BOTTOM_FRAC: number;
  MERGE_COLLINEAR_TOL_PX: number;

  PLAN_COL_FILL_MIN: number;
  PLAN_COL_FILL_MAX: number;
  PLAN_COL_DARK_MAX: number;
  PLAN_COL_DARK_W_MAX: number;
  PLAN_COL_DARK_W_MIN: number;
  PLAN_COL_DARK_AREA_MIN: number;
  PLAN_COL_ASPECT_MAX: number;
  PLAN_WALL_FILL_MIN: number;
  PLAN_WALL_FILL_MAX: number;
  PLAN_MARKER_STROKE: number;
  PLAN_CORNERS_MAX_DIST_PT: number;
  PLAN_STROKE_MAX: number;
  PLAN_STROKE_GAP_MAX: number;
  PLAN_STROKE_GAP_MIN: number;
  PLAN_STROKE_OVERLAP: number;
}

export const UNIFIED_PARAMS: UnifiedParams = {
  SEC_DPI: 300,
  PLAN_DPI: 200,
  MM_SCALE: 150,

  SEC_INK_DARK: 128,
  SEC_INK_GREY_LOW: 140,
  SEC_INK_GREY_HIGH: 205,
  SEC_COL_FILL_MIN: 0.15,
  SEC_COL_FILL_MAX: 0.97,
  SEC_COL_AREA_MIN: 30,
  SEC_COL_ASPECT_MAX: 4.0,
  COL_ERASE_PAD_PX: 25,
  WALL_CLOSE_KERNEL: 9,
  WALL_MIN_AREA_PX: 40 * 40,
  WALL_MIN_LEG_PX: 30,
  WALL_SOLID_MIN_AREA_PX: 60 * 60,
  SEC_WALL_THICK_MIN_CM: 10,
  HOUGH_THRESHOLD: 25,
  HOUGH_MIN_LEN: 12,
  HOUGH_MAX_GAP: 4,
  HATCH_MIN_LINES: 5,
  HATCH_MIN_DENSITY: 0.03,
  FOUND_OVERLAP_REJECT: 0.5,
  FOUND_BOTTOM_FRAC: 0.9,
  MERGE_COLLINEAR_TOL_PX: 60,

  PLAN_COL_FILL_MIN: 0.5,
  PLAN_COL_FILL_MAX: 0.8,
  PLAN_COL_DARK_MAX: 0.25,
  PLAN_COL_DARK_W_MAX: 80,
  PLAN_COL_DARK_W_MIN: 3,
  PLAN_COL_DARK_AREA_MIN: 15,
  PLAN_COL_ASPECT_MAX: 4.0,
  PLAN_WALL_FILL_MIN: 0.5,
  PLAN_WALL_FILL_MAX: 0.65,
  PLAN_MARKER_STROKE: 0.3,
  PLAN_CORNERS_MAX_DIST_PT: 25.0,
  PLAN_STROKE_MAX: 0.35,
  PLAN_STROKE_GAP_MAX: 40.0,
  PLAN_STROKE_GAP_MIN: 0.5,
  PLAN_STROKE_OVERLAP: 0.5,
};

/**
 * Stroke-pair walls are gated OFF to match the committed reference exactly:
 * every fresh Python run under the installed PyMuPDF (1.28) produces ZERO
 * stroke-pair walls — its get_drawings() items are tuples, so the Python's
 * `isinstance(i, dict)` guard rejects every stroke item and the F7 pass
 * silently contributes nothing (all 22 GlassWorks reference walls are
 * grey-fill walls). Emitting the pass here would add ~22 phantom
 * parallel-line walls the Python never produces, breaking the "results
 * exactly the same" guarantee. The faithful port lives in strokeWallPairs()
 * and is unit-tested; flip this to true only alongside a Python fix that
 * reads tuple items.
 */
export const EMIT_STROKE_PAIR_WALLS = false;

export const PLAN_KW = ['plan', 'floor plan', 'top view', 'გეგმა', 'план'];
export const SECTION_KW = [
  'section',
  'elevation',
  'cross section',
  'კვეთი',
  'განივი',
  'разрез',
];

// ---------------------------------------------------------------------------
// small helpers
// ---------------------------------------------------------------------------

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

function r1(n: number): number {
  return Math.round(n * 10) / 10;
}

/** PDF points -> centimetres at drawing scale 1:<scale>. */
function ptToCm(pt: number, scale: number): number {
  return (pt * 2.54) / 72.0 * scale;
}

function boxCenter(x0: number, y0: number, x1: number, y1: number): [number, number] {
  return [(x0 + x1) / 2.0, (y0 + y1) / 2.0];
}

function normAngleDeg(deg: number): number {
  return ((deg % 180) + 180) % 180;
}

// ---------------------------------------------------------------------------
// drawing-type sniffing (F4) + scale auto-detect (F3)
// ---------------------------------------------------------------------------

export function sniffDrawingType(drawings: VectorDrawing[], text: string): DrawingType {
  const lower = text.toLowerCase();
  if (PLAN_KW.some((k) => lower.includes(k))) return 'plan';
  if (SECTION_KW.some((k) => lower.includes(k))) return 'section';
  let planColFills = 0;
  let totalFills = 0;
  for (const d of drawings) {
    if (d.type !== 'f' && d.type !== 'fs') continue;
    const fill = d.fill;
    if (!fill || fill.length < 3) continue;
    totalFills += 1;
    const fm = normFill(fill)!;
    if (fm >= 0.4 && fm <= 0.62) planColFills += 1;
  }
  if (totalFills === 0) return 'plan';
  if (planColFills >= 5) return 'plan';
  return 'section';
}

/** "1:NNN" / "1/NNN" anywhere in the given page texts; `fallback` otherwise. */
export function autoDetectScale(pageTexts: string[], fallback: number): number {
  for (const txt of pageTexts) {
    const m = /1\s*[:/]\s*(\d{2,4})/.exec(txt);
    if (m) return Number(m[1]);
  }
  return fallback;
}

// ---------------------------------------------------------------------------
// SECTION pipeline (raster at 300 DPI)
// ---------------------------------------------------------------------------

interface SectionColVector {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cxCm: number;
  cyCmDown: number;
  wCm: number;
  hCm: number;
}

function sectionColumnsVector(drawings: VectorDrawing[], scale: number): SectionColVector[] {
  const out: SectionColVector[] = [];
  for (const d of drawings) {
    if (d.type !== 'f' && d.type !== 'fs') continue;
    if (!d.fill || d.fill.length < 3) continue;
    const fm = normFill(d.fill)!;
    const { SEC_COL_FILL_MIN, SEC_COL_FILL_MAX } = UNIFIED_PARAMS;
    if (!(SEC_COL_FILL_MIN <= fm && fm <= SEC_COL_FILL_MAX)) continue;
    const r = d.rect;
    const wPt = r.x1 - r.x0;
    const hPt = r.y1 - r.y0;
    if (wPt * hPt < UNIFIED_PARAMS.SEC_COL_AREA_MIN) continue;
    const aspect = Math.max(wPt, hPt) / Math.max(1.0, Math.min(wPt, hPt));
    if (aspect > UNIFIED_PARAMS.SEC_COL_ASPECT_MAX) continue;
    out.push({
      x0: r.x0,
      y0: r.y0,
      x1: r.x1,
      y1: r.y1,
      cxCm: ptToCm((r.x0 + r.x1) / 2.0, scale),
      cyCmDown: ptToCm((r.y0 + r.y1) / 2.0, scale),
      wCm: ptToCm(wPt, scale),
      hCm: ptToCm(hPt, scale),
    });
  }
  return out;
}

function sectionInkMask(cv: any, t: MatTracker, gray: any): any {
  const dark = thresholdT(
    cv,
    t,
    gray,
    UNIFIED_PARAMS.SEC_INK_DARK,
    255,
    cv.THRESH_BINARY_INV,
  );
  const grey = inRangeT(
    cv,
    t,
    gray,
    UNIFIED_PARAMS.SEC_INK_GREY_LOW,
    UNIFIED_PARAMS.SEC_INK_GREY_HIGH,
  );
  return bitwiseOrT(cv, t, dark, grey);
}

function houghLineAngles(cv: any, t: MatTracker, crop: any): number[] {
  const lines = t.mats.length
    ? null
    : null;
  const out = new (lines === null ? Array : Array)() as number[];
  const linesMat = (lines as unknown) || (() => null)();
  void linesMat;
  const ml = new cv.Mat();
  t.mats.push(ml);
  cv.HoughLinesP(
    crop,
    ml,
    1,
    Math.PI / 180,
    UNIFIED_PARAMS.HOUGH_THRESHOLD,
    UNIFIED_PARAMS.HOUGH_MIN_LEN,
    UNIFIED_PARAMS.HOUGH_MAX_GAP,
  );
  const data = ml.data32S;
  const n = ml.rows;
  for (let i = 0; i < n; i++) {
    const x1 = data[i * 4];
    const y1 = data[i * 4 + 1];
    const x2 = data[i * 4 + 2];
    const y2 = data[i * 4 + 3];
    out.push(normAngleDeg((Math.atan2(y2 - y1, x2 - x1) * 180) / Math.PI));
  }
  return out;
}

/** wall (single-direction hatch), foundation (cross-hatch) or null. */
function classifyHatchBlob(
  cv: any,
  t: MatTracker,
  ink: any,
  x: number,
  y: number,
  cw: number,
  ch: number,
): 'wall' | 'foundation' | null {
  const crop = t.mats.length ? null : null;
  void crop;
  const roi = ink.roi(new cv.Rect(x, y, cw, ch));
  t.mats.push(roi);
  if (roi.rows === 0 || roi.cols === 0) return null;
  const density = cv.countNonZero(roi) / (roi.rows * roi.cols);
  const angles = houghLineAngles(cv, t, roi);
  const aspect = Math.max(cw, ch) / Math.max(1.0, Math.min(cw, ch));

  if (angles.length >= UNIFIED_PARAMS.HATCH_MIN_LINES) {
    const hist = new Array<number>(12).fill(0);
    for (const a of angles) hist[Math.floor(a / 15) % 12] += 1;
    const mx = Math.max(...hist);
    const strong: number[] = [];
    for (let i = 0; i < 12; i++) if (hist[i] >= 0.35 * mx) strong.push(i);
    const groups: number[][] = [];
    for (const i of [...new Set(strong)].sort((a, b) => a - b)) {
      const last = groups[groups.length - 1];
      if (groups.length && i - last[last.length - 1] <= 1) last.push(i);
      else groups.push([i]);
    }
    if (groups.length >= 2) {
      const centers = groups
        .map((g) => ((g[0] + g[g.length - 1]) / 2.0) * 15)
        .sort((a, b) => a - b);
      if (centers[centers.length - 1] - centers[0] >= 60) return 'foundation';
    }
    return 'wall';
  }
  if (
    density > 0.5 &&
    cw * ch >= UNIFIED_PARAMS.WALL_SOLID_MIN_AREA_PX &&
    aspect >= 1.5
  ) {
    return 'wall';
  }
  return null;
}

function mergeCollinear(
  rects: Array<[number, number, number, number]>,
  colBoxes: Array<{ x0: number; y0: number; x1: number; y1: number }>,
  pad: number,
): Array<[number, number, number, number]> {
  let list = rects.map((r) => [...r]);
  let maxColW = 0;
  for (const b of colBoxes) {
    maxColW = Math.max(maxColW, b.x1 - b.x0, b.y1 - b.y0);
  }
  const gapMax = maxColW + 2 * pad + UNIFIED_PARAMS.MERGE_COLLINEAR_TOL_PX;
  let changed = true;
  while (changed) {
    changed = false;
    const out: number[][] = [];
    for (const r of list) {
      const [x0, y0, x1, y1] = r;
      let merged = false;
      for (let i = 0; i < out.length; i++) {
        const [ox0, oy0, ox1, oy1] = out[i];
        const sameBandY =
          y0 - oy0 < 0.5 * Math.min(y1 - y0, oy1 - oy0) + 1 &&
          oy0 - y0 < 0.5 * Math.min(y1 - y0, oy1 - oy0) + 1 &&
          Math.abs(y1 - y0 - (oy1 - oy0)) < 0.5 * Math.max(y1 - y0, oy1 - oy0) + 1;
        if (sameBandY) {
          const gap = Math.max(x0 - ox1, ox0 - x1);
          if (gap >= -10 && gap <= gapMax) {
            out[i] = [Math.min(x0, ox0), Math.min(y0, oy0), Math.max(x1, ox1), Math.max(y1, oy1)];
            merged = true;
            changed = true;
            break;
          }
        }
        const sameBandX =
          x0 - ox0 < 0.5 * Math.min(x1 - x0, ox1 - ox0) + 1 &&
          ox0 - x0 < 0.5 * Math.min(x1 - x0, ox1 - ox0) + 1 &&
          Math.abs(x1 - x0 - (ox1 - ox0)) < 0.5 * Math.max(x1 - x0, ox1 - ox0) + 1;
        if (sameBandX) {
          const gap = Math.max(y0 - oy1, oy0 - y1);
          if (gap >= -10 && gap <= gapMax) {
            out[i] = [Math.min(x0, ox0), Math.min(y0, oy0), Math.max(x1, ox1), Math.max(y1, oy1)];
            merged = true;
            changed = true;
            break;
          }
        }
      }
      if (!merged) out.push([...r]);
    }
    list = out;
  }
  return list as Array<[number, number, number, number]>;
}

function filterFoundations(
  fnd: Array<[number, number, number, number]>,
  walls: Array<[number, number, number, number]>,
  pageHCm: number,
  worldPerPx: number,
): Array<[number, number, number, number]> {
  const out: Array<[number, number, number, number]> = [];
  for (const f of fnd) {
    const [fx0, fy0, fx1, fy1] = f;
    const cyCm = pageHCm - ((fy0 + fy1) / 2.0) * worldPerPx;
    if (cyCm > UNIFIED_PARAMS.FOUND_BOTTOM_FRAC * pageHCm) continue;
    const fArea = (fx1 - fx0) * (fy1 - fy0);
    let drop = false;
    for (const w of walls) {
      const [wx0, wy0, wx1, wy1] = w;
      const ix0 = Math.max(fx0, wx0);
      const iy0 = Math.max(fy0, wy0);
      const ix1 = Math.min(fx1, wx1);
      const iy1 = Math.min(fy1, wy1);
      const inter = Math.max(0, ix1 - ix0) * Math.max(0, iy1 - iy0);
      if (fArea > 0 && inter / fArea > UNIFIED_PARAMS.FOUND_OVERLAP_REJECT) {
        drop = true;
        break;
      }
    }
    if (!drop) out.push(f);
  }
  return out;
}

/** The full section pipeline. `gray` is 8UC1 at SEC_DPI. */
export function analyzeSectionPage(
  cv: any,
  gray: any,
  drawings: VectorDrawing[],
  pagePtH: number,
  scale: number,
  params: UnifiedParams = UNIFIED_PARAMS,
): SectionPageResult {
  const t: MatTracker = newTracker();
  try {
    const worldPerPx = (2.54 / params.SEC_DPI) * scale;
    const pageHCm = (pagePtH * 2.54) / 72.0 * scale;
    const kpx = params.SEC_DPI / 72.0;

    // ---- columns (vector solid fills) ------------------------------------
    const colBoxes: Array<{
      x0: number;
      y0: number;
      x1: number;
      y1: number;
      cxCm: number;
      cyCm: number;
      wCm: number;
      hCm: number;
    }> = [];
    for (const b of sectionColumnsVector(drawings, scale)) {
      const byUp = pageHCm - b.cyCmDown;
      if (
        colBoxes.some(
          (d) => Math.abs(b.cxCm - d.cxCm) < 2 && Math.abs(byUp - d.cyCm) < 2,
        )
      ) {
        continue;
      }
      colBoxes.push({
        x0: b.x0 * kpx,
        y0: b.y0 * kpx,
        x1: b.x1 * kpx,
        y1: b.y1 * kpx,
        cxCm: b.cxCm,
        cyCm: byUp,
        wCm: b.wCm,
        hCm: b.hCm,
      });
    }

    // ---- hatch candidates: directional closing difference ----------------
    const ink = sectionInkMask(cv, t, gray);
    const inkClean = maskOutBoxes(
      cv,
      t,
      ink,
      colBoxes.map((b) => ({ x: b.x0, y: b.y0, w: b.x1 - b.x0, h: b.y1 - b.y0 })),
      params.COL_ERASE_PAD_PX,
    );

    const k15 = rectKernel(cv, t, 1, 15);
    const k15t = rectKernel(cv, t, 15, 1);
    const closeV = morphT(cv, t, inkClean, cv.MORPH_CLOSE, k15);
    const closeH = morphT(cv, t, inkClean, cv.MORPH_CLOSE, k15t);
    const diff = absdiffT(cv, t, closeV, closeH);
    const diffBin = thresholdT(cv, t, diff, 30, 255, cv.THRESH_BINARY);
    const k33 = rectKernel(cv, t, 3, 3);
    const diffClosed = morphT(cv, t, diffBin, cv.MORPH_CLOSE, k33);

    const contours = findContoursT(cv, t, diffClosed);
    const cands: BoxPx[] = [];
    for (const b of contourBoxes(cv, contours)) {
      if (b.w * b.h < params.WALL_MIN_AREA_PX) continue;
      if (Math.max(b.w, b.h) < params.WALL_MIN_LEG_PX) continue;
      cands.push(b);
    }

    // dedupe overlapping candidates
    cands.sort((a, b) => (a.x - b.x) || (a.y - b.y));
    const dedup: BoxPx[] = [];
    for (const c of cands) {
      if (
        dedup.some(
          (d) =>
            Math.abs(c.x - d.x) < 5 &&
            Math.abs(c.y - d.y) < 5 &&
            Math.abs(c.w - d.w) < 5 &&
            Math.abs(c.h - d.h) < 5,
        )
      ) {
        continue;
      }
      dedup.push(c);
    }

    const wallsPx: Array<[number, number, number, number]> = [];
    const fndPx: Array<[number, number, number, number]> = [];
    for (const b of dedup) {
      const kind = classifyHatchBlob(cv, t, ink, b.x, b.y, b.w, b.h);
      if (kind === 'wall') wallsPx.push([b.x, b.y, b.w, b.h]);
      else if (kind === 'foundation') fndPx.push([b.x, b.y, b.w, b.h]);
    }

    const walls = mergeCollinear(wallsPx, colBoxes, params.COL_ERASE_PAD_PX);
    const fnd = mergeCollinear(fndPx, colBoxes, params.COL_ERASE_PAD_PX);
    const foundations = filterFoundations(fnd, walls, pageHCm, worldPerPx);

    // ---- assemble world-coordinate output --------------------------------
    const detectedWalls = [];
    let wid = 1;
    for (const [x, y, cw, ch] of walls) {
      const length = Math.max(cw, ch) * worldPerPx;
      const thick = Math.min(cw, ch) * worldPerPx;
      if (thick < params.SEC_WALL_THICK_MIN_CM) continue;
      detectedWalls.push({
        id: wid,
        lengthCm: r1(length),
        thicknessCm: r1(thick),
        cx: r1((x + cw / 2) * worldPerPx),
        cy: r1(pageHCm - (y + ch / 2) * worldPerPx),
        rotation: ch > cw ? 90 : 0,
        label: `W${wid}`,
        confidence: 0.9,
        tier: 'high',
      });
      wid += 1;
    }

    const detectedColumns = [];
    let cid = 1;
    for (const b of colBoxes) {
      detectedColumns.push({
        id: cid,
        widthCm: r1(b.wCm),
        depthCm: r1(b.hCm),
        cx: r1(b.cxCm),
        cy: r1(b.cyCm),
        rotation: 0,
        label: `C${cid}`,
        confidence: 0.9,
        tier: 'high',
      });
      cid += 1;
    }

    const fndOut = [];
    let fid = 1;
    for (const [x, y, cw, ch] of foundations) {
      fndOut.push({
        id: fid,
        widthCm: r1(cw * worldPerPx),
        depthCm: r1(ch * worldPerPx),
        cx: r1((x + cw / 2) * worldPerPx),
        cy: r1(pageHCm - (y + ch / 2) * worldPerPx),
        label: `F${fid}`,
        confidence: 0.85,
        tier: 'medium',
      });
      fid += 1;
    }

    return {
      drawing_type: 'section',
      scale,
      detectedWalls,
      detectedColumns,
      foundations: fndOut,
    };
  } finally {
    releaseMats(t);
  }
}

// ---------------------------------------------------------------------------
// PLAN pipeline (vector-first, raster fallback at 200 DPI)
// ---------------------------------------------------------------------------

/**
 * F7: walls drawn as two parallel stroked lines (no fill).
 *
 * FAITHFULNESS NOTE: the Python `_stroke_wall_pairs` only ever consumes `l`
 * and `re` items. Under the installed PyMuPDF (1.28) `get_drawings()` returns
 * its items as TUPLES, so the Python's `isinstance(i, dict)` guard rejects
 * every stroke item and this pass contributes NOTHING — the committed
 * reference for GlassWorks (22 walls) contains zero stroke-pair walls, and
 * every fresh Python run matches. The browser reproduces that exact output
 * (see analyzePlanVector), so this function is exercised by unit tests only;
 * if the upstream detector is ever fixed to read tuple items, this port is
 * the correct algorithm to re-enable.
 */
export function strokeWallPairs(drawings: VectorDrawing[]): PlanWall[] {
  const segs: Array<[number, number, number, number]> = [];
  for (const d of drawings) {
    const stroke = d.stroke;
    if (!stroke || stroke.length < 3) continue;
    if (normFill(stroke)! > UNIFIED_PARAMS.PLAN_STROKE_MAX) continue;
    for (const item of d.items) {
      if (item.type === 'l') {
        segs.push([item.p1.x, item.p1.y, item.p2.x, item.p2.y]);
      } else if (item.type === 're') {
        const r = item.rect;
        segs.push(
          [r.x0, r.y0, r.x1, r.y0],
          [r.x0, r.y1, r.x1, r.y1],
          [r.x0, r.y0, r.x0, r.y1],
          [r.x1, r.y0, r.x1, r.y1],
        );
      }
      // c/qu items are skipped, exactly like the Python (it only reads l/re).
    }
  }

  const horiz: Array<[Array<number>, number]> = [];
  const vert: Array<[Array<number>, number]> = [];
  for (const s of segs) {
    const dx = s[2] - s[0];
    const dy = s[3] - s[1];
    const length = Math.hypot(dx, dy);
    if (length < 3) continue;
    const ang = normAngleDeg((Math.atan2(dy, dx) * 180) / Math.PI);
    if (ang < 10 || ang > 170) horiz.push([[...s], length]);
    else if (ang >= 80 && ang <= 100) vert.push([[...s], length]);
  }

  const rects: Array<[number, number, number, number]> = [];
  const { PLAN_STROKE_GAP_MIN, PLAN_STROKE_GAP_MAX, PLAN_STROKE_OVERLAP } = UNIFIED_PARAMS;
  for (const [group, axis] of [
    [horiz, 'h'],
    [vert, 'v'],
  ] as Array<[Array<[Array<number>, number]>, 'h' | 'v']>) {
    for (let i = 0; i < group.length; i++) {
      for (let j = i + 1; j < group.length; j++) {
        const [a, la] = group[i];
        const [b, lb] = group[j];
        if (axis === 'h') {
          const gap = Math.abs(a[1] - b[1]);
          if (!(PLAN_STROKE_GAP_MIN <= gap && gap <= PLAN_STROKE_GAP_MAX)) continue;
          const ox0 = Math.max(a[0], b[0]);
          const ox1 = Math.min(a[2], b[2]);
          if (ox1 - ox0 < PLAN_STROKE_OVERLAP * Math.min(la, lb)) continue;
          rects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[1], b[1])]);
        } else {
          const gap = Math.abs(a[0] - b[0]);
          if (!(PLAN_STROKE_GAP_MIN <= gap && gap <= PLAN_STROKE_GAP_MAX)) continue;
          const oy0 = Math.max(a[1], b[1]);
          const oy1 = Math.min(a[3], b[3]);
          if (oy1 - oy0 < PLAN_STROKE_OVERLAP * Math.min(la, lb)) continue;
          rects.push([Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[3], b[3])]);
        }
      }
    }
  }

  // Python merges `for r in sorted(rects)` — full lexicographic tuple order.
  // Sorting by x0 only (as an earlier port did) changes the merge chains and
  // fabricated phantom walls; match the Python ordering exactly.
  const merged: number[][] = [];
  for (const r of [...rects].sort((a, b) => {
    for (let k = 0; k < 4; k++) {
      if (a[k] !== b[k]) return a[k] - b[k];
    }
    return 0;
  })) {
    const last = merged[merged.length - 1];
    if (
      last &&
      last[2] >= r[0] &&
      last[3] >= r[1] &&
      r[2] >= last[0] &&
      r[3] >= last[1]
    ) {
      merged[merged.length - 1] = [
        Math.min(last[0], r[0]),
        Math.min(last[1], r[1]),
        Math.max(last[2], r[2]),
        Math.max(last[3], r[3]),
      ];
    } else {
      merged.push([...r]);
    }
  }

  return merged.map(([x0, y0, x1, y1]) => {
    const [cx, cy] = boxCenter(x0, y0, x1, y1);
    return { x0: r2(x0), y0: r2(y0), x1: r2(x1), y1: r2(y1), cx: r2(cx), cy: r2(cy), kind: 'wall' };
  });
}

/** The vector plan pipeline. `drawings` are page-point y-down boxes. */
export function analyzePlanVector(
  drawings: VectorDrawing[],
  effScale: number,
  params: UnifiedParams = UNIFIED_PARAMS,
): PlanPageResult {
  const columns: PlanColumn[] = [];
  const mm = (pt: number) => Math.round((pt / 2.835) * effScale);

  const pushColumn = (
    r: VectorDrawing['rect'],
    fm: number,
    darkPass: boolean,
  ) => {
    const wPt = r.x1 - r.x0;
    const hPt = r.y1 - r.y0;
    const aspect = Math.max(wPt, hPt) / Math.max(1.0, Math.min(wPt, hPt));
    if (aspect > (darkPass ? params.PLAN_COL_ASPECT_MAX : 3)) return;
    if (darkPass) {
      if (
        !(
          params.PLAN_COL_DARK_W_MIN < wPt &&
          wPt < params.PLAN_COL_DARK_W_MAX &&
          params.PLAN_COL_DARK_W_MIN < hPt &&
          hPt < params.PLAN_COL_DARK_W_MAX
        )
      ) {
        return;
      }
      if (wPt * hPt < params.PLAN_COL_DARK_AREA_MIN) return;
    }
    const [cx, cy] = boxCenter(r.x0, r.y0, r.x1, r.y1);
    columns.push({
      x0: r2(r.x0),
      y0: r2(r.y0),
      x1: r2(r.x1),
      y1: r2(r.y1),
      cx: r2(cx),
      cy: r2(cy),
      w_mm: mm(wPt),
      h_mm: mm(hPt),
    });
  };

  // grey pass
  for (const d of drawings) {
    if (d.type !== 'f' && d.type !== 'fs') continue;
    if (!d.fill || d.fill.length < 3) continue;
    const fm = normFill(d.fill)!;
    const r = d.rect;
    const wPt = r.x1 - r.x0;
    const hPt = r.y1 - r.y0;
    if (wPt < 5 || hPt < 5) continue;
    if (wPt * hPt < 50) continue;
    const aspect = Math.max(wPt, hPt) / Math.max(1.0, Math.min(wPt, hPt));
    if (aspect > 3) continue;
    if (!(params.PLAN_COL_FILL_MIN < fm && fm < params.PLAN_COL_FILL_MAX)) continue;
    pushColumn(r, fm, false);
  }
  // dark pass (F2)
  for (const d of drawings) {
    if (d.type !== 'f' && d.type !== 'fs') continue;
    if (!d.fill || d.fill.length < 3) continue;
    const fm = normFill(d.fill)!;
    if (fm >= params.PLAN_COL_DARK_MAX) continue;
    pushColumn(d.rect, fm, true);
  }

  // dedupe (grey and dark passes may overlap)
  const dedup: PlanColumn[] = [];
  for (const c of columns) {
    if (dedup.some((d) => Math.abs(c.cx - d.cx) < 2 && Math.abs(c.cy - d.cy) < 2)) continue;
    dedup.push(c);
  }

  // walls: solid-grey runs
  const walls: PlanWall[] = [];
  for (const d of drawings) {
    if (d.type !== 'f' && d.type !== 'fs') continue;
    if (!d.fill || d.fill.length < 3) continue;
    const fm = normFill(d.fill)!;
    if (!(params.PLAN_WALL_FILL_MIN < fm && fm < params.PLAN_WALL_FILL_MAX)) continue;
    const r = d.rect;
    const wPt = r.x1 - r.x0;
    const hPt = r.y1 - r.y0;
    if (wPt < 2 || hPt < 2) continue;
    if (wPt * hPt < 200) continue;
    const rw = Math.max(wPt, hPt);
    const rh = Math.min(wPt, hPt);
    if (rw < 30 || rh < 3) continue;
    const [cx, cy] = boxCenter(r.x0, r.y0, r.x1, r.y1);
    walls.push({
      x0: r2(r.x0),
      y0: r2(r.y0),
      x1: r2(r.x1),
      y1: r2(r.y1),
      cx: r2(cx),
      cy: r2(cy),
      kind: rw > rh ? 'wall' : 'beam',
    });
  }
  if (EMIT_STROKE_PAIR_WALLS) {
    walls.push(...strokeWallPairs(drawings));
  }

  // markers: unfilled column dots — the Python matches only stroke-only
  // drawings (its `("l","re","s","c")` item set means no fill items), so
  // type 's' is the one hit.
  const markers: Array<{ cx: number; cy: number; wPt: number }> = [];
  for (const d of drawings) {
    if (d.type !== 's') continue;
    const r = d.rect;
    const wPt = r.x1 - r.x0;
    const hPt = r.y1 - r.y0;
    if (Math.max(wPt, hPt) < 3) continue;
    const stroke = d.stroke;
    if (!stroke || (stroke.length >= 3 && normFill(stroke)! > params.PLAN_MARKER_STROKE)) {
      continue;
    }
    const [cx, cy] = boxCenter(r.x0, r.y0, r.x1, r.y1);
    markers.push({ cx, cy, wPt: r2(Math.max(wPt, hPt)) });
  }

  // corners: cluster wall corners + marker centres
  const corners: Array<{ cx: number; cy: number }> = [];
  let raw: Array<[number, number]> = [];
  for (const wl of walls) {
    raw.push([wl.x0, wl.y0], [wl.x0, wl.y1], [wl.x1, wl.y0], [wl.x1, wl.y1]);
  }
  for (const m of markers) raw.push([m.cx, m.cy]);
  while (raw.length) {
    const seed = raw.shift()!;
    const cluster = [seed];
    const rest: Array<[number, number]> = [];
    for (const p of raw) {
      const dx = p[0] - seed[0];
      const dy = p[1] - seed[1];
      if (dx * dx + dy * dy <= params.PLAN_CORNERS_MAX_DIST_PT ** 2) cluster.push(p);
      else rest.push(p);
    }
    raw = rest;
    const mx = cluster.reduce((s, p) => s + p[0], 0) / cluster.length;
    const my = cluster.reduce((s, p) => s + p[1], 0) / cluster.length;
    corners.push({ cx: r2(mx), cy: r2(my) });
  }

  return {
    drawing_type: 'plan',
    columns: dedup,
    walls,
    corners,
    scale: effScale,
  };
}

/** Raster fallback for plan pages (F2: dark columns too, not only grey). */
export function analyzePlanRasterFallback(
  cv: any,
  gray: any,
  dpi: number,
  effScale: number,
  params: UnifiedParams = UNIFIED_PARAMS,
): PlanPageResult {
  const t: MatTracker = newTracker();
  try {
    const k = dpi / 72.0;
    const dark = thresholdT(cv, t, gray, 64, 255, cv.THRESH_BINARY_INV);
    const mid = inRangeT(
      cv,
      t,
      gray,
      Math.floor(params.PLAN_COL_FILL_MIN * 255),
      Math.floor(params.PLAN_COL_FILL_MAX * 255),
    );
    let solid = bitwiseOrT(cv, t, dark, mid);
    const k55 = rectKernel(cv, t, 5, 5);
    solid = morphT(cv, t, solid, cv.MORPH_CLOSE, k55);

    const contours = findContoursT(cv, t, solid);
    const columns: PlanColumn[] = [];
    for (const b of contourBoxes(cv, contours)) {
      if (b.w * b.h < 50 * 50) continue;
      if (Math.max(b.w, b.h) < 5 * k) continue;
      const x0 = b.x / k;
      const y0 = b.y / k;
      const x1 = (b.x + b.w) / k;
      const y1 = (b.y + b.h) / k;
      columns.push({
        x0: r2(x0),
        y0: r2(y0),
        x1: r2(x1),
        y1: r2(y1),
        cx: r2((b.x + b.w / 2) / k),
        cy: r2((b.y + b.h / 2) / k),
        w_mm: Math.round((b.w / 2.835) * effScale),
        h_mm: Math.round((b.h / 2.835) * effScale),
      });
    }
    return { drawing_type: 'plan', columns, walls: [], corners: [], scale: effScale };
  } finally {
    releaseMats(t);
  }
}

// ---------------------------------------------------------------------------
// one-page dispatcher
// ---------------------------------------------------------------------------

export interface UnifiedPageInput {
  cv: any;
  drawings: VectorDrawing[];
  text: string;
  pagePtH: number;
  /** rasterise the page at `dpi`; returns a caller-freed 8UC1 gray Mat */
  grayAt: (dpi: number) => Promise<any>;
  drawingType: DrawingType;
  mode: 'auto' | 'vector' | 'raster';
  scale: number;
  params?: UnifiedParams;
}

export async function analyzeUnifiedPage(input: UnifiedPageInput): Promise<PageResult> {
  const { cv, drawings, text, mode, drawingType } = input;
  const params = input.params ?? UNIFIED_PARAMS;
  const dt = drawingType === 'auto' ? sniffDrawingType(drawings, text) : drawingType;

  if (dt === 'section') {
    const gray = await input.grayAt(params.SEC_DPI);
    try {
      return analyzeSectionPage(cv, gray, drawings, input.pagePtH, input.scale, params);
    } finally {
      gray?.delete?.();
    }
  }

  const res = analyzePlanVector(drawings, input.scale, params);
  if (res.columns.length === 0 && mode !== 'vector') {
    const gray = await input.grayAt(params.PLAN_DPI);
    try {
      return analyzePlanRasterFallback(cv, gray, params.PLAN_DPI, input.scale, params);
    } finally {
      gray?.delete?.();
    }
  }
  return res;
}
