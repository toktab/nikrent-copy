import type { Material, Piece } from '../types';
import { pieceBounds, type Rect } from './geometry';

/**
 * კუთხის კონექტორი 25 სმ at an outside corner (the user, 2026-11-04 - the
 * part he used to call a "25-იანი შტირი").
 *
 * At a lapped outside corner one face runs through and the other butts into
 * it. Where the butting run closes against the through panel with a ჩ5, a
 * 25 cm connector goes in from the outside of the through panel, through it
 * and the ჩ5, into the first panel of the run, and a ქანჩი + დისკო goes on
 * its outer end:
 *
 *        ○|█|░|▓▓▓▓▓▓▓▓▓       ○ ქანჩი + დისკო   █ through panel
 *         ═══════════            ░ ჩ5   ▓ the run's first panel   ═ connector
 *
 * It only fits a ჩ5. Where the corner is closed with a ჩ10 the part is a
 * 40 cm შტირი with a HALF head - წაჭრილი გაიკა - never the full-head one,
 * again with a ქანჩი + დისკო on its outer end (the user, 2026-11-04).
 *
 * At an INSIDE corner the run's filler - ჩ5 or ჩ10, either works - closes
 * against the corner profile, and the same 25 cm connector goes from inside
 * the profile's leg, through the filler, into the run's first panel. Its end
 * takes the SMALL ბარაშკა (გილზა + გაიკა), not the big ქანჩი + დისკო, so it
 * is counted apart and not in the ქანჩი + დისკო total.
 *
 * How many go up one corner is not given; taken as the შტირი spacing - 5 up a
 * 300, 2 up a 150 or 90 - until said otherwise.
 */

export const CORNER_CONNECTOR_NAME = 'კუთხის კონექტორი 25 სმ';
export const CORNER_CONNECTOR_CM = 25;
export const HALF_HEAD_NAME = 'შტირი 40 სმ ნახევარი თავით (წაჭრილი გაიკა)';
/** The uncut one, at an inside corner's leg end - see `findCornerRods` in bolts.ts. */
export const FULL_HEAD_NAME = 'შტირი 40 სმ მთლიანი თავით (წაჭრის გარეშე)';
export const INNER_CONNECTOR_NAME = 'კუთხის კონექტორი 25 სმ - შიდა კუთხე';
export const SMALL_NUT_NAME = 'ბარაშკა პატარა (გილზა + გაიკა)';
/** How far into the corner profile's leg the inside-corner connector starts, cm. */
const INTO_PROFILE_CM = 3;
export const HALF_HEAD_CM = 40;

/** How long the part through a corner closed with this filler is, cm. */
const partLength = (filler: number) => (filler === 10 ? HALF_HEAD_CM : CORNER_CONNECTOR_CM);

/** Touching, for pieces placed by hand on a 5 cm grid, cm. */
const TOUCH = 1.5;

export interface CornerConnectorSpot {
  /** where it runs in plan: from `from` to `to` along `dir`, at `at` across it */
  dir: 'h' | 'v';
  at: number;
  from: number;
  to: number;
  /** the end with the ქანჩი + დისკო, outside the through panel */
  outer: { x: number; y: number };
  /** the filler there: 5 takes the connector, 10 the half-head შტირი (outside corners) */
  filler: number;
  /** an inside corner: the connector starts in the corner profile, small ბარაშკა on it */
  inner: boolean;
  /** connectors up this spot, every course counted */
  count: number;
  /**
   * What to mark to take this spot off by hand: the `Piece.boltsOff` entry on
   * each filler it goes through, every course (see `CC_OFF`).
   */
  takeOff: Array<{ id: string; tag: string }>;
  /** one put down by hand from the catalog - the piece draws itself; see `placedHeadSpots` */
  placed?: boolean;
}

/** A catalog წაჭრილი გაიკა - the half-head შტირი 40 სმ. */
export function isHalfHeadPart(m: Material): boolean {
  return m.id === 'rod-40-half-head' || (m.name.includes('ნახევარი თავით') && !m.name.includes('ვოლერ'));
}

/** A catalog whole-head შტირი 40 სმ (წაჭრის გარეშე) - not the waler's own. */
export function isFullHeadPart(m: Material): boolean {
  return m.id === 'corner-connector-40' || (m.name.includes('მთლიანი თავით') && !m.name.includes('ვოლერ'));
}

/**
 * How many a hand-placed 40 სმ stands for: 5 by a 300 panel it touches, 2 by
 * a 150 / 90, 2 touching none - the same as one worked out at that place.
 */
