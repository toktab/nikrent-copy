import type { Material, Piece, SketchPath } from '../types';
import { uid } from './ids';
import { pieceBounds, type Rect } from './geometry';
import { isOrthogonal, segments, type Point } from './sketch';
import { cornersOnly, legDir, leftNormal, sidesFromNeighbours } from './sketchFill';

/**
 * The other face of a wall, drawn for you from the face already built.
 *
 * The way a job goes: the შიდა (inner) line is drawn and filled first, then
 * the გარე (outer) line round it, a wall's thickness away - and walls are not
 * all one thickness (the architect's job is 20 at the top and right, 15 at the
 * left, 10 at the bottom). So the new line is the old one moved across the
 * pour leg by leg, each leg by its own distance, or all by one.
 *
 * Also here: which pieces stand on which lines (Shift + click picks them up
 * with the lines), and which lines and pieces a closed line has inside it (so
 * picking the outer line brings the built inner face into the suggestion).
 */

const TOL = 0.5;

/** One leg of a line as the distance form lists it. */
export interface LegInfo {
  index: number;
  length: number;
  /** which way the concrete is from this leg - where the new face goes */
  towards: 'up' | 'down' | 'left' | 'right';
}

const TOWARDS_LABEL: Record<LegInfo['towards'], string> = {
  up: 'ზედა',
  down: 'ქვედა',
  left: 'მარცხენა',
  right: 'მარჯვენა',
};

export const towardsLabel = (t: LegInfo['towards']) => TOWARDS_LABEL[t];

/** Box to axis-aligned segment, cm; 0 when they touch. */
function boxToSegment(b: Rect, a: Point, c: Point): number {
  const minX = Math.min(a.x, c.x);
  const maxX = Math.max(a.x, c.x);
  const minY = Math.min(a.y, c.y);
  const maxY = Math.max(a.y, c.y);
  const dx = Math.max(0, minX - (b.x + b.w), b.x - maxX);
  const dy = Math.max(0, minY - (b.y + b.h), b.y - maxY);
  return Math.hypot(dx, dy);
}

/**
 * Pieces standing on any of `paths`: touching the line, along a leg of it or
 * in one of its corners. The pieces of a face a wall's thickness away do not
 * touch it, so the two faces of a wall stay apart.
 */
export function piecesOnLines(paths: SketchPath[], pieces: Piece[], materials: Material[]): string[] {
  const byId = new Map(materials.map((m) => [m.id, m]));
  return pieces
    .filter((p) => {
      const m = byId.get(p.materialId);
      if (!m || (m.category !== 'panel' && m.category !== 'filler' && m.category !== 'corner')) return false;
      const b = pieceBounds(p, m);
      return paths.some((path) => segments(path).some(([a, c]) => boxToSegment(b, a, c) <= TOL));
    })
    .map((p) => p.id);
}

/**
 * Which side of the line its panels stand on, as `sidesFromNeighbours` counts
 * sides: the side the pieces already standing on it are on, or - with nothing
 * on it - the side the drawing says.
 */
export function panelSide(path: SketchPath, sketch: SketchPath[], pieces: Piece[], materials: Material[]): 1 | -1 {
  const run = cornersOnly(path);
  const byId = new Map(materials.map((m) => [m.id, m]));
  const pts = run.points;
  const n = pts.length;
  const legs = run.closed && n > 2 ? n : n - 1;
  let plus = 0;
  let minus = 0;
  for (let j = 0; j < legs; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const d = legDir(a, b);
    const nrm = leftNormal(d);
    const across = d.x !== 0;
    const at = across ? a.y : a.x;
    const lo = Math.min(across ? a.x : a.y, across ? b.x : b.y);
    const hi = Math.max(across ? a.x : a.y, across ? b.x : b.y);
    const leftUp = (across ? nrm.y : nrm.x) > 0;
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (!m || m.shape === 'L') continue;
      const box = pieceBounds(p, m);
      const near = across ? box.y : box.x;
      const far = across ? box.y + box.h : box.x + box.w;
      const from = across ? box.x : box.y;
      const to = across ? box.x + box.w : box.y + box.h;
      if (Math.min(to, hi) - Math.max(from, lo) <= TOL) continue;
      // On the high side of the line, or the low side.
      const high = Math.abs(near - at) <= TOL ? true : Math.abs(far - at) <= TOL ? false : null;
      if (high === null) continue;
      if (high === leftUp) plus++;
      else minus++;
    }
  }
  if (plus !== minus) return plus > minus ? 1 : -1;
  const index = sketch.findIndex((k) => k.id === path.id);
  return sidesFromNeighbours(index >= 0 ? sketch : [path], { height: 1, includeCorners: true })[Math.max(0, index)];
}

