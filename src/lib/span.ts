import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds } from './geometry';
import { joinLines } from './layoutSolver';
import { sidesFromNeighbours } from './sketchFill';

type Point = { x: number; y: number };

/**
 * One empty stretch of a drawn line, from the piece standing on it on one side
 * to the piece standing on it on the other - "corner to corner".
 *
 * The way the architect works (the user, 2026-10-31): draw the line, set the
 * corners by hand, then have the system fill between them one stretch at a
 * time, choosing a pattern for each. So a click on an empty part of a line
 * that already has pieces on it picks that part only, and the recommendation
 * tab fills that part only.
 */
export interface LineSpan {
  /** the drawn line that was clicked */
  pathId: string;
  /** the stretch, as a line of its own, in the line's own direction */
  points: Point[];
  /** which side of it the panels stand - the whole line's side, see below */
  side: 1 | -1;
  /** its length along the line, cm */
  length: number;
}

/** Shorter than this between two pieces is a placing error, not a stretch to fill. */
const MIN_SPAN_CM = 2.5;
/** How close a piece has to come to a line to count as standing on it, cm. */
const TOUCH_CM = 0.6;

/**
 * The empty stretch of `pathId` around `at`, or null when there is nothing to
 * pick out: no piece on the line at all (the whole line is the stretch), or
 * `at` lands on a piece.
 *
 * Worked on the line as the fill sees it - lines that meet end to end joined
 * into one (`joinLines`), so a stretch carries on round a corner and across
 * the join of two drawn lines. Which side the panels go is read off that whole
 * line in the whole drawing and handed on, because a stretch on its own is an
 * open fragment whose winding says nothing.
 */
export function spanAt(
  pathId: string,
  at: Point,
  sketch: SketchPath[],
  pieces: Piece[],
  materials: Material[],
): LineSpan | null {
  const chains = joinLines(sketch);
  const index = chains.findIndex((c) => c.sources.includes(pathId));
  if (index < 0) return null;
  const chain = chains[index].path;
  const side = sidesFromNeighbours(
    chains.map((c) => c.path),
    { height: 300, includeCorners: true },
  )[index];

  const pts = chain.points;
  const closed = !!chain.closed && pts.length > 2;
  const legCount = closed ? pts.length : pts.length - 1;
  const legs: Array<{ a: Point; b: Point; s0: number; len: number }> = [];
  let total = 0;
  for (let i = 0; i < legCount; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    legs.push({ a, b, s0: total, len });
    total += len;
  }
  if (!(total > 0)) return null;

  // Where along the line the click is.
  let click = -1;
  let best = Infinity;
  for (const leg of legs) {
    if (!leg.len) continue;
    const t = Math.max(
      0,
      Math.min(1, ((at.x - leg.a.x) * (leg.b.x - leg.a.x) + (at.y - leg.a.y) * (leg.b.y - leg.a.y)) / leg.len ** 2),
    );
    const px = leg.a.x + (leg.b.x - leg.a.x) * t;
    const py = leg.a.y + (leg.b.y - leg.a.y) * t;
    const d = Math.hypot(at.x - px, at.y - py);
    if (d < best) {
      best = d;
      click = leg.s0 + t * leg.len;
    }
  }
  if (click < 0) return null;

  // What stands on it: every panel, filler and corner touching a leg, as
  // stretches of the line's length.
  const byId = new Map(materials.map((m) => [m.id, m]));
  const taken: Array<[number, number]> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || (m.category !== 'panel' && m.category !== 'filler' && m.category !== 'corner')) continue;
    const r = pieceBounds(p, m);
    for (const leg of legs) {
      const across = leg.a.y === leg.b.y;
      const along = leg.a.x === leg.b.x;
      if (!across && !along) continue;
      const c = across ? leg.a.y : leg.a.x;
      const lo = across ? r.y : r.x;
      const hi = across ? r.y + r.h : r.x + r.w;
      if (lo > c + TOUCH_CM || hi < c - TOUCH_CM) continue;
      // Along the leg, measured from its start in its own direction.
      const start = across ? leg.a.x : leg.a.y;
      const dir = across ? Math.sign(leg.b.x - leg.a.x) : Math.sign(leg.b.y - leg.a.y);
      const from = across ? r.x : r.y;
      const to = across ? r.x + r.w : r.y + r.h;
      const u0 = Math.max(0, Math.min((from - start) * dir, (to - start) * dir));
      const u1 = Math.min(leg.len, Math.max((from - start) * dir, (to - start) * dir));
      if (u1 - u0 > TOUCH_CM) taken.push([leg.s0 + u0, leg.s0 + u1]);
    }
  }
  if (!taken.length) return null;

  // A closed line goes round: the stretches are read twice over so one that
  // runs across the start is still found whole.
  const all = closed ? [...taken, ...taken.map(([a, b]): [number, number] => [a + total, b + total])] : taken;
  all.sort((p, q) => p[0] - q[0]);
  const at0 = closed && click < Math.min(...taken.map((t) => t[0])) ? click + total : click;
  if (all.some(([a, b]) => at0 >= a - TOUCH_CM && at0 <= b + TOUCH_CM)) return null;
  let lo = closed ? -Infinity : 0;
  let hi = closed ? Infinity : total;
  for (const [a, b] of all) {
    if (b <= at0) lo = Math.max(lo, b);
    if (a >= at0) hi = Math.min(hi, a);
  }
  if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi - lo < MIN_SPAN_CM) return null;

  return { pathId, points: slice(legs, total, closed, lo, hi), side, length: Math.round((hi - lo) * 10) / 10 };
}

/** The line between two lengths along it, its corners included. */
function slice(
  legs: Array<{ a: Point; b: Point; s0: number; len: number }>,
  total: number,
  closed: boolean,
  lo: number,
  hi: number,
): Point[] {
  const pointAt = (s: number): Point => {
    const t = closed ? ((s % total) + total) % total : s;
    for (const leg of legs) {
      if (t <= leg.s0 + leg.len + 1e-6) {
        const k = leg.len ? (t - leg.s0) / leg.len : 0;
        return { x: leg.a.x + (leg.b.x - leg.a.x) * k, y: leg.a.y + (leg.b.y - leg.a.y) * k };
      }
    }
    const last = legs[legs.length - 1];
    return { ...last.b };
  };
  const round = (p: Point) => ({ x: Math.round(p.x * 10) / 10, y: Math.round(p.y * 10) / 10 });
  const out: Point[] = [round(pointAt(lo))];
  // Every corner strictly inside the stretch, going round as often as needed.
  const turns = closed ? [0, total] : [0];
  const corners: number[] = [];
  for (const base of turns) for (const leg of legs) corners.push(base + leg.s0);
  for (const s of corners.sort((a, b) => a - b)) {
    if (s > lo + 1e-6 && s < hi - 1e-6) out.push(round(pointAt(s)));
  }
  out.push(round(pointAt(hi)));
  return out;
}

/** The stretch as a line the solver can fill - with its side fixed. */
export function spanPath(span: LineSpan): SketchPath {
  return { id: `span:${span.pathId}`, points: span.points };
}
