import type { Material, MeasureLine, Piece, SketchPath } from '../types';
import { planH, planW } from './geometry';
import { planOutline } from './shapePath';
import { closestOnLeg, legLength, segments, type Point } from './sketch';

/**
 * The measure tool: "from here to there is this far".
 *
 * A check dimension is taken off something - the end of a wall, the corner of
 * a panel - and usually held a fixed distance off it so the line does not sit
 * on top of what it measures. Placed freehand, that distance is a guess at both
 * ends and the two ends never quite agree. So the tool does the setting-out:
 *
 *   1. near an edge, it shows the perpendicular from that edge and how far off
 *      it the pointer is, snapped to the drawing grid and to the edge's ends;
 *   2. after the first click it offers the matching point at the far end of the
 *      same edge, the same distance off, so the line comes out parallel;
 *   3. the second click saves a free line - any direction - with its length;
 *   4. picked or hovered, a saved line shows how far it stands off the edge it
 *      runs alongside.
 *
 * The helper can be switched off (or held off with Alt) for the one line it
 * gets wrong. Everything here is pure plan-world geometry.
 */

// ── display settings ────────────────────────────────────────────────────────

export interface MeasureStyle {
  color: string;
  opacity: number;
  /** the picked or hovered line, and the wall it is measured off */
  focusColor: string;
  /** when picked or hovered, show how far each end stands off the wall */
  showOffsets: boolean;
  /** the snapping helper: edges, the suggested end, the magnet between lines */
  helper: boolean;
}

export const DEFAULT_MEASURE_STYLE: MeasureStyle = {
  color: '#9aa4b2',
  opacity: 0.55,
  focusColor: '#e5484d',
  showOffsets: true,
  helper: true,
};

const HEX = /^#[0-9a-fA-F]{6}$/;

/** Saved settings, repaired field by field - a bad colour must not cost the rest. */
export function normalizeMeasureStyle(raw: unknown): MeasureStyle {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Partial<Record<keyof MeasureStyle, unknown>>;
  const d = DEFAULT_MEASURE_STYLE;
  return {
    color: typeof r.color === 'string' && HEX.test(r.color) ? r.color : d.color,
    // Never fully transparent: a line you cannot see is still clickable and
    // still printed, which is worse than one that is merely faint.
    opacity:
      typeof r.opacity === 'number' && Number.isFinite(r.opacity)
        ? Math.min(1, Math.max(0.15, r.opacity))
        : d.opacity,
    focusColor: typeof r.focusColor === 'string' && HEX.test(r.focusColor) ? r.focusColor : d.focusColor,
    showOffsets: typeof r.showOffsets === 'boolean' ? r.showOffsets : d.showOffsets,
    helper: typeof r.helper === 'boolean' ? r.helper : d.helper,
  };
}

// ── what can be measured off ────────────────────────────────────────────────

export interface RefEdge {
  a: Point;
  b: Point;
  /** `sk:<path>:<leg>`, `pc:<piece>:<edge>` or `ms:<measure>` */
  key: string;
}

/**
 * A placed piece's plan outline in world cm, turned as it is on screen.
 *
 * Rotation is about the plan centre, the same as the piece's own CSS
 * transform, so an edge found here is exactly the edge drawn there.
 */
export function pieceOutline(p: Piece, m: Material): Point[] {
  const pw = planW(m);
  const ph = planH(m);
  const cx = p.x + pw / 2;
  const cy = p.y + ph / 2;
  const r = (p.rot * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return planOutline(m).map(([x, y]) => {
    const dx = x - pw / 2;
    const dy = y - ph / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  });
}

function insidePolygon(ring: Point[], at: Point): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const a = ring[i];
    const b = ring[j];
    if (a.y > at.y !== b.y > at.y && at.x < ((b.x - a.x) * (at.y - a.y)) / (b.y - a.y) + a.x) {
      inside = !inside;
    }
  }
  return inside;
}

