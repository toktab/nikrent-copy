import type { SketchPath } from '../types';
import { uid } from './ids';

/**
 * Client-side import of detection JSON — no Python, no server.py.
 *
 * Accepts the raw output of `python britania_detector.py <drawing.pdf> --json`
 * (a legacy document: `{source, all_pages}`, schemaVersion absent) and converts
 * it to schema v1, then to sketch rectangles on the plan. Files that are already
 * schema v1 pass through unchanged, so both imports render identically.
 *
 * Key fact about the legacy shape: every coordinate is a PDF page point in a
 * y-down system, and the detector never computes physical sizes — columns and
 * walls carry only bounding boxes (`x0..y1`) and centroids (`cx/cy`).
 */

export const CM_PER_INCH = 2.54;
export const PT_PER_INCH = 72.0;

/** Gap in world units between imported pages laid side by side on the plan. */
export const PAGE_GAP = 100;
/** Margin around the detected content that counts as the "sheet". */
export const PAGE_MARGIN = 40;

/** Detection box inside a legacy britania page (page-point coordinates). */
export interface LegacyBritaniaBox {
  id?: number | string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  kind?: string;
}

export interface LegacyBritaniaPage {
  drawing_type?: string;
  columns?: LegacyBritaniaBox[];
  walls?: LegacyBritaniaBox[];
}

export interface LegacyBritaniaDoc {
  source?: { pdf?: string; n_pages?: number };
  all_pages: Record<string, LegacyBritaniaPage>;
}

export interface SchemaObject {
  id: string;
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  cx: number;
  cy: number;
  widthCm?: number | null;
  depthCm?: number | null;
  lengthCm?: number | null;
  thicknessCm?: number | null;
  rotation?: number;
  source?: string;
  [key: string]: unknown;
}

/** Round to 2 decimals — world cm values deserve no more noise. */
export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** True for the raw britania_detector.py --json output. */
export function isLegacyBritania(doc: unknown): doc is LegacyBritaniaDoc {
  const d = doc as Record<string, unknown> | null;
  return (
    !!d &&
    typeof d === 'object' &&
    d.schemaVersion == null &&
    !!d.all_pages &&
    typeof d.all_pages === 'object' &&
    Object.keys(d.all_pages).some((k) => /^page_\d+$/.test(k))
  );
}

/** True for a schema v1 detection document (pass through unchanged). */
export function isSchemaV1(doc: unknown): doc is Record<string, unknown> {
  const d = doc as Record<string, unknown> | null;
  return (
    !!d &&
    typeof d === 'object' &&
    d.schemaVersion === 1 &&
    typeof d.all_pages === 'undefined'
  );
}

/**
 * One legacy britania page -> schema v1 page objects.
 *
 * `pagePtW/pagePtH` (page points) describe the sheet the boxes sit on;
 * `scale` is the drawing scale denominator (1:50 -> 50). k = page pt -> world
 * cm. The legacy JSON carries no page size and no scale, so the caller decides:
 * pass `scale = PT_PER_INCH / CM_PER_INCH` for k = 1 (render in page-point
 * space — proportions are exact, units are just page points) or the real scale
 * once it is known.
 */
export function legacyBritaniaPageToSchema(
  pageDict: LegacyBritaniaPage,
  pageIndex: number,
  pagePtW: number,
  pagePtH: number,
  scale: number,
): {
  index: number;
  pagePtW: number;
  pagePtH: number;
  drawingType: string;
  coords: string;
  units: string;
  objects: {
    columns: SchemaObject[];
    walls: SchemaObject[];
    foundations: [];
    grid: [];
    corners: [];
    lines: [];
    arcs: [];
    text: [];
  };
} {
  const k = (CM_PER_INCH / PT_PER_INCH) * scale; // page pt -> world cm

  const columns = (pageDict.columns ?? []).map((c) => ({
    id: `col-${c.id}`,
    x0: c.x0,
    y0: c.y0,
    x1: c.x1,
    y1: c.y1, // already page pts, reuse as-is
    cx: round2(c.cx * k),
    cy: round2(c.cy * k), // world cm
    widthCm: null,
    depthCm: null, // unknown — britania never computes this
    rotation: 0,
    source: 'britania',
  }));

  const walls = (pageDict.walls ?? []).map((w) => {
    const horizontal = w.x1 - w.x0 >= w.y1 - w.y0;
    return {
      id: `wall-${w.id}`,
      x0: w.x0,
      y0: w.y0,
      x1: w.x1,
      y1: w.y1,
      cx: round2(w.cx * k),
      cy: round2(w.cy * k),
      lengthCm: null,
      thicknessCm: null,
      rotation: horizontal ? 0 : 90,
      kind: 'wall',
      source: 'britania',
    };
  });

  return {
    index: pageIndex,
    pagePtW,
    pagePtH,
    drawingType: 'plan',
    coords: 'y-down-page-pts',
    units: 'world-cm',
    objects: {
      columns,
      walls,
      foundations: [],
      grid: [],
      corners: [],
      lines: [],
      arcs: [],
      text: [],
    },
  };
}

