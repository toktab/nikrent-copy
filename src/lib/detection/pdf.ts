/**
 * pdf.js integration for the in-browser detectors.
 *
 * Runs entirely inside the detection Web Worker (module worker, so ESM
 * imports work). pdf.js does the parsing; pages are rasterised to grayscale
 * Mats for the OpenCV pipelines, and the operator list is walked to recover
 * the structured vector fills/strokes that PyMuPDF's `get_drawings()` provides
 * the Python originals.
 *
 * Coordinate conventions reproduced from PyMuPDF:
 *   - raster pixels: y-down, top-left origin, scale = dpi/72 px per pt;
 *   - vector rects/points: PDF page points, y-down, top-left origin
 *     (PDF content space is y-up bottom-left; the y axis is flipped here using
 *     the page height, exactly as PyMuPDF does).
 */

import * as pdfjsLib from 'pdfjs-dist';

export type { PDFDocumentProxy, PDFPageProxy } from 'pdfjs-dist';

// ---------------------------------------------------------------------------
// pdf.js v6 engine-compat polyfills
//
// pdf.js v6 relies on several APIs that are younger than Chrome 130 / Electron
// 33 (the Freebuff preview engine): `Uint8Array.prototype.toHex` and
// `.toBase64` / `Uint8Array.fromBase64` landed in Chrome 133+, and
// `Map.prototype.getOrInsert` / `getOrInsertComputed` in Chrome 137+. Without
// them the pipeline dies mid-parse: first "hashOriginal.toHex is not a
// function" (document fingerprint), then "_intentStates.getOrInsertComputed
// is not a function" (first page render). Each polyfill implements the TC39
// semantics and only installs when the native method is missing. The worker
// is the only place pdf.js loads (this module is imported by
// detectionWorker.ts), so guarding here covers the whole app.
// ---------------------------------------------------------------------------

type U8 = Uint8Array;
type U8Ctor = typeof Uint8Array;

if (!(Uint8Array.prototype as U8 & { toHex?: () => string }).toHex) {
  Object.defineProperty(Uint8Array.prototype, 'toHex', {
    configurable: true,
    writable: true,
    value: function toHex(): string {
      const { length } = this as Uint8Array;
      const out = new Array<string>(length);
      for (let i = 0; i < length; i++) {
        out[i] = (this[i] < 16 ? '0' : '') + this[i].toString(16);
      }
      return out.join('');
    },
  });
}
if (!(Uint8Array as U8Ctor & { fromHex?: (hex: string) => Uint8Array }).fromHex) {
  Object.defineProperty(Uint8Array, 'fromHex', {
    configurable: true,
    writable: true,
    value: function fromHex(hex: string): Uint8Array {
      const len = hex.length >> 1;
      const out = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        out[i] = Number.parseInt(hex.slice(i * 2, i * 2 + 2), 16);
      }
      return out;
    },
  });
}
if (!(Uint8Array.prototype as U8 & { toBase64?: () => string }).toBase64) {
  Object.defineProperty(Uint8Array.prototype, 'toBase64', {
    configurable: true,
    writable: true,
    value: function toBase64(): string {
      const { length } = this as Uint8Array;
      let binary = '';
      // String.fromCharCode(...) with a huge spread blows the stack; chunk it.
      const CHUNK = 0x8000;
      for (let i = 0; i < length; i += CHUNK) {
        binary += String.fromCharCode(...(this as Uint8Array).subarray(i, i + CHUNK));
      }
      return btoa(binary);
    },
  });
}
if (!(Uint8Array as U8Ctor & { fromBase64?: (s: string) => Uint8Array }).fromBase64) {
  Object.defineProperty(Uint8Array, 'fromBase64', {
    configurable: true,
    writable: true,
    value: function fromBase64(encoded: string): Uint8Array {
      const binary = atob(encoded.replace(/\s+/g, ''));
      const out = new Uint8Array(binary.length);
      for (let i = 0; i < binary.length; i++) {
        out[i] = binary.charCodeAt(i);
      }
      return out;
    },
  });
}

