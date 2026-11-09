import type { Material, Piece, SketchPath } from '../types';
import { isLinear, normalizeRot, pieceBounds, planH, planW, type Rect } from './geometry';

/**
 * ნიანგი and ბაყაყი - the two clamps that hold a face's pieces together along
 * the wall (the user, 2026-11-07).
 *
 *   - ნიანგი (ჩამკეტი რეგულირებადი): where two panels have a ჩაკერება between
 *     them - panel, ჩაკერება, panel in one straight run, nothing else (no
 *     შიდა / გარე კუთხე). It reaches across all three, on the back of the face.
 *   - ბაყაყი (სამაგრი ფიქსი): where two panels meet end to end with nothing
 *     between them.
 *
 * Up a 300 panel there are 4 at each such place, up a 150 or a 90, 2. The plan
 * shows one at each place; the count is places × 4 or × 2, as the ჭანჭიკები
 * menu writes it.
 *
 * Like the კონექტორები they are real pieces: ავტომატურად თავიდან დასმა puts one
 * at every place the rule names, and they can be put down, moved and deleted
 * by hand like any other piece.
 */

export type ClampKind = 'crocodiles' | 'frogs';

export function isCrocodile(m: Material): boolean {
  return m.name.includes('ნიანგ') && !isLinear(m);
}

export function isFrog(m: Material): boolean {
  return m.name.includes('ბაყაყ') && !isLinear(m);
}

export const isClampOf = (kind: ClampKind) => (kind === 'crocodiles' ? isCrocodile : isFrog);

/**
 * A გარე კუთხე 300 - the thin outside-corner angle. Each one takes 12 ბაყაყი
 * (the user, 2026-11-08): one is drawn, across the inside of its bend, red,
 * and counts 12.
 */
export function isOuterCorner300(m: Material): boolean {
  return m.category === 'corner' && m.shape === 'L' && m.name.includes('გარე') && m.h >= 250;
}

/** ბაყაყი on one გარე კუთხე 300. */
export const FROGS_PER_OUTER_CORNER = 12;

/** The ბაყაყი standing on a გარე კუთხე 300 - drawn red. */
export function frogsAtOuterCorners(pieces: Piece[], byId: Map<string, Material>): Set<string> {
  const corners: Array<{ r: Rect; z: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && isOuterCorner300(m)) corners.push({ r: pieceBounds(p, m), z: Math.round(p.z ?? 0) });
  }
  const out = new Set<string>();
  if (!corners.length) return out;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isFrog(m)) continue;
    const r = pieceBounds(p, m);
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const z = Math.round(p.z ?? 0);
    if (corners.some((c) => c.z === z && cx >= c.r.x - 1 && cx <= c.r.x + c.r.w + 1 && cy >= c.r.y - 1 && cy <= c.r.y + c.r.h + 1)) {
      out.add(p.id);
    }
  }
  return out;
}

/** How many up one place: 4 up a 300, 2 up a 150 or a 90. */
export function clampsUpHeight(h: number): number {
  return h >= 250 ? 4 : 2;
}

/** The catalog piece for a kind: the built-in one when it is there. */
export function clampMaterial(materials: Material[], kind: ClampKind): Material | undefined {
  const id = kind === 'crocodiles' ? 'acc-latch-adjustable' : 'acc-frog';
  return materials.find((m) => m.id === id) ?? materials.find(isClampOf(kind));
}

/** One place on the plan where a clamp goes. */
export interface ClampSpot {
  /** world cm, the middle of the clamp's footprint in plan */
  x: number;
  y: number;
  /** its turn: its top edge on the back of the face (see `PanelHolderShape`) */
  rot: number;
  z: number;
  /** how many go up it */
  each: number;
}

/** Ends this close are touching, cm. */
const TOUCH = 1;
/** A panel needs a partner across the wall no further than this, edge to edge, cm. */
const MAX_ACROSS_CM = 130;
const MIN_ACROSS_CM = 3;

interface Part {
  p: Piece;
  m: Material;
  r: Rect;
  /** its long side runs along x */
  across: boolean;
  z: number;
  lo: number;
  hi: number;
  near: number;
  far: number;
}

