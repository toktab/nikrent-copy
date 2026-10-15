import type { Material, Piece } from '../types';
import { normalizeRot, pieceBounds, planH, planW, type Rect } from './geometry';
import { cornerLeg } from './shapePath';

/**
 * Where the drawing needs a ჭანჭიკი (tie bolt), worked out from what is placed.
 *
 * Two places, as the user drew them (2026-10-15):
 *
 *   T-joint      a panel's end butts the face of another panel at right angles -
 *                a T, or the lap at an outside corner. The two panels share one
 *                bolt at the joint, not one each.
 *   corner end   a შიდა კუთხე's leg ends against a ჩაკერება 5 or 10. The filler
 *                has no frame of its own to clamp to, so the joint is bolted.
 *
 * Nothing else is counted - a straight joint between two panels in line is not
 * a bolt by this rule. This is an overlay and a count, never placed pieces: the
 * parts list stays what was drawn, and the number is there for whoever orders.
 *
 * Square turns only. Formwork is built square, and a piece at 37° has no face
 * another piece can butt cleanly.
 */

export type BoltKind = 'tee' | 'corner';

export interface Bolt {
  /** world cm, the middle of the joint */
  x: number;
  y: number;
  kind: BoltKind;
  /** the course it is on - the underside of the pieces it joins */
  z: number;
  /** the two pieces that share it */
  a: string;
  b: string;
}

/** How close two faces must be to count as touching, cm. Drawing snaps to 5. */
const TOUCH_CM = 0.5;
/** How much of an edge two pieces must share to be a joint and not a corner graze. */
const MIN_SHARED_CM = 1;
/** Two joints closer than this are the same place on site - one bolt. */
const SAME_SPOT_CM = 2;

/** An axis-aligned edge: `at` on the fixed axis, `from..to` along the other. */
interface Edge {
  /** 'v' - a vertical edge, x fixed; 'h' - a horizontal edge, y fixed */
  dir: 'v' | 'h';
  at: number;
  from: number;
  to: number;
}

const isSquare = (p: Piece) => normalizeRot(p.rot) % 90 === 0;

/** Same z: a course stacked above shares a footprint in plan but not a joint. */
const sameCourse = (p: Piece, q: Piece) => Math.abs((p.z ?? 0) - (q.z ?? 0)) < TOUCH_CM;

export function isInnerCorner(m: Material): boolean {
  return m.category === 'corner' && m.shape === 'L' && m.name.includes('შიდა');
}

/** A ჩაკერება 5 or 10 - the two the rule names. */
export function isBoltFiller(m: Material): boolean {
  return m.category === 'filler' && (planW(m) === 5 || planW(m) === 10);
}

/** The two short ends of a panel's footprint. */
function panelEnds(r: Rect): Edge[] {
  if (r.w >= r.h) {
    return [
      { dir: 'v', at: r.x, from: r.y, to: r.y + r.h },
      { dir: 'v', at: r.x + r.w, from: r.y, to: r.y + r.h },
    ];
  }
  return [
    { dir: 'h', at: r.y, from: r.x, to: r.x + r.w },
    { dir: 'h', at: r.y + r.h, from: r.x, to: r.x + r.w },
  ];
}

/** The two long faces of a panel's footprint. */
function panelFaces(r: Rect): Edge[] {
  if (r.w >= r.h) {
    return [
      { dir: 'h', at: r.y, from: r.x, to: r.x + r.w },
      { dir: 'h', at: r.y + r.h, from: r.x, to: r.x + r.w },
    ];
  }
  return [
    { dir: 'v', at: r.x, from: r.y, to: r.y + r.h },
    { dir: 'v', at: r.x + r.w, from: r.y, to: r.y + r.h },
  ];
}

/** All four sides of a box. */
function sides(r: Rect): Edge[] {
  return [
    { dir: 'h', at: r.y, from: r.x, to: r.x + r.w },
    { dir: 'h', at: r.y + r.h, from: r.x, to: r.x + r.w },
    { dir: 'v', at: r.x, from: r.y, to: r.y + r.h },
    { dir: 'v', at: r.x + r.w, from: r.y, to: r.y + r.h },
  ];
}