type MathWithSumPrecise = Math & { sumPrecise?: (values: Iterable<number>) => number };
if (typeof (Math as MathWithSumPrecise).sumPrecise !== 'function') {
  // pdf.js calls Math.sumPrecise (Chrome 127+) as a fast path and logs a
  // warning when it is absent. A plain fold matches the contract well enough
  // for the sizes pdf.js sums; the fallback path was already working.
  (Math as MathWithSumPrecise).sumPrecise = function sumPrecise(values: Iterable<number>): number {
    let sum = 0;
    for (const v of values) sum += v;
    return sum;
  };
}

interface MapWithGetters {
  getOrInsert?(key: unknown, value: unknown): unknown;
  getOrInsertComputed?(key: unknown, callback: (key: unknown) => unknown): unknown;
}
const mapProto = Map.prototype as Map<unknown, unknown> & MapWithGetters;
if (!mapProto.getOrInsert) {
  Object.defineProperty(Map.prototype, 'getOrInsert', {
    configurable: true,
    writable: true,
    value: function getOrInsert(key: unknown, value: unknown): unknown {
      if (this.has(key)) return this.get(key);
      this.set(key, value);
      return value;
    },
  });
}
if (!mapProto.getOrInsertComputed) {
  Object.defineProperty(Map.prototype, 'getOrInsertComputed', {
    configurable: true,
    writable: true,
    value: function getOrInsertComputed(key: unknown, callback: (key: unknown) => unknown): unknown {
      if (this.has(key)) return this.get(key);
      const value = callback(key);
      this.set(key, value);
      return value;
    },
  });
}

/** Point the pdf.js worker at the bundled module worker (Vite asset URL). */
export function initPdfJs(): void {
  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.mjs',
    import.meta.url,
  ).toString();
}

export interface Pt {
  x: number;
  y: number;
}

export interface PtBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** A straight segment inside a drawing (the `l` item PyMuPDF exposes). */
export interface LineItem {
  type: 'l';
  p1: Pt;
  p2: Pt;
}

/** A rectangle item inside a drawing (the `re` item PyMuPDF exposes). */
export interface RectItem {
  type: 're';
  rect: PtBox;
}

/** A cubic Bézier item (the `c` item PyMuPDF exposes). Detectors skip it. */
export interface CurveItem {
  type: 'c';
  p1: Pt;
  c1: Pt;
  c2: Pt;
  p4: Pt;
}

/** A quadratic Bézier item (the `qu` item PyMuPDF exposes). Detectors skip it. */
export interface QuadItem {
  type: 'qu';
  p1: Pt;
  c1: Pt;
  p2: Pt;
}

/** Any item a drawing can expose — mirrors PyMuPDF's `l`/`re`/`c`/`qu`. */
export type DrawingItem = LineItem | RectItem | CurveItem | QuadItem;

/**
 * One "drawing" recovered from the operator list — the analogue of a PyMuPDF
 * `get_drawings()` entry. `type` is `f` (filled), `s` (stroked) or `fs`; at
 * least one of `fill`/`stroke` holds the normalised [r,g,b] colour.
 */
export interface VectorDrawing {
  type: 'f' | 's' | 'fs';
  fill: number[] | null;
  stroke: number[] | null;
  rect: PtBox;
  items: DrawingItem[];
}

/** A single PDF opened for detection. */
export class PdfDocument {
  constructor(readonly doc: any, readonly fileName: string) {}

  get pageCount(): number {
    return this.doc.numPages;
  }

  page(num: number): Promise<any> {
    return this.doc.getPage(num);
  }

  async destroy(): Promise<void> {
    try {
      await this.doc.destroy();
    } catch {
      /* already destroyed */
    }
  }
}

// ---------------------------------------------------------------------------
// worker-safe canvas/filter factories
//
// pdf.js v6 builds its transport factory from `src.CanvasFactory` inside
// `getDocument` and uses IT for every scratch canvas the renderer creates —
// the `canvasFactory` option passed to `page.render()` is ignored in v6. The
// DOM defaults need `document.createElement('canvas')`, which does not exist
// in a worker: a page that draws text dies in `isFontSubpixelAAEnabled` with
// "Cannot read properties of undefined (reading 'createElement')". These two
// classes mirror the BaseCanvasFactory/BaseFilterFactory contracts on
// OffscreenCanvas only.
// ---------------------------------------------------------------------------

