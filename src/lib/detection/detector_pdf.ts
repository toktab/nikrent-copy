/**
 * detector_pdf.ts
 *
 * Browser port of detector.py — the merged auto-selecting detector. Per page it
 * probes for Britania-style traits and routes the page to the britania pipeline
 * (britania_detector_pdf.ts) or the GlassWorks pipeline
 * (unified_detector_v2_pdf.ts), then hands the legacy `{source, all_pages}`
 * shape to the shared render path (src/lib/detectImport.ts).
 *
 * The probe mirrors _probe_britania_style: five signals, three or more select
 * the britania path. S1/S2/S4 read the vector fills (getPageDrawings), S3 the
 * text layer, S5 the rasterised page (PROBE_DPI, same grey-column thresholds
 * as the britania column pass). Every mat is tracked and released; `rasterAt`
 * hands back a caller-owned gray Mat.
 */

import {
  BRITANIA_S1_DARK_FILL_MAX,
  BRITANIA_S1_DARK_RATIO,
  type AlgorithmChoice,
  type AlgorithmName,
  type DrawingType,
  type PlanMode,
  type PageResult,
} from './types';
import type { VectorDrawing } from './pdf';
import { getPageDrawings, getPageText, normFill } from './pdf';
import { BRITANIA_PARAMS, detectBritaniaPage } from './britania_detector_pdf';
import { analyzeUnifiedPage } from './unified_detector_v2_pdf';
import { detectSuperPage } from './super_detector_pdf';
import {
  contourBoxes,
  findContoursT,
  inRangeT,
  morphT,
  newTracker,
  rectKernel,
  releaseMats,
} from './opencv';

export const PROBE_DPI = 150;
export const BRITANIA_MIN_SCORE = 3;

const BRITANIA: AlgorithmName = 'britania';
const GLASSWORKS: AlgorithmName = 'glassworks';

/** How the page is rasterised: `(dpi) => Promise<gray>` (8UC1, caller frees). */
export type RasterAt = (dpi: number) => Promise<any>;

export interface DetectPageOptions {
  cv: any;
  algorithm: AlgorithmChoice;
  drawingType: DrawingType;
  mode: PlanMode;
  /** the resolved drawing scale (1:<scale>) — glassworks pages only */
  scale: number;
  /** page height in PDF points (y-flip reference for section output) */
  pagePtH: number;
}

// ---------------------------------------------------------------------------
// probe (signals S1–S4 are pure; S5 needs the raster)
// ---------------------------------------------------------------------------

export interface BritaniaVectorSignals {
  s1: boolean;
  s2: boolean;
  s3: boolean;
  s4: boolean;
  score: number;
}

/**
 * S1–S4 of _probe_britania_style, computed from the vector layer and the text
 * layer only (no raster — hence unit-testable in Node).
 */
export function probeBritaniaVectorSignals(
  drawings: VectorDrawing[],
  text: string,
): BritaniaVectorSignals {
  let dark = 0;
  let total = 0;
  let big = 0;
  for (const d of drawings) {
    const fill = d.fill;
    if (!fill || fill.length < 3) continue;
    const fm = normFill(fill)!;
    total += 1;
    if (fm < BRITANIA_S1_DARK_FILL_MAX) dark += 1;
    const r = d.rect;
    if ((r.x1 - r.x0) * (r.y1 - r.y0) > 3000) big += 1;
  }
  const words = text.split(/\s+/).filter(Boolean).length;
  const s1 = total > 0 && dark / total > BRITANIA_S1_DARK_RATIO;
  const s2 = dark > 150;
  const s3 = words < 20;
  const s4 = big === 0;
  return { s1, s2, s3, s4, score: (s1 ? 1 : 0) + (s2 ? 1 : 0) + (s3 ? 1 : 0) + (s4 ? 1 : 0) };
}

