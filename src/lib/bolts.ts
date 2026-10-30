import type { Material, Piece } from '../types';
import { isConnector, isLatch, isLinear, isNut, normalizeRot, pieceBounds, planH, planW, type Rect } from './geometry';
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

/**
 * How many connectors go at each joint: five, always, whatever the height (the
 * user, 2026-10-23). One mark on the plan, or one placed piece, stands for all
 * of them.
 */
export const CONNECTORS_PER_JOINT = 5;

/**
 * How many connectors the drawing has: five for every one placed.
 *
 * Only placed ones (the user, 2026-10-23): a drawing gets its connectors when
 * ჭანჭიკები -> ავტომატურად თავიდან დასმა puts them on the joints the rule
 * names, or by hand - never by itself the moment panels go down. The joints are
 * still worked out (`findBolts`) for that button and for snapping.
 */
export function connectorCount(pieces: Piece[], byId: Map<string, Material>): number {
  return placedConnectors(pieces, byId).length * CONNECTORS_PER_JOINT;
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
  nuts: boolean;
  latches: boolean;
}

export const ALL_BOLT_KINDS: BoltKinds = { connectors: true, rods: true, nuts: true, latches: true };

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
      if (kinds.nuts && isNut(m)) return false;
      if (kinds.latches && isLatch(m)) return false;
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
  /**
   * A rod goes through one wall: between its two faces there is concrete and
   * nothing else. Two joints with another face between them - the far side of
   * a room, through the panels of the wall in its middle - are not a rod
   * (the user's ნახაზი 3, 2026-10-23), however well they line up.
   */
  const boxes: Array<{ r: Rect; z: number; h: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && !isConnector(m) && ['panel', 'filler', 'corner'].includes(m.category)) {
      boxes.push({ r: pieceBounds(p, m), z: p.z ?? 0, h: m.h });
    }
  }
  const blocked = (j: Joint, k: Joint) => {
    const [lo, hi] = k.from >= j.to ? [j.to, k.from] : [k.to, j.from];
    const at = (j.at + k.at) / 2;
    return boxes.some(({ r, z, h }) => {
      if (z > j.z + TOUCH_CM || z + h < j.z + TOUCH_CM) return false;
      const [a0, a1, c0, c1] = j.dir === 'v' ? [r.y, r.y + r.h, r.x, r.x + r.w] : [r.x, r.x + r.w, r.y, r.y + r.h];
      return at > c0 + TOUCH_CM && at < c1 - TOUCH_CM && Math.min(a1, hi) - Math.max(a0, lo) > MIN_SHARED_CM;
    });
  };
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
      if (gap < bestGap && !blocked(j, k)) {
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
 * The rods - or the nuts on a rod end - standing one above the other with
 * `p`: the stack a click on one picks up, so it moves and deletes as the one
 * thing it is on the plan.
 */
export function rodStackOf(p: Piece, pieces: Piece[], byId: Map<string, Material>): Piece[] {
  const m = byId.get(p.materialId);
  if (!m || !(isRod(m) || isNut(m) || isLatch(m))) return [p];
  const c = pieceCentre(p, m);
  return pieces.filter((q) => {
    const qm = byId.get(q.materialId);
    if (!qm) return false;
    if (isRod(m) && !(isRod(qm) && rodDir(q) === rodDir(p))) return false;
    if (isNut(m) && !(isNut(qm) && normalizeRot(q.rot) === normalizeRot(p.rot))) return false;
    if (isLatch(m) && !(isLatch(qm) && normalizeRot(q.rot) === normalizeRot(p.rot))) return false;
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

/*
 * ქანჩი + დისკო - the nut and washer on each end of a შტირი.
 *
 * As the user set it (2026-10-16): every rod has two, one on each end, the
 * washer flat against the outside of the face and the nut on it. Worked out
 * from the rods - placed or not - the same way the rods are worked out from
 * the joints: counted and drawn by themselves, and a real piece only once one
 * is dragged in from the catalog, when it snaps onto a rod end.
 *
 * A nut piece's turn says which way it faces: 0 is the end of a rod running off
 * towards +x, 90 towards +y, and so on round. So it is drawn the right way
 * round without having to find its rod again.
 */

export { isLatch, isNut };

/** The nut the catalog offers for a rod end. */
export function nutMaterial(materials: Material[]): Material | undefined {
  return materials.find((m) => m.id === 'acc-nut-washer') ?? materials.find(isNut);
}

/** One end of a rod stack, where its nuts go. */
export interface RodEnd {
  /** world cm, on the outside of the face */
  x: number;
  y: number;
  /** which way is out, as a piece turn - see above */
  rot: number;
  /** the middle of each rod up the stack, cm off the floor */
  levels: number[];
}

/** The way out from a rod end, as a unit step. */
export const outward = (rot: number) => {
  const r = Math.round(normalizeRot(rot) / 90) % 4;
  return [
    { x: 1, y: 0 },
    { x: 0, y: 1 },
    { x: -1, y: 0 },
    { x: 0, y: -1 },
  ][r];
};

/** The two ends of a rod running `dir` across `from..to` at `at`. */
function endsOf(dir: 'h' | 'v', at: number, from: number, to: number, levels: number[]): RodEnd[] {
  return dir === 'v'
    ? [
        { x: at, y: from, rot: 270, levels },
        { x: at, y: to, rot: 90, levels },
      ]
    : [
        { x: from, y: at, rot: 180, levels },
        { x: to, y: at, rot: 0, levels },
      ];
}

/**
 * Every rod end on the drawing: the worked-out rods nobody has placed, and
 * every stack that has been. A placed stack on a rod spot takes its ends from
 * the faces of that spot; one standing loose, from its own two tips.
 */
export function rodEnds(pieces: Piece[], byId: Map<string, Material>): RodEnd[] {
  const out: RodEnd[] = [];
  for (const r of openRods(pieces, byId)) {
    const levels = Array.from({ length: r.count }, (_, i) => r.z + (r.h * (i + 0.5)) / r.count);
    out.push(...endsOf(r.dir, r.at, r.from, r.to, levels));
  }
  const spots = findRods(pieces, byId, true);
  const seen = new Set<string>();
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isRod(m) || seen.has(p.id)) continue;
    const stack = rodStackOf(p, pieces, byId);
    for (const q of stack) seen.add(q.id);
    const c = pieceCentre(p, m);
    const dir = rodDir(p);
    const levels = stack.map((q) => (q.z ?? 0) + (byId.get(q.materialId)?.h ?? 0) / 2).sort((a, b) => a - b);
    const spot = spots.find((s) => s.dir === dir && Math.hypot(s.x - c.x, s.y - c.y) <= ON_ROD_CM);
    if (spot) {
      out.push(...endsOf(dir, spot.at, spot.from, spot.to, levels));
    } else {
      const half = planW(m) / 2;
      const along = dir === 'v' ? c.y : c.x;
      out.push(...endsOf(dir, dir === 'v' ? c.x : c.y, along - half, along + half, levels));
    }
  }
  return out;
}

/**
 * What goes on a rod end, from the face out: the ქანჩი + დისკო - washer, nut
 * and the light wing piece past it, one item (the user, 2026-10-23). It sits
 * `offset` cm out from the face. (The ჩამკეტი fix is not a rod-end fitting:
 * it clamps two panels together - see the end of the file.)
 */
export interface Fitting {
  is: (m: Material) => boolean;
  offset: number;
}

/** The washer: a disc this wide, this thick, cm. */
export const WASHER_CM = 12;
export const WASHER_T_CM = 1.5;
/** The nut on it, cm. */
export const NUT_CM = 4;
/** The wing piece at the end of a ქანჩი + დისკო: its hub this deep along the rod, its wings this tall across it, cm. */
export const WING_HUB_CM = 4;
export const WING_SPAN_CM = 14;

export const NUT_FIT: Fitting = { is: isNut, offset: 0 };

/** Any of the things that go on a rod end. */
export const isFitting = (m: Material) => isNut(m);
const fitOf = (_m: Material): Fitting => NUT_FIT;

/** Where a fitting piece's middle goes on a rod end: its `offset` out, then half itself. */
export function fittingCentre(end: { x: number; y: number; rot: number }, m: Material) {
  const o = outward(end.rot);
  const out = fitOf(m).offset + planW(m) / 2;
  return { x: end.x + o.x * out, y: end.y + o.y * out };
}

/** The nut's name for `fittingCentre`. */
export const nutCentre = fittingCentre;

/** A fitting placed on an end stands this close to where it belongs, cm. */
const ON_END_CM = 3;

/** The pieces of one kind that stand on `end`. */
function fittingsOn(end: RodEnd, pieces: Piece[], byId: Map<string, Material>, fit: Fitting): Piece[] {
  return pieces.filter((p) => {
    const m = byId.get(p.materialId);
    if (!m || !fit.is(m)) return false;
    const want = fittingCentre(end, m);
    const c = pieceCentre(p, m);
    return Math.hypot(c.x - want.x, c.y - want.y) <= ON_END_CM;
  });
}

/** The rod ends with nothing of that kind placed on them - drawn and counted by themselves. */
export function openRodEnds(
  pieces: Piece[],
  byId: Map<string, Material>,
  fit: Fitting = NUT_FIT,
): RodEnd[] {
  return rodEnds(pieces, byId).filter((e) => fittingsOn(e, pieces, byId, fit).length === 0);
}

/** How many of a kind the drawing needs: one per rod per end, placed or not. */
export function fittingCount(pieces: Piece[], byId: Map<string, Material>, fit: Fitting): number {
  let n = 0;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && fit.is(m)) n++;
  }
  for (const e of rodEnds(pieces, byId)) {
    n += Math.max(0, e.levels.length - fittingsOn(e, pieces, byId, fit).length);
  }
  return n;
}