export function placedHeadCount(p: Piece, m: Material, pieces: Piece[], byId: Map<string, Material>): number {
  const r = pieceBounds(p, m);
  const z = Math.round(p.z ?? 0);
  let h = 0;
  for (const q of pieces) {
    const qm = byId.get(q.materialId);
    if (!qm || (qm.category !== 'panel' && qm.category !== 'filler' && qm.category !== 'corner')) continue;
    if (Math.round(q.z ?? 0) !== z) continue;
    const b = pieceBounds(q, qm);
    if (b.x <= r.x + r.w + 2 && b.x + b.w >= r.x - 2 && b.y <= r.y + r.h + 2 && b.y + b.h >= r.y - 2) h = Math.max(h, qm.h);
  }
  return h ? connectorsUp(h) : 2;
}

/**
 * The წაჭრილი გაიკა put down by hand from the catalog (the user, 2026-11-07:
 * everything in ჭანჭიკები can be placed from the left menu), as spots - so the
 * menu, the ქანჩი + დისკო, the PDF and the info count them with the worked-out
 * ones. Not drawn by the marks layer: the piece is drawn as its disc itself.
 */
function placedHalfHeads(pieces: Piece[], byId: Map<string, Material>): CornerConnectorSpot[] {
  const out: CornerConnectorSpot[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !isHalfHeadPart(m)) continue;
    const r = pieceBounds(p, m);
    const c = { x: r.x + r.w / 2, y: r.y + r.h / 2 };
    out.push({
      dir: 'h',
      at: c.y,
      from: c.x - 1,
      to: c.x + 1,
      outer: c,
      filler: 10,
      inner: false,
      count: placedHeadCount(p, m, pieces, byId),
      takeOff: [],
      placed: true,
    });
  }
  return out;
}

/** A filler's `Piece.boltsOff` entry for a corner connector taken off at its low (-1) or high (1) end. */
export const CC_OFF = 'cc:';

const isUpright = (p: Piece) => {
  const r = ((p.rot % 90) + 90) % 90;
  return r < 0.5 || r > 89.5;
};

/** How many go up one course of the given height - the შტირი spacing. */
export function connectorsUp(heightCm: number): number {
  return heightCm >= 250 ? 5 : 2;
}

/**
 * Every outside-corner closure on the drawing: a ჩ5 or ჩ10 between a through
 * panel standing across the run and the run's first panel.
 */
