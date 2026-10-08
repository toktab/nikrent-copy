/**
 * britania_detector_pdf.ts
 *
 * Faithful browser port of britania_detector.py, rewritten against opencv.js.
 * The Python original runs on the CLI; this file runs on the same raster
 * produced by pdf.js in the browser, with no server and no native code.
 *
 * The port mirrors the Python pipeline step for step, including all three
 * wall pipelines (the current Python has no rejoin step and uses
 * MIN_SHORT_SIDE = 25):
 *
 *   Columns  inRange(130..210) -> open(5x5) -> contours
 *            filter area > 400, aspect < 2.5
 *   Primary  erase columns (2 px pad) -> threshold <100 (THRESH_BINARY_INV)
 *            -> close(25x25) -> open(8x8)
 *            -> directional open (5,40)/(40,5)
 *            -> contours, filter area >= 2000, short side >= 25,
 *               aspect >= 2.5 per mask direction
 *   Supplem. detect_walls_supplemental: 1-px directional open (min 200 px
 *            length) -> perpendicular dilate (80 px) -> directional close
 *            (20 px heal) -> contours, filter area >= 2000, aspect >= 2.5,
 *            25 <= short <= 160. Dedup vs primary (IoU > 0.25) and columns
 *            (IoU > 0.5).
 *   Hatch    detect_hatched_bridges: only inspects the strip directly between
 *            two already-detected columns on the same row/column line.
 *            Density smear (blur + threshold) -> close(5,15)/(15,5) ->
 *            contours, filter area >= 900, short >= 15, aspect >= 2.2.
 *            Kind "wall_hatched". Dedup as supplemental.
 *
 * Every threshold is a named export in BRITANIA_PARAMS so visual tuning can
 * move without touching the pipeline. The values mirror the Python constants
 * exactly.
 */

import type { PlanColumn, PlanPageResult, PlanWall } from './types';
import {
  blurT,
  contourBoxes,
  dilateT,
  findContoursT,
  inRangeT,
  morphT,
  newTracker,
  paintRectsWhite,
  rectKernel,
  releaseMats,
  thresholdT,
  type BoxPx,
  type MatTracker,
} from './opencv';

export interface BritaniaParams {
  /** rasterisation density: px per pt = DPI/72 */
  DPI: number;
  COLUMN_GRAY_LO: number;
  COLUMN_GRAY_HI: number;
  COLUMN_OPEN_KERNEL: number;
  COLUMN_MIN_AREA: number;
  COLUMN_MAX_ASPECT: number;
  /** margin around a column masked out of the wall image, in px */
  COLUMN_MASK_EXPAND_PX: number;
  WALL_BLACK_THRESH: number;
  WALL_CLOSE_KERNEL: number;
  WALL_OPEN_KERNEL: number;
  /** directional open kernel: short side (wall thickness axis) */
  WALL_DIR_OPEN_SHORT: number;
  /** directional open kernel: long side (wall length axis) */
  WALL_DIR_OPEN_LONG: number;
  WALL_MIN_AREA: number;
  WALL_MIN_ASPECT: number;
  WALL_MIN_SHORT_SIDE: number;
  /** supplemental pipeline (detect_walls_supplemental) */
  SUPP_MIN_LONG_PX: number;
  SUPP_BRIDGE_PX: number;
  SUPP_MIN_AREA: number;
  SUPP_MIN_ASP: number;
  SUPP_MIN_SHORT: number;
  SUPP_MAX_SHORT: number;
  /** hatch-bridge pipeline (detect_hatched_bridges) */
  HATCH_ROW_TOL: number;
  HATCH_COL_TOL: number;
  HATCH_MIN_GAP: number;
  HATCH_MAX_GAP: number;
  HATCH_PAD: number;
  HATCH_DENSITY_THRESH: number;
  HATCH_MIN_AREA: number;
  HATCH_MIN_ASP: number;
  HATCH_MIN_SHORT: number;
  /** IoU dedup thresholds */
  IOU_THRESH: number;
  IOU_COL: number;
  MIN_ASPECT_FOR_THICKNESS: number;
}

