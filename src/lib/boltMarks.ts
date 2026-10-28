import type { Material, Piece } from '../types';
import { isConnector, normalizeRot, planW } from './geometry';
import {
  CONNECTORS_PER_JOINT,
  connectorCount,
  latchCount,
  isLatch,
  isNut,
  isRod,
  nutCount,
  openBolts,
  openLatches,
  openRodEnds,
  openRods,
  outward,
  pieceCentre,
  rodCount,
  rodEnds,
  ROD_OVERHANG_CM,
  rodMaterialFor,
  type Bolt,
  type BoltKinds,
  type LatchSpot,
  type Rod,
  type RodEnd,
} from './bolts';

/**
 * The worked-out ჭანჭიკები as the plan shows them: one mark per spot.
 *
 * A stacked course has its joints, rods and rod ends in the same place in plan
 * as the course under it, so each spot is kept once - the counts (`boltTotals`)
 * still go course by course. The screen's mark layer and the printed sheet both
 * draw from this, so the two can never disagree about what is there.
 */
export interface PlanMarks {
  /** კონექტორი joints nothing has been placed on */
  connectors: Bolt[];
  /** შტირი spots nothing has been placed in */
  rods: Rod[];
  /** rod ends with no ქანჩი + დისკო placed on them */
  nuts: RodEnd[];
  /** panel joints with no ჩამკეტი fix placed on them */
  latches: LatchSpot[];
}

function once<T>(items: T[], key: (t: T) => string): T[] {
  const seen = new Set<string>();
  return items.filter((t) => {
    const k = key(t);
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

const endKey = (e: RodEnd) => `${Math.round(e.x)}:${Math.round(e.y)}:${e.rot}`;

export function planMarks(pieces: Piece[], byId: Map<string, Material>): PlanMarks {
  return {
    // No connector marks: connectors are placed by the ჭანჭიკები button, as pieces
    // - see `connectorCount`.
    connectors: [],
    rods: once(openRods(pieces, byId, true), (r) => `${r.dir}:${Math.round(r.x)}:${Math.round(r.y)}`),
    nuts: once(openRodEnds(pieces, byId), endKey),
    latches: once(openLatches(pieces, byId, true), (l) => `${Math.round(l.x)}:${Math.round(l.y)}`),
  };
}

/** How long a worked-out rod is drawn: the catalog rod that would go there, tip to tip. */
export function markedRodLength(materials: Material[], rod: Rod): number {
  const span = rod.to - rod.from;
  const m = rodMaterialFor(materials, span);
  return m ? Math.max(m.w, m.h) : span + ROD_OVERHANG_CM * 2;
}

/** Which of the four ჭანჭიკი kinds a material is, if any. */
export type BoltKindName = 'connectors' | 'rods' | 'nuts' | 'latches';

export function boltKindOf(m: Material): BoltKindName | null {
  if (isConnector(m)) return 'connectors';
  if (isRod(m)) return 'rods';
  if (isNut(m)) return 'nuts';
  if (isLatch(m)) return 'latches';
  return null;
}

/** How many of each kind the drawing needs - worked out and placed, every course. */
export function boltTotals(pieces: Piece[], byId: Map<string, Material>): Record<BoltKindName, number> {
  return {
    connectors: connectorCount(pieces, byId),
    rods: rodCount(pieces, byId),
    nuts: nutCount(pieces, byId),
    latches: latchCount(pieces, byId),
  };
}

/**
 * Places on the plan and how many go at each: `places` marks you can count
 * from above, `each` of them at every one of those - one above the other, in
 * 3D. A kind with more than one size of stack has a group for each.
 */
export interface BoltGroup {
  places: number;
  each: number;
}

const spotKey = (p: { x: number; y: number }) => `${Math.round(p.x)}:${Math.round(p.y)}`;

/** Units at plan spots, grouped by how many each spot holds, biggest stacks first. */
function grouped(units: Array<[string, number]>): BoltGroup[] {
  const at = new Map<string, number>();
  for (const [k, n] of units) if (n > 0) at.set(k, (at.get(k) ?? 0) + n);
  const by = new Map<number, number>();
  for (const n of at.values()) by.set(n, (by.get(n) ?? 0) + 1);
  return [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each);
}

/**
 * Every kind as the ჭანჭიკები menu reads it: so many places on the plan, so
 * many at each, so many in all (the user, 2026-10-23). Worked out and placed
 * alike, every course - the total is the same number `boltTotals` gives.
 */
export function boltGroups(pieces: Piece[], byId: Map<string, Material>): Record<BoltKindName, BoltGroup[]> {
  const placed = (is: (m: Material) => boolean) =>
    pieces.flatMap((p) => {
      const m = byId.get(p.materialId);
      return m && is(m) ? [{ p, m }] : [];
    });

  const connectors: Array<[string, number]> = [
    ...placed(isConnector).map(({ p, m }): [string, number] => [spotKey(pieceCentre(p, m)), CONNECTORS_PER_JOINT]),
  ];
  const rods: Array<[string, number]> = [
    ...openRods(pieces, byId).map((r): [string, number] => [spotKey(r), r.count]),
    ...placed(isRod).map(({ p, m }): [string, number] => [spotKey(pieceCentre(p, m)), 1]),
  ];

  // A placed nut belongs to the rod end it stands on, so a part-placed end is
  // still one place.
  const ends = rodEnds(pieces, byId);
  const endKey = (e: RodEnd) => `${spotKey(e)}:${normalizeRot(e.rot)}`;
  const onEnd = new Map<string, number>();
  const nuts: Array<[string, number]> = [];
  for (const { p, m } of placed(isNut)) {
    const c = pieceCentre(p, m);
    const o = outward(p.rot);
    const at = { x: c.x - (o.x * planW(m)) / 2, y: c.y - (o.y * planW(m)) / 2 };
    const end = ends.find(
      (e) => normalizeRot(e.rot) === normalizeRot(p.rot) && Math.hypot(e.x - at.x, e.y - at.y) <= 3,
    );
    const k = end ? endKey(end) : `nut:${spotKey(c)}`;
    if (end) onEnd.set(k, (onEnd.get(k) ?? 0) + 1);
    nuts.push([k, 1]);
  }
  for (const e of ends) nuts.push([endKey(e), Math.max(0, e.levels.length - (onEnd.get(endKey(e)) ?? 0))]);

  const latches: Array<[string, number]> = [
    ...openLatches(pieces, byId).map((s): [string, number] => [spotKey(s), s.levels.length]),
    ...placed(isLatch).map(({ p, m }): [string, number] => [spotKey(pieceCentre(p, m)), 1]),
  ];

  return { connectors: grouped(connectors), rods: grouped(rods), nuts: grouped(nuts), latches: grouped(latches) };
}

/** A kind's groups as the menu writes them: "14 × 5 = 70", or "12 × 5 + 2 × 2 = 64". */
export function groupsText(groups: BoltGroup[]): string {
  const total = groups.reduce((n, g) => n + g.places * g.each, 0);
  if (!groups.length) return '0';
  return `${groups.map((g) => `${g.places} × ${g.each}`).join(' + ')} = ${total}`;
}

/**
 * Which kinds the plan shows - each one switched on and off by itself from the
 * ჭანჭიკები menu. Anything not a clear `false` shows, so a setting saved before
 * a kind existed still shows it.
 */
export function normalizeBoltKinds(raw: unknown): BoltKinds {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return {
    connectors: r.connectors !== false,
    rods: r.rods !== false,
    nuts: r.nuts !== false,
    latches: r.latches !== false,
  };
}
