import type { Material, Piece, ViewTransform } from '../types';

/**
 * ── Canvas maths ──────────────────────────────────────────────────────────────
 *
 * World units are CENTIMETRES. The `#world` layer is drawn at 1 cm = 1 CSS px
 * and then transformed with `translate(panX, panY) scale(zoom)`, so:
 *
 *     screen = world * zoom + pan
 *     world  = (screen - pan) / zoom
 *
 * `zoom` is therefore literally "screen pixels per centimetre". All screen
 * coordinates below are relative to the stage element's top-left corner.
 */

export const WORLD_W = 4000; // cm
export const WORLD_H = 3000; // cm
export const MIN_ZOOM = 0.08;
export const MAX_ZOOM = 8;

/**
 * ── Plan view ────────────────────────────────────────────────────────────────
 *
 * The surface is a PLAN (looking down on the column), so a piece occupies
 * `w × depth` on screen. Its `h` is the vertical height and points out of the
 * page — a "პანელი 30*300" is drawn 30 cm wide and 9 cm thick, not 30 × 300.
 * Everything that positions or hit-tests a piece must go through these two.
 */
export const planW = (m: Material): number => m.w;
export const planH = (m: Material): number => m.depth;

export function worldToScreen(wx: number, wy: number, v: ViewTransform) {
  return { x: wx * v.zoom + v.panX, y: wy * v.zoom + v.panY };
}

export function screenToWorld(sx: number, sy: number, v: ViewTransform) {
  return { x: (sx - v.panX) / v.zoom, y: (sy - v.panY) / v.zoom };
}

export function clampZoom(z: number): number {
  return Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));
}

export function snapValue(value: number, step: number, enabled: boolean): number {
  return enabled && step > 0 ? Math.round(value / step) * step : value;
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Axis-aligned bounding box of a placed piece, in world cm.
 * A piece is rotated about its own centre, so at 90°/270° the box simply swaps
 * width and height while the centre stays put.
 */
/** Normalised rotation in [0, 360). */
export function normalizeRot(rot: number): number {
  return ((rot % 360) + 360) % 360;
}

/**
 * On-screen extents of a piece rotated by any angle, about its own centre.
 * At 0/90/180/270 this reduces to swapping w and h; at other angles it is the
 * usual rotated-rectangle bounding box.
 */
export function rotatedExtent(pw: number, ph: number, rot: number): { w: number; h: number } {
  const rad = (normalizeRot(rot) * Math.PI) / 180;
  const cos = Math.abs(Math.cos(rad));
  const sin = Math.abs(Math.sin(rad));
  return { w: pw * cos + ph * sin, h: pw * sin + ph * cos };
}

export function pieceBounds(piece: Piece, m: Material): Rect {
  const pw = planW(m);
  const ph = planH(m);
  const cx = piece.x + pw / 2;
  const cy = piece.y + ph / 2;
  const { w, h } = rotatedExtent(pw, ph, piece.rot);
  return { x: cx - w / 2, y: cy - h / 2, w, h };
}

/** Bounding box that contains every placed piece (null when nothing is placed). */
export function contentBounds(
  pieces: Piece[],
  byId: Map<string, Material>,
): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    const b = pieceBounds(p, m);
    minX = Math.min(minX, b.x);
    minY = Math.min(minY, b.y);
    maxX = Math.max(maxX, b.x + b.w);
    maxY = Math.max(maxY, b.y + b.h);
  }
  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: Math.max(1, maxX - minX), h: Math.max(1, maxY - minY) };
}

export function rectsOverlap(a: Rect, b: Rect, tolerance = 0.5): boolean {
  return (
    a.x + a.w > b.x + tolerance &&
    b.x + b.w > a.x + tolerance &&
    a.y + a.h > b.y + tolerance &&
    b.y + b.h > a.y + tolerance
  );
}

/**
 * Ids of pieces whose footprints clash. Formwork panels butt against each
 * other, so two panels in the same place almost always means a mistake.
 *
 * Linear materials are excluded: walers, tie rods and posts are *meant* to lie
 * across panels, and flagging those would paint a correct column entirely red.
 * Only sheet-like materials (rect and L) are checked against each other.
 *
 * A small tolerance keeps exact edge-to-edge contact from counting as overlap.
 */
export function findOverlaps(pieces: Piece[], byId: Map<string, Material>): Set<string> {
  const boxes = pieces
    .map((p) => {
      const m = byId.get(p.materialId);
      if (!m || isLinear(m)) return null;
      return { id: p.id, box: pieceBounds(p, m) };
    })
    .filter((v): v is { id: string; box: Rect } => v !== null);

  const hits = new Set<string>();
  // Sort by x so we can stop comparing once boxes are past each other.
  boxes.sort((a, b) => a.box.x - b.box.x);
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (boxes[j].box.x >= boxes[i].box.x + boxes[i].box.w) break;
      if (rectsOverlap(boxes[i].box, boxes[j].box)) {
        hits.add(boxes[i].id);
        hits.add(boxes[j].id);
      }
    }
  }
  return hits;
}

/**
 * A box to align, plus any line inside it that is worth aligning to.
 *
 * The bounding box is not the whole story for every piece. An L-profile's legs
 * lie nine centimetres inside two of its four edges, and those leg faces are
 * exactly what has to end up flush with a panel or with another corner — so
 * aligning one corner to another by its box alone is impossible from the two
 * sides where the box is not the piece.
 */