/** BaseCanvasFactory contract backed by OffscreenCanvas (worker-safe). */
class WorkerCanvasFactory {
  create(width: number, height: number): { canvas: any; context: any } {
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    const canvas = this._createCanvas(width, height);
    return { canvas, context: canvas.getContext('2d', { willReadFrequently: true }) };
  }

  reset(c: { canvas: any }, width: number, height: number): void {
    if (!c.canvas) throw new Error('Canvas is not specified');
    if (width <= 0 || height <= 0) throw new Error('Invalid canvas size');
    c.canvas.width = width;
    c.canvas.height = height;
  }

  destroy(c: { canvas: any; context: any }): void {
    if (!c.canvas) throw new Error('Canvas is not specified');
    c.canvas.width = c.canvas.height = 0;
    c.canvas = null;
    c.context = null;
  }

  _createCanvas(width: number, height: number): any {
    return new OffscreenCanvas(width, height);
  }
}

/** BaseFilterFactory contract: every filter resolves to "none". */
class WorkerFilterFactory {
  addFilter() {
    return 'none';
  }
  addHCMFilter() {
    return 'none';
  }
  addAlphaFilter() {
    return 'none';
  }
  addLuminosityFilter() {
    return 'none';
  }
  addKnockoutFilter() {
    return 'none';
  }
  addHighlightHCMFilter() {
    return 'none';
  }
  addSelectionHCMFilter() {
    return 'none';
  }
  addSelectionFilter() {
    return 'none';
  }
  createSelectionStyle() {
    return null;
  }
  destroy() {}
}

export async function openPdf(data: ArrayBuffer, fileName: string): Promise<PdfDocument> {
  const doc = await pdfjsLib
    .getDocument({ data, CanvasFactory: WorkerCanvasFactory, FilterFactory: WorkerFilterFactory })
    .promise;
  return new PdfDocument(doc, fileName);
}

// ---------------------------------------------------------------------------
// rasterisation
// ---------------------------------------------------------------------------

export interface RenderedPage {
  /** RGBA Mat from the raster; caller owns it. */
  rgba: any;
  /** 8UC1 grayscale Mat from the raster; caller owns it. */
  gray: any;
  /** device pixel size (dpi-scaled) */
  pxW: number;
  pxH: number;
  /** page size in PDF points */
  pagePtW: number;
  pagePtH: number;
}

/**
 * Rasterise one page at `dpi`. OffscreenCanvas keeps the render off the DOM —
 * the worker has none — and the pixel buffer flows straight into OpenCV.
 */
export async function renderPage(cv: any, page: any, dpi: number): Promise<RenderedPage> {
  const viewport = page.getViewport({ scale: dpi / 72 });
  const pxW = Math.ceil(viewport.width);
  const pxH = Math.ceil(viewport.height);

  const canvas = new OffscreenCanvas(pxW, pxH);
  const context = canvas.getContext('2d', { willReadFrequently: true })!;

  // Scratch canvases (text, knockout groups, the subpixel-AA probe) come from
  // the transport factory handed to getDocument — see WorkerCanvasFactory.
  // pdf.js v6 ignores a canvasFactory passed here, so none is supplied.
  await page.render({ canvasContext: context, viewport }).promise;

  const imageData = context.getImageData(0, 0, pxW, pxH);
  const rgba = cv.matFromImageData(imageData);
  const gray = new cv.Mat();
  cv.cvtColor(rgba, gray, cv.COLOR_RGBA2GRAY);

  const base = page.getViewport({ scale: 1 });
  return { rgba, gray, pxW, pxH, pagePtW: base.width, pagePtH: base.height };
}

/** Whole-page text (for the text-free britania probe and the scale sniffing). */
export async function getPageText(page: any): Promise<string> {
  const content = await page.getTextContent();
  const parts: string[] = [];
  for (const item of content.items as Array<{ str?: string }>) {
    if (item?.str) parts.push(item.str);
  }
  return parts.join(' ');
}

