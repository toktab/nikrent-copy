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
  /**
   * The drawing it measures - `pc:<piece>`, `sk:<path>:<leg>`, `ms:<measure>` -
   * whose own edges must not count as in the way of its label.
   */
  owners?: string[];
}

/** An edge on the drawing a label must not sit on, world cm, with what it belongs to. */
export interface DimObstacle {
  a: Point;
  b: Point;
  owner: string;
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
  /** every edge on the drawing - panels, lines, measured lines - see `DimObstacle` */
  obstacles?: DimObstacle[];
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
/** at least this far, on screen, a label looks for other work when picking a side */
const LOOK_MIN_PX = 120;

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
 * The side a span's length tries first when nothing else decides: up the
 * screen, or left for a span that runs exactly vertically. What is around it
 * can send it to the other side - see `layoutDimensions`.
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
  const obstacles = (view.obstacles ?? []).map((o) => ({
    a: screen(o.a),
    b: screen(o.b),
    owner: o.owner,
  }));
  const onScreen = (box: Box) => box.x0 >= 0 && box.y0 >= 0 && box.x1 <= stageW && box.y1 <= stageH;
  /** how far to look for other work when choosing a side: past the thickest wall */
  const lookPx = Math.max(LOOK_MIN_PX, WALL_PAIR_MAX_CM * zoom);

  for (const { item, sa, sb, len } of prepared) {
    const u = { x: (sb.x - sa.x) / len, y: (sb.y - sa.y) / len };
    const n = outwardNormal(u);
    const angle = readableAngle(u);
    const { w, h } = textSize(item.text);
    const mid = { x: (sa.x + sb.x) / 2, y: (sa.y + sb.y) / 2 };
    const base = { id: item.id, accent: !!item.accent, lines: item.text, angle, w, h };
    // A thing's own edges are not in the way of its own length.
    const own = new Set(item.owners ?? [item.id]);
    const foreign = obstacles.filter((o) => !own.has(o.owner));
    // A piece is measured from its edge, not its middle, so the label never
    // sits on the piece it names.
    const clear = item.inside ? (item.inside.across * zoom) / 2 : 0;

    /**
     * Which side to try first: away from the rest of the work.
     *
     * Everything nearby along this span votes by which side of it it lies on.
     * The two faces of a wall each see the other, so each face's lengths go on
     * its own outside instead of both climbing the same side; a run with
     * nothing beside it keeps the usual up-or-left.
     */
    let lean = 0;
    for (const o of foreign) {
      const rx = (o.a.x + o.b.x) / 2 - mid.x;
      const ry = (o.a.y + o.b.y) / 2 - mid.y;
      const alongDist = Math.abs(rx * u.x + ry * u.y);
      const acrossDist = rx * n.x + ry * n.y;
      if (alongDist <= len / 2 + GAP_PX * 5 && Math.abs(acrossDist) > 0.5 && Math.abs(acrossDist) <= lookPx) {
        lean += Math.sign(acrossDist);
      }
    }
    const sides: Array<1 | -1> = lean > 0 ? [-1, 1] : [1, -1];

    const labelsClear = (box: Box, line?: [Point, Point]) =>
      !takenLabels.some((l) => overlaps(l, box)) &&
      !takenLines.some(([p, q]) => segmentHitsBox(p, q, box)) &&
      !(line && takenLabels.some((l) => segmentHitsBox(line[0], line[1], l)));
    const drawingClear = (box: Box) => !foreign.some((o) => segmentHitsBox(o.a, o.b, box));

    interface Candidate {
      placed: PlacedDim;
      box: Box;
      line?: [Point, Point];
    }
    const candidates: Candidate[] = [];

    // Inside the piece, when the text genuinely fits there - no leader, no
    // line, nothing to confuse with the neighbours.
    if (item.inside && w <= item.inside.along * zoom && h <= item.inside.across * zoom) {
      candidates.push({
        placed: { ...base, tier: 0, inside: true, x: mid.x, y: mid.y },
        box: boxAround(mid.x, mid.y, u, n, w, h),
      });
    }

    // Both sides at each distance before going further out: the other side of
    // a panel is nearer than a second dimension line on the crowded one.
    for (let tier = 0; tier <= MAX_TIER; tier++) {
      for (const side of sides) {
        const ns = { x: n.x * side, y: n.y * side };
        if (tier === 0) {
          const c = along(mid, ns, clear + h / 2 + GAP_PX);
          candidates.push({
            placed: { ...base, tier, inside: false, x: c.x, y: c.y },
            box: boxAround(c.x, c.y, u, n, w, h),
          });
          continue;
        }
        // The first dimension line clears a tier-0 label; each after that
        // clears the one before it.
        const d = clear + h + GAP_PX * 2 + (tier - 1) * TIER_GAP_PX;
        const c = along(mid, ns, d);
        const line: [Point, Point] = [along(sa, ns, d), along(sb, ns, d)];
        candidates.push({
          placed: {
            ...base,
            tier,
            inside: false,
            x: c.x,
            y: c.y,
            dimLine: line,
            ext: [
              [along(sa, ns, clear + 2), along(sa, ns, d + EXT_OVERSHOOT_PX)],
              [along(sb, ns, clear + 2), along(sb, ns, d + EXT_OVERSHOOT_PX)],
            ],
          },
          box: boxAround(c.x, c.y, u, n, w, h),
          line,
        });
      }
    }

    /**
     * The first spot that is fully clear. Failing that, what matters most goes
     * first: never on another length, then never off the screen, and only then
     * over a line of the drawing. A crowded length is still better than one that
     * has vanished or been cut off.
     */
    const chosen =
      candidates.find((c) => onScreen(c.box) && labelsClear(c.box, c.line) && drawingClear(c.box)) ??
      candidates.find((c) => onScreen(c.box) && labelsClear(c.box, c.line)) ??
      candidates.find((c) => labelsClear(c.box, c.line)) ??
      candidates.find((c) => onScreen(c.box)) ??
      candidates[candidates.length - 1];
    if (!chosen) continue;
    takenLabels.push(chosen.box);
    if (chosen.line) takenLines.push(chosen.line);
    out.push(chosen.placed);
  }
  return out;
}