/**
 * How many ქანჩი + დისკო the drawing needs: two for every შტირი - one on each
 * end - and one for every კონექტორი (the user, 2026-10-30). Read off those two
 * counts rather than off the nuts standing on the plan, so a nut placed beside
 * its rod end, or one not placed yet, cannot make the delivery note disagree
 * with the rule.
 */
export const nutCount = (pieces: Piece[], byId: Map<string, Material>) =>
  rodCount(pieces, byId) * 2 + connectorCount(pieces, byId);

/** The fittings for one rod end, one per rod up it, facing out. `ids` as in `rodStack`. */
export function fittingStack(m: Material, end: RodEnd, ids: string[], newId: () => string): Piece[] {
  const c = fittingCentre(end, m);
  return end.levels.map((level, i) => ({
    id: ids[i] ?? newId(),
    materialId: m.id,
    x: c.x - planW(m) / 2,
    y: c.y - planH(m) / 2,
    rot: end.rot,
    z: Math.max(0, level - m.h / 2),
  }));
}

/** The nut's name for `fittingStack`. */
export const nutStack = fittingStack;

/** The rod end a fitting let go near `at` belongs on - the nearest in reach. */
export function snapNut(
  at: { x: number; y: number },
  pieces: Piece[],
  byId: Map<string, Material>,
  reach: number,
): RodEnd | null {
  let best: RodEnd | null = null;
  let bestD = reach;
  for (const e of rodEnds(pieces, byId)) {
    const d = Math.hypot(e.x - at.x, e.y - at.y);
    if (d <= bestD) {
      best = e;
      bestD = d;
    }
  }
  return best;
}

