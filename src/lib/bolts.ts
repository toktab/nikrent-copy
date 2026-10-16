import type { Material, Piece } from '../types';
import { isConnector, isLinear, normalizeRot, pieceBounds, planH, planW, type Rect } from './geometry';
import { cornerLeg } from './shapePath';

/**
 * Where the drawing needs a კონექტორი (tie bolt), worked out from what is placed.
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
 * A connector somebody places by hand is a real piece - see the end of the file.
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
  /** the stretch the two pieces touch along - a placed კონექტორი anywhere on it takes this joint */
  seam: Edge;
}

/** How close two faces must be to count as touching, cm. Drawing snaps to 5. */
const TOUCH_CM = 0.5;
/** How much of an edge two pieces must share to be a joint and not a corner graze. */
const MIN_SHARED_CM = 1;
/** Two joints closer than this are the same place on site - one bolt. */
const SAME_SPOT_CM = 2;

/** An axis-aligned edge: `at` on the fixed axis, `from..to` along the other. */
export interface Edge {
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
function stretch(e: Edge, f: Edge): Edge | null {
  if (e.dir !== f.dir || Math.abs(e.at - f.at) > TOUCH_CM) return null;
  const from = Math.max(e.from, f.from);
  const to = Math.min(e.to, f.to);
  if (to - from < MIN_SHARED_CM) return null;
  return { dir: e.dir, at: e.at, from, to };
}

/** The middle of an edge, in world cm. */
function middle(s: Edge): { x: number; y: number } {
  const mid = (s.from + s.to) / 2;
  return s.dir === 'v' ? { x: s.at, y: mid } : { x: mid, y: s.at };
}

/** The point of an edge nearest `at`, in world cm. */
function nearestOn(s: Edge, at: { x: number; y: number }): { x: number; y: number } {
  if (s.dir === 'v') return { x: s.at, y: Math.min(s.to, Math.max(s.from, at.y)) };
  return { x: Math.min(s.to, Math.max(s.from, at.x)), y: s.at };
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
  const add = (seam: Edge, kind: BoltKind, a: Piece, b: Piece) => {
    // Taken off by hand - see `Piece.boltsOff`.
    if (a.boltsOff?.includes(b.id) || b.boltsOff?.includes(a.id)) return;
    const at = middle(seam);
    const z = a.z ?? 0;
    const dup = out.some(
      (o) => Math.abs(o.z - z) < TOUCH_CM && Math.hypot(o.x - at.x, o.y - at.y) < SAME_SPOT_CM,
    );
    if (!dup) out.push({ x: at.x, y: at.y, kind, z, a: a.id, b: b.id, seam });
  };

  // T-joints: an end of one panel on a long face of another.
  for (const end of panels) {
    for (const face of panels) {
      if (end === face || !sameCourse(end.p, face.p)) continue;
      for (const e of panelEnds(end.r)) {
        for (const f of panelFaces(face.r)) {
          const s = stretch(e, f);
          if (s) add(s, 'tee', end.p, face.p);
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
          const s = stretch(e, f);
          if (s) add(s, 'corner', c.p, fl.p);
        }
      }
    }
  }

  return out;
}

/*
 * Placed კონექტორები.
 *
 * The marks above are worked out, but the site does not always put the clamp
 * where the rule does, so a კუთხის კონექტორი can also be a real piece: dragged
 * in from the catalog, or a mark taken hold of and moved. Either way it lands on
 * a joint - a stretch where two pieces touch - and a joint the rule names that
 * already has one standing on it shows no mark of its own and is not counted
 * twice.
 */

/** A placed connector stands on the seam if its middle is this close to it, cm. */
const ON_SEAM_CM = 1;

/** How far from a joint a connector let go still finds it, in screen px. */
export const CONNECTOR_SNAP_PX = 24;

/** The middle of a placed piece in plan - turning does not move it. */
export function pieceCentre(p: Piece, m: Material): { x: number; y: number } {
  return { x: p.x + planW(m) / 2, y: p.y + planH(m) / 2 };
}

/** The connector the catalog offers for a joint: the plain one when there is one. */
export function connectorMaterial(materials: Material[]): Material | undefined {
  const all = materials.filter(isConnector);
  return all.find((m) => m.id === 'corner-connector') ?? [...all].sort((a, b) => a.h - b.h)[0];
}

/** Every placed connector, where its middle is. */
function placedConnectors(pieces: Piece[], byId: Map<string, Material>) {
  const out: Array<{ x: number; y: number; z: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && isConnector(m)) out.push({ ...pieceCentre(p, m), z: p.z ?? 0 });
  }
  return out;
}

const onSeam = (at: { x: number; y: number }, s: Edge) => {
  const near = nearestOn(s, at);
  return Math.hypot(near.x - at.x, near.y - at.y) <= ON_SEAM_CM;
};

/**
 * The worked-out joints nothing has been placed on yet.
 *
 * `anyCourse` is for the marks on the plan, where a stack of courses shares
 * one spot: a connector placed on the joint takes the mark away whatever course
 * it is on. The count keeps to the course, so two courses still need two.
 */
