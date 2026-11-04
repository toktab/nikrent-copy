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
 * It only fits a ჩ5. With a ჩ10 there a different part is needed (not known
 * yet), so those spots are reported and not counted.
 *
 * How many go up one corner is not given; taken as the შტირი spacing - 5 up a
 * 300, 2 up a 150 or 90 - until said otherwise.
 */

export const CORNER_CONNECTOR_NAME = 'კუთხის კონექტორი 25 სმ';
export const CORNER_CONNECTOR_CM = 25;

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
  /** the filler there: 5 takes the connector, 10 needs another part */
  filler: number;
  /** connectors up this spot, every course counted */
  count: number;
}

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
      // The through panel: standing ACROSS the run, its side on this end.
      const through = panels.find((a) => {
        if (Math.abs(a.z - f.z) > 1) return false;
        const across = dir === 'h' ? a.r.h > a.r.w : a.r.w > a.r.h;
        if (!across) return false;
        const face = sign < 0 ? (dir === 'h' ? a.r.x + a.r.w : a.r.y + a.r.h) : dir === 'h' ? a.r.x : a.r.y;
        const span = dir === 'h' ? [a.r.y, a.r.y + a.r.h] : [a.r.x, a.r.x + a.r.w];
        return near(face, end) && overlap(span[0], span[1], c0, c1) > (c1 - c0) / 2;
      });
      if (!through) continue;
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

      // From the outside of the through panel, CORNER_CONNECTOR_CM into the run.
      const outside =
        sign < 0 ? (dir === 'h' ? through.r.x : through.r.y) : dir === 'h' ? through.r.x + through.r.w : through.r.y + through.r.h;
      const inner = outside - sign * CORNER_CONNECTOR_CM;
      const at = (c0 + c1) / 2;
      const key = `${dir}:${Math.round(at)}:${Math.round(outside)}`;
      const had = out.get(key);
      const count = connectorsUp(f.m.h);
      if (had) {
        had.count += count;
        continue;
      }
      out.set(key, {
        dir,
        at,
        from: Math.min(outside, inner),
        to: Math.max(outside, inner),
        outer: dir === 'h' ? { x: outside, y: at } : { x: at, y: outside },
        filler: f.m.w,
        count,
      });
    }
  }
  return [...out.values()];
}

export interface CornerConnectorTotals {
  /** connectors, every course, at ჩ5 closures */
  connectors: number;
  /** a ქანჩი + დისკო on each */
  nuts: number;
  /** ჩ5 closures by connectors each, for "4 × 5 = 20" */
  groups: Array<{ places: number; each: number }>;
  /** ჩ10 closures - a different part goes there, not counted */
  wide: number;
}

export function cornerConnectorTotals(spots: CornerConnectorSpot[]): CornerConnectorTotals {
  const fit = spots.filter((s) => s.filler === 5);
  const by = new Map<number, number>();
  for (const s of fit) by.set(s.count, (by.get(s.count) ?? 0) + 1);
  const connectors = fit.reduce((n, s) => n + s.count, 0);
  return {
    connectors,
    nuts: connectors,
    groups: [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each),
    wide: spots.length - fit.length,
  };
}