/** The piece under a plan point, topmost first - for showing a length on hover. */
export function pieceAt(pieces: Piece[], byId: Map<string, Material>, at: Point): string | null {
  for (let i = pieces.length - 1; i >= 0; i--) {
    const m = byId.get(pieces[i].materialId);
    if (m && insidePolygon(pieceOutline(pieces[i], m), at)) return pieces[i].id;
  }
  return null;
}

/**
 * Every edge the tool can take a measurement off: each drawn leg, each outline
 * edge of every placed piece of any kind, and every line already measured.
 */
export function referenceEdges(
  sketch: SketchPath[],
  pieces: Piece[],
  byId: Map<string, Material>,
  measures: MeasureLine[],
): RefEdge[] {
  const out: RefEdge[] = [];
  for (const path of sketch) {
    segments(path).forEach(([a, b], i) => out.push({ a, b, key: `sk:${path.id}:${i}` }));
  }
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    const ring = pieceOutline(p, m);
    ring.forEach((a, i) => out.push({ a, b: ring[(i + 1) % ring.length], key: `pc:${p.id}:${i}` }));
  }
  for (const m of measures) out.push({ a: m.a, b: m.b, key: `ms:${m.id}` });
  return out;
}

export function nearestEdge(
  edges: RefEdge[],
  at: Point,
  tolCm: number,
): { edge: RefEdge; foot: Point; dist: number } | null {
  let best: { edge: RefEdge; foot: Point; dist: number } | null = null;
  for (const edge of edges) {
    if (legLength(edge.a, edge.b) === 0) continue;
    const foot = closestOnLeg(edge.a, edge.b, at);
    const dist = Math.hypot(at.x - foot.x, at.y - foot.y);
    if (dist <= tolCm && (!best || dist < best.dist)) best = { edge, foot, dist };
  }
  return best;
}

// ── placing a line ──────────────────────────────────────────────────────────

/** A point held a measured distance off an edge. */
export interface MeasureAnchor {
  point: Point;
  /** where the perpendicular meets the edge; null for a free point */
  foot: Point | null;
  /** signed distance off the edge along its left normal, cm */
  offsetCm: number;
  /** snapped onto one of the edge's own ends */
  atEnd: 'a' | 'b' | null;
  edgeKey: string | null;
  /** the edge it was found off, to light it up while aiming */
  edge?: { a: Point; b: Point } | null;
}

export const freeAnchor = (point: Point): MeasureAnchor => ({
  point,
  foot: null,
  offsetCm: 0,
  atEnd: null,
  edgeKey: null,
});

function frame(edge: RefEdge) {
  const len = legLength(edge.a, edge.b);
  const u = { x: (edge.b.x - edge.a.x) / len, y: (edge.b.y - edge.a.y) / len };
  return { len, u, n: { x: -u.y, y: u.x } };
}

/**
 * Hold the pointer a whole number of grid steps off an edge.
 *
 * Along the edge it lands on an end when it is close to one - a check line is
 * nearly always taken from the end of a wall - and otherwise on the grid, never
 * past either end. Off the edge it takes whichever side the pointer is on.
 */
export function anchorFromEdge(
  edge: RefEdge,
  at: Point,
  opts: { step: number; endSnapCm: number },
): MeasureAnchor {
  const { len, u, n } = frame(edge);
  const rel = { x: at.x - edge.a.x, y: at.y - edge.a.y };
  const s = rel.x * u.x + rel.y * u.y;
  const o = rel.x * n.x + rel.y * n.y;

  let along: number;
  let atEnd: 'a' | 'b' | null = null;
  if (Math.abs(s) <= opts.endSnapCm) {
    along = 0;
    atEnd = 'a';
  } else if (Math.abs(s - len) <= opts.endSnapCm) {
    along = len;
    atEnd = 'b';
  } else {
    along = Math.min(len, Math.max(0, Math.round(s / opts.step) * opts.step));
  }

  const offsetCm = Math.round(o / opts.step) * opts.step;
  const foot = { x: edge.a.x + u.x * along, y: edge.a.y + u.y * along };
  return {
    point: { x: foot.x + n.x * offsetCm, y: foot.y + n.y * offsetCm },
    foot,
    offsetCm,
    atEnd,
    edgeKey: edge.key,
    edge: { a: edge.a, b: edge.b },
  };
}

