import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds, type Rect } from './geometry';

/**
 * ვოლერი - the steel beam that stiffens a panel standing on its own (the
 * user, 2026-11-04).
 *
 * A wall's two faces brace each other: the panels stand opposite one another
 * and the tie rods pull them together. A panel with NOTHING facing it across
 * the wall - one face built against ground, an old wall, or simply left
 * single-sided - has no partner to brace it, and a waler goes across its back
 * instead, bolted through:
 *
 *   - 3 walers up a 300-high panel, 2 up a 150 or a 90;
 *   - each waler: 2 ვოლერის შტირი 40 სმ (full head), a თავის ჩასაკეტი on the
 *     head of each, and a ქანჩი + დისკო on each.
 *
 * Counted per panel with no partner, course by course, the way every other
 * ჭანჭიკი is counted. Nothing is placed - like the worked-out rods, walers
 * are a count and a mark on the plan.
 */

/** A panel needs a partner across the wall no further than this, edge to edge, cm. */
const MAX_ACROSS_CM = 130;
/** Two faces closer than this are one face (a run of panels), not a wall. */
const MIN_ACROSS_CM = 3;
/** How much of a panel the one opposite has to cover to brace it. */
const MIN_COVER = 1 / 3;

export const WALER_RODS_EACH = 2;
export const WALER_ROD_NAME = 'ვოლერის შტირი 40 სმ (მთლიანი თავით)';
export const WALER_LOCK_NAME = 'ვოლერის შტირის თავის ჩასაკეტი';

/** Walers up one panel: three up a 300, two up anything shorter (150, 90). */
export function walersFor(m: Material): number {
  return m.h >= 250 ? 3 : 2;
}

/** A panel with nothing facing it, and where its waler goes. */
export interface SoloPanel {
  piece: Piece;
  material: Material;
  walers: number;
  /** the panel's footprint in plan */
  box: Rect;
  /** its long side runs along x */
  across: boolean;
  /** which way its back faces, away from the concrete: +1 towards +y / +x, -1 the other way */
  back: 1 | -1;
}

const isUpright = (p: Piece) => Math.abs(((p.rot % 90) + 90) % 90) < 0.5 || Math.abs(((p.rot % 90) + 90) % 90) > 89.5;

/** Every panel on the drawing with no panel facing it across a wall. */
export function soloPanels(pieces: Piece[], byId: Map<string, Material>, sketch: SketchPath[] = []): SoloPanel[] {
  const panels: Array<{ p: Piece; m: Material; r: Rect; across: boolean; z: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || m.category !== 'panel' || !isUpright(p)) continue;
    const r = pieceBounds(p, m);
    panels.push({ p, m, r, across: r.w >= r.h, z: Math.round(p.z ?? 0) });
  }

  const out: SoloPanel[] = [];
  for (const a of panels) {
    const aLo = a.across ? a.r.x : a.r.y;
    const aHi = a.across ? a.r.x + a.r.w : a.r.y + a.r.h;
    const aNear = a.across ? a.r.y : a.r.x;
    const aFar = a.across ? a.r.y + a.r.h : a.r.x + a.r.w;
    let partner = false;
    for (const b of panels) {
      if (b === a || b.across !== a.across || Math.abs(b.z - a.z) > 1) continue;
      const bLo = b.across ? b.r.x : b.r.y;
      const bHi = b.across ? b.r.x + b.r.w : b.r.y + b.r.h;
      const cover = Math.min(aHi, bHi) - Math.max(aLo, bLo);
      if (cover < (aHi - aLo) * MIN_COVER) continue;
      const bNear = b.across ? b.r.y : b.r.x;
      const bFar = b.across ? b.r.y + b.r.h : b.r.x + b.r.w;
      const gap = bNear >= aFar ? bNear - aFar : aNear >= bFar ? aNear - bFar : -1;
      if (gap >= MIN_ACROSS_CM && gap <= MAX_ACROSS_CM) {
        partner = true;
        break;
      }
    }
    if (partner) continue;
    out.push({
      piece: a.p,
      material: a.m,
      walers: walersFor(a.m),
      box: a.r,
      across: a.across,
      back: backOf(a.r, a.across, sketch),
    });
  }
  return out;
}

/**
 * The panel's back: the long side NOT on a drawn line. The face stands on the
 * line - that is what a line is (docs/FORMWORK.md) - so the waler goes on the
 * other side. With no line by it either way, the far side in +y / +x.
 */
function backOf(r: Rect, across: boolean, sketch: SketchPath[]): 1 | -1 {
  const lo = across ? r.y : r.x;
  const hi = across ? r.y + r.h : r.x + r.w;
  const from = across ? r.x : r.y;
  const to = across ? r.x + r.w : r.y + r.h;
  let dLo = Infinity;
  let dHi = Infinity;
  for (const path of sketch) {
    const pts = path.points;
    const n = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      const legAcross = Math.abs(a.y - b.y) < 0.01;
      const legAlong = Math.abs(a.x - b.x) < 0.01;
      if (across ? !legAcross : !legAlong) continue;
      const c = across ? a.y : a.x;
      const s0 = Math.min(across ? a.x : a.y, across ? b.x : b.y);
      const s1 = Math.max(across ? a.x : a.y, across ? b.x : b.y);
      if (Math.min(s1, to) - Math.max(s0, from) <= 1) continue;
      dLo = Math.min(dLo, Math.abs(c - lo));
      dHi = Math.min(dHi, Math.abs(c - hi));
    }
  }
  if (dLo === Infinity && dHi === Infinity) return 1;
  return dLo <= dHi ? 1 : -1;
}

/** What the drawing needs for its walers, all of it. */
export interface WalerTotals {
  /** panels with nothing facing them */
  panels: number;
  walers: number;
  /** ვოლერის შტირი 40 სმ, full head */
  rods: number;
  /** a თავის ჩასაკეტი on each rod */
  locks: number;
  /** a ქანჩი + დისკო on each rod */
  nuts: number;
  /** panels by walers each, for "12 × 3 + 4 × 2 = 44" */
  groups: Array<{ places: number; each: number }>;
}

export function walerTotals(solo: SoloPanel[]): WalerTotals {
  const by = new Map<number, number>();
  for (const s of solo) by.set(s.walers, (by.get(s.walers) ?? 0) + 1);
  const walers = solo.reduce((n, s) => n + s.walers, 0);
  const rods = walers * WALER_RODS_EACH;
  return {
    panels: solo.length,
    walers,
    rods,
    locks: rods,
    nuts: rods,
    groups: [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each),
  };
}