/**
 * The ends of an L's two legs, in world cm.
 *
 * In its own box the L has its upright leg on the left and its foot along the
 * bottom (`lPoints`): the upright ends at the top edge, the foot at the right.
 * Turned about the box centre the same way the renderer turns it.
 */
function cornerLegEnds(p: Piece, m: Material): Edge[] {
  const pw = planW(m);
  const ph = planH(m);
  const t = cornerLeg(m);
  const rad = (normalizeRot(p.rot) * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  const cx = p.x + pw / 2;
  const cy = p.y + ph / 2;
  const turn = (lx: number, ly: number) => {
    const dx = lx - pw / 2;
    const dy = ly - ph / 2;
    return { x: cx + dx * cos - dy * sin, y: cy + dx * sin + dy * cos };
  };
  const edge = (a: { x: number; y: number }, b: { x: number; y: number }): Edge =>
    Math.abs(a.x - b.x) < 1e-6
      ? { dir: 'v', at: a.x, from: Math.min(a.y, b.y), to: Math.max(a.y, b.y) }
      : { dir: 'h', at: a.y, from: Math.min(a.x, b.x), to: Math.max(a.x, b.x) };
  return [edge(turn(0, 0), turn(t, 0)), edge(turn(pw, ph - t), turn(pw, ph))];
}

/** The stretch two edges share when they lie on one another, or null. */
function shared(e: Edge, f: Edge): { x: number; y: number } | null {
  if (e.dir !== f.dir || Math.abs(e.at - f.at) > TOUCH_CM) return null;
  const from = Math.max(e.from, f.from);
  const to = Math.min(e.to, f.to);
  if (to - from < MIN_SHARED_CM) return null;
  const mid = (from + to) / 2;
  return e.dir === 'v' ? { x: e.at, y: mid } : { x: mid, y: e.at };
}

/** Every bolt the placed pieces need, one per joint. */
export function findBolts(pieces: Piece[], byId: Map<string, Material>): Bolt[] {
  const panels: Array<{ p: Piece; r: Rect }> = [];
  const corners: Array<{ p: Piece; m: Material }> = [];
  const fillers: Array<{ p: Piece; r: Rect }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isSquare(p)) continue;
    if (m.category === 'panel') panels.push({ p, r: pieceBounds(p, m) });
    else if (isInnerCorner(m)) corners.push({ p, m });
    else if (isBoltFiller(m)) fillers.push({ p, r: pieceBounds(p, m) });
  }

  const out: Bolt[] = [];
  // Two joints at one spot are one bolt - but only on the same course.
  const add = (at: { x: number; y: number }, kind: BoltKind, a: Piece, b: Piece) => {
    const z = a.z ?? 0;
    const dup = out.some(
      (o) => Math.abs(o.z - z) < TOUCH_CM && Math.hypot(o.x - at.x, o.y - at.y) < SAME_SPOT_CM,
    );
    if (!dup) out.push({ x: at.x, y: at.y, kind, z, a: a.id, b: b.id });
  };

  // T-joints: an end of one panel on a long face of another.
  for (const end of panels) {
    for (const face of panels) {
      if (end === face || !sameCourse(end.p, face.p)) continue;
      for (const e of panelEnds(end.r)) {
        for (const f of panelFaces(face.r)) {
          const at = shared(e, f);
          if (at) add(at, 'tee', end.p, face.p);
        }
      }
    }
  }

  // Inner corner legs ending on a ჩაკერება 5 / 10.
  for (const c of corners) {
    const ends = cornerLegEnds(c.p, c.m);
    for (const fl of fillers) {
      if (!sameCourse(c.p, fl.p)) continue;
      for (const e of ends) {
        for (const f of sides(fl.r)) {
          const at = shared(e, f);
          if (at) add(at, 'corner', c.p, fl.p);
        }
      }
    }
  }

  return out;
}