/**
 * Where the second point probably goes: the far end of the same edge, the same
 * distance off it, so the finished line runs parallel to what it measures.
 */
export function suggestEnd(edge: RefEdge, first: MeasureAnchor): MeasureAnchor {
  const { n } = frame(edge);
  // The end further from where the first point stands. Measured, not read off
  // `atEnd`, because the edge offered here may be a whole run the first point's
  // own short edge is only part of - see `collinearRun`.
  const from = first.foot ?? first.point;
  const toA = Math.hypot(edge.a.x - from.x, edge.a.y - from.y);
  const toB = Math.hypot(edge.b.x - from.x, edge.b.y - from.y);
  let end: 'a' | 'b' = toA > toB ? 'a' : 'b';
  if (Math.abs(toA - toB) < 0.01 && first.atEnd) end = first.atEnd === 'a' ? 'b' : 'a';
  const foot = end === 'a' ? edge.a : edge.b;
  return {
    point: { x: foot.x + n.x * first.offsetCm, y: foot.y + n.y * first.offsetCm },
    foot: { ...foot },
    offsetCm: first.offsetCm,
    atEnd: end,
    edgeKey: edge.key,
    edge: { a: edge.a, b: edge.b },
  };
}

/**
 * How far each snap reaches: a screen distance, but never less than a real
 * distance on the drawing.
 *
 * Screen pixels alone made the helper shrink as you zoomed in - at a close zoom
 * 40 px is 12 cm, so a check line held 45 cm off a panel never found the panel,
 * fell through to the plain grid, and came out 90.1 instead of 90.
 */
const reach = (px: number, minCm: number, zoom: number) => Math.max(px / zoom, minCm);

const EDGE_REACH = { px: 40, cm: 60 };
const END_SNAP = { px: 12, cm: 3 };
const SUGGESTION = { px: 24, cm: 10 };
const VERTEX = { px: 10, cm: 2 };
const PARALLEL = { px: 14, cm: 5 };
const MAGNET = { px: 18, cm: 5 };
/**
 * Lining up with an end from further away: how far off the end's own
 * perpendicular the pointer may be, and how far out along it the end still
 * counts. The long reach is what lets a check line held a metre below a wall
 * still start exactly under the wall's first corner.
 */
const TRACK = { px: 12, cm: 3 };
const TRACK_REACH = { px: 300, cm: 300 };
/** nearly level or nearly plumb is meant to be level or plumb */
const AXIS_PX = 8;
const ANGLE_LOCK_DEG = 15;

const roundTo = (v: number, step: number) => Math.round(v / step) * step;

/**
 * Round a second point relative to the first, not to the world grid.
 *
 * The first point is often on something that is not on the grid - a panel
 * placed by edge snapping sits wherever its neighbour ended. Rounding the second
 * point to the world grid then made every length a fraction off: 90.1, 44.9.
 * Rounding the run from the first point keeps each component a whole step.
 */
function roundFrom(first: Point, at: Point, step: number, axisTolCm: number): Point {
  let dx = at.x - first.x;
  let dy = at.y - first.y;
  if (axisTolCm > 0) {
    if (Math.abs(dy) <= axisTolCm && Math.abs(dx) > Math.abs(dy)) dy = 0;
    else if (Math.abs(dx) <= axisTolCm && Math.abs(dy) > Math.abs(dx)) dx = 0;
  }
  return { x: first.x + roundTo(dx, step), y: first.y + roundTo(dy, step) };
}

/**
 * The magnet between measured lines: onto another line's end, or onto the line
 * itself, when the pointer comes close. Two check dimensions that are meant to
 * meet should meet exactly, not a millimetre apart.
 */