export interface SnapRect extends Rect {
  /** extra vertical lines to align on, in world cm */
  xLines?: number[];
  /** extra horizontal lines to align on */
  yLines?: number[];
}

export interface EdgeSnap {
  dx: number;
  dy: number;
  /** world x of the alignment line to draw, if any */
  guideX: number | null;
  guideY: number | null;
}

/**
 * Nudges a dragged bounding box so its edges (or centre) line up with a nearby
 * piece — the behaviour that lets panels butt together exactly instead of
 * landing 2 cm apart. Grid snapping alone cannot do this because panel widths
 * are not multiples of the grid step.
 */
export function computeEdgeSnap(
  moving: SnapRect,
  targets: SnapRect[],
  tolerance: number,
): EdgeSnap {
  const movingX = [moving.x, moving.x + moving.w / 2, moving.x + moving.w, ...(moving.xLines ?? [])];
  const movingY = [moving.y, moving.y + moving.h / 2, moving.y + moving.h, ...(moving.yLines ?? [])];

  let bestX: { delta: number; line: number } | null = null;
  let bestY: { delta: number; line: number } | null = null;

  for (const t of targets) {
    const targetX = [t.x, t.x + t.w / 2, t.x + t.w, ...(t.xLines ?? [])];
    const targetY = [t.y, t.y + t.h / 2, t.y + t.h, ...(t.yLines ?? [])];

    for (const mx of movingX) {
      for (const tx of targetX) {
        const delta = tx - mx;
        if (Math.abs(delta) <= tolerance && (!bestX || Math.abs(delta) < Math.abs(bestX.delta))) {
          bestX = { delta, line: tx };
        }
      }
    }
    for (const my of movingY) {
      for (const ty of targetY) {
        const delta = ty - my;
        if (Math.abs(delta) <= tolerance && (!bestY || Math.abs(delta) < Math.abs(bestY.delta))) {
          bestY = { delta, line: ty };
        }
      }
    }
  }

  return {
    dx: bestX?.delta ?? 0,
    dy: bestY?.delta ?? 0,
    guideX: bestX?.line ?? null,
    guideY: bestY?.line ?? null,
  };
}

/** Union of several rectangles (the bounding box of a multi-selection). */
export function unionRect(rects: Rect[]): Rect | null {
  if (!rects.length) return null;
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const r of rects) {
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/** True for materials measured by length (walers, tie rods, posts). */
export function isLinear(m: Material): boolean {
  return m.shape === 'line';
}

/** Longer side in cm — the "length" of a linear material. */
export function lengthCm(m: Material): number {
  return Math.max(m.w, m.h);
}

/** The heavy grid line, in cm. A metre, so the squares can be counted. */
export const GRID_MAJOR_CM = 100;

/**
 * The fine grid square, in cm, at the current zoom.
 *
 * Five where five will read, because five is what the drawing snaps to and a
 * square you cannot land on is a square in the way: three out of every four
 * snap positions had no line under them on the old fixed 20 cm grid, so setting
 * a corner out meant counting in the head instead of counting squares.
 *
 * It steps up as the drawing is zoomed out, at the point where the lines would
 * be closer together than they are wide and the surface would go grey.
 */
export function gridStep(zoom: number): number {
  const steps = [5, 10, 20, 50, GRID_MAJOR_CM, 200, 500];
  const target = 4.5 / zoom;
  return steps.find((s) => s >= target) ?? 500;
}

/** Ruler step that keeps ticks ≈70 px apart at the current zoom. */
export function niceStep(zoom: number): number {
  const target = 70 / zoom;
  const steps = [10, 20, 50, 100, 200, 500, 1000, 2000];
  return steps.find((s) => s >= target) ?? 2000;
}

/** Drop trailing ".0" from computed cm values. */
export function fmtCm(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 10) / 10);
}

/**
 * Where to drop a freshly generated assembly, in world cm.
 *
 * The wizards used to place their output at the world point behind the stage's
 * top-left pixel, plus 40 cm. Three things were wrong with that: the top-left
 * pixel is under the ruler gutter, 40 cm is 8 px at 20% zoom and 224 px at
 * 560%, and a column is built *outwards* from its origin — the walers sit at
 * origin − panelDepth − walerDepth — so the assembly reached back past the
 * corner it was measured from and off the screen.
 *
 * The middle of what the user is looking at has none of those problems, and it
 * is where anyone would expect a thing they just asked for to appear. The
 * caller passes the assembly's own plan size so the box is centred rather than
 * hung off its corner.
 */
export function dropOrigin(
  view: { panX: number; panY: number; zoom: number; stageW: number; stageH: number },
  sizeX: number,
  sizeY: number,
): { x: number; y: number } {
  const { panX, panY, zoom, stageW, stageH } = view;
  // A zero stage means the canvas has not been measured yet — on the very
  // first render, before the ResizeObserver reports. The world origin is a
  // better answer than dividing by nothing.
  if (!(zoom > 0) || !(stageW > 0) || !(stageH > 0)) return { x: 0, y: 0 };
  const centreX = (stageW / 2 - panX) / zoom;
  const centreY = (stageH / 2 - panY) / zoom;
  return {
    x: Math.round(centreX - (Number.isFinite(sizeX) ? sizeX : 0) / 2),
    y: Math.round(centreY - (Number.isFinite(sizeY) ? sizeY : 0) / 2),
  };
}
