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

/** Which kinds of ჭანჭიკი a reset puts back - see ჭანჭიკები -> the settings. */
export interface BoltKinds {
  connectors: boolean;
  rods: boolean;
}

export const ALL_BOLT_KINDS: BoltKinds = { connectors: true, rods: true };

/** A taken-off entry in `Piece.boltsOff` that belongs to a შტირი, not a connector. */
const ROD_OFF = 'rod:';

/**
 * Back to what the rule says, for the kinds asked: every joint taken off comes
 * back, and every one of that kind placed by hand goes, so the marks are once
 * again exactly the worked-out ones.
 */
export function resetBolts(
  pieces: Piece[],
  byId: Map<string, Material>,
  kinds: BoltKinds = ALL_BOLT_KINDS,
): Piece[] {
  return pieces
    .filter((p) => {
      const m = byId.get(p.materialId);
      if (!m) return true;
      if (kinds.connectors && isConnector(m)) return false;
      if (kinds.rods && isRod(m)) return false;
      return true;
    })
    .map((p) => {
      if (!p.boltsOff) return p;
      const keep = p.boltsOff.filter((k) => (k.startsWith(ROD_OFF) ? !kinds.rods : !kinds.connectors));
      if (keep.length === p.boltsOff.length) return p;
      const { boltsOff: _off, ...rest } = p;
      return keep.length ? { ...rest, boltsOff: keep } : rest;
    });
}

/*
 * შტირები - tie rods across a wall.
 *
 * As the user drew it (2026-10-16): a wall has two faces, შიდა and გარე, each a
 * run of panels and ჩაკერება end to end. Where a joint between two of them sits
 * straight across from a joint on the other face, one შტირი goes through both,
 * square to the wall, holding the two faces together against the pour.
 *
 * Like the connector marks this is worked out, drawn and counted, never placed:
 * a rod is only a piece once somebody takes hold of one, or drags one in from
 * the catalog - and then it snaps to these same spots.
 */

/**
 * Two joints this far apart along the wall still face one another, cm. Short
 * of the 5 cm the drawing moves in, so the next joint along is never taken.
 */
const ACROSS_CM = 3;
/** A rod sticks out this far past each face, cm - how it was drawn. */
export const ROD_OVERHANG_CM = 5;
/** The longest a rod can be when the catalog does not say. */
const DEFAULT_MAX_ROD_CM = 150;

export function isRod(m: Material): boolean {
  return isLinear(m) && (m.category === 'rod' || m.name.includes('შტირ'));
}

export interface Rod {
  /** 'v' - the rod runs along y, across a wall that runs along x; 'h' - the other way */
  dir: 'h' | 'v';
  /** the fixed coordinate: where along the wall it goes */
  at: number;
  /** from the outside of one face to the outside of the other, along `dir` */
  from: number;
  to: number;
  /** world cm, its middle */
  x: number;
  y: number;
  z: number;
  /** how tall the faces are at the joint, cm - the tallest piece there */
  h: number;
  /** how many rods go up that height - see `rodsUpHeight` */
  count: number;
  /** the two panels on one face whose joint it goes through - its key */
  a: string;
  b: string;
}

/**
 * How many შტირი go through one spot, bottom to top.
 *
 * The user's rule (2026-10-16): a 300 panel takes five, a 150 or a 90 takes
 * two. One mark on the plan stands for all of them - they are one above the
 * other - but the count and the 3D are the real number.
 */
export function rodsUpHeight(h: number): number {
  return h >= 300 ? 5 : 2;
}

/** A joint between two pieces end to end, on one face. */
interface Joint extends Edge {
  z: number;
  a: string;
  b: string;
}

/** A ჩაკერება's joint with another is the whole thickness of the face, give or take. */
const FULL_FACE_CM = 8;

/**
 * Every joint in a run of panels and ჩაკერება end to end, on any face.
 *
 * A panel says which way it runs by its shape - long one way, 9 deep the other
 * - so its joints are its two short ends. A ჩაკერება 5 is narrower than it is
 * deep and cannot say, so it takes the way of whatever it butts: next to a
 * panel its joint is that panel's end, and next to another ჩაკერება it is the
 * side the two share across the full face.
 */