export function magnetToMeasures(
  at: Point,
  measures: MeasureLine[],
  tolCm: number,
): MeasureAnchor | null {
  let best: MeasureAnchor | null = null;
  let bestD = tolCm;
  for (const m of measures) {
    for (const [end, p] of [['a', m.a], ['b', m.b]] as const) {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = {
          point: { ...p },
          foot: { ...p },
          offsetCm: 0,
          atEnd: end,
          edgeKey: `ms:${m.id}`,
          edge: { a: m.a, b: m.b },
        };
      }
    }
  }
  if (best) return best;
  for (const m of measures) {
    const foot = closestOnLeg(m.a, m.b, at);
    const d = Math.hypot(at.x - foot.x, at.y - foot.y);
    if (d <= bestD) {
      bestD = d;
      best = {
        point: foot,
        foot,
        offsetCm: 0,
        atEnd: null,
        edgeKey: `ms:${m.id}`,
        edge: { a: m.a, b: m.b },
      };
    }
  }
  return best;
}

export type SnapVia =
  | 'lock'
  | 'suggestion'
  | 'magnet'
  | 'vertex'
  | 'parallel'
  | 'edge'
  | 'track'
  | 'free';

/**
 * The pointer lined up with the end of an edge, however far out: the point
 * squares up exactly under (or beside) that end, a whole number of steps off.
 *
 * The edge reach finds a wall when the pointer is near it. This finds the wall
 * when the pointer is far from it but plainly aiming at where it starts - which
 * is how a check line is usually held, well clear of the panels it measures.
 */
export function trackEnds(
  edges: RefEdge[],
  at: Point,
  opts: { zoom: number; step: number },
): MeasureAnchor | null {
  const tolerance = reach(TRACK.px, TRACK.cm, opts.zoom);
  const far = reach(TRACK_REACH.px, TRACK_REACH.cm, opts.zoom);
  let best: { anchor: MeasureAnchor; sideways: number; out: number } | null = null;
  for (const edge of edges) {
    if (edge.key.startsWith('ms:') || !legLength(edge.a, edge.b)) continue;
    const { u, n } = frame(edge);
    for (const [end, p] of [
      ['a', edge.a],
      ['b', edge.b],
    ] as const) {
      const rx = at.x - p.x;
      const ry = at.y - p.y;
      const out = rx * n.x + ry * n.y;
      const sideways = Math.abs(rx * u.x + ry * u.y);
      if (sideways > tolerance || Math.abs(out) < 0.5 || Math.abs(out) > far) continue;
      if (best && (sideways > best.sideways + 0.01 || (Math.abs(sideways - best.sideways) <= 0.01 && Math.abs(out) >= best.out))) {
        continue;
      }
      const offsetCm = roundTo(out, opts.step);
      best = {
        sideways,
        out: Math.abs(out),
        anchor: {
          point: { x: p.x + n.x * offsetCm, y: p.y + n.y * offsetCm },
          foot: { ...p },
          offsetCm,
          atEnd: end,
          edgeKey: edge.key,
          edge: { a: edge.a, b: edge.b },
        },
      };
    }
  }
  return best?.anchor ?? null;
}

/**
 * The whole straight run an edge is part of: every edge lying on the same line
 * and touching end to end, joined into one - kept in the first edge's own
 * direction, so an offset measured off it keeps its sign.
 *
 * A wall of panels is a row of short edges, one per panel. The end worth
 * suggesting is the end of the wall, not the far corner of the first panel.
 */
export function collinearRun(edge: RefEdge, edges: RefEdge[]): RefEdge {
  const len = legLength(edge.a, edge.b);
  if (!len) return edge;
  const { u, n } = frame(edge);
  const across = (p: Point) => (p.x - edge.a.x) * n.x + (p.y - edge.a.y) * n.y;
  const along = (p: Point) => (p.x - edge.a.x) * u.x + (p.y - edge.a.y) * u.y;
  const spans = edges
    .filter((e) => {
      if (e.key.startsWith('ms:')) return false;
      const l = legLength(e.a, e.b);
      if (!l) return false;
      const ex = (e.b.x - e.a.x) / l;
      const ey = (e.b.y - e.a.y) / l;
      return (
        Math.abs(u.x * ey - u.y * ex) <= PARALLEL_SIN &&
        Math.abs(across(e.a)) <= 0.5 &&
        Math.abs(across(e.b)) <= 0.5
      );
    })
    .map((e) => [Math.min(along(e.a), along(e.b)), Math.max(along(e.a), along(e.b))] as const);

  let lo = 0;
  let hi = len;
  for (let grew = true; grew; ) {
    grew = false;
    for (const [a, b] of spans) {
      if (a <= hi + 0.5 && b >= lo - 0.5 && (a < lo - 0.01 || b > hi + 0.01)) {
        lo = Math.min(lo, a);
        hi = Math.max(hi, b);
        grew = true;
      }
    }
  }
  return {
    a: { x: edge.a.x + u.x * lo, y: edge.a.y + u.y * lo },
    b: { x: edge.a.x + u.x * hi, y: edge.a.y + u.y * hi },
    key: edge.key,
  };
}