// ---------------------------------------------------------------------------
// vector extraction (the get_drawings() analogue)
// ---------------------------------------------------------------------------

const OPS = pdfjsLib.OPS;

/** DrawOPS bytecodes inside an `OPS.constructPath` buffer (see pdf.js source). */
const DRAWOPS = { moveTo: 0, lineTo: 1, curveTo: 2, quadraticCurveTo: 3, closePath: 4 };

type Affine = [number, number, number, number, number, number];

const IDENTITY: Affine = [1, 0, 0, 1, 0, 0];

/** Concatenate `t` onto the current CTM: CTM' = CTM · T (PDF `cm` semantics). */
function concat(ctm: Affine, t: number[]): Affine {
  const [a1, b1, c1, d1, e1, f1] = ctm;
  const [a2, b2, c2, d2, e2, f2] = t;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function transformPoint(ctm: Affine, x: number, y: number): Pt {
  return { x: ctm[0] * x + ctm[2] * y + ctm[4], y: ctm[1] * x + ctm[3] * y + ctm[5] };
}

/** PyMuPDF-style y flip: PDF user space (y-up) -> page points (y-down). */
function flipY(pagePtH: number, p: Pt): Pt {
  return { x: p.x, y: pagePtH - p.y };
}

function boxOf(points: Pt[]): PtBox {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const p of points) {
    if (p.x < x0) x0 = p.x;
    if (p.y < y0) y0 = p.y;
    if (p.x > x1) x1 = p.x;
    if (p.y > y1) y1 = p.y;
  }
  return { x0, y0, x1, y1 };
}

/**
 * One subpath inside a drawing: a moveTo'd chain of segments plus its
 * bbox points. PyMuPDF exposes one item per segment and NEVER connects the
 * end of one subpath to the start of the next — the old single flat point
 * list did, which fabricated "jump" segments across subpath boundaries.
 */
interface SubPath {
  /** true when this subpath came from an `re` operator (a true rectangle) */
  isRect: boolean;
  /** every point of the subpath (bbox source and `re` corners) */
  pts: Pt[];
  /** the segments; curve control points are carried for faithful c/qu items */
  segs: Array<{ kind: 'l' | 'c' | 'q'; a: Pt; b: Pt; c1?: Pt; c2?: Pt }>;
}

function itemsOf(subpaths: SubPath[], pagePtH: number): DrawingItem[] {
  const items: DrawingItem[] = [];
  for (const sp of subpaths) {
    // A rectangle becomes ONE "re" item — PyMuPDF's get_drawings does not
    // also list the four edges as "l" items. Emitting both made
    // strokeWallPairs (GlassWorks F7) see every rect's edges twice and
    // fabricate parallel-line walls from a single filled rect (196 walls vs
    // the reference 22).
    if (sp.isRect && sp.pts.length === 4) {
      items.push({ type: 're', rect: boxOf(sp.pts.map((p) => flipY(pagePtH, p))) });
      continue;
    }
    for (const s of sp.segs) {
      if (s.a.x === s.b.x && s.a.y === s.b.y) continue; // zero-length: never an item
      if (s.kind === 'l') {
        items.push({ type: 'l', p1: flipY(pagePtH, s.a), p2: flipY(pagePtH, s.b) });
      } else if (s.kind === 'c') {
        items.push({
          type: 'c',
          p1: flipY(pagePtH, s.a),
          c1: flipY(pagePtH, s.c1!),
          c2: flipY(pagePtH, s.c2!),
          p4: flipY(pagePtH, s.b),
        });
      } else {
        items.push({ type: 'qu', p1: flipY(pagePtH, s.a), c1: flipY(pagePtH, s.c1!), p2: flipY(pagePtH, s.b) });
      }
    }
  }
  return items;
}

/** "#rrggbb" (pdf.js v6 emits CSS hex colours as setFillRGBColor operands). */
function hexToRgb(hex: string): number[] | null {
  const m = /^#([0-9a-fA-F]{6})$/.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [((n >> 16) & 0xff) / 255, ((n >> 8) & 0xff) / 255, (n & 0xff) / 255];
}