/** 45, or 63.6 on a diagonal - whole centimetres whenever the length is one. */
export function fmtLength(cm: number): string {
  const r = Math.round(cm * 10) / 10;
  return Number.isInteger(r) ? String(r) : r.toFixed(1);
}

/** The widest pour read as one wall - the same limit the fill pairs faces by (FORMWORK.md). */
const WALL_PAIR_MAX_CM = 120;
const PARALLEL_SIN = Math.sin(Math.PI / 180);
/** half a centimetre: the drawing is ruled in fives, so anything less is the same */
const SAME_CM = 0.5;

/**
 * One length for the two faces of a wall, when they say the same thing.
 *
 * A wall is two drawn lines a pour's thickness apart, and when both show their
 * length they are the same number twice - the second pushed up onto its own
 * dimension line because the first took its place, which reads as two
 * different measurements. So two legs that are parallel, the same length, level
 * with each other end to end and no further apart than a wall is thick share
 * one label, set on the outer line so it sits clear of the wall rather than
 * squeezed between its faces. Where the lengths differ - a corner has shortened
 * one face - both are kept, because then they are different measurements.
 */
export function mergeWallFaces(items: DimItem[]): DimItem[] {
  const legs = items.filter((i) => i.id.startsWith('sk:'));
  if (legs.length < 2) return items;
  const gone = new Set<DimItem>();
  const merged: DimItem[] = [];

  for (let i = 0; i < legs.length; i++) {
    const a = legs[i];
    if (gone.has(a)) continue;
    const len = legLength(a.a, a.b);
    if (!len) continue;
    const u = { x: (a.b.x - a.a.x) / len, y: (a.b.y - a.a.y) / len };
    // Where a point sits relative to leg a: along it, and square across it.
    const rel = (p: Point) => ({
      along: (p.x - a.a.x) * u.x + (p.y - a.a.y) * u.y,
      across: (p.x - a.a.x) * -u.y + (p.y - a.a.y) * u.x,
    });

    let partner: { item: DimItem; gap: number } | null = null;
    for (let j = i + 1; j < legs.length; j++) {
      const b = legs[j];
      if (gone.has(b)) continue;
      const blen = legLength(b.a, b.b);
      if (Math.abs(blen - len) > SAME_CM) continue;
      const v = { x: (b.b.x - b.a.x) / blen, y: (b.b.y - b.a.y) / blen };
      if (Math.abs(u.x * v.y - u.y * v.x) > PARALLEL_SIN) continue;
      const p = rel(b.a);
      const q = rel(b.b);
      const gap = Math.abs(p.across);
      if (gap < SAME_CM || gap > WALL_PAIR_MAX_CM || Math.abs(p.across - q.across) > SAME_CM) continue;
      // Level end to end, not merely overlapping: a shorter face beside a
      // longer one is a different measurement even when it is parallel.
      if (Math.abs(Math.min(p.along, q.along)) > SAME_CM) continue;
      if (Math.abs(Math.max(p.along, q.along) - len) > SAME_CM) continue;
      if (!partner || gap < partner.gap) partner = { item: b, gap };
    }
    if (!partner) continue;

    const b = partner.item;
    gone.add(a);
    gone.add(b);
    // The face further out along the side labels go, so the label clears both.
    const n = outwardNormal(u);
    const out = (it: DimItem) => ((it.a.x + it.b.x) / 2) * n.x + ((it.a.y + it.b.y) / 2) * n.y;
    const outer = out(a) >= out(b) ? a : b;
    merged.push({
      ...outer,
      id: `skw:${[a.id, b.id].sort().join('|')}`,
      owners: [...(a.owners ?? [a.id]), ...(b.owners ?? [b.id])],
      priority: Math.min(a.priority, b.priority),
      accent: !!(a.accent || b.accent),
    });
  }

  if (!gone.size) return items;
  return [...items.filter((i) => !gone.has(i)), ...merged];
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
      owners: [`ms:${m.id}`],
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
        owners: [`sk:${path.id}:${i}`],
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
        owners: [`sk:${path.id}:${at}`],
        priority: 4,
        accent: true,
      });
    }
  }

  // Two faces of one wall measure the same: say it once. Nothing merged hands
  // back this very array, so it is only replaced when there is a new one -
  // emptying it first would empty the copy too.
  const withWalls = mergeWallFaces(out);
  if (withWalls !== out) {
    out.length = 0;
    out.push(...withWalls);
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
      owners: [`pc:${p.id}`],
      priority: chosen || hovered ? 1 : 3,
      inside: { along: pw, across: ph },
      accent: chosen || hovered,
    });
  }
  return out;
}
