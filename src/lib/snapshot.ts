import type { Material, Piece } from '../types';
import { contentBounds, planH, planW } from './geometry';
import { drawingSizeLabel } from './bom';
import { barRect, lPoints } from './shapePath';

/**
 * Renders the current drawing to an offscreen 2D canvas and returns a PNG data
 * URL, for embedding above the BOM table in the PDF.
 *
 * We draw it ourselves rather than screenshotting the live stage: the printout
 * needs a light background, no rulers/selection chrome, and labels that are
 * always horizontal — and this way the output does not depend on how the user
 * happened to have the view panned or zoomed.
 */
export interface SnapshotOptions {
  /** target image width in CSS px (the height follows the content aspect) */
  maxWidth?: number;
  maxHeight?: number;
  padding?: number;
  showLabels?: boolean;
}

export function renderLayoutSnapshot(
  materials: Material[],
  pieces: Piece[],
  options: SnapshotOptions = {},
): string | null {
  const { maxWidth = 1400, maxHeight = 950, padding = 28, showLabels = true } = options;

  const byId = new Map(materials.map((m) => [m.id, m]));
  const bounds = contentBounds(pieces, byId);
  if (!bounds) return null;

  // px per cm so the content fits the target box (never magnify past 4 px/cm)
  const scale = Math.min(
    4,
    (maxWidth - padding * 2) / bounds.w,
    (maxHeight - padding * 2) / bounds.h,
  );
  // ~1.6× gives roughly 250 dpi once placed on an A4 page — crisp in print
  // without ballooning the embedded bitmap.
  const dpr = 1.6;
  const cssW = Math.max(240, Math.ceil(bounds.w * scale + padding * 2));
  const cssH = Math.max(160, Math.ceil(bounds.h * scale + padding * 2));

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(cssW * dpr);
  canvas.height = Math.round(cssH * dpr);
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  ctx.scale(dpr, dpr);

  // world (cm) -> image (px)
  const tx = (wx: number) => padding + (wx - bounds.x) * scale;
  const ty = (wy: number) => padding + (wy - bounds.y) * scale;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, cssW, cssH);

  drawGrid(ctx, bounds, scale, tx, ty, cssW, cssH, padding);

  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    drawPiece(ctx, p, m, tx, ty, scale);
  }

  if (showLabels) {
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (!m) continue;
      drawLabel(ctx, p, m, tx, ty, scale);
    }
  }

  // frame
  ctx.strokeStyle = '#c9ced6';
  ctx.lineWidth = 1;
  ctx.strokeRect(0.5, 0.5, cssW - 1, cssH - 1);

  return canvas.toDataURL('image/png');
}

function drawGrid(
  ctx: CanvasRenderingContext2D,
  bounds: { x: number; y: number; w: number; h: number },
  scale: number,
  tx: (v: number) => number,
  ty: (v: number) => number,
  cssW: number,
  cssH: number,
  padding: number,
): void {
  const step = 100; // cm
  if (step * scale < 8) return;
  ctx.save();
  ctx.strokeStyle = '#eef1f5';
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (let cm = Math.floor(bounds.x / step) * step; cm <= bounds.x + bounds.w; cm += step) {
    const x = Math.round(tx(cm)) + 0.5;
    ctx.moveTo(x, padding);
    ctx.lineTo(x, cssH - padding);
  }
  for (let cm = Math.floor(bounds.y / step) * step; cm <= bounds.y + bounds.h; cm += step) {
    const y = Math.round(ty(cm)) + 0.5;
    ctx.moveTo(padding, y);
    ctx.lineTo(cssW - padding, y);
  }
  ctx.stroke();
  ctx.restore();
}

function drawPiece(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  m: Material,
  tx: (v: number) => number,
  ty: (v: number) => number,
  scale: number,
): void {
  const pw = planW(m);
  const ph = planH(m);
  const cx = tx(p.x + pw / 2);
  const cy = ty(p.y + ph / 2);
  const w = pw * scale;
  const h = ph * scale;

  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((p.rot * Math.PI) / 180);
  ctx.translate(-w / 2, -h / 2); // now drawing in the material's own box
  ctx.fillStyle = m.color;
  ctx.strokeStyle = 'rgba(0,0,0,.55)';
  ctx.lineWidth = 1;

  if (m.shape === 'L') {
    const pts = lPoints(w, h);
    ctx.beginPath();
    pts.forEach(([px, py], i) => (i === 0 ? ctx.moveTo(px, py) : ctx.lineTo(px, py)));
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  } else if (m.shape === 'line') {
    const bar = barRect(w, h);
    roundedRect(ctx, bar.x, bar.y, bar.w, bar.h, Math.min(bar.r, 4));
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(0, 0, w, h);
    ctx.strokeRect(0, 0, w, h);
  }
  ctx.restore();
}

function drawLabel(
  ctx: CanvasRenderingContext2D,
  p: Piece,
  m: Material,
  tx: (v: number) => number,
  ty: (v: number) => number,
  scale: number,
): void {
  const upright = ((p.rot % 180) + 180) % 180 === 0;
  const boxW = (upright ? planW(m) : planH(m)) * scale;
  const boxH = (upright ? planH(m) : planW(m)) * scale;
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
  ctx.fillStyle = 'rgba(0,0,0,.78)';

  // Bars carry their dimension along the length; compact pieces must fit both
  // ways, so shrink the font before falling back to a leadered outside label.
  const bar = m.shape === 'line' || along >= across * 4;
  for (const px of [11, 9, 7.5]) {
    ctx.font = font(px);
    const w = ctx.measureText(text).width;
    if (w + 4 <= along && (bar || px * 1.15 <= across)) {
      ctx.translate(cx, cy);
      if (vertical) ctx.rotate(-Math.PI / 2);
      ctx.fillText(text, 0, 0);
      ctx.restore();
      return;
    }
  }

  const px = 9;
  ctx.font = font(px);
  const ly = cy - boxH / 2 - 5 - px / 2;
  ctx.strokeStyle = 'rgba(0,0,0,.4)';
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, cy - boxH / 2);
  ctx.lineTo(cx, ly + px / 2);
  ctx.stroke();
  ctx.fillText(text, cx, ly);
  ctx.restore();
}

function roundedRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.max(0, Math.min(r, w / 2, h / 2));
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}