export function cornerConnectorSpots(pieces: Piece[], byId: Map<string, Material>): CornerConnectorSpot[] {
  type Box = { p: Piece; m: Material; r: Rect; z: number };
  const boxes: Box[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || (m.category !== 'panel' && m.category !== 'filler') || !isUpright(p)) continue;
    boxes.push({ p, m, r: pieceBounds(p, m), z: Math.round(p.z ?? 0) });
  }
  const panels = boxes.filter((b) => b.m.category === 'panel');
  // The inside-corner profiles - an L standing in the notch.
  const profiles: Box[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || m.category !== 'corner' || m.shape !== 'L' || !m.name.includes('შიდა') || !isUpright(p)) continue;
    profiles.push({ p, m, r: pieceBounds(p, m), z: Math.round(p.z ?? 0) });
  }
  const near = (a: number, b: number) => Math.abs(a - b) <= TOUCH;
  const overlap = (a0: number, a1: number, b0: number, b1: number) => Math.min(a1, b1) - Math.max(a0, b0);

  const out = new Map<string, CornerConnectorSpot>();
  for (const f of boxes) {
    if (f.m.category !== 'filler' || (f.m.w !== 5 && f.m.w !== 10)) continue;
    // The filler's width runs along the run: along x unturned, along y turned.
    const turned = Math.round(((f.p.rot % 180) + 180) % 180) === 90;
    const dir: 'h' | 'v' = turned ? 'v' : 'h';
    const lo = dir === 'h' ? f.r.x : f.r.y;
    const hi = dir === 'h' ? f.r.x + f.r.w : f.r.y + f.r.h;
    const c0 = dir === 'h' ? f.r.y : f.r.x;
    const c1 = dir === 'h' ? f.r.y + f.r.h : f.r.x + f.r.w;

    for (const [end, other, sign] of [
      [lo, hi, -1],
      [hi, lo, 1],
    ] as const) {
      // Taken off by hand at this end - see `CC_OFF`.
      if (f.p.boltsOff?.includes(CC_OFF + sign)) continue;
      // The through panel: standing ACROSS the run, its side on this end.
      const through = panels.find((a) => {
        if (Math.abs(a.z - f.z) > 1) return false;
        const across = dir === 'h' ? a.r.h > a.r.w : a.r.w > a.r.h;
        if (!across) return false;
        const face = sign < 0 ? (dir === 'h' ? a.r.x + a.r.w : a.r.y + a.r.h) : dir === 'h' ? a.r.x : a.r.y;
        const span = dir === 'h' ? [a.r.y, a.r.y + a.r.h] : [a.r.x, a.r.x + a.r.w];
        return near(face, end) && overlap(span[0], span[1], c0, c1) > (c1 - c0) / 2;
      });
      // Or an inside corner's profile, its leg on this end.
      const profile = through
        ? undefined
        : profiles.find((a) => {
            if (Math.abs(a.z - f.z) > 1) return false;
            const face = sign < 0 ? (dir === 'h' ? a.r.x + a.r.w : a.r.y + a.r.h) : dir === 'h' ? a.r.x : a.r.y;
            const span = dir === 'h' ? [a.r.y, a.r.y + a.r.h] : [a.r.x, a.r.x + a.r.w];
            return near(face, end) && overlap(span[0], span[1], c0, c1) > (c1 - c0) / 2;
          });
      if (!through && !profile) continue;
      // ...and the run's first panel on the filler's other end, along the run.
      const run = panels.find((b) => {
        if (Math.abs(b.z - f.z) > 1) return false;
        const along = dir === 'h' ? b.r.w > b.r.h : b.r.h > b.r.w;
        if (!along) return false;
        const face = sign < 0 ? (dir === 'h' ? b.r.x : b.r.y) : dir === 'h' ? b.r.x + b.r.w : b.r.y + b.r.h;
        const span = dir === 'h' ? [b.r.y, b.r.y + b.r.h] : [b.r.x, b.r.x + b.r.w];
        return near(face, other) && overlap(span[0], span[1], c0, c1) > (c1 - c0) / 2;
      });
      if (!run) continue;

      // From the outside of the through panel - or from a little way into the
      // profile's leg - the part's length into the run.
      const outside = through
        ? sign < 0
          ? dir === 'h'
            ? through.r.x
            : through.r.y
          : dir === 'h'
            ? through.r.x + through.r.w
            : through.r.y + through.r.h
        : end + sign * INTO_PROFILE_CM;
      const inner = outside - sign * (profile ? CORNER_CONNECTOR_CM : partLength(f.m.w));
      const at = (c0 + c1) / 2;
      const key = `${dir}:${Math.round(at)}:${Math.round(outside)}`;
      const had = out.get(key);
      const count = connectorsUp(f.m.h);
      const tag = { id: f.p.id, tag: CC_OFF + sign };
      if (had) {
        had.count += count;
        had.takeOff.push(tag);
        continue;
      }
      out.set(key, {
        dir,
        at,
        from: Math.min(outside, inner),
        to: Math.max(outside, inner),
        outer: dir === 'h' ? { x: outside, y: at } : { x: at, y: outside },
        filler: f.m.w,
        inner: !!profile,
        count,
        takeOff: [tag],
      });
    }
  }
  return [...out.values(), ...placedHalfHeads(pieces, byId)];
}

export interface CornerConnectorTotals {
  /** connectors, every course, at ჩ5 closures */
  connectors: number;
  /** a ქანჩი + დისკო on each */
  nuts: number;
  /** ჩ5 closures by connectors each, for "4 × 5 = 20" */
  groups: Array<{ places: number; each: number }>;
  /** შტირი 40 სმ with a half head, every course, at ჩ10 closures */
  halfHead: number;
  /** ჩ10 closures by half-head rods each */
  halfGroups: Array<{ places: number; each: number }>;
  /** 25 cm connectors at inside corners, every course */
  innerConnectors: number;
  /** a small ბარაშკა on each - not a ქანჩი + დისკო */
  smallNuts: number;
  innerGroups: Array<{ places: number; each: number }>;
}

export function cornerConnectorTotals(spots: CornerConnectorSpot[]): CornerConnectorTotals {
  const grouped = (list: CornerConnectorSpot[]) => {
    const by = new Map<number, number>();
    for (const s of list) by.set(s.count, (by.get(s.count) ?? 0) + 1);
    return [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each);
  };
  const fit = spots.filter((s) => !s.inner && s.filler === 5);
  const half = spots.filter((s) => !s.inner && s.filler === 10);
  const inside = spots.filter((s) => s.inner);
  const innerConnectors = inside.reduce((n, s) => n + s.count, 0);
  const connectors = fit.reduce((n, s) => n + s.count, 0);
  const halfHead = half.reduce((n, s) => n + s.count, 0);
  return {
    connectors,
    // A ქანჩი + დისკო on the outer end of every one of either.
    nuts: connectors + halfHead,
    groups: grouped(fit),
    halfHead,
    halfGroups: grouped(half),
    innerConnectors,
    smallNuts: innerConnectors,
    innerGroups: grouped(inside),
  };
}