export const BRITANIA_PARAMS: BritaniaParams = {
  DPI: 300,
  COLUMN_GRAY_LO: 130,
  COLUMN_GRAY_HI: 210,
  COLUMN_OPEN_KERNEL: 5,
  COLUMN_MIN_AREA: 400,
  COLUMN_MAX_ASPECT: 2.5,
  COLUMN_MASK_EXPAND_PX: 2,
  WALL_BLACK_THRESH: 100,
  WALL_CLOSE_KERNEL: 25,
  WALL_OPEN_KERNEL: 8,
  WALL_DIR_OPEN_SHORT: 5,
  WALL_DIR_OPEN_LONG: 40,
  WALL_MIN_AREA: 2000,
  WALL_MIN_ASPECT: 2.5,
  WALL_MIN_SHORT_SIDE: 25,
  SUPP_MIN_LONG_PX: 200,
  SUPP_BRIDGE_PX: 80,
  SUPP_MIN_AREA: 2000,
  SUPP_MIN_ASP: 2.5,
  SUPP_MIN_SHORT: 25,
  SUPP_MAX_SHORT: 160,
  HATCH_ROW_TOL: 45,
  HATCH_COL_TOL: 45,
  HATCH_MIN_GAP: 20,
  HATCH_MAX_GAP: 2800,
  HATCH_PAD: 4,
  HATCH_DENSITY_THRESH: 200,
  HATCH_MIN_AREA: 900,
  HATCH_MIN_ASP: 2.2,
  HATCH_MIN_SHORT: 15,
  IOU_THRESH: 0.25,
  IOU_COL: 0.5,
  MIN_ASPECT_FOR_THICKNESS: 2.5,
};

/** px -> PDF page points at the detector's DPI. */
export function pxToPt(px: number, dpi: number): number {
  return (px * 72.0) / dpi;
}

function r2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** IoU of two (x, y, w, h) rects — port of the Python `iou`. */
export function iou(a: BoxPx, b: BoxPx): number {
  const ax1 = a.x;
  const ay1 = a.y;
  const ax2 = a.x + a.w;
  const ay2 = a.y + a.h;
  const bx1 = b.x;
  const by1 = b.y;
  const bx2 = b.x + b.w;
  const by2 = b.y + b.h;
  const ix1 = Math.max(ax1, bx1);
  const iy1 = Math.max(ay1, by1);
  const ix2 = Math.min(ax2, bx2);
  const iy2 = Math.min(ay2, by2);
  if (ix2 <= ix1 || iy2 <= iy1) return 0.0;
  const inter = (ix2 - ix1) * (iy2 - iy1);
  const union = a.w * a.h + b.w * b.h - inter;
  return union > 0 ? inter / union : 0.0;
}

