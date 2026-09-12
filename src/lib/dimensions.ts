import type { Material, MeasureLine, Piece, SketchPath } from '../types';
import { drawingSizeLabel } from './bom';
import { planH, planW } from './geometry';
import { legLength, segments, type Point } from './sketch';

/**
 * Where every length goes on screen, and how the lengths keep out of each
 * other's way.
 *
 * A length always sits at the middle of what it measures. Parked at one end it
 * reads as belonging to whatever is next to that end, and a run total written
 * at a wall's first corner was being read as the length of the leg beside it.
 *
 * When two lengths would land on top of each other - two faces of a wall a
 * panel's thickness apart, a panel lying on its layout line - the second one
 * does what a drafter does: it steps out to a dimension line of its own, with
 * thin extension lines back to the exact ends it measures. The shorter span
 * stays nearest the work, the longer one goes outside it, which is the order
 * dimension chains are stacked in on any drawing.
 *
 * Pure and in screen pixels, so it can be tested without a browser and the
 * overlay only has to draw what it is given.
 */

/**
 * Which lengths are on the drawing, decided per kind of thing.
 *
 * One mode for everything could not say "panel lengths only when I point at
 * one, but my measured lines always" - and that is what a working drawing
 * needs: the numbers somebody put there on purpose stay, the rest come and go.
 */
export type LengthKind = 'wall' | 'line' | 'corner' | 'other' | 'measure';
export type LengthVisibility = 'always' | 'hover' | 'click' | 'never';

export const LENGTH_KINDS: readonly LengthKind[] = ['wall', 'line', 'corner', 'other', 'measure'];
export const LENGTH_VISIBILITIES: readonly LengthVisibility[] = ['always', 'hover', 'click', 'never'];

export const DEFAULT_LENGTH_VISIBILITY: Record<LengthKind, LengthVisibility> = {
  wall: 'hover',
  line: 'click',
  corner: 'click',
  other: 'never',
  measure: 'always',
};

/** Which column of the table a placed piece belongs to. */
export function lengthKindOf(m: Material): LengthKind {
  // Fillers close the face between panels, so they read as the wall they are.
  if (m.category === 'panel' || m.category === 'filler') return 'wall';
  if (m.category === 'corner') return 'corner';
  return 'other';
}

export function normalizeLengthVisibility(raw: unknown): Record<LengthKind, LengthVisibility> {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_LENGTH_VISIBILITY };
  for (const kind of LENGTH_KINDS) {
    const v = r[kind];
    if (typeof v === 'string' && (LENGTH_VISIBILITIES as readonly string[]).includes(v)) {
      out[kind] = v as LengthVisibility;
    }
  }
  return out;
}

/**
 * What the printed sheet shows - simpler than the screen, because paper has no
 * pointer: a length is on it or it is not.
 */
export interface PdfVisibility {
  /** lengths, per kind */
  wall: boolean;
  line: boolean;
  corner: boolean;
  other: boolean;
  measure: boolean;
  /** the drawn layout lines themselves */
  sketchLines: boolean;
  /** the measured lines themselves */
  measureLines: boolean;
  /** overall width and height outside the drawing */
  overall: boolean;
}

export const DEFAULT_PDF_VISIBILITY: PdfVisibility = {
  wall: true,
  line: false,
  corner: true,
  other: true,
  measure: true,
  sketchLines: true,
  measureLines: true,
  overall: true,
};

export function normalizePdfVisibility(raw: unknown): PdfVisibility {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const out = { ...DEFAULT_PDF_VISIBILITY };
  for (const key of Object.keys(out) as Array<keyof PdfVisibility>) {
    if (typeof r[key] === 'boolean') out[key] = r[key] as boolean;
  }
  return out;
}

/** Does a length with this setting show, given whether its thing is pointed at or picked? */
export function shows(visibility: LengthVisibility, hovered: boolean, selected: boolean): boolean {
  switch (visibility) {
    case 'always':
      return true;
    // Clicking something means pointing at it first, so picked counts too.
    case 'hover':
      return hovered || selected;
    case 'click':
      return selected;
    default:
      return false;
  }
}

