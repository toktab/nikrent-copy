import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds, type Rect } from './geometry';
import { faceBands } from './gap';

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
/** The `Piece.boltsOff` entry on a panel whose waler was taken off by hand. */
export const WALER_OFF = 'waler';
/** The waler's rod is the კონექტორი 40 სმ მთლიანი თავით - one part (the user, 2026-11-08). */
export const WALER_ROD_NAME = 'კონექტორი 40 სმ მთლიანი თავით (წაჭრის გარეშე)';
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
  /**
   * Why it has walers: nothing faces it ('solo'), or what faces it steps in or
   * out - a niche or a pilaster in the other face - so the tie rods cannot
   * hold it straight there ('jog', the user's მეიდ drawing, 2026-11-16).
   */
  reason?: 'solo' | 'jog';
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

  // Everything that can face a panel across a wall, for the jog check.
  // A corner is its two legs, each a face of its own - its box would put the
  // whole L in the face line and hide the step it makes.
  const faces: Face[] = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || !['panel', 'filler', 'corner'].includes(m.category) || !isUpright(p)) continue;
    if (m.category === 'corner' && m.shape !== 'L') continue;
    const r = pieceBounds(p, m);
    const z = Math.round(p.z ?? 0);
    const bands = faceBands(r, m, p.rot, false) ?? [];
    if (m.shape === 'L') {
      for (const b of bands) {
        faces.push({
          r: b.axis === 'u' ? { x: r.x, y: b.from, w: r.w, h: b.to - b.from } : { x: b.from, y: r.y, w: b.to - b.from, h: r.h },
          z,
          axis: b.axis,
        });
      }
    } else faces.push({ r, z, axis: bands[0]?.axis ?? null });
  }

  const out: SoloPanel[] = [];
  for (const a of panels) {
    // A waler taken off this panel by hand (selected and deleted) - see
    // `Piece.boltsOff`; ავტომატურად თავიდან დასმა puts it back.
    if (a.p.boltsOff?.includes(WALER_OFF)) continue;
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
    if (partner) {
      const jog = facesJog(a, faces);
      if (jog) {
        out.push({
          piece: a.p,
          material: a.m,
          walers: walersFor(a.m),
          box: a.r,
          across: a.across,
          // Away from the concrete: the far side from what faces it.
          back: jog.side > 0 ? -1 : 1,
          reason: 'jog',
        });
      }
      continue;
    }
    out.push({
      piece: a.p,
      material: a.m,
      walers: walersFor(a.m),
      box: a.r,
      across: a.across,
      back: backOf(a.r, a.across, sketch),
      reason: 'solo',
    });
  }
  return out;
}

/** A step in the face opposite has to be at least this deep to need a waler, cm. */
const JOG_MIN_CM = 5;
/** ...and run at least this far along the panel either way, cm. */
const JOG_MIN_RUN_CM = 10;

type Face = { r: Rect; z: number; axis: 'u' | 'v' | null };

/**
 * Whether what stands across the wall from a panel steps in or out along it -
 * the face opposite has a niche or a pilaster (two შიდა კუთხე with a short
 * panel set back between them). The tie rods there cannot hold the panel
 * straight: the rod spots do not line up across the step, and where they
 * would, a corner profile is in the way. So it takes walers across its back,
 * like a panel with nothing facing it (the user, 2026-11-16: "here it needs a
 * waler", the first picture of მეიდ).
 *
 * Read by sampling along the panel: how far it is, at each point, to the
 * nearest face piece across (panels, ჩაკერება, corners), on the side the
 * wall is on. Two distances more than JOG_MIN_CM apart, each held for
 * JOG_MIN_RUN_CM or more, is a step. A plain wall, a corner (the corner's leg
 * is flush with the face) or a lap past the end are one distance, or nothing.
 */