const upright = (p: Piece) => normalizeRot(p.rot) % 90 === 0;

function part(p: Piece, m: Material, across?: boolean): Part {
  const r = pieceBounds(p, m);
  const a = across ?? r.w >= r.h;
  return {
    p,
    m,
    r,
    across: a,
    z: Math.round(p.z ?? 0),
    lo: a ? r.x : r.y,
    hi: a ? r.x + r.w : r.y + r.h,
    near: a ? r.y : r.x,
    far: a ? r.y + r.h : r.x + r.w,
  };
}

/** Same face line: the two lie in one straight run. */
const inLine = (a: Part, b: Part) =>
  a.across === b.across && a.z === b.z && Math.abs(a.near - b.near) <= TOUCH && Math.abs(a.far - b.far) <= TOUCH;

/**
 * Which side of a panel is its back, away from the concrete: +1 towards +y / +x.
 * The side away from a panel facing it across the wall; with none, the long
 * side not on a drawn line (the face stands on the line); with neither, +1.
 */
function backOf(a: Part, panels: Part[], sketch: SketchPath[]): 1 | -1 {
  let best: { gap: number; side: 1 | -1 } | null = null;
  for (const b of panels) {
    if (b === a || b.across !== a.across || b.z !== a.z) continue;
    const cover = Math.min(a.hi, b.hi) - Math.max(a.lo, b.lo);
    if (cover < (a.hi - a.lo) / 3) continue;
    const gap = b.near >= a.far ? b.near - a.far : a.near >= b.far ? a.near - b.far : -1;
    if (gap < MIN_ACROSS_CM || gap > MAX_ACROSS_CM) continue;
    const side: 1 | -1 = b.near >= a.far ? -1 : 1;
    if (!best || gap < best.gap) best = { gap, side };
  }
  if (best) return best.side;
  let dLo = Infinity;
  let dHi = Infinity;
  for (const path of sketch) {
    const pts = path.points;
    const n = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const s = pts[i];
      const e = pts[(i + 1) % pts.length];
      const flat = a.across ? Math.abs(s.y - e.y) < 0.01 : Math.abs(s.x - e.x) < 0.01;
      if (!flat) continue;
      const c = a.across ? s.y : s.x;
      const s0 = Math.min(a.across ? s.x : s.y, a.across ? e.x : e.y);
      const s1 = Math.max(a.across ? s.x : s.y, a.across ? e.x : e.y);
      if (Math.min(s1, a.hi) - Math.max(s0, a.lo) <= 1) continue;
      dLo = Math.min(dLo, Math.abs(c - a.near));
      dHi = Math.min(dHi, Math.abs(c - a.far));
    }
  }
  if (dLo === Infinity && dHi === Infinity) return 1;
  return dLo <= dHi ? 1 : -1;
}

/** The clamp's footprint centred at `along` on the back of `a`'s face. */
function spotAt(a: Part, along: number, side: 1 | -1, m: Material, each: number): ClampSpot {
  const ph = planH(m);
  const line = side > 0 ? a.far : a.near;
  const off = line + (side * ph) / 2;
  return {
    x: a.across ? along : off,
    y: a.across ? off : along,
    rot: a.across ? (side > 0 ? 0 : 180) : side > 0 ? 270 : 90,
    z: a.z,
    each,
  };
}