/**
 * How close the pointer is to taking the suggested end: 1 inside its snap,
 * falling to 0 some way out. The suggestion is drawn stronger as this rises,
 * so the hand can see it is homing in before the snap happens.
 */
export function suggestionCloseness(at: Point, suggestion: MeasureAnchor | null, zoom: number): number {
  if (!suggestion) return 0;
  const d = Math.hypot(at.x - suggestion.point.x, at.y - suggestion.point.y);
  const snap = reach(SUGGESTION.px, SUGGESTION.cm, zoom);
  return Math.max(0, Math.min(1, 1 - (d - snap) / (snap * 6)));
}

/** Where the first click would land. */
export function firstPoint(
  at: Point,
  ctx: { edges: RefEdge[]; measures: MeasureLine[]; zoom: number; step: number; helper: boolean },
): { point: Point; helper: MeasureAnchor | null; via: SnapVia } {
  const { zoom, step } = ctx;
  const grid = { x: roundTo(at.x, step), y: roundTo(at.y, step) };
  if (!ctx.helper) return { point: grid, helper: null, via: 'free' };

  const magnet = magnetToMeasures(at, ctx.measures, reach(MAGNET.px, MAGNET.cm, zoom));
  if (magnet) return { point: magnet.point, helper: magnet, via: 'magnet' };

  const near = nearestEdge(ctx.edges, at, reach(EDGE_REACH.px, EDGE_REACH.cm, zoom));
  if (near) {
    const helper = anchorFromEdge(near.edge, at, {
      step,
      endSnapCm: reach(END_SNAP.px, END_SNAP.cm, zoom),
    });
    return { point: helper.point, helper, via: 'edge' };
  }

  const tracked = trackEnds(ctx.edges, at, { zoom, step });
  if (tracked) return { point: tracked.point, helper: tracked, via: 'track' };

  return { point: grid, helper: null, via: 'free' };
}

export interface SecondPoint {
  point: Point;
  via: SnapVia;
  /** the edge or line the point is being held off, when there is one */
  helper: MeasureAnchor | null;
}

/**
 * Where the second click would land, in order of what the hand most likely
 * means: the suggested end, another measured line, an exact corner, the same
 * distance off the wall the first end was held off, a measured distance off
 * whatever edge is near, then a whole-step run from the first point. Shift
 * instead holds the line to the nearest 15 degrees. With the helper off, only
 * Shift and the whole-step run apply.
 */