function median(vals: number[]): number {
  if (!vals.length) return 0;
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/**
 * Cluster items into groups where consecutive key values (sorted) are within
 * tol of each other — port of the Python `_cluster_1d`.
 */
export function cluster1d<T>(items: T[], key: (it: T) => number, tol: number): T[][] {
  if (!items.length) return [];
  const ordered = [...items].sort((a, b) => key(a) - key(b));
  const groups: T[][] = [[ordered[0]]];
  for (const it of ordered.slice(1)) {
    const last = groups[groups.length - 1];
    if (key(it) - key(last[last.length - 1]) <= tol) {
      last.push(it);
    } else {
      groups.push([it]);
    }
  }
  return groups;
}

/**
 * Median thickness of already-detected walls running in `direction` — port of
 * the Python `_infer_thickness`.
 */
function inferThickness(
  wallRects: BoxPx[],
  direction: 'H' | 'V',
  def: number,
  minAspect: number,
): number {
  const vals: number[] = [];
  for (const r of wallRects) {
    if (direction === 'H' && r.w >= r.h * minAspect) vals.push(r.h);
    else if (direction === 'V' && r.h >= r.w * minAspect) vals.push(r.w);
  }
  return vals.length ? Math.trunc(median(vals)) : def;
}

interface DirectedBox extends BoxPx {
  direction: 'H' | 'V';
}

/**
 * Supplemental wall detector (port of detect_walls_supplemental): hatched
 * walls whose outlines are two thin parallel lines. 1-px directional MORPH_OPEN
 * extracts long border lines (min 200 px), a perpendicular dilate (80 px)
 * bridges the parallel pair, a small directional close heals breaks.
 */
export function detectWallsSupplemental(
  cv: any,
  t: MatTracker,
  blackMask: any,
  params: BritaniaParams = BRITANIA_PARAMS,
): DirectedBox[] {
  const bm = morphT(cv, t, blackMask, cv.MORPH_CLOSE, rectKernel(cv, t, 3, 3));
  const results: DirectedBox[] = [];

  // numpy np.ones((rows, cols)) is (height, width); cv.Size(w, h) is
  // (width, height) — kernel args are swapped to match the Python.
  for (const vertical of [true, false]) {
    const openKernel = vertical
      ? rectKernel(cv, t, 1, params.SUPP_MIN_LONG_PX) // (200,1) -> Size(1,200)
      : rectKernel(cv, t, params.SUPP_MIN_LONG_PX, 1); // (1,200) -> Size(200,1)
    const bridgeKernel = vertical
      ? rectKernel(cv, t, params.SUPP_BRIDGE_PX, 1) // (1,80) -> Size(80,1)
      : rectKernel(cv, t, 1, params.SUPP_BRIDGE_PX); // (80,1) -> Size(1,80)
    const healKernel = vertical
      ? rectKernel(cv, t, 1, 20) // (20,1) -> Size(1,20)
      : rectKernel(cv, t, 20, 1); // (1,20) -> Size(20,1)

    const longLines = morphT(cv, t, bm, cv.MORPH_OPEN, openKernel);
    const bridged = dilateT(cv, t, longLines, bridgeKernel);
    const healed = morphT(cv, t, bridged, cv.MORPH_CLOSE, healKernel);

    const contours = findContoursT(cv, t, healed);
    for (const b of contourBoxes(cv, contours)) {
      const area = b.w * b.h;
      const short = Math.min(b.w, b.h);
      const asp = vertical
        ? b.h / Math.max(1.0, b.w)
        : b.w / Math.max(1.0, b.h);
      if (
        area >= params.SUPP_MIN_AREA &&
        asp >= params.SUPP_MIN_ASP &&
        short >= params.SUPP_MIN_SHORT &&
        short <= params.SUPP_MAX_SHORT
      ) {
        results.push({ x: b.x, y: b.y, w: b.w, h: b.h, direction: vertical ? 'V' : 'H' });
      }
    }
  }
  return results;
}

/**
 * Hatch-bridge wall detector (port of detect_hatched_bridges): crosshatch
 * walls connecting two already-detected columns on the same row/column line.
 * Only inspects the thin strip between such columns — never the whole page —
 * so dimension lines, text and other distant ink cannot be mistaken for walls.
 */
export function detectHatchedBridges(
  cv: any,
  t: MatTracker,
  grayNoCols: any,
  columnsPx: BoxPx[],
  existingWallRects: BoxPx[],
  params: BritaniaParams = BRITANIA_PARAMS,
): DirectedBox[] {
  if (!columnsPx.length) return [];

  const H_img = grayNoCols.rows;
  const W_img = grayNoCols.cols;
  const defaultThickness = Math.trunc(median(columnsPx.map((c) => c.h)));
  const results: DirectedBox[] = [];

  // ---- Horizontal bridges: columns grouped into rows by cy ---------------
  const rowGroups = cluster1d(
    columnsPx,
    (c) => c.y + c.h / 2.0,
    params.HATCH_ROW_TOL,
  );
  const thicknessH = inferThickness(
    existingWallRects,
    'H',
    defaultThickness,
    params.MIN_ASPECT_FOR_THICKNESS,
  );

  for (const group of rowGroups) {
    const sorted = [...group].sort((a, b) => a.x - b.x);
    for (let i = 0; i < sorted.length - 1; i++) {
      const c1 = sorted[i];
      const c2 = sorted[i + 1];
      const leftEdge = c1.x + c1.w;
      const rightEdge = c2.x;
      const gap = rightEdge - leftEdge;
      if (gap < params.HATCH_MIN_GAP || gap > params.HATCH_MAX_GAP) continue;

      let bandTop = Math.max(0, Math.min(c1.y, c2.y) - params.HATCH_PAD);
      let bandBottom = Math.min(
        H_img,
        Math.max(c1.y + c1.h, c2.y + c2.h) + params.HATCH_PAD,
      );
      if (bandBottom - bandTop < params.HATCH_MIN_SHORT) {
        const bandCy = Math.round((c1.y + c1.h / 2.0 + c2.y + c2.h / 2.0) / 2.0);
        bandTop = Math.max(0, bandCy - Math.floor(thicknessH / 2) - params.HATCH_PAD);
        bandBottom = Math.min(H_img, bandCy + Math.floor(thicknessH / 2) + params.HATCH_PAD);
      }

      const bandRect: BoxPx = { x: leftEdge, y: bandTop, w: gap, h: bandBottom - bandTop };
      if (existingWallRects.some((wr) => iou(bandRect, wr) > 0.5)) continue;
      if (gap <= 0 || bandBottom - bandTop <= 0) continue;

      const strip = grayNoCols.roi(new cv.Rect(leftEdge, bandTop, gap, bandBottom - bandTop));
      t.mats.push(strip);
      if (strip.rows === 0 || strip.cols === 0) continue;

      const ink = thresholdT(
        cv,
        t,
        strip,
        params.HATCH_DENSITY_THRESH,
        255,
        cv.THRESH_BINARY_INV,
      );
      let k = Math.max(3, Math.min(21, Math.floor(strip.rows / 2)));
      if (k % 2 === 0) k += 1;
      const density = blurT(cv, t, ink, k, k);
      const denseMask = thresholdT(cv, t, density, 20, 255, cv.THRESH_BINARY);
      // Python np.ones((5,15)) = 5 tall x 15 wide -> Size(15,5)
      const closed = morphT(cv, t, denseMask, cv.MORPH_CLOSE, rectKernel(cv, t, 15, 5));

      const contours = findContoursT(cv, t, closed);
      for (const b of contourBoxes(cv, contours)) {
        const area = b.w * b.h;
        if (area < params.HATCH_MIN_AREA) continue;
        if (Math.min(b.w, b.h) < params.HATCH_MIN_SHORT) continue;
        if (b.w / Math.max(1.0, b.h) < params.HATCH_MIN_ASP) continue;
        results.push({
          x: leftEdge + b.x,
          y: bandTop + b.y,
          w: b.w,
          h: b.h,
          direction: 'H',
        });
      }
    }
  }

  // ---- Vertical bridges: columns grouped into column-lines by cx ---------
  const colGroups = cluster1d(
    columnsPx,
    (c) => c.x + c.w / 2.0,
    params.HATCH_COL_TOL,
  );
  const thicknessV = inferThickness(
    existingWallRects,
    'V',
    defaultThickness,
    params.MIN_ASPECT_FOR_THICKNESS,
  );

  for (const group of colGroups) {
    const sorted = [...group].sort((a, b) => a.y - b.y);
    for (let i = 0; i < sorted.length - 1; i++) {
      const c1 = sorted[i];
      const c2 = sorted[i + 1];
      const topEdge = c1.y + c1.h;
      const bottomEdge = c2.y;
      const gap = bottomEdge - topEdge;
      if (gap < params.HATCH_MIN_GAP || gap > params.HATCH_MAX_GAP) continue;

      let bandLeft = Math.max(0, Math.min(c1.x, c2.x) - params.HATCH_PAD);
      let bandRight = Math.min(
        W_img,
        Math.max(c1.x + c1.w, c2.x + c2.w) + params.HATCH_PAD,
      );
      if (bandRight - bandLeft < params.HATCH_MIN_SHORT) {
        const bandCx = Math.round((c1.x + c1.w / 2.0 + c2.x + c2.w / 2.0) / 2.0);
        bandLeft = Math.max(0, bandCx - Math.floor(thicknessV / 2) - params.HATCH_PAD);
        bandRight = Math.min(W_img, bandCx + Math.floor(thicknessV / 2) + params.HATCH_PAD);
      }

      const bandRect: BoxPx = { x: bandLeft, y: topEdge, w: bandRight - bandLeft, h: gap };
      if (existingWallRects.some((wr) => iou(bandRect, wr) > 0.5)) continue;
      if (gap <= 0 || bandRight - bandLeft <= 0) continue;

      const strip = grayNoCols.roi(new cv.Rect(bandLeft, topEdge, bandRight - bandLeft, gap));
      t.mats.push(strip);
      if (strip.rows === 0 || strip.cols === 0) continue;

      const ink = thresholdT(
        cv,
        t,
        strip,
        params.HATCH_DENSITY_THRESH,
        255,
        cv.THRESH_BINARY_INV,
      );
      let k = Math.max(3, Math.min(21, Math.floor(strip.cols / 2)));
      if (k % 2 === 0) k += 1;
      const density = blurT(cv, t, ink, k, k);
      const denseMask = thresholdT(cv, t, density, 20, 255, cv.THRESH_BINARY);
      // Python np.ones((15,5)) = 15 tall x 5 wide -> Size(5,15)
      const closed = morphT(cv, t, denseMask, cv.MORPH_CLOSE, rectKernel(cv, t, 5, 15));

      const contours = findContoursT(cv, t, closed);
      for (const b of contourBoxes(cv, contours)) {
        const area = b.w * b.h;
        if (area < params.HATCH_MIN_AREA) continue;
        if (Math.min(b.w, b.h) < params.HATCH_MIN_SHORT) continue;
        if (b.h / Math.max(1.0, b.w) < params.HATCH_MIN_ASP) continue;
        results.push({
          x: bandLeft + b.x,
          y: topEdge + b.y,
          w: b.w,
          h: b.h,
          direction: 'V',
        });
      }
    }
  }

  return results;
}

/**
 * One page through the britania pipeline. `gray` is 8UC1 at the params' DPI.
 * Mirrors the Python process_page exactly: columns, then the three wall
 * pipelines with the same IoU dedup and kind labels ("wall" for primary and
 * supplemental, "wall_hatched" for hatch-bridge).
 */
export function detectBritaniaPage(
  cv: any,
  gray: any,
  params: BritaniaParams = BRITANIA_PARAMS,
): PlanPageResult {
  const t: MatTracker = newTracker();
  try {
    const {
      DPI,
      COLUMN_GRAY_LO,
      COLUMN_GRAY_HI,
      COLUMN_OPEN_KERNEL,
      COLUMN_MIN_AREA,
      COLUMN_MAX_ASPECT,
      COLUMN_MASK_EXPAND_PX,
      WALL_BLACK_THRESH,
      WALL_CLOSE_KERNEL,
      WALL_OPEN_KERNEL,
      WALL_DIR_OPEN_SHORT,
      WALL_DIR_OPEN_LONG,
      WALL_MIN_AREA,
      WALL_MIN_ASPECT,
      WALL_MIN_SHORT_SIDE,
    } = params;

    // ---- 1. columns: solid-grey squares ---------------------------------
    const grayMask = inRangeT(cv, t, gray, COLUMN_GRAY_LO, COLUMN_GRAY_HI);
    const colOpenKernel = rectKernel(cv, t, COLUMN_OPEN_KERNEL, COLUMN_OPEN_KERNEL);
    const colOpened = morphT(cv, t, grayMask, cv.MORPH_OPEN, colOpenKernel);
    const colContours = findContoursT(cv, t, colOpened);

    const columnsPx: BoxPx[] = [];
    const columns: PlanColumn[] = [];
    let colId = 1;
    for (const b of contourBoxes(cv, colContours)) {
      const area = b.w * b.h;
      const aspect = Math.max(b.w, b.h) / Math.max(1.0, Math.min(b.w, b.h));
      if (area <= COLUMN_MIN_AREA) continue;
      if (aspect >= COLUMN_MAX_ASPECT) continue;
      columnsPx.push(b);
      columns.push({
        id: colId,
        x0: r2(pxToPt(b.x, DPI)),
        y0: r2(pxToPt(b.y, DPI)),
        x1: r2(pxToPt(b.x + b.w, DPI)),
        y1: r2(pxToPt(b.y + b.h, DPI)),
        cx: r2(pxToPt(b.x + b.w / 2, DPI)),
        cy: r2(pxToPt(b.y + b.h / 2, DPI)),
      });
      colId += 1;
    }

    // ---- 2. erase columns from the wall image ----------------------------
    const grayNoCols = gray.clone();
    t.mats.push(grayNoCols);
    paintRectsWhite(cv, grayNoCols, columnsPx, COLUMN_MASK_EXPAND_PX);

    // ---- 3. black mask -> close -> open ----------------------------------
    const blackMask = thresholdT(
      cv,
      t,
      grayNoCols,
      WALL_BLACK_THRESH,
      255,
      cv.THRESH_BINARY_INV,
    );
    const closeKernel = rectKernel(cv, t, WALL_CLOSE_KERNEL, WALL_CLOSE_KERNEL);
    const wallMask = morphT(cv, t, blackMask, cv.MORPH_CLOSE, closeKernel);
    const openKernel = rectKernel(cv, t, WALL_OPEN_KERNEL, WALL_OPEN_KERNEL);
    const wallOpened = morphT(cv, t, wallMask, cv.MORPH_OPEN, openKernel);

    // ---- 4. directional open: isolate H and V wall segments --------------
    // Python kernel_h = np.ones((5,40)) = 5 tall x 40 wide -> Size(40,5);
    // kernel_v = np.ones((40,5)) = 40 tall x 5 wide -> Size(5,40).
    const kernelH = rectKernel(cv, t, WALL_DIR_OPEN_LONG, WALL_DIR_OPEN_SHORT);
    const maskH = morphT(cv, t, wallOpened, cv.MORPH_OPEN, kernelH);
    const kernelV = rectKernel(cv, t, WALL_DIR_OPEN_SHORT, WALL_DIR_OPEN_LONG);
    const maskV = morphT(cv, t, wallOpened, cv.MORPH_OPEN, kernelV);

    // ---- 5. PRIMARY walls -------------------------------------------------
    const walls: PlanWall[] = [];
    const accepted: BoxPx[] = []; // primary_rects: dedup base for supp + hatch
    let wallId = 1;

    const emitWall = (b: BoxPx, kind: string) => {
      walls.push({
        id: wallId,
        x0: r2(pxToPt(b.x, DPI)),
        y0: r2(pxToPt(b.y, DPI)),
        x1: r2(pxToPt(b.x + b.w, DPI)),
        y1: r2(pxToPt(b.y + b.h, DPI)),
        cx: r2(pxToPt(b.x + b.w / 2, DPI)),
        cy: r2(pxToPt(b.y + b.h / 2, DPI)),
        kind,
      });
      wallId += 1;
    };

    const filter = (mask: any, vertical: boolean) => {
      const contours = findContoursT(cv, t, mask);
      for (const b of contourBoxes(cv, contours)) {
        const area = b.w * b.h;
        const short = Math.min(b.w, b.h);
        const aspect = vertical
          ? b.h / Math.max(1.0, b.w)
          : b.w / Math.max(1.0, b.h);
        if (area < WALL_MIN_AREA) continue;
        if (short < WALL_MIN_SHORT_SIDE) continue;
        if (aspect < WALL_MIN_ASPECT) continue;
        accepted.push(b);
        emitWall(b, 'wall');
      }
    };
    filter(maskH, false);
    filter(maskV, true);

    // ---- 6. SUPPLEMENTAL walls -------------------------------------------
    for (const s of detectWallsSupplemental(cv, t, blackMask, params)) {
      const candidate: BoxPx = { x: s.x, y: s.y, w: s.w, h: s.h };
      if (accepted.some((pr) => iou(candidate, pr) > params.IOU_THRESH)) continue;
      if (columnsPx.some((col) => iou(candidate, col) > params.IOU_COL)) continue;
      accepted.push(candidate);
      emitWall(candidate, 'wall');
    }

    // ---- 7. HATCH-BRIDGE walls -------------------------------------------
    for (const s of detectHatchedBridges(cv, t, grayNoCols, columnsPx, accepted, params)) {
      const candidate: BoxPx = { x: s.x, y: s.y, w: s.w, h: s.h };
      if (accepted.some((pr) => iou(candidate, pr) > params.IOU_THRESH)) continue;
      if (columnsPx.some((col) => iou(candidate, col) > params.IOU_COL)) continue;
      accepted.push(candidate);
      emitWall(candidate, 'wall_hatched');
    }

    return { drawing_type: 'plan', columns, walls };
  } finally {
    releaseMats(t);
  }
}