function inlineJoints(pieces: Piece[], byId: Map<string, Material>): Joint[] {
  const parts: Array<{ p: Piece; r: Rect; panel: boolean }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isSquare(p)) continue;
    if (m.category === 'panel') parts.push({ p, r: pieceBounds(p, m), panel: true });
    else if (m.category === 'filler') parts.push({ p, r: pieceBounds(p, m), panel: false });
  }
  const out: Joint[] = [];
  for (let i = 0; i < parts.length; i++) {
    for (let j = i + 1; j < parts.length; j++) {
      const A = parts[i];
      const B = parts[j];
      if (!sameCourse(A.p, B.p)) continue;
      // Two panels in line lie the same way, so an end meets an end.
      if (A.panel && B.panel && A.r.w >= A.r.h !== B.r.w >= B.r.h) continue;
      const ea = A.panel ? panelEnds(A.r) : sides(A.r);
      const eb = B.panel ? panelEnds(B.r) : sides(B.r);
      for (const e of ea) {
        for (const f of eb) {
          const s = stretch(e, f);
          if (!s) continue;
          if (!A.panel && !B.panel && s.to - s.from < FULL_FACE_CM) continue;
          out.push({ ...s, z: A.p.z ?? 0, a: A.p.id, b: B.p.id });
        }
      }
    }
  }
  return out;
}

const longestRod = (byId: Map<string, Material>) => {
  let best = 0;
  for (const m of byId.values()) if (isRod(m)) best = Math.max(best, Math.max(m.w, m.h));
  return best || DEFAULT_MAX_ROD_CM;
};

const rodTakenOff = (byPiece: Map<string, Piece>, j: Joint) =>
  !!byPiece.get(j.a)?.boltsOff?.includes(ROD_OFF + j.b) ||
  !!byPiece.get(j.b)?.boltsOff?.includes(ROD_OFF + j.a);

/**
 * Every შტირი the drawing needs: one per pair of joints that face each other
 * across a wall.
 *
 * Each joint is matched with the nearest joint straight across from it, and a
 * rod goes in only when the two choose each other - so a joint with two walls
 * near it is not tied to both, and no pair is counted twice. `all` keeps the
 * ones taken off by hand: they are still where a rod can be put back.
 */
export function findRods(pieces: Piece[], byId: Map<string, Material>, all = false): Rod[] {
  const joints = inlineJoints(pieces, byId);
  const reach = longestRod(byId) - ROD_OVERHANG_CM * 2;
  const gapBetween = (j: Joint, k: Joint) =>
    k.from >= j.to ? k.from - j.to : j.from >= k.to ? j.from - k.to : -1;
  const nearest = joints.map((j) => {
    let best = -1;
    let bestGap = Infinity;
    joints.forEach((k, ki) => {
      if (k === j || k.dir !== j.dir || Math.abs(k.z - j.z) >= TOUCH_CM) return;
      if (Math.abs(k.at - j.at) > ACROSS_CM) return;
      const gap = gapBetween(j, k);
      // Faces that touch are one face, not a wall with concrete between.
      if (gap < MIN_SHARED_CM) return;
      if (Math.max(j.to, k.to) - Math.min(j.from, k.from) > reach) return;
      if (gap < bestGap) {
        bestGap = gap;
        best = ki;
      }
    });
    return best;
  });

  const byPiece = new Map(pieces.map((p) => [p.id, p]));
  const out: Rod[] = [];
  joints.forEach((j, ji) => {
    const ki = nearest[ji];
    if (ki < 0 || ki < ji || nearest[ki] !== ji) return;
    const k = joints[ki];
    if (!all && (rodTakenOff(byPiece, j) || rodTakenOff(byPiece, k))) return;
    const at = (j.at + k.at) / 2;
    const from = Math.min(j.from, k.from);
    const to = Math.max(j.to, k.to);
    const mid = (from + to) / 2;
    // A joint edge that stands along y sits in a wall running along x, so the
    // rod crossing it runs along y too.
    const dir = j.dir;
    const h = Math.max(
      ...[j.a, j.b, k.a, k.b].map((id) => {
        const p = byPiece.get(id);
        return (p && byId.get(p.materialId)?.h) || 0;
      }),
    );
    out.push({
      dir,
      at,
      from,
      to,
      x: dir === 'v' ? at : mid,
      y: dir === 'v' ? mid : at,
      z: j.z,
      h,
      count: rodsUpHeight(h),
      a: j.a,
      b: j.b,
    });
  });
  return out;
}

/** The pieces with this rod's joint taken off - see `Piece.boltsOff`. */
export function withRodOff(pieces: Piece[], rod: Rod): Piece[] {
  return withBoltOff(pieces, rod.a, ROD_OFF + rod.b);
}

/** A placed rod stands in a spot if its middle is this close and it runs the same way, cm. */
const ON_ROD_CM = 3;

/** How a rod piece lies: turned a quarter, it runs along y. */
const rodDir = (p: Piece): 'h' | 'v' => (Math.round(normalizeRot(p.rot) / 90) % 2 === 1 ? 'v' : 'h');