/**
 * A fitting as it is drawn in 3D, in place of the box the catalog sizes it as.
 *
 * The ქანჩი + დისკო is a washer plate flat on the face, the nut on it, and past
 * that a wing nut - a hub on the rod and its two wings standing up and down from
 * it, as in the user's photo. `material` is the shape to draw each part with;
 * `piece` puts it there.
 */
export function fittingParts(p: Piece, m: Material): Array<{ piece: Piece; material: Material }> {
  const o = outward(p.rot);
  const c = pieceCentre(p, m);
  const half = planW(m) / 2;
  const start = { x: c.x - o.x * half, y: c.y - o.y * half };
  const level = (p.z ?? 0) + m.h / 2;
  const box = (name: string, along: number, across: number, tall: number, off: number, color: string) => {
    const mat: Material = { ...m, id: `${m.id}:${name}`, w: along, depth: across, h: tall, shape: 'rect', color };
    const cx = start.x + o.x * off;
    const cy = start.y + o.y * off;
    return {
      material: mat,
      piece: { ...p, x: cx - along / 2, y: cy - across / 2, z: Math.max(0, level - tall / 2) },
    };
  };
  const wings = WASHER_T_CM + NUT_CM;
  return [
    box('washer', WASHER_T_CM, WASHER_CM, WASHER_CM, WASHER_T_CM / 2, '#9aa3ad'),
    box('nut', NUT_CM, NUT_CM, NUT_CM, WASHER_T_CM + NUT_CM / 2, '#5c636d'),
    box('hub', WING_HUB_CM, 5, 5, wings + WING_HUB_CM / 2, '#d5d9de'),
    box('wings', 1.2, 2.5, WING_SPAN_CM, wings + WING_HUB_CM * 0.6, '#e6e9ec'),
  ];
}

