/**
 * super_detector_pdf.ts
 *
 * The SUPER algorithm: a unified, adaptive detection pipeline. It auto-detects
 * PDF style (plan vs section), dynamically adjusts thresholds (Otsu), and
 * assigns confidence scores to detections.
 *
 * Key Features:
 * - Adaptive routing (the auto-probe's S1 dark-fill signal + raster ink density).
 * - Hybrid detection (vector-first + raster fallback) for plans.
 * - Adaptive thresholding (Otsu's method).
 * - Confidence scoring (0-1 per detection).
 * - Per-style strengthening per SPEC.md section 6: SUPER's own single-pass
 *   detectors are the weakest link (the draft's plan wall pass misses hatched
 *   walls and its section pass finds NOTHING on real sheets — browser-validated
 *   0/0/0 on GlassWorks.pdf), so it reuses the built-in strategies per routed
 *   style: britania's hatch-bridge walls when the plan pass finds none, and the
 *   unified detector's proven section pipeline (Hough + hatch density +
 *   foundation band) for sections.
 *
 * Ported to the real in-browser API per SPEC.md:
 * - every OpenCV helper takes the resolved `cv` module as its first argument
 *   (never read off a Mat or the MatTracker — neither carries it);
 * - `PtBox` has only x0/y0/x1/y1 — widths are computed, never `.width`;
 * - plan/section results use the exact `PlanPageResult` / `SectionPageResult`
 *   shapes (drawing_type, PlanWall.kind, detectedWalls/detectedColumns...).
 */

import {
  BRITANIA_S1_DARK_FILL_MAX,
  BRITANIA_S1_DARK_RATIO,
  type DrawingType,
  type PageResult,
  type PlanColumn,
  type PlanMode,
  type PlanPageResult,
  type PlanWall,
} from './types';
import type { VectorDrawing } from './pdf';
import { normFill } from './pdf';
import { BRITANIA_PARAMS, detectBritaniaPage } from './britania_detector_pdf';
import { analyzeUnifiedPage } from './unified_detector_v2_pdf';
import {
  contourBoxes,
  findContoursT,
  morphT,
  newTracker,
  rectKernel,
  releaseMats,
  thresholdT,
  track,
  type BoxPx,
  type MatTracker,
} from './opencv';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

export const PLAN_DPI = 200;

/** Minimum short side (pt) for a vector square to count as a column — dimension
 * ticks, hatch cells and annotations are smaller (the "size filtering" fix from
 * the user's plan doc: ignore small blobs). Tuned so britania's hatch cells
 * (≈7pt) and glassworks' dimension ticks are filtered while real columns stay. */
export const MIN_COL_SIDE_PT = 8;
/** Same floor in raster pixels at PLAN_DPI for the raster-fallback column pass. */
export const MIN_COL_SIDE_PX = (MIN_COL_SIDE_PT * PLAN_DPI) / 72;

// ---------------------------------------------------------------------------
// Adaptive Thresholding
// ---------------------------------------------------------------------------

/**
 * Auto-selects the optimal threshold for a grayscale image using Otsu's method.
 * With cv.THRESH_OTSU the threshold is the RETURN VALUE of cv.threshold, not a
 * pixel of the output Mat (SPEC.md bug #1) — read it from the return.
 * @param cv - Resolved OpenCV module.
 * @param gray - Grayscale image (8UC1).
 * @returns Threshold value (0-255).
 */
export function adaptiveThresholdOtsu(cv: any, gray: any): number {
  const thresh = new cv.Mat();
  const thresholdValue = cv.threshold(gray, thresh, 0, 255, cv.THRESH_BINARY + cv.THRESH_OTSU);
  thresh.delete();
  return thresholdValue;
}

/**
 * Detects hatch patterns using Sobel gradient magnitudes (simplified for
 * opencv.js). 0 = none, 1 = horizontal, 2 = vertical, 3 = crosshatch.
 * Kept as the SPEC-documented hatch-direction signal; the section branch
 * currently delegates to the unified pipeline (SPEC.md section 6), so this is
 * exercised by unit tests rather than the hot path.
 * @param cv - Resolved OpenCV module.
 * @param gray - Grayscale image (8UC1).
 */