export function secondPoint(
  at: Point,
  ctx: {
    first: Point;
    /** the edge the first end was held off, if any */
    firstEdge: RefEdge | null;
    suggestion: MeasureAnchor | null;
    edges: RefEdge[];
    measures: MeasureLine[];
    zoom: number;
    step: number;
    shift: boolean;
    helper: boolean;
  },
): SecondPoint {
  const { first, suggestion, edges, zoom, step } = ctx;

  if (ctx.shift) {
    const vx = at.x - first.x;
    const vy = at.y - first.y;
    const deg = roundTo((Math.atan2(vy, vx) * 180) / Math.PI, ANGLE_LOCK_DEG);
    const r = (deg * Math.PI) / 180;
    const ux = Math.cos(r);
    const uy = Math.sin(r);
    const len = roundTo(vx * ux + vy * uy, step);
    return { point: { x: first.x + ux * len, y: first.y + uy * len }, via: 'lock', helper: null };
  }

  if (!ctx.helper) return { point: roundFrom(first, at, step, 0), via: 'free', helper: null };

  if (
    suggestion &&
    Math.hypot(at.x - suggestion.point.x, at.y - suggestion.point.y) <=
      reach(SUGGESTION.px, SUGGESTION.cm, zoom)
  ) {
    return { point: { ...suggestion.point }, via: 'suggestion', helper: suggestion };
  }

  const magnet = magnetToMeasures(at, ctx.measures, reach(MAGNET.px, MAGNET.cm, zoom));
  if (magnet) return { point: magnet.point, via: 'magnet', helper: magnet };

  let corner: Point | null = null;
  let cornerD = reach(VERTEX.px, VERTEX.cm, zoom);
  for (const e of edges) {
    if (e.key.startsWith('ms:')) continue; // measured lines were the magnet's to take
    for (const p of [e.a, e.b]) {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= cornerD) {
        cornerD = d;
        corner = p;
      }
    }
  }
  if (corner) return { point: { ...corner }, via: 'vertex', helper: null };

  // Still beside the wall the first end was taken off: stay exactly as far
  // off it, so the line comes out parallel wherever along it the click lands.
  if (ctx.firstEdge && legLength(ctx.firstEdge.a, ctx.firstEdge.b) > 0) {
    const { u } = frame(ctx.firstEdge);
    const rx = at.x - first.x;
    const ry = at.y - first.y;
    const across = Math.abs(rx * u.y - ry * u.x);
    if (across <= reach(PARALLEL.px, PARALLEL.cm, zoom)) {
      const t = roundTo(rx * u.x + ry * u.y, step);
      return { point: { x: first.x + u.x * t, y: first.y + u.y * t }, via: 'parallel', helper: null };
    }
  }

  const near = nearestEdge(edges, at, reach(EDGE_REACH.px, EDGE_REACH.cm, zoom));
  if (near) {
    const helper = anchorFromEdge(near.edge, at, {
      step,
      endSnapCm: reach(END_SNAP.px, END_SNAP.cm, zoom),
    });
    return { point: helper.point, via: 'edge', helper };
  }

  const tracked = trackEnds(edges, at, { zoom, step });
  if (tracked) return { point: tracked.point, via: 'track', helper: tracked };

  return { point: roundFrom(first, at, step, AXIS_PX / zoom), via: 'free', helper: null };
}

/** What the canvas shows while the tool is out. */
export interface MeasurePreview {
  point: Point;
  helper: MeasureAnchor | null;
  suggestion: MeasureAnchor | null;
  onSuggestion: boolean;
  via: SnapVia;
  /** 0..1, how near the pointer is to taking the suggestion - see `suggestionCloseness` */
  closeness: number;
}

// ── reading saved lines ─────────────────────────────────────────────────────

/** The saved line under the pointer, if any. */
export function measureAt(measures: MeasureLine[], at: Point, tolCm: number): string | null {
  let best: string | null = null;
  let bestD = tolCm;
  for (const m of measures) {
    const foot = closestOnLeg(m.a, m.b, at);
    const d = Math.hypot(at.x - foot.x, at.y - foot.y);
    if (d <= bestD) {
      bestD = d;
      best = m.id;
    }
  }
  return best;
}

export interface Contact {
  point: Point;
  /** an end meets the other line; or the two lines pass through each other */
  kind: 'touch' | 'cross';
}

/** Closer than this, an end is on the other line. */
const TOUCH_CM = 0.5;

function contactOf(s: { a: Point; b: Point }, t: { a: Point; b: Point }): Contact | null {
  for (const [p, other] of [
    [s.a, t],
    [s.b, t],
    [t.a, s],
    [t.b, s],
  ] as const) {
    const foot = closestOnLeg(other.a, other.b, p);
    if (Math.hypot(p.x - foot.x, p.y - foot.y) <= TOUCH_CM) return { point: { ...p }, kind: 'touch' };
  }
  const rx = s.b.x - s.a.x;
  const ry = s.b.y - s.a.y;
  const qx = t.b.x - t.a.x;
  const qy = t.b.y - t.a.y;
  const denom = rx * qy - ry * qx;
  if (Math.abs(denom) < 1e-9) return null;
  const wx = t.a.x - s.a.x;
  const wy = t.a.y - s.a.y;
  const u1 = (wx * qy - wy * qx) / denom;
  const u2 = (wx * ry - wy * rx) / denom;
  if (u1 > 0 && u1 < 1 && u2 > 0 && u2 < 1) {
    return { point: { x: s.a.x + rx * u1, y: s.a.y + ry * u1 }, kind: 'cross' };
  }
  return null;
}