export interface DimItem {
  /** stable across renders: `pc:<piece>`, `sk:<path>:<leg>`, `skt:<path>`, `ms:<measure>` */
  id: string;
  /** the span being measured, world cm */
  a: Point;
  b: Point;
  text: string[];
  /** lower is placed first and so gets the nearest free spot */
  priority: number;
  /** the piece's own footprint (world cm) a label may sit inside, when it fits */
  inside?: { along: number; across: number };
  /** selected or under the pointer */
  accent?: boolean;
}

export interface PlacedDim {
  id: string;
  /** 0 = just off the line (or inside the piece); 1+ = stepped out on its own dimension line */
  tier: number;
  inside: boolean;
  accent: boolean;
  lines: string[];
  /** label centre, screen px */
  x: number;
  y: number;
  /** degrees, always in [-90, 90) so no length is ever upside down */
  angle: number;
  w: number;
  h: number;
  dimLine?: [Point, Point];
  ext?: [[Point, Point], [Point, Point]];
}

export interface DimView {
  zoom: number;
  panX: number;
  panY: number;
  stageW: number;
  stageH: number;
  /** keep lengths on spans too small to normally be worth labelling */
  force?: boolean;
}

export const DIM_FONT_PX = 11;
const CHAR_W = 0.58; // average glyph width as a fraction of the font size
const LINE_H = 1.28;
/** the chip's padding and border, both axes */
const PAD_X = 12;
const PAD_Y = 4;
/** clearance between a line and a label sitting beside it */
const GAP_PX = 4;
/** distance between one stepped-out dimension line and the next */
const TIER_GAP_PX = 22;
export const MAX_TIER = 4;
/** extension lines run a little past the dimension line, as drawn by hand */
const EXT_OVERSHOOT_PX = 3;
/** below this a span is a speck and labelling it is noise */
const MIN_SPAN_PX = 12;
const CULL_MARGIN_PX = 220;
const COLLIDE_PAD_PX = 3;

interface Box {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

function textSize(lines: string[]): { w: number; h: number } {
  const longest = lines.reduce((n, t) => Math.max(n, t.length), 0);
  return {
    w: longest * DIM_FONT_PX * CHAR_W + PAD_X,
    h: lines.length * DIM_FONT_PX * LINE_H + PAD_Y,
  };
}

/** Axis-aligned box around a label turned to run along `u`. */
function boxAround(cx: number, cy: number, u: Point, n: Point, w: number, h: number): Box {
  const hx = (Math.abs(u.x) * w) / 2 + (Math.abs(n.x) * h) / 2 + COLLIDE_PAD_PX;
  const hy = (Math.abs(u.y) * w) / 2 + (Math.abs(n.y) * h) / 2 + COLLIDE_PAD_PX;
  return { x0: cx - hx, y0: cy - hy, x1: cx + hx, y1: cy + hy };
}

const overlaps = (p: Box, q: Box) => p.x0 < q.x1 && q.x0 < p.x1 && p.y0 < q.y1 && q.y0 < p.y1;

/** Does segment a-b pass through the box? (Liang-Barsky clipping.) */
function segmentHitsBox(a: Point, b: Point, box: Box): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const edges: Array<[number, number]> = [
    [-dx, a.x - box.x0],
    [dx, box.x1 - a.x],
    [-dy, a.y - box.y0],
    [dy, box.y1 - a.y],
  ];
  for (const [p, q] of edges) {
    if (p === 0) {
      if (q < 0) return false;
      continue;
    }
    const r = q / p;
    if (p < 0) {
      if (r > t1) return false;
      if (r > t0) t0 = r;
    } else {
      if (r < t0) return false;
      if (r < t1) t1 = r;
    }
  }
  return true;
}

/**
 * The angle a length is written at: along its span, turned so it reads left to
 * right, and bottom to top on a vertical - the drafting convention, so a
 * drawing turned clockwise to read its verticals shows them the right way up.
 */
export function readableAngle(u: Point): number {
  let deg = (Math.atan2(u.y, u.x) * 180) / Math.PI;
  if (deg >= 90) deg -= 180;
  if (deg < -90) deg += 180;
  return deg;
}

/**
 * Which side of a span its length goes on: up the screen, or left for a span
 * that runs exactly vertically.
 *
 * One fixed rule rather than "the side with room", so the two faces of a wall
 * put their lengths on the same side and stack instead of splitting to either
 * side of the concrete where nobody can compare them.
 */