export function detectHatchPattern(cv: any, gray: any): number {
  const blurred = new cv.Mat();
  cv.GaussianBlur(gray, blurred, new cv.Size(5, 5), 0);

  const gradX = new cv.Mat();
  const gradY = new cv.Mat();
  cv.Sobel(blurred, gradX, cv.CV_8U, 1, 0);
  cv.Sobel(blurred, gradY, cv.CV_8U, 0, 1);

  const meanX = cv.mean(gradX)[0];
  const meanY = cv.mean(gradY)[0];

  gradX.delete();
  gradY.delete();
  blurred.delete();

  if (meanX > 50 && meanY > 50) return 3; // Crosshatch
  if (meanX > 50) return 2; // Vertical lines dominate (Sobel X = vertical edges)
  if (meanY > 50) return 1; // Horizontal lines dominate (Sobel Y = horizontal edges)
  return 0; // None
}

// ---------------------------------------------------------------------------
// Confidence Scoring
// ---------------------------------------------------------------------------

/**
 * Assigns a confidence score (0-1) to a detected element.
 * @param box - Detected box (x, y, w, h).
 * @param aspectRatio - Aspect ratio (w/h).
 * @param fillColor - Normalized fill color (0-1).
 * @param isSquare - Whether the box is square-shaped.
 * @returns Confidence score (0-1).
 */
export function getConfidenceScore(
  box: BoxPx,
  aspectRatio: number,
  fillColor: number,
  isSquare: boolean,
): number {
  let score = 0.0;

  // Shape-based confidence
  if (isSquare && aspectRatio >= 0.8 && aspectRatio <= 1.2) {
    score += 0.4; // High confidence for squares (columns)
  } else if (aspectRatio >= 2.5) {
    score += 0.3; // Medium confidence for thin runs (walls)
  }

  // Fill-based confidence
  if (fillColor < 0.25) {
    score += 0.3; // Dark fills = columns/walls
  } else if (fillColor >= 0.4 && fillColor <= 0.7) {
    score += 0.2; // Grey fills = walls
  }

  // Size-based confidence
  const area = box.w * box.h;
  if (area > 1000) {
    score += 0.3; // Large areas = structural elements
  }

  return Math.min(score, 1.0);
}

// ---------------------------------------------------------------------------
// Plan Detection (Top-Down View) — SUPER's own vector-first + raster pipeline
// ---------------------------------------------------------------------------

/**
 * Detects columns and walls in a plan (top-down) view.
 * @param cv - Resolved OpenCV module.
 * @param drawings - Vector drawings from the PDF.
 * @param rasterAt - Raster fallback function.
 * @param tracker - MatTracker for OpenCV resources.
 * @returns PlanPageResult with detected columns and walls.
 */