/** Normalise PDF colour component arrays to [r,g,b] in 0..1. */
function normColor(comp: number[], space: 'gray' | 'rgb' | 'cmyk' | 'unknown'): number[] {
  // pdf.js v6 may hand setFillRGBColor/setStrokeRGBColor a single CSS hex
  // string ("#939598") with the remaining operands zeroed. Without parsing it
  // every colour resolves to NaN and the unified detectors' grey/dark fill
  // bands and PLAN_STROKE_MAX darkness filter silently match nothing.
  if (typeof comp[0] === 'string') {
    const rgb = hexToRgb(comp[0] as unknown as string);
    if (rgb) return rgb;
  }
  if (space === 'gray') {
    const g = comp[0];
    return [g, g, g];
  }
  if (space === 'cmyk') {
    const [c, m, y, k] = comp;
    return [(1 - c) * (1 - k), (1 - m) * (1 - k), (1 - y) * (1 - k)];
  }
  return [comp[0] ?? 0, comp[1] ?? 0, comp[2] ?? 0];
}

/** Guesses the colour space from the number of operands for setFillColor(N). */
function colorSpaceOf(comp: number[]): 'gray' | 'rgb' | 'cmyk' | 'unknown' {
  if (comp.length === 1) return 'gray';
  if (comp.length === 3) return 'rgb';
  if (comp.length === 4) return 'cmyk';
  return 'unknown';
}

/**
 * Recover the page's vector content as PyMuPDF-like drawings. Each filled or
 * stroked path becomes one entry with a page-point bbox and normalised colour.
 * Only the operations the detectors read are tracked; everything else (text,
 * images, gradients, clipping) is ignored.
 */