/** The nut's name for `fittingParts`. */
export const nutParts = fittingParts;

/*
 * ჩამკეტი fix - the clamp that holds two panels side by side together.
 *
 * As the user set it (2026-10-23): it goes with the შტირი. Every rod spot is a
 * joint on each face of the wall, and each of those takes a column of them on
 * the outside of its face, where the panels' frames are - one between each pair
 * of rods up it: four a side on a 300 (eight to a spot), one a side on a 150 or
 * a 90 (two). Worked out, drawn and counted like the rods; a real piece once a
 * mark is taken hold of or one is dragged in from the catalog.
 *
 * A latch piece's turn says which way is out of the face, as a nut's does: 0 is
 * +x, 90 +y, and so on round. The clamp lies across that, along the wall.
 */

/** The clamp: this long along the wall, this deep out of the face, this tall, cm. */
export const LATCH_LEN_CM = 10;
export const LATCH_DEPTH_CM = 3;
export const LATCH_TALL_CM = 5;
/** In plan its middle is this far in from the outside of the face, cm - on the frame. */
export const LATCH_IN_CM = 2;
/** A placed latch stands on a spot if its middle is this close, cm. */
const ON_JOINT_CM = 3;

export interface LatchSpot {
  /** world cm, the middle of the clamp in plan */
  x: number;
  y: number;
  /** which way is out of the face - see above */
  rot: number;
  /** where each latch up the face has its middle, cm off the floor */
  levels: number[];
  /** the lowest and highest rod there: a placed latch between them is on this spot */
  from: number;
  to: number;
}

/** Between each pair of rods up a face; a lone rod has one of its own. */
function latchLevels(rodLevels: number[]): number[] {
  const l = [...rodLevels].sort((a, b) => a - b);
  if (l.length < 2) return l;
  return l.slice(1).map((v, i) => (l[i] + v) / 2);
}

/** Every column of ჩამკეტი fix the drawing needs: one at each rod end, on its face. */
export function findLatches(pieces: Piece[], byId: Map<string, Material>): LatchSpot[] {
  const ends = rodEnds(pieces, byId);
  const walls: Rect[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && !isConnector(m) && ['panel', 'filler', 'corner'].includes(m.category)) walls.push(pieceBounds(p, m));
  }
  const out: LatchSpot[] = [];
  // `rodEnds` gives each rod's two ends one after the other.
  for (let i = 0; i + 1 < ends.length; i += 2) {
    const pair = [ends[i], ends[i + 1]];
    const length = Math.hypot(pair[0].x - pair[1].x, pair[0].y - pair[1].y);
    for (const e of pair) {
      const levels = latchLevels(e.levels);
      const face = faceIn(e, length, walls);
      if (!levels.length || face === null) continue;
      const o = outward(e.rot);
      out.push({
        x: face.x - o.x * LATCH_IN_CM,
        y: face.y - o.y * LATCH_IN_CM,
        rot: e.rot,
        levels,
        from: Math.min(...e.levels),
        to: Math.max(...e.levels),
      });
    }
  }
  return out;
}

/**
 * Where a rod first meets a panel coming in from its end: the outside of the
 * face it goes through. A rod on its spot ends right there; one standing loose
 * may stick out well past it, and the clamp stays on the panel's edge, not out
 * by the nut (the user, 2026-10-23). Null when the rod goes through no panel.
 */