/** S5: solid-grey square columns on the rasterised page (PROBE_DPI). */
export function probeGreyColumns(cv: any, gray: any): number {
  const t = newTracker();
  try {
    const gm = inRangeT(
      cv,
      t,
      gray,
      BRITANIA_PARAMS.COLUMN_GRAY_LO,
      BRITANIA_PARAMS.COLUMN_GRAY_HI,
    );
    const k = rectKernel(
      cv,
      t,
      BRITANIA_PARAMS.COLUMN_OPEN_KERNEL,
      BRITANIA_PARAMS.COLUMN_OPEN_KERNEL,
    );
    const opened = morphT(cv, t, gm, cv.MORPH_OPEN, k);
    const contours = findContoursT(cv, t, opened);
    let greyCols = 0;
    for (const b of contourBoxes(cv, contours)) {
      if (b.w * b.h <= BRITANIA_PARAMS.COLUMN_MIN_AREA) continue;
      if (
        Math.max(b.w, b.h) / Math.max(1, Math.min(b.w, b.h)) >=
        BRITANIA_PARAMS.COLUMN_MAX_ASPECT
      ) {
        continue;
      }
      greyCols += 1;
    }
    return greyCols;
  } finally {
    releaseMats(t);
  }
}

/** Full probe: True when the page looks like a Britania plan (>=3 of 5). */
export function probeBritaniaStyle(
  cv: any,
  drawings: VectorDrawing[],
  text: string,
  gray: any,
): boolean {
  const v = probeBritaniaVectorSignals(drawings, text);
  const s5 = probeGreyColumns(cv, gray) >= 5;
  return v.score + (s5 ? 1 : 0) >= BRITANIA_MIN_SCORE;
}

// ---------------------------------------------------------------------------
// per-page dispatch
// ---------------------------------------------------------------------------

/**
 * One page through the merged detector. The algorithm choice is forced when
 * `options.algorithm !== 'auto'`, else decided by the probe (matching
 * detector.py's per-page auto-select). Returns the page result plus the
 * algorithm that produced it, for the `algorithms` map of the legacy JSON.
 */
export async function detectPage(
  page: any,
  rasterAt: RasterAt,
  options: DetectPageOptions,
): Promise<{ algo: AlgorithmName; result: PageResult }> {
  const drawings = await getPageDrawings(page);
  let algo: AlgorithmName;
  let text: string | null = null;

  if (options.algorithm === 'auto') {
    text = await getPageText(page);
    const gray = await rasterAt(PROBE_DPI);
    try {
      const v = probeBritaniaVectorSignals(drawings, text);
      const s5 = probeGreyColumns(options.cv, gray) >= 5;
      algo = v.score + (s5 ? 1 : 0) >= BRITANIA_MIN_SCORE ? BRITANIA : GLASSWORKS;
    } catch {
      algo = GLASSWORKS;
    } finally {
      gray?.delete?.();
    }
  } else {
    // Validate algorithm — if unknown (e.g., 'ai-generate' which is UI-only),
    // fall back to auto-probe. This should not happen in practice since the UI
    // blocks invalid choices, but TypeScript requires the narrowing.
    const alg = options.algorithm;
    if (alg === 'britania' || alg === 'glassworks' || alg === 'super' || alg === 'custom') {
      algo = alg;
    } else {
      // Unknown algorithm — probe to decide
      text = await getPageText(page);
      const gray = await rasterAt(PROBE_DPI);
      try {
        const v = probeBritaniaVectorSignals(drawings, text);
        const s5 = probeGreyColumns(options.cv, gray) >= 5;
        algo = v.score + (s5 ? 1 : 0) >= BRITANIA_MIN_SCORE ? BRITANIA : GLASSWORKS;
      } catch {
        algo = GLASSWORKS;
      } finally {
        gray?.delete?.();
      }
    }
  }

  if (algo === BRITANIA) {
    const gray = await rasterAt(BRITANIA_PARAMS.DPI);
    try {
      return { algo, result: detectBritaniaPage(options.cv, gray) };
    } finally {
      gray?.delete?.();
    }
  } else if (algo === 'super') {
    try {
      if (text === null) text = await getPageText(page);
      return {
        algo,
        result: await detectSuperPage(options.cv, drawings, rasterAt, {
          drawingType: options.drawingType,
          text,
          pagePtH: options.pagePtH,
          mode: options.mode,
          scale: options.scale,
        }),
      };
    } catch (error) {
      console.error('SUPER algorithm failed, falling back to GlassWorks:', error);
      algo = GLASSWORKS;
    }
  }

  if (text === null) text = await getPageText(page);
  const result = await analyzeUnifiedPage({
    cv: options.cv,
    drawings,
    text,
    pagePtH: options.pagePtH,
    drawingType: options.drawingType,
    mode: options.mode,
    scale: options.scale,
    grayAt: rasterAt,
  });
  return { algo, result };
}