/** Content extents of a legacy page, in page points. */
function pageExtent(pageDict: LegacyBritaniaPage) {
  const xs: number[] = [];
  const ys: number[] = [];
  for (const grp of ['columns', 'walls'] as const) {
    for (const o of pageDict[grp] ?? []) {
      xs.push(o.x0, o.x1);
      ys.push(o.y0, o.y1);
    }
  }
  return {
    minX: xs.length ? Math.min(...xs) : 0,
    maxX: xs.length ? Math.max(...xs) : 0,
    minY: ys.length ? Math.min(...ys) : 0,
    maxY: ys.length ? Math.max(...ys) : 0,
  };
}

/** Page size guess: the legacy JSON has none, so use the object extents. */
function estimatePagePt(pageDict: LegacyBritaniaPage, margin = PAGE_MARGIN) {
  const { minX, maxX, minY, maxY } = pageExtent(pageDict);
  return {
    left: minX - margin,
    top: minY - margin,
    w: Math.round(maxX - minX + 2 * margin),
    h: Math.round(maxY - minY + 2 * margin),
  };
}

/**
 * Convert a legacy britania document to schema v1 (all pages).
 *
 * `scale` defaults so that k = 1 (page-point space — see
 * `legacyBritaniaPageToSchema`). The bridge's MM_SCALE equivalent (150) is what
 * the server flow assumes for plans; pass it when a real drawing scale is known.
 */
export function legacyBritaniaToV1(
  doc: LegacyBritaniaDoc,
  fileName?: string,
  scale: number = PT_PER_INCH / CM_PER_INCH,
): Record<string, unknown> {
  const keys = Object.keys(doc.all_pages)
    .filter((k) => /^page_\d+$/.test(k))
    .sort((a, b) => Number(a.replace('page_', '')) - Number(b.replace('page_', '')));
  if (!keys.length) throw new Error('all_pages contains no page_N entries');

  const pages = keys.map((key, i) => {
    const pageIndex = Number(key.replace('page_', '')) || i + 1;
    const pageDict = doc.all_pages[key];
    const { w, h } = estimatePagePt(pageDict);
    return {
      key,
      index: pageIndex,
      page: legacyBritaniaPageToSchema(pageDict, pageIndex, w, h, scale),
    };
  });

  const first = pages[0];
  const dpi = 300; // britania rasterises at 300 DPI
  const schema: Record<string, unknown> = {
    schemaVersion: 1,
    detector: {
      name: 'britania_detector.py (client import)',
      version: '1.0.0',
      generatedAt: new Date().toISOString(),
    },
    pdf: {
      file: fileName || doc.source?.pdf || 'detected',
      pages: doc.source?.n_pages ?? pages.length,
    },
    params: {
      drawingType: 'plan',
      scale,
      scaleSuggest: scale,
      scaleSuggestSource: null,
      page: first.index,
      dpi,
      minThickCm: 20,
    },
  };
  for (const { key, index, page } of pages) {
    schema[key] = {
      ...page,
      pxW: Math.round(page.pagePtW * dpi / PT_PER_INCH),
      pxH: Math.round(page.pagePtH * dpi / PT_PER_INCH),
    };
  }
  return schema;
}

/** Schema v1 page numbers, in document order. */
export function schemaPageKeys(schema: Record<string, unknown>): string[] {
  return Object.keys(schema)
    .filter((k) => /^page_\d+$/.test(k))
    .sort((a, b) => Number(a.replace('page_', '')) - Number(b.replace('page_', '')));
}

/**
 * Turn a schema v1 document into closed rectangle sketch paths — one per
 * detected box (columns, walls, foundations), laid out page by page from left
 * to right so every page of a multi-page drawing stays visible on the plan.
 *
 * Each page's content is normalised to its own origin first (the schema keeps
 * raw page-point coordinates, which may start well above zero), so pages never
 * overlap no matter where the drawing sat on the sheet. Relative positions and
 * proportions inside a page are preserved exactly.
 */
export function schemaToSketchPaths(
  schema: Record<string, unknown>,
  gap = PAGE_GAP,
  margin = PAGE_MARGIN,
): SketchPath[] {
  const paths: SketchPath[] = [];
  let xOffset = 0;
  for (const key of schemaPageKeys(schema)) {
    const page = schema[key] as {
      pagePtW?: number;
      objects?: {
        columns?: SchemaObject[];
        walls?: SchemaObject[];
        foundations?: SchemaObject[];
      };
    };
    const objs = page?.objects ?? {};
    const boxes = [
      ...(objs.columns ?? []),
      ...(objs.walls ?? []),
      ...(objs.foundations ?? []),
    ].filter((o) => typeof o.x0 === 'number');
    const xs = boxes.flatMap((o) => [o.x0, o.x1]);
    const left = xs.length ? Math.min(...xs) - margin : 0;
    for (const o of boxes) {
      paths.push({
        id: uid('sk'),
        points: [
          { x: o.x0 - left + xOffset, y: o.y0 },
          { x: o.x1 - left + xOffset, y: o.y0 },
          { x: o.x1 - left + xOffset, y: o.y1 },
          { x: o.x0 - left + xOffset, y: o.y1 },
        ],
        closed: true,
      });
    }
    xOffset += (page?.pagePtW ?? 0) + gap;
  }
  return paths;
}
