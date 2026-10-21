import { jsPDF } from 'jspdf';
import { createElement, type ReactElement } from 'react';
import { flushSync } from 'react-dom';
import { createRoot } from 'react-dom/client';
import type { DrawingDoc, Material, MeasureLine, Piece, SketchPath } from '../types';
import { contentBounds, isConnector, pieceBounds, planH, planW, type Rect } from './geometry';
import { drawingSizeLabel, type Bom } from './bom';
import { legLength, segments } from './sketch';
import {
  DEFAULT_PDF_VISIBILITY,
  fmtLength,
  lengthKindOf,
  readableAngle,
  type PdfVisibility,
} from './dimensions';
import { sheetBounds, type SheetSize } from './exportOptions';
import { stampedName } from './files';
import { connectorsAtCorners, openBolts, pieceCentre } from './bolts';
import { boltKindOf, boltTotals, markedRodLength, planMarks, type BoltKindName } from './boltMarks';
import { CATEGORY_ORDER } from '../data/categories';
import { CONNECTOR_R_CM, SheetSvg, type LegendIcon, type PlacedIcon, type SheetDrawing } from '../components/PdfSheetSvg';

export type { SheetSize };

/**
 * Prints the drawing itself - to scale, dimensioned, with a key and a title
 * block - as opposed to the parts list. This is the thing a foreman takes to
 * site, so it has to show what the screen shows: every panel, ჩაკერება and
 * კუთხე where it lies, every შტირი with its ქანჩი + დისკო and ჩამკეტი fix, and
 * every კონექტორი.
 *
 * Two layers make one sheet:
 *
 * - the linework is an SVG drawn with the screen's own components
 *   (`PdfSheetSvg`), so nothing is drawn twice and nothing can drift;
 * - the text - sizes, lengths, the key, the title block - is written over it
 *   on the canvas with the page's Georgian font. jsPDF's built-in fonts have no
 *   Georgian, and an SVG drawn as an image cannot reach the page's web fonts.
 *
 * The canvas is placed into the PDF at exact millimetre size, so the printed
 * scale really is 1:`scale`.
 */

const SHEETS: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 }, // landscape
  A3: { w: 420, h: 297 },
};

const MARGIN_MM = 10;
const TITLE_H_MM = 18;
/** Room kept outside the content for the overall dimension lines. */
const DIM_GUTTER_MM = 14;
/** Room kept round the content for marks drawn bigger than life - a კონექტორი disc, a nut. */
const MARK_PAD_MM = 3;
/** Render density. 300 dpi: hairlines and small Georgian text stay crisp in print. */
const PX_PER_MM = 300 / 25.4;

/** The key: a row per kind of thing, in columns at least this wide. */
const LEGEND_COL_MIN_MM = 66;
const LEGEND_ROW_MM = 7.2;
const LEGEND_HEAD_MM = 6.5;
const LEGEND_ICON_W_MM = 13;
const LEGEND_GAP_MM = 3;

const FONT = '"Noto Sans Georgian", "Noto Sans", -apple-system, "Segoe UI", sans-serif';
const font = (px: number, weight = 400) => `${weight} ${px}px ${FONT}`;
const INK = '#1b1f24';
const MUTED = '#5c6572';

export interface DrawingSheetOptions {
  doc: DrawingDoc;
  materials: Material[];
  sheet?: SheetSize;
  /** override the document scale, e.g. when auto-fitting */
  scale?: number;
  showDimensions?: boolean;
  /** print the drawn layout under the formwork as a setting-out line */
  showSketch?: boolean;
  /** what the sheet carries - pieces, ჭანჭიკები, lines, lengths, key, title block */
  visibility?: PdfVisibility;
  /** render density, px per mm; lower for an on-screen preview */
  pxPerMm?: number;
}

export interface SheetResult {
  dataUrl: string;
  sheet: SheetSize;
  scale: number;
  /** true when the content had to be shrunk past the requested scale to fit */
  rescaled: boolean;
}

/** Standard drawing scales, smallest denominator (largest drawing) first. */
const SCALE_LADDER = [10, 20, 25, 50, 100, 200, 500];
/**
 * What ავტომატური picks from: the standard ones and the round steps between
 * them. With the key along the bottom, a wall that just missed 1:25 dropped to
 * 1:50 and filled a quarter of the sheet; 1:30 or 1:40 is still a true,
 * round scale, and the drawing comes out twice the size.
 */
const AUTO_LADDER = [10, 15, 20, 25, 30, 40, 50, 60, 75, 100, 125, 150, 200, 250, 300, 400, 500];

/** One row of the key. */
interface LegendEntry {
  icon?: LegendIcon;
  /** a sample of text in place of a picture - how a size is written */
  sample?: string;
  label: string;
  note?: string;
  count?: string;
}