/**
 * Where measured lines meet: an end resting on another line (touch), or two
 * lines running through each other (cross).
 *
 * With the helper off nothing pulls two lines together, so this is how it
 * shows that they do - or that one has gone past the other and carried on.
 */
export function measureContacts(
  measures: MeasureLine[],
  live: { a: Point; b: Point } | null = null,
): Contact[] {
  const lines: Array<{ a: Point; b: Point }> = measures.map((m) => ({ a: m.a, b: m.b }));
  if (live && legLength(live.a, live.b) > 0) lines.push(live);
  const found = new Map<string, Contact>();
  for (let i = 0; i < lines.length; i++) {
    for (let j = i + 1; j < lines.length; j++) {
      const c = contactOf(lines[i], lines[j]);
      if (!c) continue;
      const key = `${Math.round(c.point.x * 2)}:${Math.round(c.point.y * 2)}`;
      // A crossing is the stronger statement and wins the spot.
      if (!found.has(key) || c.kind === 'cross') found.set(key, c);
    }
  }
  return [...found.values()];
}

/** One degree: parallel enough to call a measurement "off" that edge. */
const PARALLEL_SIN = Math.sin((1 * Math.PI) / 180);

/**
 * The edge a saved line runs alongside, and how far off it each end stands.
 *
 * Worked out when it is shown rather than stored with the line, so moving a
 * wall moves the reading with it instead of leaving a stale reference behind.
 * The nearest parallel edge wins, but only one the line actually runs beside.
 */
export function parallelEdge(
  measure: MeasureLine,
  edges: RefEdge[],
  maxCm = 300,
): { edge: RefEdge; offA: number; offB: number; footA: Point; footB: Point } | null {
  const mlen = legLength(measure.a, measure.b);
  if (!mlen) return null;
  const mu = { x: (measure.b.x - measure.a.x) / mlen, y: (measure.b.y - measure.a.y) / mlen };

  let best: { edge: RefEdge; offA: number; offB: number; footA: Point; footB: Point } | null = null;
  let bestScore = Infinity;
  for (const edge of edges) {
    if (edge.key === `ms:${measure.id}`) continue;
    const elen = legLength(edge.a, edge.b);
    if (!elen) continue;
    const { u, n } = frame(edge);
    if (Math.abs(mu.x * u.y - mu.y * u.x) > PARALLEL_SIN) continue;

    const rel = (p: Point) => ({ x: p.x - edge.a.x, y: p.y - edge.a.y });
    const ra = rel(measure.a);
    const rb = rel(measure.b);
    const offA = ra.x * n.x + ra.y * n.y;
    const offB = rb.x * n.x + rb.y * n.y;
    // Lying on the edge is not standing off it.
    if (Math.abs(offA) < 0.5 && Math.abs(offB) < 0.5) continue;
    if (Math.abs(offA) > maxCm || Math.abs(offB) > maxCm) continue;

    const ta = ra.x * u.x + ra.y * u.y;
    const tb = rb.x * u.x + rb.y * u.y;
    if (Math.max(Math.min(ta, tb), 0) >= Math.min(Math.max(ta, tb), elen)) continue;

    const score = (Math.abs(offA) + Math.abs(offB)) / 2;
    if (score < bestScore) {
      bestScore = score;
      best = {
        edge,
        offA: Math.abs(offA),
        offB: Math.abs(offB),
        footA: { x: edge.a.x + u.x * ta, y: edge.a.y + u.y * ta },
        footB: { x: edge.a.x + u.x * tb, y: edge.a.y + u.y * tb },
      };
    }
  }
  return best;
}
