import { jsPDF } from 'jspdf';
import type { DrawingDoc, Material, Piece, SketchPath } from '../types';
import { contentBounds, pieceBounds, planH, planW } from './geometry';
import { drawingSizeLabel } from './bom';
import { barRect, scaledOutline } from './shapePath';
import { segments } from './sketch';
import { stampedName } from './files';

/**
 * Prints the drawing itself — to scale, dimensioned, with a title block — as
 * opposed to the BOM sheet. This is the thing a foreman takes to site.
 *
 * The whole sheet (drawing, dimensions and title block) is rendered to one
 * canvas and placed into the PDF at exact millimetre size. Rendering the text
 * with the browser's font stack is what keeps Georgian legible; drawing it with
 * jsPDF's built-in fonts would produce garbage. Because the canvas is placed at
 * a known mm size, the printed scale really is 1:`scale`.
 */

export type SheetSize = 'A4' | 'A3';

const SHEETS: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 }, // landscape
  A3: { w: 420, h: 297 },
};

const MARGIN_MM = 10;
const TITLE_H_MM = 28;
/** Room reserved outside the content for the overall dimension lines. */
const DIM_GUTTER_MM = 14;
/** Render density. 200 dpi keeps lines crisp without a huge file. */
const PX_PER_MM = 200 / 25.4;

export interface DrawingSheetOptions {
  doc: DrawingDoc;
  materials: Material[];
  sheet?: SheetSize;
  /** override the document scale, e.g. when auto-fitting */
  scale?: number;
  showDimensions?: boolean;
  /** print the drawn layout under the formwork as a setting-out line */
  showSketch?: boolean;
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

export function renderDrawingSheet(options: DrawingSheetOptions): SheetResult | null {
  const { doc, materials, sheet = 'A4', showDimensions = true, showSketch = true } = options;
  const byId = new Map(materials.map((m) => [m.id, m]));
  const bounds = contentBounds(doc.pieces, byId);
  if (!bounds) return null;

  const paper = SHEETS[sheet];
  const drawW = paper.w - MARGIN_MM * 2;
  const drawH = paper.h - MARGIN_MM * 2 - TITLE_H_MM;

  // Dimension lines sit outside the content, so the content itself has to fit
  // in a slightly smaller box or the witness lines run into the title block.
  const dimGutter = showDimensions ? DIM_GUTTER_MM : 0;
  const fitW = drawW - dimGutter;
  const fitH = drawH - dimGutter;

  // cm → mm at a given scale: mm = cm * 10 / scale
  const fitsAt = (s: number) => (bounds.w * 10) / s <= fitW && (bounds.h * 10) / s <= fitH;

  const requested = options.scale ?? doc.scale;
  let scale = requested;
  let rescaled = false;

  if (requested <= 0) {
    // Auto: the smallest denominator that still fits fills the sheet best.
    scale = SCALE_LADDER.find(fitsAt) ?? SCALE_LADDER[SCALE_LADDER.length - 1];
  } else if (!fitsAt(scale)) {
    // Step out to the next standard scale that fits rather than inventing one.
    const found = SCALE_LADDER.find((s) => s >= requested && fitsAt(s));
    scale = found ?? SCALE_LADDER[SCALE_LADDER.length - 1];
    rescaled = true;
  }

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(paper.w * PX_PER_MM);
  canvas.height = Math.round(paper.h * PX_PER_MM);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  const mm = (v: number) => v * PX_PER_MM;
  /** world cm → canvas px */
  const cmToPx = (v: number) => mm((v * 10) / scale);

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  // Sheet border
  ctx.strokeStyle = '#1b1f24';
  ctx.lineWidth = mm(0.5);
  ctx.strokeRect(mm(MARGIN_MM / 2), mm(MARGIN_MM / 2), mm(paper.w - MARGIN_MM), mm(paper.h - MARGIN_MM));

  // Centre the content in the drawing area
  const contentWpx = cmToPx(bounds.w);
  const contentHpx = cmToPx(bounds.h);
  const offsetX = mm(MARGIN_MM) + (mm(fitW) - contentWpx) / 2;
  const offsetY = mm(MARGIN_MM) + (mm(fitH) - contentHpx) / 2;
  const tx = (wx: number) => offsetX + cmToPx(wx - bounds.x);
  const ty = (wy: number) => offsetY + cmToPx(wy - bounds.y);

  // The layout goes down first, so the formwork sits on it exactly as it does
  // on screen. Setting-out lines belong on the sheet: they are what the person
  // on site checks the panels against, and a printed drawing without them is
  // just a pile of panels with no datum.
  if (showSketch) drawSketch(ctx, doc.sketch ?? [], tx, ty, mm);

  for (const piece of doc.pieces) {
    const m = byId.get(piece.materialId);
    if (m) drawPiece(ctx, piece, m, tx, ty, cmToPx);
  }

  if (showDimensions) {
    for (const piece of doc.pieces) {
      const m = byId.get(piece.materialId);
      if (m) drawPieceLabel(ctx, piece, m, tx, ty, cmToPx, mm);
    }
    drawOverallDimensions(ctx, bounds, tx, ty, mm);
  }

  drawTitleBlock(ctx, doc, scale, sheet, paper, mm);

  return { dataUrl: canvas.toDataURL('image/png'), sheet, scale, rescaled };
}

/**
 * The drawn layout, as a setting-out line.
 *
 * Long-dashed and thin, which is the drafting convention for a reference line
 * rather than a built edge — on paper it must be impossible to mistake for a
 * panel, and there is no colour to rely on.
 */
function drawSketch(
  ctx: CanvasRenderingContext2D,
  sketch: SketchPath[],
  tx: (x: number) => number,
  ty: (y: number) => number,
  mm: (v: number) => number,
): void {
  if (!sketch.length) return;
  ctx.save();
  ctx.strokeStyle = '#8a8f96';
  ctx.lineWidth = mm(0.25);
  ctx.setLineDash([mm(4), mm(2)]);
  for (const path of sketch) {
    for (const [a, b] of segments(path)) {
      ctx.beginPath();
      ctx.moveTo(tx(a.x), ty(a.y));
      ctx.lineTo(tx(b.x), ty(b.y));
      ctx.stroke();
    }
  }
  ctx.restore();
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  m: Material,
  tx: (v: number) => number,
  ty: (v: number) => number,
  cmToPx: (v: number) => number,
): void {
  const pw = planW(m);
  const ph = planH(m);
  const cx = tx(p.x + pw / 2);
  const cy = ty(p.y + ph / 2);
  const w = cmToPx(pw);
  const h = cmToPx(ph);

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2);
  ctx.fillStyle = m.color;
  ctx.globalAlpha = 0.55; // washed out so the linework and text stay dominant
  ctx.strokeStyle = '#1b1f24';
  ctx.lineWidth = Math.max(1, cmToPx(0.4));