/** The legs of a line, corners only, each with the way its concrete lies. */
export function legsForOffset(path: SketchPath, side: 1 | -1): LegInfo[] {
  const run = cornersOnly(path);
  const pts = run.points;
  const n = pts.length;
  const legs = run.closed && n > 2 ? n : n - 1;
  const out: LegInfo[] = [];
  for (let j = 0; j < legs; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const nrm = leftNormal(legDir(a, b));
    // The concrete is opposite the panels.
    const cx = -side * nrm.x;
    const cy = -side * nrm.y;
    out.push({
      index: j,
      length: Math.round(Math.hypot(b.x - a.x, b.y - a.y) * 10) / 10,
      towards: cx > 0 ? 'right' : cx < 0 ? 'left' : cy > 0 ? 'down' : 'up',
    });
  }
  return out;
}

/**
 * The line moved across the pour - away from its panels - each leg by its own
 * distance. Each leg moves along its normal; where two moved legs meet is the
 * new corner, so an outside corner grows by both distances and an inside one
 * shrinks, the way a wall's faces do.
 */
export function offsetFace(
  path: SketchPath,
  side: 1 | -1,
  distances: number[],
  perimeter: 'outer' | 'inner' = 'outer',
): SketchPath | null {
  const run = cornersOnly(path);
  if (!isOrthogonal(run)) return null;
  const pts = run.points;
  const n = pts.length;
  const closed = !!run.closed && n > 2;
  const legs = closed ? n : n - 1;
  if (legs < 1) return null;
  const moved: Array<{ across: boolean; at: number; shift: Point }> = [];
  for (let j = 0; j < legs; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const d = legDir(a, b);
    const nrm = leftNormal(d);
    const dist = distances[j] ?? distances[0] ?? 0;
    const shift = { x: -side * nrm.x * dist, y: -side * nrm.y * dist };
    const across = d.x !== 0;
    moved.push({ across, at: across ? a.y + shift.y : a.x + shift.x, shift });
  }
  const round = (v: number) => Math.round(v * 10) / 10;
  const points: Point[] = pts.map((p, i) => {
    const prev = closed ? moved[(i - 1 + legs) % legs] : moved[i - 1];
    const next = closed ? moved[i % legs] : moved[i];
    if (!prev || !next || prev.across === next.across) {
      const leg = next ?? prev!;
      return { x: round(p.x + leg.shift.x), y: round(p.y + leg.shift.y) };
    }
    const h = prev.across ? prev : next;
    const v = prev.across ? next : prev;
    return { x: round(v.at), y: round(h.at) };
  });
  return {
    id: uid('sk'),
    points,
    ...(closed ? { closed: true as const } : {}),
    perimeter,
  };
}

/**
 * The `side` to hand `offsetFace` and `legsForOffset` so the new line goes
 * where the person asked: გარე is outside, შიდა is inside.
 *
 * A closed line has an inside and an outside of its own, whichever side its
 * panels stand on - so გარე is outside the loop and შიდა inside it. A line
 * drawn as a room's face has its panels inside and gets its other face
 * outside; one drawn round a building has its panels outside, and asking for
 * გარე there puts the new line out past the panels, which is what was asked.
 * An open line has no inside: გარე is out past its panels, შიდა the other way.
 */
export function offsetSide(path: SketchPath, panels: 1 | -1, where: 'outer' | 'inner'): 1 | -1 {
  const run = cornersOnly(path);
  const pts = run.points;
  if (!run.closed || pts.length < 3) return where === 'outer' ? ((-panels) as 1 | -1) : panels;
  let twiceArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  // y counts down: a positive sum runs clockwise on screen and holds its inside
  // on the right, so the left normal points out. The line moves to -side.
  const leftIsOut = twiceArea > 0;
  const out: 1 | -1 = leftIsOut ? -1 : 1;
  return where === 'outer' ? out : ((-out) as 1 | -1);
}

/** Whether `p` is inside the closed polygon `poly` (even-odd). */
function inside(poly: Point[], p: Point): boolean {
  let hit = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i];
    const b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) hit = !hit;
  }
  return hit;
}

/**
 * Lines wholly inside a closed line, and how many pieces stand inside it - so
 * picking the outer line of a wall knows the inner face is there.
 *
 * Not the line's own pieces: a შიდა line has its panels standing inside it,
 * and counting those read every room as a wall's outer line.
 */
export function enclosed(
  path: SketchPath,
  sketch: SketchPath[],
  pieces: Piece[],
  materials: Material[],
): { lines: string[]; pieces: number } {
  if (!path.closed || path.points.length < 3) return { lines: [], pieces: 0 };
  const poly = path.points;
  const byId = new Map(materials.map((m) => [m.id, m]));
  const lines = sketch
    .filter((k) => k.id !== path.id && k.points.length && k.points.every((p) => inside(poly, p)))
    .map((k) => k.id);
  const own = new Set(piecesOnLines([path], pieces, materials));
  const count = pieces.filter((p) => {
    if (own.has(p.id)) return false;
    const m = byId.get(p.materialId);
    if (!m) return false;
    const b = pieceBounds(p, m);
    return inside(poly, { x: b.x + b.w / 2, y: b.y + b.h / 2 });
  }).length;
  return { lines, pieces: count };
}