function placedRods(pieces: Piece[], byId: Map<string, Material>) {
  const out: Array<{ x: number; y: number; z: number; dir: 'h' | 'v' }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && isRod(m)) out.push({ ...pieceCentre(p, m), z: p.z ?? 0, dir: rodDir(p) });
  }
  return out;
}

/**
 * The worked-out rods no placed rod already stands in - anywhere up the height
 * of the faces, since a spot's rods go one above the other. `anyCourse` as in
 * `openBolts`.
 */
export function openRods(pieces: Piece[], byId: Map<string, Material>, anyCourse = false): Rod[] {
  const placed = placedRods(pieces, byId);
  return findRods(pieces, byId).filter(
    (r) =>
      !placed.some(
        (c) =>
          c.dir === r.dir &&
          (anyCourse || (c.z > r.z - TOUCH_CM && c.z < r.z + r.h)) &&
          Math.hypot(c.x - r.x, c.y - r.y) <= ON_ROD_CM,
      ),
  );
}

/** How many შტირი the drawing needs: every rod up every open spot, and the ones placed. */
export function rodCount(pieces: Piece[], byId: Map<string, Material>): number {
  const open = openRods(pieces, byId).reduce((n, r) => n + r.count, 0);
  return open + placedRods(pieces, byId).length;
}

/** The catalog rod for a span: the shortest that sticks out past both faces. */
export function rodMaterialFor(materials: Material[], span: number): Material | undefined {
  const rods = materials.filter(isRod).sort((a, b) => Math.max(a.w, a.h) - Math.max(b.w, b.h));
  return rods.find((m) => Math.max(m.w, m.h) >= span + ROD_OVERHANG_CM * 2) ?? rods[rods.length - 1];
}

/** Where a rod let go near `at` belongs - the nearest rod spot in reach, turned to suit. */
export function snapRod(
  at: { x: number; y: number },
  pieces: Piece[],
  byId: Map<string, Material>,
  reach: number,
): RodSpot | null {
  let best: Rod | null = null;
  let bestD = reach;
  for (const r of findRods(pieces, byId, true)) {
    const d = Math.hypot(r.x - at.x, r.y - at.y);
    if (d <= bestD) {
      best = r;
      bestD = d;
    }
  }
  return best && rodSpot(best);
}

/** Where a stack of rods goes: the spot's middle, how it is turned, and up what height. */
export interface RodSpot {
  x: number;
  y: number;
  /** the underside of the faces */
  z: number;
  rot: number;
  h: number;
  count: number;
}

export const rodSpot = (r: Rod): RodSpot => ({
  x: r.x,
  y: r.y,
  z: r.z,
  rot: r.dir === 'v' ? 90 : 0,
  h: r.h,
  count: r.count,
});

/**
 * The rods for one spot, evenly up the height of the faces: each in the middle
 * of its share of it, so five on a 300 are 30 cm off the floor and the top and
 * 60 apart, as drawn. `ids` are used in order; the rest are made with `newId`.
 */
export function rodStack(m: Material, spot: RodSpot, ids: string[], newId: () => string): Piece[] {
  const out: Piece[] = [];
  for (let i = 0; i < spot.count; i++) {
    const level = spot.z + (spot.h * (i + 0.5)) / spot.count - m.h / 2;
    out.push(rodPieceAt(m, { ...spot, z: level }, ids[i] ?? newId()));
  }
  return out;
}

/**
 * The rods standing one above the other with `p` - the stack a click on one
 * picks up, so it moves and deletes as the one thing it is on the plan.
 */
export function rodStackOf(p: Piece, pieces: Piece[], byId: Map<string, Material>): Piece[] {
  const m = byId.get(p.materialId);
  if (!m || !isRod(m)) return [p];
  const c = pieceCentre(p, m);
  return pieces.filter((q) => {
    const qm = byId.get(q.materialId);
    if (!qm || !isRod(qm) || rodDir(q) !== rodDir(p)) return false;
    const qc = pieceCentre(q, qm);
    return Math.hypot(qc.x - c.x, qc.y - c.y) < TOUCH_CM;
  });
}

/** A rod piece with its middle on a spot, turned to it. */
export function rodPieceAt(
  m: Material,
  spot: { x: number; y: number; z: number; rot: number },
  id: string,
): Piece {
  // `z` is where this one rod sits - see `rodStack` for a whole spot.
  return {
    id,
    materialId: m.id,
    x: spot.x - planW(m) / 2,
    y: spot.y - planH(m) / 2,
    rot: spot.rot,
    z: Math.max(0, spot.z),
  };
}