export async function renderDrawingSheet(options: DrawingSheetOptions): Promise<SheetResult | null> {
  const { doc, materials, sheet = 'A4', showDimensions = true, showSketch = true } = options;
  const vis = options.visibility ?? DEFAULT_PDF_VISIBILITY;
  const pxPerMm = options.pxPerMm ?? PX_PER_MM;
  const byId = new Map(materials.map((m) => [m.id, m]));

  const content = sheetContent(doc, materials, byId, vis);

  // A line's length is printed along it, so lengths alone still need their
  // lines' room on the sheet even when the lines themselves are switched off.
  const withSketch = showSketch && (vis.sketchLines || vis.line);
  const withMeasures = vis.measureLines || vis.measure;
  const bounds = unionRect(
    sheetBounds(
      { pieces: content.pieces.map((d) => d.piece), sketch: doc.sketch, measures: doc.measures },
      byId,
      { pieces: content.pieces.length > 0, sketch: withSketch, measures: withMeasures },
    ),
    content.markBounds,
  );
  if (!bounds) return null;

  const paper = SHEETS[sheet];
  const titleH = vis.titleBlock ? TITLE_H_MM : 0;
  const innerW = paper.w - MARGIN_MM * 2;

  const legend = vis.legend ? legendEntries(doc, byId, vis, content, showSketch, showDimensions) : [];
  const legendLayout = layoutLegend(legend, innerW);
  const legendH = legendLayout ? legendLayout.h + LEGEND_GAP_MM : 0;

  const drawW = innerW;
  const drawH = paper.h - MARGIN_MM * 2 - titleH - legendH;

  // Dimension lines sit outside the content, so the content itself has to fit
  // in a slightly smaller box or the witness lines run into the key.
  const dimGutter = showDimensions && vis.overall && content.formwork ? DIM_GUTTER_MM : 0;
  const fitW = drawW - dimGutter - MARK_PAD_MM * 2;
  const fitH = drawH - dimGutter - MARK_PAD_MM * 2;

  // cm → mm at a given scale: mm = cm * 10 / scale
  const fitsAt = (s: number) => (bounds.w * 10) / s <= fitW && (bounds.h * 10) / s <= fitH;

  const requested = options.scale ?? doc.scale;
  let scale = requested;
  let rescaled = false;

  if (requested <= 0) {
    // Auto: the smallest denominator that still fits fills the sheet best.
    scale = AUTO_LADDER.find(fitsAt) ?? AUTO_LADDER[AUTO_LADDER.length - 1];
  } else if (!fitsAt(scale)) {
    // Step out to the next standard scale that fits rather than inventing one.
    const found = SCALE_LADDER.find((s) => s >= requested && fitsAt(s));
    scale = found ?? SCALE_LADDER[SCALE_LADDER.length - 1];
    rescaled = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(paper.w * pxPerMm);
  canvas.height = Math.round(paper.h * pxPerMm);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mm = (v: number) => v * pxPerMm;
  /** world cm → paper mm */
  const cmToMm = (v: number) => (v * 10) / scale;

  // Centre the content in what is left once the dimension gutter is kept.
  const frame: Rect = {
    x: MARGIN_MM + (drawW - dimGutter - cmToMm(bounds.w)) / 2,
    y: MARGIN_MM + (drawH - dimGutter - cmToMm(bounds.h)) / 2,
    w: cmToMm(bounds.w),
    h: cmToMm(bounds.h),
  };
  const tx = (wx: number) => mm(frame.x + cmToMm(wx - bounds.x));
  const ty = (wy: number) => mm(frame.y + cmToMm(wy - bounds.y));
  const cmToPx = (v: number) => mm(cmToMm(v));

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // ── the linework ─────────────────────────────────────────────────────────
  const drawing: SheetDrawing = {
    frame,
    world: bounds,
    cmPerMm: scale / 10,
    sketch: showSketch && vis.sketchLines ? (doc.sketch ?? []) : [],
    pieces: content.pieces,
    atCorners: content.atCorners,
    connectors: content.marks.connectors,
    rods: content.marks.rods,
    nuts: content.marks.nuts,
    latches: content.marks.latches,
  };
  const legendTop = paper.h - MARGIN_MM - titleH - legendH;
  const icons: PlacedIcon[] = [];
  if (legendLayout) {
    for (const cell of legendLayout.cells) {
      if (!cell.entry.icon) continue;
      icons.push({
        icon: cell.entry.icon,
        box: { x: MARGIN_MM + cell.x + 1.5, y: legendTop + cell.y + 1.6, w: LEGEND_ICON_W_MM, h: LEGEND_ROW_MM - 3.2 },
      });
    }
  }
  const svg = markup(createElement(SheetSvg, { paper, pixels: { w: canvas.width, h: canvas.height }, drawing, icons }));
  const [image] = await Promise.all([svgImage(svg), fontsReady()]);
  ctx.drawImage(image, 0, 0, canvas.width, canvas.height);

  // ── the text over it ─────────────────────────────────────────────────────
  if (showSketch && vis.line) drawSketchLengths(ctx, doc.sketch ?? [], tx, ty, mm);

  // Measured lines follow the PDF choices, not the on-screen layout toggle: each
  // was put on the drawing on purpose, to be read.
  if (withMeasures) {
    drawMeasures(ctx, doc.measures ?? [], tx, ty, mm, { lines: vis.measureLines, lengths: vis.measure });
  }

  if (showDimensions) {
    const labels = new LabelPlacer(mm);
    // Everything drawn is in the way of a label put beside its piece.
    for (const { piece, material } of content.pieces) {
      const b = pieceBounds(piece, material);
      labels.block({ x0: tx(b.x), y0: ty(b.y), x1: tx(b.x + b.w), y1: ty(b.y + b.h) });
    }
    for (const r of content.markRects) {
      labels.blockMark({ x0: tx(r.x), y0: ty(r.y), x1: tx(r.x + r.w), y1: ty(r.y + r.h) });
    }
    // ...and so are the measured lines and their numbers.
    if (withMeasures) {
      for (const b of measureBoxes(ctx, doc.measures ?? [], tx, ty, mm, vis.measure)) labels.block(b);
    }
    const labelled = content.pieces.filter(
      ({ material }) => !boltKindOf(material) && vis[lengthKindOf(material)],
    );
    // A stacked course is the same box in plan: one label for the stack.
    const seen = new Set<string>();
    const todo = labelled.filter(({ piece, material }) => {
      const b = pieceBounds(piece, material);
      const key = `${material.id}:${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.w)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
    // Labels that fit inside their pieces first, so the ones that have to go
    // beside a piece know where those already are.
    const outside = todo.filter(({ piece, material }) => !labels.inside(ctx, piece, material, tx, ty, cmToPx));
    for (const { piece, material } of outside) labels.beside(ctx, piece, material, tx, ty);
    labels.draw(ctx);

    if (vis.overall && content.formwork) {
      drawOverallDimensions(ctx, content.formwork, bounds, tx, ty, mm);
    }
  }

  if (legendLayout) drawLegend(ctx, legendLayout, MARGIN_MM, legendTop, innerW, mm);
  if (vis.titleBlock) drawTitleBlock(ctx, doc, scale, sheet, paper, mm);

  // Sheet border last, over anything that reached the edge.
  ctx.strokeStyle = INK;
  ctx.lineWidth = mm(0.5);
  ctx.strokeRect(mm(MARGIN_MM / 2), mm(MARGIN_MM / 2), mm(paper.w - MARGIN_MM), mm(paper.h - MARGIN_MM));

  return { dataUrl: canvas.toDataURL('image/png'), sheet, scale, rescaled };
}

// ── what goes on the sheet ─────────────────────────────────────────────────

interface SheetContent {
  /** the pieces drawn, in the drawing's order; ჭანჭიკი kinds switched off are left out */
  pieces: Array<{ piece: Piece; material: Material }>;
  /** the box round the formwork itself - what the overall dimensions measure */
  formwork: Rect | null;
  atCorners: Set<string>;
  marks: {
    connectors: ReturnType<typeof planMarks>['connectors'];
    rods: SheetDrawing['rods'];
    nuts: ReturnType<typeof planMarks>['nuts'];
    latches: ReturnType<typeof planMarks>['latches'];
  };
  /** where the worked-out marks reach, world cm */
  markRects: Rect[];
  markBounds: Rect | null;
}

const NO_MARKS = { connectors: [], rods: [], nuts: [], latches: [] };

function sheetContent(
  doc: DrawingDoc,
  materials: Material[],
  byId: Map<string, Material>,
  vis: PdfVisibility,
): SheetContent {
  if (!vis.pieces) {
    return { pieces: [], formwork: null, atCorners: new Set(), marks: NO_MARKS, markRects: [], markBounds: null };
  }
  const kindOn = (k: BoltKindName | null) => k === null || vis[k];
  const pieces: SheetContent['pieces'] = [];
  for (const piece of doc.pieces) {
    const material = byId.get(piece.materialId);
    if (material && kindOn(boltKindOf(material))) pieces.push({ piece, material });
  }
  const formwork = contentBounds(
    pieces.filter(({ material }) => !boltKindOf(material)).map(({ piece }) => piece),
    byId,
  );

  // Worked out from every piece on the drawing - a placed connector takes its
  // joint's mark away whether or not connectors are printed.
  const all = planMarks(doc.pieces, byId);
  const marks: SheetContent['marks'] = {
    connectors: vis.connectors ? all.connectors : [],
    rods: vis.rods ? all.rods.map((rod) => ({ rod, length: markedRodLength(materials, rod) })) : [],
    nuts: vis.nuts ? all.nuts : [],
    latches: vis.latches ? all.latches : [],
  };

  const markRects: Rect[] = [];
  const cr = CONNECTOR_R_CM + 1;
  for (const b of marks.connectors) markRects.push({ x: b.x - cr, y: b.y - cr, w: cr * 2, h: cr * 2 });
  // Placed ones are marks too, as far as a label is concerned.
  for (const { piece, material } of pieces) {
    const kind = boltKindOf(material);
    if (kind === 'connectors') {
      const c = pieceCentre(piece, material);
      markRects.push({ x: c.x - cr, y: c.y - cr, w: cr * 2, h: cr * 2 });
    } else if (kind) {
      markRects.push(pieceBounds(piece, material));
    }
  }
  for (const { rod, length } of marks.rods) {
    const mid = (rod.from + rod.to) / 2;
    markRects.push(
      rod.dir === 'v'
        ? { x: rod.at - 1, y: mid - length / 2, w: 2, h: length }
        : { x: mid - length / 2, y: rod.at - 1, w: length, h: 2 },
    );
  }
  // A nut, and the wing nut past it, reach about 10 cm out from the face and
  // the washer 6 either side.
  for (const e of [...marks.nuts, ...marks.latches]) {
    const out = e.rot === 0 || e.rot === 180 ? 'h' : 'v';
    const sign = e.rot === 0 || e.rot === 90 ? 1 : -1;
    const reach = 10;
    markRects.push(
      out === 'h'
        ? { x: sign > 0 ? e.x : e.x - reach, y: e.y - 7, w: reach, h: 14 }
        : { x: e.x - 7, y: sign > 0 ? e.y : e.y - reach, w: 14, h: reach },
    );
  }
  const markBounds = markRects.reduce<Rect | null>((acc, r) => unionRect(acc, r), null);

  return {
    pieces,
    formwork,
    atCorners: vis.connectors ? connectorsAtCorners(doc.pieces, byId) : new Set(),
    marks,
    markRects,
    markBounds,
  };
}

function unionRect(a: Rect | null, b: Rect | null): Rect | null {
  if (!a) return b;
  if (!b) return a;
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return { x, y, w: Math.max(a.x + a.w, b.x + b.w) - x, h: Math.max(a.y + a.h, b.y + b.h) - y };
}

// ── the key ────────────────────────────────────────────────────────────────

const pcs = (n: number) => `${n} ც.`;

/**
 * Every kind of thing on the sheet, once: each material drawn, then each
 * ჭანჭიკი kind, then the lines. Only what is actually on this sheet - a key
 * that explains things the drawing does not have sends the reader looking.
 */
function legendEntries(
  doc: DrawingDoc,
  byId: Map<string, Material>,
  vis: PdfVisibility,
  content: SheetContent,
  showSketch: boolean,
  showDimensions: boolean,
): LegendEntry[] {
  const out: LegendEntry[] = [];

  // Materials, by category then name, each with how many.
  const counts = new Map<string, number>();
  for (const { material } of content.pieces) {
    if (boltKindOf(material)) continue;
    counts.set(material.id, (counts.get(material.id) ?? 0) + 1);
  }
  const used = [...counts.keys()]
    .map((id) => byId.get(id))
    .filter((m): m is Material => !!m)
    .sort(
      (a, b) =>
        CATEGORY_ORDER.indexOf(a.category) - CATEGORY_ORDER.indexOf(b.category) ||
        a.name.localeCompare(b.name, 'ka', { numeric: true }),
    );
  // One scale for them all, the widest panel filling the picture. A long
  // waler or post would shrink everything else to specks, so it is left out of
  // the sum and simply fitted to the picture by itself.
  const sized = used.filter((m) => m.shape !== 'line');
  const mmPerCm = Math.min(
    LEGEND_ICON_W_MM / Math.max(1, ...sized.map(planW)),
    (LEGEND_ROW_MM - 3.2) / Math.max(1, ...sized.map(planH)),
  );
  for (const m of used) {
    out.push({
      icon: { type: 'material', material: m, mmPerCm },
      label: m.name,
      note: m.category === 'filler' ? 'ჩაკერება - დაშტრიხული' : undefined,
      count: pcs(counts.get(m.id) ?? 0),
    });
  }

  if (vis.pieces) {
    const totals = boltTotals(doc.pieces, byId);
    if (vis.connectors && totals.connectors > 0) {
      // The total split by where it stands, so each colour has its own row.
      const open = openBolts(doc.pieces, byId);
      const atCorner = connectorsAtCorners(doc.pieces, byId);
      let tee = open.filter((b) => b.kind === 'tee').length;
      let corner = open.length - tee;
      for (const p of doc.pieces) {
        const m = byId.get(p.materialId);
        if (!m || !isConnector(m)) continue;
        if (atCorner.has(p.id)) corner++;
        else tee++;
      }
      if (tee) out.push({ icon: { type: 'connector', kind: 'tee' }, label: 'კონექტორი', note: 'T-შეერთება', count: pcs(tee) });
      if (corner) {
        out.push({
          icon: { type: 'connector', kind: 'corner' },
          label: 'კონექტორი',
          note: 'კუთხესთან, ჩაკერებაზე',
          count: pcs(corner),
        });
      }
    }
    if (vis.rods && totals.rods > 0) {
      out.push({
        icon: { type: 'rod' },
        label: 'შტირი',
        note: 'ერთი ნიშანი - 5 ც. 300-ზე, 2 ც. 150 / 90-ზე',
        count: pcs(totals.rods),
      });
    }
    if (vis.nuts && totals.nuts > 0) {
      out.push({ icon: { type: 'nut' }, label: 'ქანჩი + დისკო', note: 'შტირის ორივე ბოლოზე', count: pcs(totals.nuts) });
    }
    if (vis.latches && totals.latches > 0) {
      out.push({ icon: { type: 'latch' }, label: 'ჩამკეტი fix', note: 'ყველა ქანჩი + დისკოზე', count: pcs(totals.latches) });
    }
  }

  if (showSketch && vis.sketchLines && (doc.sketch ?? []).length) {
    out.push({ icon: { type: 'sketch' }, label: 'დახაზული ხაზი', note: 'ბეტონის ზედაპირი' });
  }
  if (vis.measureLines && (doc.measures ?? []).length) {
    out.push({ icon: { type: 'measure' }, label: 'გაზომვის ხაზი', note: 'სიგრძე, სმ' });
  }
  if (showDimensions && content.pieces.length && (vis.wall || vis.corner || vis.other)) {
    out.push({ sample: '90 × 300', label: 'ელემენტის ზომა', note: 'სიგანე × სიმაღლე, სმ' });
  }
  if (showDimensions && vis.overall && content.formwork) {
    out.push({ icon: { type: 'overall' }, label: 'ჯამური ზომა', note: 'ყალიბის გარე ზომა, სმ' });
  }
  return out;
}

interface LegendLayout {
  /** height of the whole key, mm */
  h: number;
  colW: number;
  cells: Array<{ entry: LegendEntry; x: number; y: number }>;
}

/** Rows down each column, then the next column - the order reads the way it was grouped. */
function layoutLegend(entries: LegendEntry[], width: number): LegendLayout | null {
  if (!entries.length) return null;
  const maxCols = Math.max(1, Math.floor(width / LEGEND_COL_MIN_MM));
  const rows = Math.ceil(entries.length / maxCols);
  const colW = width / maxCols;
  const cells = entries.map((entry, i) => ({
    entry,
    x: Math.floor(i / rows) * colW,
    y: LEGEND_HEAD_MM + (i % rows) * LEGEND_ROW_MM,
  }));
  return { h: LEGEND_HEAD_MM + rows * LEGEND_ROW_MM + 1, colW, cells };
}

function drawLegend(
  ctx: CanvasRenderingContext2D,
  layout: LegendLayout,
  left: number,
  top: number,
  width: number,
  mm: (v: number) => number,
): void {
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.lineWidth = mm(0.3);
  ctx.strokeRect(mm(left), mm(top), mm(width), mm(layout.h));
  ctx.lineWidth = mm(0.15);
  ctx.beginPath();
  ctx.moveTo(mm(left), mm(top + LEGEND_HEAD_MM - 1));
  ctx.lineTo(mm(left + width), mm(top + LEGEND_HEAD_MM - 1));
  ctx.stroke();

  ctx.fillStyle = INK;
  ctx.font = font(mm(2.6), 700);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'middle';
  ctx.fillText('პირობითი აღნიშვნები', mm(left + 2), mm(top + (LEGEND_HEAD_MM - 1) / 2));

  for (const { entry, x, y } of layout.cells) {
    const x0 = left + x;
    const y0 = top + y;
    const textX = x0 + 1.5 + LEGEND_ICON_W_MM + 2.5;
    const right = x0 + layout.colW - 4;

    if (entry.sample) {
      ctx.font = font(mm(2.2), 600);
      ctx.fillStyle = '#11151a';
      ctx.textAlign = 'center';
      ctx.fillText(entry.sample, mm(x0 + 1.5 + LEGEND_ICON_W_MM / 2), mm(y0 + LEGEND_ROW_MM / 2));
    }

    let countW = 0;
    if (entry.count) {
      ctx.font = font(mm(2.3), 700);
      ctx.fillStyle = INK;
      ctx.textAlign = 'right';
      ctx.fillText(entry.count, mm(right), mm(y0 + (entry.note ? 2.6 : LEGEND_ROW_MM / 2)));
      countW = ctx.measureText(entry.count).width / mm(1) + 2;
    }
    const room = right - countW - textX;
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    fitText(ctx, entry.label, mm(textX), mm(y0 + (entry.note ? 2.6 : LEGEND_ROW_MM / 2)), mm(room), mm(2.3), 600);
    if (entry.note) {
      ctx.fillStyle = MUTED;
      fitText(ctx, entry.note, mm(textX), mm(y0 + 5.2), mm(right - textX), mm(1.85), 400);
    }
  }
  ctx.restore();
}

/** Writes `text` at `size`, smaller if it must be to fit `room`, cut short only as a last resort. */
function fitText(
  ctx: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  room: number,
  size: number,
  weight: number,
): void {
  let px = size;
  ctx.font = font(px, weight);
  while (ctx.measureText(text).width > room && px > size * 0.75) {
    px *= 0.94;
    ctx.font = font(px, weight);
  }
  let shown = text;
  while (shown.length > 1 && ctx.measureText(shown).width > room) shown = shown.slice(0, -2) + '…';
  ctx.fillText(shown, x, y);
}

// ── sizes on the pieces ────────────────────────────────────────────────────

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

const overlaps = (a: Box, b: Box) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;
const overlapArea = (a: Box, b: Box) =>
  Math.max(0, Math.min(a.x1, b.x1) - Math.max(a.x0, b.x0)) * Math.max(0, Math.min(a.y1, b.y1) - Math.max(a.y0, b.y0));

interface PlacedLabel {
  text: string;
  x: number;
  y: number;
  px: number;
  rotate: boolean;
  /** a leader from the piece to the label, when it sits beside the piece */
  leader?: { x1: number; y1: number; x2: number; y2: number };
}

/**
 * Size labels that never sit on top of one another.
 *
 * A label that fits along its piece is written there. One that does not - a
 * ჩაკერება 5 is a millimetre wide at 1:50 - goes beside the piece on a short
 * leader, at the first spot round it that is clear of every piece, mark and
 * label already placed; with none clear, at the one that covers least.
 */
class LabelPlacer {
  private blocked: Box[] = [];
  /** the ჭანჭიკები - a label written along a panel must not cover one */
  private marks: Box[] = [];
  private placed: Box[] = [];
  private out: PlacedLabel[] = [];

  constructor(private mm: (v: number) => number) {}

  block(b: Box) {
    this.blocked.push(b);
  }

  blockMark(b: Box) {
    this.blocked.push(b);
    this.marks.push(b);
  }

  /** Writes the label inside its piece if it fits there; false if it has to go beside. */
  inside(
    ctx: CanvasRenderingContext2D,
    p: Piece,
    m: Material,
    tx: (v: number) => number,
    ty: (v: number) => number,
    cmToPx: (v: number) => number,
  ): boolean {
    const { mm } = this;
    const b = pieceBounds(p, m);
    const boxW = cmToPx(b.w);
    const boxH = cmToPx(b.h);
    const text = drawingSizeLabel(m);
    const cx = tx(b.x + b.w / 2);
    const cy = ty(b.y + b.h / 2);
    const vertical = boxH > boxW;
    const along = vertical ? boxH : boxW;
    const across = vertical ? boxW : boxH;

    // A long thin piece (a panel, a waler) carries its size ALONG its length -
    // the text may run past the thin side, that is normal. A compact piece (a
    // corner, a stubby filler) must hold the text within both sides.
    const bar = m.shape === 'line' || along >= across * 4;
    for (const px of [mm(2.3), mm(2.0), mm(1.7)]) {
      ctx.font = font(px, 600);
      const w = ctx.measureText(text).width;
      if (w + mm(0.8) <= along && (bar || px * 1.15 <= across)) {
        const box: Box = vertical
          ? { x0: cx - px / 2, y0: cy - w / 2, x1: cx + px / 2, y1: cy + w / 2 }
          : { x0: cx - w / 2, y0: cy - px / 2, x1: cx + w / 2, y1: cy + px / 2 };
        // Its white halo would wipe out a კონექტორი or a rod under it: smaller,
        // or beside the piece instead.
        if (this.marks.some((m) => overlaps(box, m))) continue;
        this.placed.push(box);
        this.out.push({ text, x: cx, y: cy, px, rotate: vertical });
        return true;
      }
    }
    return false;
  }

  beside(
    ctx: CanvasRenderingContext2D,
    p: Piece,
    m: Material,
    tx: (v: number) => number,
    ty: (v: number) => number,
  ): void {
    const { mm } = this;
    const b = pieceBounds(p, m);
    const box: Box = { x0: tx(b.x), y0: ty(b.y), x1: tx(b.x + b.w), y1: ty(b.y + b.h) };
    const text = drawingSizeLabel(m);
    const px = mm(1.9);
    ctx.font = font(px, 600);
    const w = ctx.measureText(text).width + mm(0.6);
    const h = px * 1.2;
    const cx = (box.x0 + box.x1) / 2;
    const cy = (box.y0 + box.y1) / 2;

    let best: { at: Box; leader: PlacedLabel['leader']; cost: number } | null = null;
    for (const d of [mm(1.6), mm(3.6), mm(6), mm(9)]) {
      // Across the thin side first: that is off the wall, into clear space.
      const tall = box.y1 - box.y0 > box.x1 - box.x0;
      const sides = tall ? ['left', 'right', 'up', 'down'] : ['up', 'down', 'left', 'right'];
      for (const side of sides) {
        let at: Box;
        let leader: NonNullable<PlacedLabel['leader']>;
        if (side === 'up') {
          at = { x0: cx - w / 2, y0: box.y0 - d - h, x1: cx + w / 2, y1: box.y0 - d };
          leader = { x1: cx, y1: box.y0, x2: cx, y2: at.y1 };
        } else if (side === 'down') {
          at = { x0: cx - w / 2, y0: box.y1 + d, x1: cx + w / 2, y1: box.y1 + d + h };
          leader = { x1: cx, y1: box.y1, x2: cx, y2: at.y0 };
        } else if (side === 'left') {
          at = { x0: box.x0 - d - w, y0: cy - h / 2, x1: box.x0 - d, y1: cy + h / 2 };
          leader = { x1: box.x0, y1: cy, x2: at.x1, y2: cy };
        } else {
          at = { x0: box.x1 + d, y0: cy - h / 2, x1: box.x1 + d + w, y1: cy + h / 2 };
          leader = { x1: box.x1, y1: cy, x2: at.x0, y2: cy };
        }
        let cost = 0;
        for (const o of this.placed) cost += overlapArea(at, o) * 4;
        for (const o of this.blocked) if (overlaps(at, o)) cost += overlapArea(at, o);
        // Further out costs a little, so a clear near spot beats a clear far one.
        cost += d * 0.01;
        if (!best || cost < best.cost) best = { at, leader, cost };
      }
      if (best && best.cost < mm(9) * 0.02) break;
    }
    if (!best) return;
    this.placed.push(best.at);
    this.out.push({
      text,
      x: (best.at.x0 + best.at.x1) / 2,
      y: (best.at.y0 + best.at.y1) / 2,
      px,
      rotate: false,
      leader: best.leader,
    });
  }

  draw(ctx: CanvasRenderingContext2D): void {
    const { mm } = this;
    ctx.save();
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.lineJoin = 'round';
    for (const l of this.out) {
      if (l.leader) {
        ctx.strokeStyle = '#4a5560';
        ctx.lineWidth = mm(0.15);
        ctx.beginPath();
        ctx.moveTo(l.leader.x1, l.leader.y1);
        ctx.lineTo(l.leader.x2, l.leader.y2);
        ctx.stroke();
        ctx.fillStyle = '#4a5560';
        ctx.beginPath();
        ctx.arc(l.leader.x1, l.leader.y1, mm(0.3), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.save();
      ctx.translate(l.x, l.y);
      if (l.rotate) ctx.rotate(-Math.PI / 2);
      ctx.font = font(l.px, 600);
      // A thin white halo, so a size stays readable where a rod or a nut runs under it.
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.lineWidth = mm(0.35);
      ctx.strokeText(l.text, 0, 0);
      ctx.fillStyle = '#11151a';
      ctx.fillText(l.text, 0, 0);
      ctx.restore();
    }
    ctx.restore();
  }
}

// ── lines and lengths ──────────────────────────────────────────────────────

/** Each drawn leg's length, at its middle and along it. */
function drawSketchLengths(
  ctx: CanvasRenderingContext2D,
  sketch: SketchPath[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  mm: (v: number) => number,
): void {
  if (!sketch.length) return;
  ctx.save();
  ctx.fillStyle = '#4a5560';
  ctx.font = font(mm(2), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const path of sketch) {
    for (const [a, b] of segments(path)) {
      const len = legLength(a, b);
      const ax = tx(a.x);
      const ay = ty(a.y);
      const bx = tx(b.x);
      const by = ty(b.y);
      const px = Math.hypot(bx - ax, by - ay);
      if (len < 1 || !px) continue;
      ctx.save();
      ctx.translate((ax + bx) / 2, (ay + by) / 2);
      ctx.rotate((readableAngle({ x: (bx - ax) / px, y: (by - ay) / px }) * Math.PI) / 180);
      ctx.fillText(`${fmtLength(len)} სმ`, 0, -mm(0.8));
      ctx.restore();
    }
  }
  ctx.restore();
}

/**
 * Measured lines as thin dimension lines: end ticks, length at the middle. The
 * line and its number are separate choices - a length can stand on its own
 * where the line would only repeat an edge already drawn.
 */
function drawMeasures(
  ctx: CanvasRenderingContext2D,
  measures: MeasureLine[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  mm: (v: number) => number,
  show: { lines: boolean; lengths: boolean },
): void {
  if (!measures.length) return;
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, mm(0.2));
  ctx.font = font(mm(2.2), 600);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  for (const m of measures) {
    const ax = tx(m.a.x);
    const ay = ty(m.a.y);
    const bx = tx(m.b.x);
    const by = ty(m.b.y);
    const len = Math.hypot(bx - ax, by - ay);
    if (!len) continue;
    const ux = (bx - ax) / len;
    const uy = (by - ay) / len;
    if (show.lines) {
      const tick = mm(1.2);
      ctx.beginPath();
      ctx.moveTo(ax, ay);
      ctx.lineTo(bx, by);
      ctx.moveTo(ax + uy * tick, ay - ux * tick);
      ctx.lineTo(ax - uy * tick, ay + ux * tick);
      ctx.moveTo(bx + uy * tick, by - ux * tick);
      ctx.lineTo(bx - uy * tick, by + ux * tick);
      ctx.stroke();
    }
    if (!show.lengths) continue;

    ctx.save();
    ctx.translate((ax + bx) / 2, (ay + by) / 2);
    ctx.rotate((readableAngle({ x: ux, y: uy }) * Math.PI) / 180);
    ctx.fillText(`${fmtLength(legLength(m.a, m.b))} სმ`, 0, -mm(0.8));
    ctx.restore();
  }
  ctx.restore();
}

/** Where each measured line and its number are, for labels to keep clear of. */
function measureBoxes(
  ctx: CanvasRenderingContext2D,
  measures: MeasureLine[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  mm: (v: number) => number,
  lengths: boolean,
): Box[] {
  const out: Box[] = [];
  ctx.save();
  ctx.font = font(mm(2.2), 600);
  const pad = mm(1.2);
  for (const m of measures) {
    const ax = tx(m.a.x);
    const ay = ty(m.a.y);
    const bx = tx(m.b.x);
    const by = ty(m.b.y);
    out.push({ x0: Math.min(ax, bx) - pad, y0: Math.min(ay, by) - pad, x1: Math.max(ax, bx) + pad, y1: Math.max(ay, by) + pad });
    if (!lengths) continue;
    const w = ctx.measureText(`${fmtLength(legLength(m.a, m.b))} სმ`).width / 2 + mm(0.5);
    const t = mm(3.4);
    const mx = (ax + bx) / 2;
    const my = (ay + by) / 2;
    // The number stands just off the line, on whichever side reads upright -
    // both sides are kept clear rather than work out which.
    out.push(
      Math.abs(bx - ax) >= Math.abs(by - ay)
        ? { x0: mx - w, y0: my - t, x1: mx + w, y1: my + t }
        : { x0: mx - t, y0: my - w, x1: mx + t, y1: my + w },
    );
  }
  ctx.restore();
  return out;
}

/**
 * Overall width and height of the formwork, CAD style: witness lines from its
 * edges out past everything drawn round it, and the dimension line there.
 * The number is the formwork's own size - a rod sticking out past the panels
 * is not part of it.
 */
function drawOverallDimensions(
  ctx: CanvasRenderingContext2D,
  formwork: Rect,
  outer: Rect,
  tx: (v: number) => number,
  ty: (v: number) => number,
  mm: (v: number) => number,
): void {
  const offset = mm(MARK_PAD_MM + 5);
  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = Math.max(1, mm(0.2));
  ctx.font = font(mm(2.6), 600);

  const left = tx(formwork.x);
  const right = tx(formwork.x + formwork.w);
  const top = ty(formwork.y);
  const bottom = ty(formwork.y + formwork.h);

  // horizontal, below everything
  const hy = ty(outer.y + outer.h) + offset;
  ctx.lineWidth = mm(0.12);
  line(ctx, left, bottom + mm(1), left, hy + mm(1.5));
  line(ctx, right, bottom + mm(1), right, hy + mm(1.5));
  ctx.lineWidth = mm(0.2);
  line(ctx, left, hy, right, hy);
  tick(ctx, left, hy, mm);
  tick(ctx, right, hy, mm);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${fmtLength(formwork.w)} სმ`, (left + right) / 2, hy - mm(0.8));

  // vertical, right of everything
  const vx = tx(outer.x + outer.w) + offset;
  ctx.lineWidth = mm(0.12);
  line(ctx, right + mm(1), top, vx + mm(1.5), top);
  line(ctx, right + mm(1), bottom, vx + mm(1.5), bottom);
  ctx.lineWidth = mm(0.2);
  line(ctx, vx, top, vx, bottom);
  tick(ctx, vx, top, mm);
  tick(ctx, vx, bottom, mm);
  ctx.save();
  ctx.translate(vx - mm(0.8), (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${fmtLength(formwork.h)} სმ`, 0, 0);
  ctx.restore();

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

/** A 45° architectural tick across a dimension line's end. */
function tick(ctx: CanvasRenderingContext2D, x: number, y: number, mm: (v: number) => number) {
  const s = mm(1.1);
  ctx.save();
  ctx.lineWidth = mm(0.35);
  ctx.beginPath();
  ctx.moveTo(x - s, y + s);
  ctx.lineTo(x + s, y - s);
  ctx.stroke();
  ctx.restore();
}

function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  doc: DrawingDoc,
  scale: number,
  sheet: SheetSize,
  paper: { w: number; h: number },
  mm: (v: number) => number,
): void {
  const x = mm(MARGIN_MM);
  const y = mm(paper.h - MARGIN_MM - TITLE_H_MM);
  const w = mm(paper.w - MARGIN_MM * 2);
  const h = mm(TITLE_H_MM);

  ctx.save();
  ctx.strokeStyle = INK;
  ctx.fillStyle = INK;
  ctx.lineWidth = mm(0.35);
  ctx.strokeRect(x, y, w, h);

  const cells: Array<{ label: string; value: string; width: number }> = [
    { label: 'ობიექტი', value: doc.projectName || '-', width: 0.34 },
    { label: 'ნახაზი', value: doc.name, width: 0.26 },
    { label: 'მასშტაბი', value: `1:${scale}`, width: 0.1 },
    { label: 'ფურცელი', value: sheet, width: 0.1 },
    { label: 'რევიზია', value: doc.revision || 'A', width: 0.1 },
    { label: 'თარიღი', value: new Date().toLocaleDateString('ka-GE'), width: 0.1 },
  ];

  let cx = x;
  for (const cell of cells) {
    const cw = w * cell.width;
    ctx.strokeRect(cx, y, cw, h);

    ctx.font = font(mm(2), 400);
    ctx.fillStyle = MUTED;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cell.label, cx + mm(2), y + mm(2));

    ctx.fillStyle = '#11151a';
    ctx.textBaseline = 'bottom';
    fitText(ctx, cell.value, cx + mm(2), y + h - mm(2.5), cw - mm(4), mm(3.4), 600);

    cx += cw;
  }
  ctx.restore();
}

// ── plumbing ───────────────────────────────────────────────────────────────

/**
 * An element's markup, rendered by the React the page already has into a
 * detached node - no second, server-side copy of React in the bundle for it.
 */
function markup(el: ReactElement): string {
  const host = document.createElement('div');
  const root = createRoot(host);
  flushSync(() => root.render(el));
  const html = host.innerHTML;
  root.unmount();
  return html;
}

/** The sheet's SVG as an image, ready to draw. */
async function svgImage(markup: string): Promise<HTMLImageElement> {
  const img = new Image();
  img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(markup)}`;
  await img.decode();
  return img;
}

/**
 * The page's Georgian font, loaded before any text is written: a sheet drawn
 * while it is still on its way would come out in a fallback face. Offline it
 * simply is not there, and the fallback is what there is.
 */
async function fontsReady(): Promise<void> {
  try {
    await Promise.all([
      document.fonts.load(`400 16px "Noto Sans Georgian"`),
      document.fonts.load(`600 16px "Noto Sans Georgian"`),
      document.fonts.load(`700 16px "Noto Sans Georgian"`),
    ]);
  } catch {
    // No font loading API, or the font failed - write in whatever is there.
  }
}

export interface DrawingExportOptions extends DrawingSheetOptions {
  /** the bill of materials to add on its own pages after the sheet; null for none */
  bom?: Bom | null;
}

export interface DrawingExportResult {
  /** the drawing page, or null when the file holds only the parts list */
  sheet: SheetResult | null;
  bomPages: boolean;
}

/**
 * Renders the sheet and saves it as a PDF at true physical size, with the bill
 * of materials after it when asked. Null when there was nothing to put in it.
 */
export async function exportDrawingToPdf(
  options: DrawingExportOptions,
): Promise<DrawingExportResult | null> {
  const sheet = await renderDrawingSheet(options);
  const bom = options.bom && options.bom.totalPieces > 0 ? options.bom : null;
  if (!sheet && !bom) return null;

  let pdf: jsPDF;
  if (sheet) {
    const paper = SHEETS[sheet.sheet];
    pdf = new jsPDF({ unit: 'mm', format: [paper.w, paper.h], orientation: 'landscape' });
    pdf.addImage(sheet.dataUrl, 'PNG', 0, 0, paper.w, paper.h, undefined, 'FAST');
  } else {
    pdf = new jsPDF({ unit: 'mm', format: 'a4', orientation: 'portrait' });
  }

  if (bom) {
    // html2canvas is only needed for the list, so it loads only when one is asked for.
    const { appendBomPages } = await import('./pdfExport');
    await appendBomPages(pdf, { bom, title: `${options.doc.name} - მასალების უწყისი` }, Boolean(sheet));
  }

  pdf.save(stampedName('du-drawing', 'pdf'));
  return { sheet, bomPages: Boolean(bom) };
}

/** Exposed for tests: which standard scale a drawing needs on a given sheet. */
export function requiredScale(
  pieces: Piece[],
  materials: Material[],
  sheet: SheetSize = 'A4',
): number | null {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const bounds = contentBounds(pieces, byId);
  if (!bounds) return null;
  const paper = SHEETS[sheet];
  const drawW = paper.w - MARGIN_MM * 2;
  const drawH = paper.h - MARGIN_MM * 2 - TITLE_H_MM;
  return (
    SCALE_LADDER.find((s) => (bounds.w * 10) / s <= drawW && (bounds.h * 10) / s <= drawH) ??
    SCALE_LADDER[SCALE_LADDER.length - 1]
  );
}

/** Re-exported so callers can size a preview without importing geometry. */
export { pieceBounds };