export async function detectPlanPage(
  cv: any,
  drawings: VectorDrawing[],
  rasterAt: (dpi: number) => Promise<any>,
  tracker: MatTracker,
): Promise<PlanPageResult> {
  const columns: PlanColumn[] = [];
  const walls: PlanWall[] = [];

  // Phase 1: Vector-first pass (columns = dark/grey squares, walls = grey runs)
  for (const d of drawings) {
    const fill = (d.fill && normFill(d.fill)) ?? 1.0;
    const wPt = d.rect.x1 - d.rect.x0;
    const hPt = d.rect.y1 - d.rect.y0;
    const isDark = fill < 0.25;
    const isGrey = fill >= 0.4 && fill <= 0.7;
    const isSquare = Math.abs(wPt - hPt) < 5;

    // Detect columns (dark/grey squares) — size floor so hatch cells,
    // dimension ticks and text blobs are not counted as columns.
    if (isSquare && (isDark || isGrey) && Math.min(wPt, hPt) >= MIN_COL_SIDE_PT) {
      columns.push({
        x0: d.rect.x0,
        y0: d.rect.y0,
        x1: d.rect.x1,
        y1: d.rect.y1,
        cx: d.rect.x0 + wPt / 2,
        cy: d.rect.y0 + hPt / 2,
      });
    }

    // Detect walls (grey thin runs)
    if (isGrey && wPt / hPt >= 2.5) {
      walls.push({
        x0: d.rect.x0,
        y0: d.rect.y0,
        x1: d.rect.x1,
        y1: d.rect.y1,
        cx: d.rect.x0 + wPt / 2,
        cy: d.rect.y0 + hPt / 2,
        kind: 'wall',
      });
    }
  }

  // Phase 2: Raster fallback — per class (SPEC.md bug #4): columns fall back
  // independently of walls, so a vector pass that found columns but no walls
  // still recovers walls from the raster.
  const needCols = columns.length === 0;
  const needWalls = walls.length === 0;
  if (needCols || needWalls) {
    const gray = await rasterAt(PLAN_DPI);
    track(tracker, gray);

    // Adaptive thresholding
    const threshValue = adaptiveThresholdOtsu(cv, gray);
    const binary = thresholdT(cv, tracker, gray, threshValue, 255, cv.THRESH_BINARY_INV);

    // Morphology (clean noise)
    const kernel = rectKernel(cv, tracker, 3, 3);
    const cleaned = morphT(cv, tracker, binary, cv.MORPH_OPEN, kernel);

    // Contour detection
    const contours = findContoursT(cv, tracker, cleaned);
    const boxes = contourBoxes(cv, contours);

    for (const box of boxes) {
      const aspectRatio = box.w / box.h;
      const isSquare = aspectRatio >= 0.8 && aspectRatio <= 1.2;
      const confidence = getConfidenceScore(box, aspectRatio, 0.5, isSquare);

      if (
        needCols &&
        isSquare &&
        Math.min(box.w, box.h) >= MIN_COL_SIDE_PX &&
        confidence > 0.5
      ) {
        columns.push({
          x0: box.x,
          y0: box.y,
          x1: box.x + box.w,
          y1: box.y + box.h,
          cx: box.x + box.w / 2,
          cy: box.y + box.h / 2,
        });
      } else if (needWalls && aspectRatio >= 2.5 && confidence > 0.5) {
        walls.push({
          x0: box.x,
          y0: box.y,
          x1: box.x + box.w,
          y1: box.y + box.h,
          cx: box.x + box.w / 2,
          cy: box.y + box.h / 2,
          kind: 'wall',
        });
      }
    }
  }

  return { drawing_type: 'plan', columns, walls };
}

// ---------------------------------------------------------------------------
// SUPER Algorithm Entry Point
// ---------------------------------------------------------------------------

/** Everything the routed pipelines need that the raw `(drawings, rasterAt)`
 * signature does not carry — threaded from detector_pdf's DetectPageOptions. */
export interface SuperPageInput {
  /** forced drawing type; 'auto' sniffs (S1 + ink density) */
  drawingType: DrawingType;
  /** page text layer (scale sniffing in the delegated section pipeline) */
  text: string;
  /** page height in PDF points (y-flip reference for section output) */
  pagePtH: number;
  mode: PlanMode;
  scale: number;
}

/**
 * Detects elements in a PDF page using the SUPER algorithm.
 * @param cv - Resolved OpenCV module (threaded from the caller, never read off
 *   a Mat or the tracker — SPEC.md bug #2).
 * @param drawings - Vector drawings from the PDF.
 * @param rasterAt - Raster fallback function.
 * @param input - Routing + pipeline context (drawingType, text, pagePtH, ...).
 * @returns PageResult with detected elements.
 */