export function outwardNormal(u: Point): Point {
  const n = { x: -u.y, y: u.x };
  if (Math.abs(n.y) > 1e-9) return n.y < 0 ? n : { x: -n.x, y: -n.y };
  return n.x < 0 ? n : { x: -n.x, y: -n.y };
}

const along = (p: Point, n: Point, d: number): Point => ({ x: p.x + n.x * d, y: p.y + n.y * d });

export function layoutDimensions(items: DimItem[], view: DimView): PlacedDim[] {
  const { zoom, panX, panY, stageW, stageH, force = false } = view;
  const screen = (p: Point): Point => ({ x: p.x * zoom + panX, y: p.y * zoom + panY });

  const prepared = items
    .map((item) => {
      const sa = screen(item.a);
      const sb = screen(item.b);
      return { item, sa, sb, len: Math.hypot(sb.x - sa.x, sb.y - sa.y) };
    })
    .filter(({ sa, sb, len }) => {
      if (len <= 0 || (len < MIN_SPAN_PX && !force)) return false;
      const mx = (sa.x + sb.x) / 2;
      const my = (sa.y + sb.y) / 2;
      return (
        mx >= -CULL_MARGIN_PX &&
        my >= -CULL_MARGIN_PX &&
        mx <= stageW + CULL_MARGIN_PX &&
        my <= stageH + CULL_MARGIN_PX
      );
    })
    // Priority first, then shortest nearest, then id so the result never
    // depends on the order the items happened to arrive in.
    .sort(
      (p, q) =>
        p.item.priority - q.item.priority ||
        p.len - q.len ||
        (p.item.id < q.item.id ? -1 : p.item.id > q.item.id ? 1 : 0),
    );

  const takenLabels: Box[] = [];
  const takenLines: Array<[Point, Point]> = [];
  const out: PlacedDim[] = [];

  for (const { item, sa, sb, len } of prepared) {
    const u = { x: (sb.x - sa.x) / len, y: (sb.y - sa.y) / len };
    const n = outwardNormal(u);
    const angle = readableAngle(u);
    const { w, h } = textSize(item.text);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const base = { id: item.id, accent: !!item.accent, lines: item.text, angle, w, h };

    const isFree = (box: Box, line?: [Point, Point]) =>
      !takenLabels.some((l) => overlaps(l, box)) &&
      !takenLines.some(([p, q]) => segmentHitsBox(p, q, box)) &&
      !(line && takenLabels.some((l) => segmentHitsBox(line[0], line[1], l)));

    let placed: PlacedDim | null = null;
    let placedBox: Box | null = null;

    // Inside the piece, when the text genuinely fits there - no leader, no
    // line, nothing to confuse with the neighbours.
    if (item.inside && w <= item.inside.along * zoom && h <= item.inside.across * zoom) {
      const box = boxAround(mid.x, mid.y, u, n, w, h);
      if (isFree(box)) {
        placed = { ...base, tier: 0, inside: true, x: mid.x, y: mid.y };
        placedBox = box;
      }
    }

    for (let tier = 0; !placed && tier <= MAX_TIER; tier++) {
      if (tier === 0) {
        const c = along(mid, n, h / 2 + GAP_PX);
        const box = boxAround(c.x, c.y, u, n, w, h);
        if (isFree(box)) {
          placed = { ...base, tier, inside: false, x: c.x, y: c.y };
          placedBox = box;
        }
        continue;
      }
      // The first dimension line clears a tier-0 label; each after that clears
      // the one before it.
      const d = h + GAP_PX * 2 + (tier - 1) * TIER_GAP_PX;
      const c = along(mid, n, d);
      const box = boxAround(c.x, c.y, u, n, w, h);
      const dimLine: [Point, Point] = [along(sa, n, d), along(sb, n, d)];
      // Nowhere is free: the outermost tier is used anyway. A length that is
      // crowded is still better than a length that has vanished.
      if (isFree(box, dimLine) || tier === MAX_TIER) {
        placed = {
          ...base,
          tier,
          inside: false,
          x: c.x,
          y: c.y,
          dimLine,
          ext: [
            [along(sa, n, 2), along(sa, n, d + EXT_OVERSHOOT_PX)],
            [along(sb, n, 2), along(sb, n, d + EXT_OVERSHOOT_PX)],
          ],
        };
        placedBox = box;
        takenLines.push(dimLine);
      }
    }

    if (placed && placedBox) {
      takenLabels.push(placedBox);
      out.push(placed);
    }
  }
  return out;
}

