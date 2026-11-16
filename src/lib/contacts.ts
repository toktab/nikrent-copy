import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds, type Rect } from './geometry';
import { isFace } from './gap';

/**
 * Where two things on the plan touch - and where they only nearly do.
 *
 * The user (2026-11-16): two panels side by side show one black line between
 * them whether they touch or stand a centimetre apart, so there was no way to
 * tell. Every joint where two faces (panels, fillers, corners) meet with no gap
 * is marked green along the length they share; one with a small gap - up to
 * NEAR_CM, the kind left by placing by eye - is marked red, so the bad ones
 * stand out instead of hiding among the good. The drawn lines (ხაზვა) get the
 * same at their ends: green where an end lands on another line, red where it
 * stops just short.
 */

/** Closer than this counts as touching, cm - float noise and nothing more. */
export const TOUCH_CM = 0.3;
/** A gap up to this is "nearly touching" - almost certainly meant to touch, cm. */
export const NEAR_CM = 4;
/** Two edges must run alongside each other at least this far to be a joint, cm. */
const MIN_SHARED_CM = 1;

export interface Contact {
  /** the shared stretch, world cm */
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** touching, or a small gap between */
  kind: 'touch' | 'near';
  /** the gap, cm (0 when touching) */
  gap: number;
}

/** Only square-on pieces: a box is the piece itself at a quarter turn, not at 30°. */
function squareOn(p: Piece): boolean {
  return Math.abs(p.rot % 90) < 0.01 || Math.abs((p.rot % 90) - 90) < 0.01;
}

/** The joints between face pieces on the plan, each pair once. */
export function pieceContacts(pieces: Piece[], byId: Map<string, Material>): Contact[] {
  const boxes: Rect[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isFace(m) || !squareOn(p)) continue;
    boxes.push(pieceBounds(p, m));
  }
  // Sorted on x, so each box is only tested against those that start before
  // it ends - a drawing of a few hundred panels stays cheap to redo on a drag.
  const order = boxes.map((_, i) => i).sort((a, b) => boxes[a].x - boxes[b].x);
  const out: Contact[] = [];
  const seen = new Set<string>();
  for (let oi = 0; oi < order.length; oi++) {
    const i = order[oi];
    const a = boxes[i];
    for (let oj = oi + 1; oj < order.length; oj++) {
      const j = order[oj];
      const b = boxes[j];
      if (b.x > a.x + a.w + NEAR_CM) break;
      const c = contactBetween(a, b);
      if (!c) continue;
      const key = `${Math.round(c.x1 * 2)}:${Math.round(c.y1 * 2)}:${Math.round(c.x2 * 2)}:${Math.round(c.y2 * 2)}`;
      // A stacked course is the same joint again: drawn once.
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(c);
    }
  }
  return out;
}

/** The joint between two boxes, if they touch or nearly touch along an edge. */
export function contactBetween(a: Rect, b: Rect): Contact | null {
  // Side by side (a vertical joint): one's right edge against the other's left.
  const yFrom = Math.max(a.y, b.y);
  const yTo = Math.min(a.y + a.h, b.y + b.h);
  if (yTo - yFrom >= MIN_SHARED_CM) {
    for (const [l, r] of [
      [a, b],
      [b, a],
    ] as const) {
      const gap = r.x - (l.x + l.w);
      if (gap > -TOUCH_CM && gap <= NEAR_CM) {
        const x = l.x + l.w + Math.max(0, gap) / 2;
        return { x1: x, y1: yFrom, x2: x, y2: yTo, kind: gap <= TOUCH_CM ? 'touch' : 'near', gap: Math.max(0, gap) };
      }
    }
  }
  // One above the other (a horizontal joint).
  const xFrom = Math.max(a.x, b.x);
  const xTo = Math.min(a.x + a.w, b.x + b.w);
  if (xTo - xFrom >= MIN_SHARED_CM) {
    for (const [t, d] of [
      [a, b],
      [b, a],
    ] as const) {
      const gap = d.y - (t.y + t.h);
      if (gap > -TOUCH_CM && gap <= NEAR_CM) {
        const y = t.y + t.h + Math.max(0, gap) / 2;
        return { x1: xFrom, y1: y, x2: xTo, y2: y, kind: gap <= TOUCH_CM ? 'touch' : 'near', gap: Math.max(0, gap) };
      }
    }
  }
  return null;
}

export interface EndContact {
  x: number;
  y: number;
  kind: 'touch' | 'near';
  gap: number;
}

function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  const t = len2 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2)) : 0;
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

/**
 * The free ends of the drawn lines: on another line (or the same line's other
 * leg) - touching; a few cm short of one - nearly. A closed outline has no ends.
 */
export function sketchEndContacts(sketch: SketchPath[]): EndContact[] {
  const out: EndContact[] = [];
  for (const k of sketch) {
    if (k.closed || k.points.length < 2) continue;
    const ends = [
      { pt: k.points[0], skip: 0 },
      { pt: k.points[k.points.length - 1], skip: k.points.length - 2 },
    ];
    for (const { pt, skip } of ends) {
      let best = Infinity;
      for (const o of sketch) {
        const n = o.points.length;
        const legs = o.closed ? n : n - 1;
        for (let i = 0; i < legs; i++) {
          // Never the leg the end belongs to.
          if (o.id === k.id && i === skip) continue;
          const a = o.points[i];
          const b = o.points[(i + 1) % n];
          best = Math.min(best, distToSegment(pt.x, pt.y, a.x, a.y, b.x, b.y));
        }
      }
      if (best <= TOUCH_CM) out.push({ x: pt.x, y: pt.y, kind: 'touch', gap: 0 });
      else if (best <= NEAR_CM * 2) out.push({ x: pt.x, y: pt.y, kind: 'near', gap: best });
    }
  }
  return out;
}

/** Whether a point is on the edge of a face piece - a measure end landing on a panel, for one. */
export function onPieceEdge(pt: { x: number; y: number }, pieces: Piece[], byId: Map<string, Material>): boolean {
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isFace(m)) continue;
    const r = pieceBounds(p, m);
    const inX = pt.x >= r.x - TOUCH_CM && pt.x <= r.x + r.w + TOUCH_CM;
    const inY = pt.y >= r.y - TOUCH_CM && pt.y <= r.y + r.h + TOUCH_CM;
    if (!inX || !inY) continue;
    const onV = Math.abs(pt.x - r.x) <= TOUCH_CM || Math.abs(pt.x - (r.x + r.w)) <= TOUCH_CM;
    const onH = Math.abs(pt.y - r.y) <= TOUCH_CM || Math.abs(pt.y - (r.y + r.h)) <= TOUCH_CM;
    if (onV || onH) return true;
  }
  return false;
}