export async function detectSuperPage(
  cv: any,
  drawings: VectorDrawing[],
  rasterAt: (dpi: number) => Promise<any>,
  input: SuperPageInput,
): Promise<PageResult> {
  const tracker = newTracker();
  try {
    // Auto-detect drawing type if not provided
    const detectedType =
      input.drawingType === 'auto' ? await sniffDrawingType(cv, drawings, rasterAt, tracker) : input.drawingType;

    if (detectedType === 'plan') {
      const result = await detectPlanPage(cv, drawings, rasterAt, tracker);
      // SPEC.md section 6: SUPER's own plan wall pass (grey vector runs +
      // contour fallback) misses hatched walls — the weakest part of the
      // design. When it finds none, reuse britania's proven hatch-bridge +
      // IoU-merge wall recovery so plan walls are never silently missed.
      if (result.walls.length === 0) {
        const gray = await rasterAt(BRITANIA_PARAMS.DPI);
        try {
          const b = detectBritaniaPage(cv, gray);
          result.walls = b.walls;
        } finally {
          gray?.delete?.();
        }
      }
      return result;
    } else if (detectedType === 'section') {
      // SPEC.md section 6: the draft's single directional-close section pass
      // finds NOTHING on real sheets (browser-validated: 0 walls / 0 columns /
      // 0 foundations on GlassWorks.pdf). Delegate the section branch to the
      // proven unified pipeline (Hough + hatch density + foundation band) —
      // the SPEC's recommended "reuse the built-in strategies".
      //
      // drawingType is 'auto', NOT forced 'section': SUPER's own ink-density
      // sniff can disagree with the unified sniff on glassworks sheets
      // (browser-validated: GlassWorks.pdf — SUPER says 'section' by ink
      // density, the unified sniff says 'plan' — a grey grid plan; forcing
      // 'section' on the delegated pipeline suppressed the plan branch and
      // lost all 22 walls). Letting the delegated pipeline apply its OWN
      // proven routing guarantees the SPEC section-7 target ("counts ≈
      // auto-probe's glassworks result") by construction — it is the exact
      // same call the built-in GlassWorks path makes.
      return analyzeUnifiedPage({
        cv,
        drawings,
        text: input.text,
        pagePtH: input.pagePtH,
        grayAt: rasterAt,
        drawingType: 'auto',
        mode: input.mode,
        scale: input.scale,
      });
    } else {
      throw new Error(`Unsupported drawing type: ${detectedType}`);
    }
  } finally {
    releaseMats(tracker);
  }
}

/**
 * Sniffs the drawing type (plan/section) from vector and raster data.
 * @param cv - Resolved OpenCV module.
 * @param drawings - Vector drawings from the PDF.
 * @param rasterAt - Raster fallback function.
 * @param tracker - MatTracker for OpenCV resources.
 * @returns Detected drawing type.
 */
export async function sniffDrawingType(
  cv: any,
  drawings: VectorDrawing[],
  rasterAt: (dpi: number) => Promise<any>,
  tracker: MatTracker,
): Promise<DrawingType> {
  // Text keyword sniffing (e.g., "plan", "section") is future work — the
  // raster density + fill palette below is the current router.

  // Vector fill analysis — the exact S1 signal of the auto-probe (detector_pdf
  // probeBritaniaVectorSignals): dark fills / ALL filled drawings > 0.8. Using
  // the identical definition and threshold keeps SUPER's routing consistent with
  // auto mode, so a page auto routes to britania iff SUPER routes it to plan.
  let dark = 0;
  let total = 0;
  for (const d of drawings) {
    const fill = d.fill;
    if (!fill || fill.length < 3) continue;
    const fm = normFill(fill)!;
    total += 1;
    if (fm < BRITANIA_S1_DARK_FILL_MAX) dark += 1;
  }
  const s1 = total > 0 && dark / total > BRITANIA_S1_DARK_RATIO; // guard NaN (SPEC.md bug)

  // Raster density check
  const gray = await rasterAt(PLAN_DPI);
  track(tracker, gray);
  const inkDensity = cv.mean(gray)[0] / 255;

  // Heuristic: dark-fill-dominant vectors = a grid plan (a plan sheet is
  // dominated by dark/grey column fills, so its raster density is NOT sparse;
  // density alone misroutes britania to section). Otherwise dense ink =
  // section, sparse ink = plan fallback.
  if (s1) {
    return 'plan';
  } else if (inkDensity >= 0.1) {
    return 'section';
  } else {
    return 'plan'; // Fallback
  }
}