/** 45, or 63.6 on a diagonal - whole centimetres whenever the length is one. */
export function fmtLength(cm: number): string {
  const r = Math.round(cm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

export interface DimSource {
  /** the master switch (D): off hides every length, whatever the table says */
  showLengths: boolean;
  visibility: Record<LengthKind, LengthVisibility>;
  pieces: Piece[];
  byId: Map<string, Material>;
  showNames: boolean;
  sketch: SketchPath[];
  measures: MeasureLine[];
  selectedIds: ReadonlySet<string>;
  selectedSketchIds: ReadonlySet<string>;
  hoverLeg: { pathId: string; index: number } | null;
  hoverPieceId: string | null;
  selectedMeasureId: string | null;
  hoverMeasureId: string | null;
}

/**
 * Every length the drawing should show right now.
 *
 * Names ride along on a piece's length rather than living on their own: hiding
 * a length is done to clear the drawing, and a name left on every panel would
 * put all the clutter straight back.
 */
export function collectDimItems(src: DimSource): DimItem[] {
  const out: DimItem[] = [];
  if (!src.showLengths) return out;
  const vis = src.visibility;

  for (const m of src.measures) {
    const hovered = m.id === src.hoverMeasureId;
    const selected = m.id === src.selectedMeasureId;
    if (!shows(vis.measure, hovered, selected)) continue;
    out.push({
      id: `ms:${m.id}`,
      a: m.a,
      b: m.b,
      text: [`${fmtLength(legLength(m.a, m.b))} სმ`],
      priority: 0,
      accent: hovered || selected,
    });
  }

  for (const path of src.sketch) {
    const chosen = src.selectedSketchIds.has(path.id);
    const legs = segments(path);
    legs.forEach(([a, b], i) => {
      const hovered = src.hoverLeg?.pathId === path.id && src.hoverLeg.index === i;
      if (!shows(vis.line, hovered, chosen)) return;
      const len = legLength(a, b);
      if (len < 0.5) return;
      out.push({
        id: `sk:${path.id}:${i}`,
        a,
        b,
        text: [`${fmtLength(len)} სმ`],
        priority: chosen || hovered ? 1 : 2,
        accent: chosen || hovered,
      });
    });

    // The run's total, on the leg that holds its halfway point - the middle of
    // the wall, not its first corner.
    if (chosen && legs.length > 1 && vis.line !== 'never') {
      const lengths = legs.map(([a, b]) => legLength(a, b));
      const total = lengths.reduce((sum, l) => sum + l, 0);
      let walked = 0;
      let at = legs.length - 1;
      for (let i = 0; i < legs.length; i++) {
        walked += lengths[i];
        if (walked >= total / 2) {
          at = i;
          break;
        }
      }
      out.push({
        id: `skt:${path.id}`,
        a: legs[at][0],
        b: legs[at][1],
        text: [`სულ ${fmtLength(total)} სმ`],
        priority: 4,
        accent: true,
      });
    }
  }

  for (const p of src.pieces) {
    const m = src.byId.get(p.materialId);
    if (!m) continue;
    const chosen = src.selectedIds.has(p.id);
    const hovered = src.hoverPieceId === p.id;
    if (!shows(vis[lengthKindOf(m)], hovered, chosen)) continue;
    // The piece's own width, through its plan centre and turned with it. The
    // centre is rotation-invariant, which is why x/y alone cannot be used.
    const pw = planW(m);
    const ph = planH(m);
    const r = (p.rot * Math.PI) / 180;
    const ux = Math.cos(r);
    const uy = Math.sin(r);
    const cx = p.x + pw / 2;
    const cy = p.y + ph / 2;
    const size = drawingSizeLabel(m);
    out.push({
      id: `pc:${p.id}`,
      a: { x: cx - (ux * pw) / 2, y: cy - (uy * pw) / 2 },
      b: { x: cx + (ux * pw) / 2, y: cy + (uy * pw) / 2 },
      text: src.showNames ? [m.name, size] : [size],
      priority: chosen || hovered ? 1 : 3,
      inside: { along: pw, across: ph },
      accent: chosen || hovered,
    });
  }
  return out;
}