/** Every place the rule puts a clamp of `kind`, course by course. */
export function clampSpots(
  pieces: Piece[],
  byId: Map<string, Material>,
  kind: ClampKind,
  m: Material,
  sketch: SketchPath[] = [],
): ClampSpot[] {
  const panels: Part[] = [];
  const fillers: Part[] = [];
  const out: ClampSpot[] = [];
  for (const p of pieces) {
    const pm = byId.get(p.materialId);
    if (!pm || !upright(p)) continue;
    if (pm.category === 'panel') panels.push(part(p, pm));
    else if (pm.category === 'filler') fillers.push(part(p, pm));
    else if (kind === 'frogs' && isOuterCorner300(pm)) {
      // Across the inside of the angle's bend, turned a half-quarter, its body
      // towards the bend - 12 to a corner (the user, 2026-11-08).
      const r = pieceBounds(p, pm);
      out.push({
        x: r.x + r.w / 2,
        y: r.y + r.h / 2,
        rot: normalizeRot(p.rot + 45),
        z: Math.round(p.z ?? 0),
        each: FROGS_PER_OUTER_CORNER,
      });
    }
  }
  for (const a of panels) {
    for (const b of panels) {
      if (a === b || !inLine(a, b) || b.lo < a.hi - TOUCH) continue;
      const each = clampsUpHeight(Math.max(a.m.h, b.m.h));
      if (kind === 'frogs') {
        if (Math.abs(b.lo - a.hi) > TOUCH) continue;
        out.push(spotAt(a, a.hi, backOf(a, panels, sketch), m, each));
      } else {
        // A ჩაკერება filling the whole gap between the two, in the same run -
        // its own long side may run either way (a ჩ5 is narrower than deep).
        const gap = b.lo - a.hi;
        if (gap <= TOUCH) continue;
        const f = fillers.find((f0) => {
          const ff = part(f0.p, f0.m, a.across);
          return (
            ff.z === a.z &&
            Math.abs(ff.lo - a.hi) <= TOUCH &&
            Math.abs(ff.hi - b.lo) <= TOUCH &&
            Math.abs(ff.near - a.near) <= TOUCH + 0.5 &&
            Math.abs(ff.far - a.far) <= TOUCH + 0.5
          );
        });
        if (!f) continue;
        out.push(spotAt(a, (a.hi + b.lo) / 2, backOf(a, panels, sketch), m, each));
      }
    }
  }
  return out;
}

/** The pieces for `spots`, one at each, standing on its course. */
export function clampPieces(m: Material, spots: ClampSpot[], newId: () => string): Piece[] {
  return spots.map((s) => ({
    id: newId(),
    materialId: m.id,
    x: s.x - planW(m) / 2,
    y: s.y - planH(m) / 2,
    rot: s.rot,
    z: s.z,
  }));
}

/** The place a clamp let go near `at` belongs on - the nearest in reach - or null. */
export function snapClamp(
  at: { x: number; y: number },
  m: Material,
  pieces: Piece[],
  byId: Map<string, Material>,
  kind: ClampKind,
  reach: number,
  sketch: SketchPath[] = [],
): ClampSpot | null {
  let best: ClampSpot | null = null;
  let bestD = reach;
  for (const s of clampSpots(pieces, byId, kind, m, sketch)) {
    const d = Math.hypot(s.x - at.x, s.y - at.y);
    if (d <= bestD) {
      best = s;
      bestD = d;
    }
  }
  return best;
}

/**
 * How many a placed clamp stands for: 4 or 2 by the tallest panel it touches
 * on its course - the place it is on - and 2 where it touches none.
 */
export function clampEach(p: Piece, m: Material, pieces: Piece[], byId: Map<string, Material>): number {
  // On a გარე კუთხე 300: the twelve that corner takes.
  if (isFrog(m) && frogsAtOuterCorners([p, ...pieces.filter((q) => q.id !== p.id)], byId).has(p.id)) {
    return FROGS_PER_OUTER_CORNER;
  }
  const r = pieceBounds(p, m);
  const z = Math.round(p.z ?? 0);
  let h = 0;
  for (const q of pieces) {
    const qm = byId.get(q.materialId);
    if (!qm || (qm.category !== 'panel' && qm.category !== 'filler')) continue;
    if (Math.round(q.z ?? 0) !== z) continue;
    const b = pieceBounds(q, qm);
    const touches =
      b.x <= r.x + r.w + TOUCH && b.x + b.w >= r.x - TOUCH && b.y <= r.y + r.h + TOUCH && b.y + b.h >= r.y - TOUCH;
    if (touches) h = Math.max(h, qm.h);
  }
  return h ? clampsUpHeight(h) : 2;
}