function faceIn(e: RodEnd, length: number, walls: Rect[]): { x: number; y: number } | null {
  const o = outward(e.rot);
  const alongX = o.x !== 0;
  let best: number | null = null;
  for (const r of walls) {
    // The rod's line runs through this box...
    const across = alongX ? e.y : e.x;
    const [lo, hi] = alongX ? [r.y, r.y + r.h] : [r.x, r.x + r.w];
    if (across < lo - TOUCH_CM || across > hi + TOUCH_CM) continue;
    // ...and the face it meets first, going in, is the box's outer edge.
    const sign = alongX ? o.x : o.y;
    const end = alongX ? e.x : e.y;
    const edge = sign > 0 ? (alongX ? r.x + r.w : r.y + r.h) : alongX ? r.x : r.y;
    const d = (end - edge) * sign;
    if (d < -TOUCH_CM || d > length) continue;
    if (best === null || d < best) best = Math.max(0, d);
  }
  if (best === null) return null;
  return { x: e.x - o.x * best, y: e.y - o.y * best };
}

function placedLatches(pieces: Piece[], byId: Map<string, Material>) {
  const out: Array<{ x: number; y: number; level: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && isLatch(m)) out.push({ ...pieceCentre(p, m), level: (p.z ?? 0) + m.h / 2 });
  }
  return out;
}

/** The spots no placed latch already stands on - `anyCourse` as in `openBolts`. */
export function openLatches(pieces: Piece[], byId: Map<string, Material>, anyCourse = false): LatchSpot[] {
  const placed = placedLatches(pieces, byId);
  return findLatches(pieces, byId).filter(
    (s) =>
      !placed.some(
        (c) =>
          (anyCourse || (c.level > s.from - TOUCH_CM && c.level < s.to + TOUCH_CM)) &&
          Math.hypot(c.x - s.x, c.y - s.y) <= ON_JOINT_CM,
      ),
  );
}

/** How many ჩამკეტი fix the drawing needs: every one up every open joint, and the ones placed. */
export function latchCount(pieces: Piece[], byId: Map<string, Material>): number {
  const open = openLatches(pieces, byId).reduce((n, s) => n + s.levels.length, 0);
  return open + placedLatches(pieces, byId).length;
}

/** The catalog ჩამკეტი fix. */
export function latchMaterial(materials: Material[]): Material | undefined {
  return materials.find((m) => m.id === 'acc-latch-fix') ?? materials.find(isLatch);
}

/** The latches for one joint, one at each of its levels. `ids` as in `rodStack`. */
export function latchStack(m: Material, spot: LatchSpot, ids: string[], newId: () => string): Piece[] {
  return spot.levels.map((level, i) => ({
    id: ids[i] ?? newId(),
    materialId: m.id,
    x: spot.x - planW(m) / 2,
    y: spot.y - planH(m) / 2,
    rot: spot.rot,
    z: Math.max(0, level - m.h / 2),
  }));
}

/** The spot a latch let go near `at` belongs on - the nearest in reach. */
export function snapLatch(
  at: { x: number; y: number },
  pieces: Piece[],
  byId: Map<string, Material>,
  reach: number,
): LatchSpot | null {
  let best: LatchSpot | null = null;
  let bestD = reach;
  for (const s of findLatches(pieces, byId)) {
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * A ჩამკეტი fix as it is drawn in 3D: small, a block on the outside of the
 * face across the joint, and the wedge through it standing up and down - so it
 * reads from the side as well as head on.
 */
export function latchParts(p: Piece, m: Material): Array<{ piece: Piece; material: Material }> {
  const o = outward(p.rot);
  const c = pieceCentre(p, m);
  const face = { x: c.x + o.x * LATCH_IN_CM, y: c.y + o.y * LATCH_IN_CM };
  const level = (p.z ?? 0) + m.h / 2;
  const box = (name: string, along: number, across: number, tall: number, off: number, color: string) => {
    const mat: Material = { ...m, id: `${m.id}:${name}`, w: along, depth: across, h: tall, shape: 'rect', color };
    const cx = face.x + o.x * off;
    const cy = face.y + o.y * off;
    return { material: mat, piece: { ...p, x: cx - along / 2, y: cy - across / 2, z: Math.max(0, level - tall / 2) } };
  };
  return [
    box('clamp', LATCH_DEPTH_CM, LATCH_LEN_CM, LATCH_TALL_CM, LATCH_DEPTH_CM / 2, '#3f72d6'),
    box('wedge', 1.2, 1.6, LATCH_TALL_CM * 2, LATCH_DEPTH_CM * 0.6, '#24489a'),
  ];
}