export function openBolts(pieces: Piece[], byId: Map<string, Material>, anyCourse = false): Bolt[] {
  const placed = placedConnectors(pieces, byId);
  return findBolts(pieces, byId).filter(
    (b) => !placed.some((c) => (anyCourse || Math.abs(c.z - b.z) < TOUCH_CM) && onSeam(c, b.seam)),
  );
}

/** How many connectors the drawing needs: the open joints and the ones placed. */
export function connectorCount(pieces: Piece[], byId: Map<string, Material>): number {
  return openBolts(pieces, byId).length + placedConnectors(pieces, byId).length;
}

/** Every stretch where two pieces on one course touch - anywhere a connector can go. */
export function findSeams(pieces: Piece[], byId: Map<string, Material>): Array<Edge & { z: number }> {
  const boxes: Array<{ p: Piece; r: Rect }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isSquare(p) || isConnector(m) || isLinear(m)) continue;
    boxes.push({ p, r: pieceBounds(p, m) });
  }
  const out: Array<Edge & { z: number }> = [];
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      if (!sameCourse(boxes[i].p, boxes[j].p)) continue;
      for (const e of sides(boxes[i].r)) {
        for (const f of sides(boxes[j].r)) {
          const s = stretch(e, f);
          if (s) out.push({ ...s, z: boxes[i].p.z ?? 0 });
        }
      }
    }
  }
  return out;
}

/**
 * Where a connector let go near `at` belongs, or null when no joint is in reach.
 *
 * A joint the rule names wins outright and takes the connector to its middle -
 * that is where one goes. Otherwise it sits on the nearest stretch where two
 * pieces meet, at the point along it nearest the pointer, so it can be slid
 * along a joint as well as moved from one joint to another.
 */
export function snapConnector(
  at: { x: number; y: number },
  pieces: Piece[],
  byId: Map<string, Material>,
  reach: number,
): { x: number; y: number; z: number } | null {
  let best: { x: number; y: number; z: number } | null = null;
  let bestD = reach;
  const bolts = findBolts(pieces, byId);
  for (const b of bolts) {
    const d = Math.hypot(b.x - at.x, b.y - at.y);
    if (d <= bestD) {
      best = { x: b.x, y: b.y, z: b.z };
      bestD = d;
    }
  }
  if (best) return best;
  // The inner-corner joints are leg ends inside an L's box, which no box side
  // finds, so their seams go in with the rest.
  for (const s of [...findSeams(pieces, byId), ...bolts.map((b) => ({ ...b.seam, z: b.z }))]) {
    const near = nearestOn(s, at);
    const d = Math.hypot(near.x - at.x, near.y - at.y);
    if (d <= bestD) {
      best = { ...near, z: s.z };
      bestD = d;
    }
  }
  return best;
}

/**
 * The placed connectors that touch a კუთხე - drawn orange rather than yellow,
 * like the worked-out mark at an inner corner, so a connector clamping a
 * corner reads as that at a glance.
 *
 * "Touching" is its middle on or inside the corner's footprint, give or take
 * the same centimetre a connector on a seam is allowed.
 */
export function connectorsAtCorners(pieces: Piece[], byId: Map<string, Material>): Set<string> {
  const corners: Array<{ r: Rect; z: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && m.category === 'corner' && !isConnector(m)) corners.push({ r: pieceBounds(p, m), z: p.z ?? 0 });
  }
  const out = new Set<string>();
  if (!corners.length) return out;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isConnector(m)) continue;
    const c = pieceCentre(p, m);
    const z = p.z ?? 0;
    const touches = corners.some(
      ({ r, z: cz }) =>
        Math.abs(cz - z) < TOUCH_CM &&
        c.x >= r.x - ON_SEAM_CM &&
        c.x <= r.x + r.w + ON_SEAM_CM &&
        c.y >= r.y - ON_SEAM_CM &&
        c.y <= r.y + r.h + ON_SEAM_CM,
    );
    if (touches) out.add(p.id);
  }
  return out;
}

/** The pieces with `b` added to `a`'s taken-off joints - see `Piece.boltsOff`. */
export function withBoltOff(pieces: Piece[], a: string, b: string): Piece[] {
  return pieces.map((p) =>
    p.id === a && !p.boltsOff?.includes(b) ? { ...p, boltsOff: [...(p.boltsOff ?? []), b] } : p,
  );
}

/**
 * Back to what the rule says: every joint taken off comes back, and every
 * connector placed by hand goes, so the marks are once again exactly the
 * worked-out ones.
 */
export function resetBolts(pieces: Piece[], byId: Map<string, Material>): Piece[] {
  return pieces
    .filter((p) => {
      const m = byId.get(p.materialId);
      return !(m && isConnector(m));
    })
    .map((p) => {
      if (!p.boltsOff) return p;
      const { boltsOff: _off, ...rest } = p;
      return rest;
    });
}