export async function getPageDrawings(page: any): Promise<VectorDrawing[]> {
  const list = await page.getOperatorList();
  const pagePtH = page.getViewport({ scale: 1 }).height;
  const drawings: VectorDrawing[] = [];

  let ctm: Affine = IDENTITY;
  const stack: Array<{ ctm: Affine; fill: number[] | null; stroke: number[] | null }> = [];
  // PDF graphics state starts with the default fill/stroke = black. PyMuPDF
  // reports `fill=(0,0,0)` for paths painted without an explicit colour op
  // (britania's B* hatch fills), so null here would drop them and starve the
  // probe's S1/S2 dark-fill signals (and any dark-fill wall pass).
  let fill: number[] | null = [0, 0, 0];
  let stroke: number[] | null = [0, 0, 0];

  // Subpath-based path tracking. PyMuPDF's get_drawings() exposes one item
  // per segment and NEVER joins the end of one subpath to the start of the
  // next — the earlier flat point list wrapped around and fabricated
  // "jump" segments across subpath boundaries (a source of the phantom
  // GlassWorks stroke walls: 132 extra vs the reference's 22).
  let subpaths: SubPath[] = [];
  let cur: SubPath | null = null;

  const flushSub = () => {
    if (cur) {
      subpaths.push(cur);
      cur = null;
    }
  };
  const startSub = (isRect: boolean) => {
    flushSub();
    cur = { isRect, pts: [], segs: [] };
  };
  const lastPt = (): Pt | null =>
    cur && cur.pts.length ? cur.pts[cur.pts.length - 1] : null;

  const addSeg = (kind: 'l' | 'c' | 'q', b: Pt, c1?: Pt, c2?: Pt) => {
    if (!cur) startSub(false);
    if (!cur!.pts.length) {
      // A segment without a preceding moveTo: PDF treats the start as the
      // implicit current point, so back-fill it.
      cur!.pts.push(b);
      cur!.segs.push({ kind, a: b, b, c1, c2 });
      return;
    }
    const a = lastPt()!;
    cur!.segs.push({ kind, a, b, c1, c2 });
    cur!.pts.push(b);
  };

  const doMoveTo = (p: Pt) => {
    startSub(false);
    cur!.pts.push(p);
  };
  const doLineTo = (p: Pt) => addSeg('l', p);
  const doCurveTo = (c1: Pt, c2: Pt, p: Pt) => addSeg('c', p, c1, c2);
  const doQuadTo = (c1: Pt, p: Pt) => addSeg('q', p, c1);
  const doClose = () => {
    // Explicit closePath: PyMuPDF reports the closing segment back to the
    // subpath start (never a wrap for open subpaths).
    if (cur && cur.pts.length > 1) {
      const a = lastPt()!;
      const b = cur.pts[0];
      if (a.x !== b.x || a.y !== b.y) {
        cur.segs.push({ kind: 'l', a, b });
        cur.pts.push(b);
      }
    }
  };

  const emit = (filled: boolean, stroked: boolean) => {
    flushSub();
    if (!subpaths.length || (!filled && !stroked)) {
      subpaths = [];
      return;
    }
    const allPts: Pt[] = [];
    for (const sp of subpaths) allPts.push(...sp.pts);
    drawings.push({
      type: filled && stroked ? 'fs' : filled ? 'f' : 's',
      fill: filled ? fill : null,
      stroke: stroked ? stroke : null,
      rect: boxOf(allPts.map((p) => flipY(pagePtH, p))),
      items: itemsOf(subpaths, pagePtH),
    });
    subpaths = [];
  };

  const resetPath = () => {
    subpaths = [];
    cur = null;
  };

  const setFill = (comp: number[], space: 'gray' | 'rgb' | 'cmyk' | 'unknown') => {
    fill = normColor(comp, space);
  };
  const setStroke = (comp: number[], space: 'gray' | 'rgb' | 'cmyk' | 'unknown') => {
    stroke = normColor(comp, space);
  };

  const { fnArray, argsArray } = list;
  for (let i = 0; i < fnArray.length; i++) {
    const fn = fnArray[i];
    const args = argsArray[i] ?? [];
    switch (fn) {
      case OPS.constructPath: {
        // pdf.js v6 bundles whole paths into ONE op: args = [drawOp,
        // [Float32Array(pathBuffer)], minMax]. The pathBuffer interleaves
        // DrawOPS bytecodes with coordinates (curveTo = 3 points, quadratic =
        // 2 points). The drawOp is the actual fill/stroke/close op. Without
        // decoding this, CAD-exported PDFs that draw everything through
        // constructPath (e.g. GlassWorks.pdf: 1051 constructPath ops, zero
        // moveTo/lineTo/fill ops) would recover almost no vector content.
        const drawOp = (args as number[])[0];
        const dataArr = (args as unknown[])[1] as Array<Float32Array | null> | null;
        const buffer = dataArr && dataArr[0];
        if (buffer instanceof Float32Array) {
          let k = 0;
          while (k < buffer.length) {
            const cmd = buffer[k++];
            switch (cmd) {
              case DRAWOPS.moveTo:
                doMoveTo(transformPoint(ctm, buffer[k], buffer[k + 1]));
                k += 2;
                break;
              case DRAWOPS.lineTo:
                doLineTo(transformPoint(ctm, buffer[k], buffer[k + 1]));
                k += 2;
                break;
              case DRAWOPS.curveTo: {
                const p = transformPoint(ctm, buffer[k + 4], buffer[k + 5]);
                const c1 = transformPoint(ctm, buffer[k], buffer[k + 1]);
                const c2 = transformPoint(ctm, buffer[k + 2], buffer[k + 3]);
                doCurveTo(c1, c2, p);
                k += 6;
                break;
              }
              case DRAWOPS.quadraticCurveTo: {
                const p = transformPoint(ctm, buffer[k + 2], buffer[k + 3]);
                const c1 = transformPoint(ctm, buffer[k], buffer[k + 1]);
                doQuadTo(c1, p);
                k += 4;
                break;
              }
              case DRAWOPS.closePath:
                doClose();
                break;
              default:
                // unknown bytecode: cannot resync — bail out of the buffer
                k = buffer.length;
                break;
            }
          }
        }
        switch (drawOp) {
          case OPS.stroke:
            emit(false, true);
            break;
          case OPS.closeStroke:
            doClose();
            emit(false, true);
            break;
          case OPS.fill:
          case OPS.eoFill:
            emit(true, false);
            break;
          case OPS.fillStroke:
          case OPS.eoFillStroke: {
            emit(true, true);
            break;
          }
          case OPS.closeFillStroke:
          case OPS.closeEOFillStroke:
            doClose();
            emit(true, true);
            break;
          default:
            resetPath();
            break;
        }
        break;
      }
      case OPS.transform: {
        ctm = concat(ctm, args as number[]);
        break;
      }
      case OPS.save:
        stack.push({ ctm, fill, stroke });
        break;
      case OPS.restore: {
        const state = stack.pop();
        if (state) {
          ctm = state.ctm;
          fill = state.fill;
          stroke = state.stroke;
        }
        break;
      }
      case OPS.moveTo: {
        const [x, y] = args as number[];
        doMoveTo(transformPoint(ctm, x, y));
        break;
      }
      case OPS.lineTo: {
        const [x, y] = args as number[];
        doLineTo(transformPoint(ctm, x, y));
        break;
      }
      case OPS.curveTo: {
        const a = args as number[];
        doCurveTo(
          transformPoint(ctm, a[0], a[1]),
          transformPoint(ctm, a[2], a[3]),
          transformPoint(ctm, a[4], a[5]),
        );
        break;
      }
      case OPS.curveTo2: {
        // `v` — first control point is the current point
        const a = args as number[];
        const start = lastPt() ?? transformPoint(ctm, 0, 0);
        doCurveTo(
          start,
          transformPoint(ctm, a[0], a[1]),
          transformPoint(ctm, a[2], a[3]),
        );
        break;
      }
      case OPS.curveTo3: {
        // `y` — second control point coincides with the endpoint
        const a = args as number[];
        const end = transformPoint(ctm, a[2], a[3]);
        doCurveTo(transformPoint(ctm, a[0], a[1]), end, end);
        break;
      }
      case OPS.rectangle: {
        const [x, y, w, h] = args as number[];
        startSub(true);
        cur!.pts.push(
          transformPoint(ctm, x, y),
          transformPoint(ctm, x + w, y),
          transformPoint(ctm, x + w, y + h),
          transformPoint(ctm, x, y + h),
        );
        break;
      }
      case OPS.closePath:
        doClose();
        break;
      case OPS.stroke:
        emit(false, true);
        break;
      case OPS.closeStroke:
        doClose();
        emit(false, true);
        break;
      case OPS.fill:
      case OPS.eoFill:
        emit(true, false);
        break;
      case OPS.fillStroke:
      case OPS.eoFillStroke: {
        emit(true, true);
        break;
      }
      case OPS.closeFillStroke:
      case OPS.closeEOFillStroke:
        doClose();
        emit(true, true);
        break;
      case OPS.endPath:
      case OPS.clip:
      case OPS.eoClip:
        resetPath();
        break;
      case OPS.setFillGray:
        setFill(args as number[], 'gray');
        break;
      case OPS.setFillRGBColor:
        setFill(args as number[], 'rgb');
        break;
      case OPS.setFillCMYKColor:
        setFill(args as number[], 'cmyk');
        break;
      case OPS.setFillColor:
      case OPS.setFillColorN: {
        const comp = args as number[];
        if (typeof comp[0] !== 'number') {
          fill = null; // pattern/colour-space name operand — not a solid fill
        } else {
          setFill(comp, colorSpaceOf(comp));
        }
        break;
      }
      case OPS.setStrokeGray:
        setStroke(args as number[], 'gray');
        break;
      case OPS.setStrokeRGBColor:
        setStroke(args as number[], 'rgb');
        break;
      case OPS.setStrokeCMYKColor:
        setStroke(args as number[], 'cmyk');
        break;
      case OPS.setStrokeColor:
      case OPS.setStrokeColorN: {
        const comp = args as number[];
        if (typeof comp[0] !== 'number') {
          stroke = null;
        } else {
          setStroke(comp, colorSpaceOf(comp));
        }
        break;
      }
      default:
        // Text, images, gradients, inline forms, marked content: ignored.
        break;
    }
  }
  return drawings;
}

/** The norm PyMuPDF uses for a fill/stroke colour: mean of the first 3 comps. */
export function normFill(color: number[] | null | undefined): number | null {
  if (!color || color.length < 3) return null;
  return (color[0] + color[1] + color[2]) / 3;
}