  if (m.shape === 'L') {
    const pts = scaledOutline(m, w, h);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.stroke();
  } else if (m.shape === 'line') {
    const bar = barRect(w, h);
    ctx.fillRect(bar.x, bar.y, bar.w, bar.h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(bar.x, bar.y, bar.w, bar.h);
  } else {
    ctx.fillRect(0, 0, w, h);
    ctx.globalAlpha = 1;
    ctx.strokeRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawPieceLabel(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  m: Material,
  tx: (v: number) => number,
  ty: (v: number) => number,
  cmToPx: (v: number) => number,
  mm: (v: number) => number,
): void {
  const upright = ((p.rot % 180) + 180) % 180 === 0;
  const boxW = cmToPx(upright ? planW(m) : planH(m));
  const boxH = cmToPx(upright ? planH(m) : planW(m));
  const text = drawingSizeLabel(m);
  const cx = tx(p.x + planW(m) / 2);
  const cy = ty(p.y + planH(m) / 2);
  const vertical = boxH > boxW;
  const along = vertical ? boxH : boxW;
  const across = vertical ? boxW : boxH;
  const font = (px: number) =>
    `600 ${px}px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif`;

  ctx.save();
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = '#11151a';

  // A long thin bar (rod, waler, panel edge) carries its dimension ALONG its
  // length — the text may overflow the thin dimension, that is normal. A
  // compact piece (a corner, a stubby filler) must hold the text within both
  // sides, so we shrink the font to try to fit it before giving up.
  // Smallest font is a readable ~4.5 pt floor; anything that still will not fit
  // gets a leadered label rather than a microscopic one crammed inside.
  const bar = m.shape === 'line' || along >= across * 4;
  const sizes = [mm(2.4), mm(2.0), mm(1.6)];

  for (const px of sizes) {
    ctx.font = font(px);
    const w = ctx.measureText(text).width;
    const fitsAlong = w + mm(0.6) <= along;
    const fitsAcross = px * 1.15 <= across;
    if (fitsAlong && (bar || fitsAcross)) {
      ctx.translate(cx, cy);
      if (vertical) ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
      return;
    }
  }

  // Genuinely too small even at the smallest font (little fillers): place the
  // label just outside in clear space and draw a thin leader to the piece, so
  // it is unmistakably that piece's dimension rather than floating loose.
  const px = mm(1.9);
  ctx.font = font(px);
  const gap = mm(1.4);
  const ly = cy - boxH / 2 - gap - px / 2;
  ctx.strokeStyle = '#4a5560';
  ctx.lineWidth = mm(0.18);
  ctx.beginPath();
  ctx.moveTo(cx, cy - boxH / 2);
  ctx.lineTo(cx, ly + px / 2);
  ctx.stroke();
  ctx.fillText(text, cx, ly);
  ctx.restore();
}

/** Overall width/height dimension lines with arrow ticks, CAD style. */
function drawOverallDimensions(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  tx: (v: number) => number,
  ty: (v: number) => number,
  mm: (v: number) => number,
): void {
  const offset = mm(6);
  const font = mm(2.6);
  ctx.save();
  ctx.strokeStyle = '#1b1f24';
  ctx.fillStyle = '#1b1f24';
  ctx.lineWidth = Math.max(1, mm(0.25));
  ctx.font = `${font}px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif`;

  const left = tx(bounds.x);
  const right = tx(bounds.x + bounds.w);
  const top = ty(bounds.y);
  const bottom = ty(bounds.y + bounds.h);

  // horizontal, below the drawing
  const hy = bottom + offset;
  line(ctx, left, hy, right, hy);
  tick(ctx, left, hy, mm);
  tick(ctx, right, hy, mm);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(bounds.w)} სმ`, (left + right) / 2, hy - mm(1));

  // vertical, to the right
  const vx = right + offset;
  line(ctx, vx, top, vx, bottom);
  tick(ctx, vx, top, mm, true);
  tick(ctx, vx, bottom, mm, true);
  ctx.save();
  ctx.translate(vx + mm(1.5), (top + bottom) / 2);
  ctx.rotate(-Math.PI / 2);
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(bounds.h)} სმ`, 0, 0);
  ctx.restore();

  ctx.restore();
}

function line(ctx: CanvasRenderingContext2D, x1: number, y1: number, x2: number, y2: number) {
  ctx.beginPath();
  ctx.moveTo(x1, y1);
  ctx.lineTo(x2, y2);
  ctx.stroke();
}

function tick(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  mm: (v: number) => number,
  vertical = false,
) {
  const s = mm(1.2);
  ctx.beginPath();
  if (vertical) {
    ctx.moveTo(x - s, y);
    ctx.lineTo(x + s, y);
  } else {
    ctx.moveTo(x, y - s);
    ctx.lineTo(x, y + s);
  }
  ctx.stroke();
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
  ctx.strokeStyle = '#1b1f24';
  ctx.fillStyle = '#1b1f24';
  ctx.lineWidth = mm(0.4);
  ctx.strokeRect(x, y, w, h);

  const cells: Array<{ label: string; value: string; width: number }> = [
    { label: 'ობიექტი', value: doc.projectName || '—', width: 0.34 },
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

    ctx.font = `${mm(2.1)}px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif`;
    ctx.fillStyle = '#5c6572';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(cell.label, cx + mm(2), y + mm(2.5));

    ctx.font = `600 ${mm(3.4)}px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif`;
    ctx.fillStyle = '#11151a';
    ctx.textBaseline = 'bottom';
    // Clip long values to their cell instead of spilling into the next one.
    ctx.save();
    ctx.beginPath();
    ctx.rect(cx, y, cw, h);
    ctx.clip();
    ctx.fillText(cell.value, cx + mm(2), y + h - mm(3));
    ctx.restore();

    cx += cw;
  }
  ctx.restore();
}

/** Renders the sheet and saves it as a PDF at true physical size. */
export function exportDrawingToPdf(options: DrawingSheetOptions): SheetResult | null {
  const result = renderDrawingSheet(options);
  if (!result) return null;

  const paper = SHEETS[result.sheet];
  const pdf = new jsPDF({
    unit: 'mm',
    format: [paper.w, paper.h],
    orientation: 'landscape',
  });
  pdf.addImage(result.dataUrl, 'PNG', 0, 0, paper.w, paper.h, undefined, 'FAST');
  pdf.save(stampedName('du-drawing', 'pdf'));
  return result;
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