function facesJog(
  a: { p: Piece; r: Rect; across: boolean; z: number },
  faces: Face[],
): { side: 1 | -1 } | null {
  const lo = a.across ? a.r.x : a.r.y;
  const hi = a.across ? a.r.x + a.r.w : a.r.y + a.r.h;
  const near = a.across ? a.r.y : a.r.x;
  const far = a.across ? a.r.y + a.r.h : a.r.x + a.r.w;
  let best: { side: 1 | -1; runs: number[] } | null = null;
  for (const side of [1, -1] as const) {
    const dists: number[] = [];
    for (let s = lo + 2.5; s < hi - 2; s += 5) {
      let d = Infinity;
      for (const f of faces) {
        if (Math.abs(f.z - a.z) > 1) continue;
        // Only faces lying the panel's way: a leg across the wall is not a face it faces.
        if (f.axis && f.axis !== (a.across ? 'u' : 'v')) continue;
        const f0 = a.across ? f.r.x : f.r.y;
        const f1 = a.across ? f.r.x + f.r.w : f.r.y + f.r.h;
        if (s <= f0 || s >= f1) continue;
        const fNear = a.across ? f.r.y : f.r.x;
        const fFar = a.across ? f.r.y + f.r.h : f.r.x + f.r.w;
        const gap = side > 0 ? fNear - far : near - fFar;
        if (gap >= MIN_ACROSS_CM && gap <= MAX_ACROSS_CM) d = Math.min(d, gap);
      }
      if (Number.isFinite(d)) dists.push(Math.round(d));
    }
    if (dists.length && (!best || dists.length > best.runs.length)) best = { side, runs: dists };
  }
  if (!best) return null;
  // Distances held for long enough to be a face, not a sliver.
  const held = new Map<number, number>();
  for (const d of best.runs) held.set(d, (held.get(d) ?? 0) + 5);
  const faced = [...held].filter(([, run]) => run >= JOG_MIN_RUN_CM).map(([d]) => d);
  if (faced.length < 2) return null;
  return Math.max(...faced) - Math.min(...faced) >= JOG_MIN_CM ? { side: best.side } : null;
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

export function walerTotals(solo: SoloPanel[], placed: Array<{ each: number }> = []): WalerTotals {
  const by = new Map<number, number>();
  for (const s of solo) by.set(s.walers, (by.get(s.walers) ?? 0) + 1);
  // Placed by hand count the same way, place by place (the user, 2026-11-16).
  for (const p of placed) by.set(p.each, (by.get(p.each) ?? 0) + 1);
  const walers = solo.reduce((n, s) => n + s.walers, 0) + placed.reduce((n, p) => n + p.each, 0);
  const rods = walers * WALER_RODS_EACH;
  return {
    panels: solo.length + placed.length,
    walers,
    rods,
    locks: rods,
    nuts: rods,
    groups: [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each),
  };
}

/** The catalog waler for a panel this wide: the shortest that spans it, else the longest there is. */
export function walerMaterialFor(materials: Iterable<Material>, spanCm: number): Material | undefined {
  const all = [...materials].filter((m) => m.category === 'waler').sort((a, b) => a.w - b.w);
  return all.find((m) => m.w >= spanCm - 0.5) ?? all[all.length - 1];
}

/**
 * Walers put down by hand from the catalog (the user, 2026-11-16: placed ones
 * were never counted). One on the plan stands for all of them up the panel it
 * is against - 3 by a 300, 2 by a 150 / 90 - like a worked-out one; against
 * nothing, it is taken as one.
 */
export function placedWalers(
  pieces: Piece[],
  byId: Map<string, Material>,
): Array<{ piece: Piece; material: Material; each: number }> {
  const panels = pieces.flatMap((p) => {
    const m = byId.get(p.materialId);
    return m?.category === 'panel' ? [{ r: pieceBounds(p, m), m }] : [];
  });
  const out: Array<{ piece: Piece; material: Material; each: number }> = [];
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || m.category !== 'waler') continue;
    const r = pieceBounds(p, m);
    // Within a few cm of a panel's back: that panel's height says how many.
    const reach = 8;
    const by = panels.find(
      (q) =>
        r.x < q.r.x + q.r.w + reach &&
        r.x + r.w > q.r.x - reach &&
        r.y < q.r.y + q.r.h + reach &&
        r.y + r.h > q.r.y - reach,
    );
    out.push({ piece: p, material: m, each: by ? walersFor(by.m) : 1 });
  }
  return out;
}

/**
 * Every waler by catalog size - the worked-out ones sized to the panel they
 * cross, the placed ones as they are - for the ჭანჭიკები menu and the PDF.
 */
export function walerSizes(
  solo: SoloPanel[],
  placed: Array<{ material: Material; each: number }>,
  materials: Iterable<Material>,
): Array<{ material: Material; count: number }> {
  const list = [...materials];
  const by = new Map<string, { material: Material; count: number }>();
  const add = (m: Material | undefined, n: number) => {
    if (!m) return;
    const had = by.get(m.id) ?? { material: m, count: 0 };
    had.count += n;
    by.set(m.id, had);
  };
  for (const s of solo) add(walerMaterialFor(list, s.across ? s.box.w : s.box.h), s.walers);
  for (const p of placed) add(p.material, p.each);
  return [...by.values()].sort((a, b) => a.material.w - b.material.w);
}
