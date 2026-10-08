import type { DrawingDoc, Material } from '../types';
import { contentBounds, type Rect } from './geometry';

/**
 * What goes into an exported drawing - the PDF sheet and the JSON file - as
 * plain data, so the choices can be remembered, repaired when saved by an older
 * version, and tested without a browser.
 *
 * The PDF's own switches live in `PdfVisibility` (lib/dimensions), because the
 * display settings shared them first; this holds what only the export needs.
 */

export type SheetSize = 'A4' | 'A3';
export const SHEET_SIZES: readonly SheetSize[] = ['A4', 'A3'];

export function normalizeSheetSize(raw: unknown): SheetSize {
  return raw === 'A3' ? 'A3' : 'A4';
}

/** Which parts of the drawing the JSON file carries. */
export interface JsonExportOptions {
  /** the placed formwork */
  pieces: boolean;
  /** definitions of the materials those pieces use, so another catalog can open them */
  materials: boolean;
  /** the drawn layout lines */
  sketch: boolean;
  /** the measured lines */
  measures: boolean;
  /** every leg's and measurement's length written out, for whatever reads the file next */
  lengths: boolean;
  /** project, revision and scale */
  titleBlock: boolean;
}

/** Everything the file always held, and the lengths as an extra it did not. */
export const DEFAULT_JSON_EXPORT: JsonExportOptions = {
  pieces: true,
  materials: true,
  sketch: true,
  measures: true,
  lengths: false,
  titleBlock: true,
};

export function normalizeJsonExport(raw: unknown): JsonExportOptions {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_JSON_EXPORT };
  for (const key of Object.keys(out) as Array<keyof JsonExportOptions>) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  return out;
}

export interface SheetContent {
  pieces: boolean;
  sketch: boolean;
  measures: boolean;
}

/**
 * The world-cm box around what the sheet will actually carry.
 *
 * Only what is switched on counts. A sheet of setting-out lines with the panels
 * turned off has to be scaled to the lines - scaling it to panels that are not
 * printed leaves the lines small in a corner, or off the paper when a line runs
 * past the last panel. Null when nothing is left to draw.
 */
export function sheetBounds(
  doc: Pick<DrawingDoc, 'pieces' | 'sketch' | 'measures'>,
  byId: Map<string, Material>,
  include: SheetContent,
): Rect | null {
  const pieces = include.pieces ? contentBounds(doc.pieces, byId) : null;
  let minX = pieces ? pieces.x : Infinity;
  let minY = pieces ? pieces.y : Infinity;
  let maxX = pieces ? pieces.x + pieces.w : -Infinity;
  let maxY = pieces ? pieces.y + pieces.h : -Infinity;
  const add = (x: number, y: number) => {
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };
  if (include.sketch) {
    for (const path of doc.sketch ?? []) for (const p of path.points) add(p.x, p.y);
  }
  if (include.measures) {
    for (const m of doc.measures ?? []) {
      add(m.a.x, m.a.y);
      add(m.b.x, m.b.y);
    }
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}
