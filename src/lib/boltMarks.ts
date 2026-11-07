import type { Material, Piece } from '../types';
import { EVERY_KIND, type KindsOn } from './boltKinds';
import { soloPanels, WALER_RODS_EACH } from './walers';
import { cornerConnectorSpots } from './cornerConnectors';
import { isConnector, isPanelHolder, normalizeRot, planW } from './geometry';
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

export function planMarks(pieces: Piece[], byId: Map<string, Material>, on: KindsOn = EVERY_KIND): PlanMarks {
  return {
    // No connector marks: connectors are placed by the ჭანჭიკები button, as pieces
    // - see `connectorCount`.
    connectors: [],
    // A kind that is not on the drawing has no marks either - see boltKinds.ts.
    rods: on.rods ? once(openRods(pieces, byId, true), (r) => `${r.dir}:${Math.round(r.x)}:${Math.round(r.y)}`) : [],
    nuts: on.nuts && on.rods ? once(openRodEnds(pieces, byId), endKey) : [],
    latches: on.latches ? once(openLatches(pieces, byId, true), (l) => `${Math.round(l.x)}:${Math.round(l.y)}`) : [],
  };
}

/** How long a worked-out rod is drawn: the catalog rod that would go there, tip to tip. */
export function markedRodLength(materials: Material[], rod: Rod): number {
  const span = rod.to - rod.from;
  const m = rodMaterialFor(materials, span);
  return m ? Math.max(m.w, m.h) : span + ROD_OVERHANG_CM * 2;
}

/** Which of the placeable ჭანჭიკი kinds a material is, if any. */
export type BoltKindName = 'connectors' | 'rods' | 'nuts' | 'latches' | 'holders';

export function boltKindOf(m: Material): BoltKindName | null {
  if (isConnector(m)) return 'connectors';
  if (isRod(m)) return 'rods';
  if (isNut(m)) return 'nuts';
  if (isLatch(m)) return 'latches';
  if (isPanelHolder(m)) return 'holders';
  return null;
}

/**
 * How many of each kind the drawing needs - worked out and placed, every
 * course. With `on`, only the kinds the drawing has on (boltKinds.ts), read
 * off the same groups the menu shows.
 */
export function boltTotals(
  pieces: Piece[],
  byId: Map<string, Material>,
  on?: KindsOn,
): Record<BoltKindName, number> {
  if (on) {
    const g = boltGroups(pieces, byId, on);
    const sum = (list: BoltGroup[]) => list.reduce((n, x) => n + x.places * x.each, 0);
    return {
      connectors: sum(g.connectors),
      rods: sum(g.rods),
      nuts: sum(g.nuts),
      latches: sum(g.latches),
      holders: sum(g.holders),
    };
  }
  return {
    connectors: connectorCount(pieces, byId),
    rods: rodCount(pieces, byId),
    nuts: nutCount(pieces, byId),
    latches: latchCount(pieces, byId),
    holders: pieces.filter((p) => {
      const m = byId.get(p.materialId);
      return !!m && isPanelHolder(m);
    }).length,
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
export function boltGroups(
  pieces: Piece[],
  byId: Map<string, Material>,
  on: KindsOn = EVERY_KIND,
): Record<BoltKindName, BoltGroup[]> {
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

  // ქანჩი + დისკო by the rule, not by what stands on the plan: as many at each
  // end of a შტირი spot as rods go up it, and one at every კონექტორი - see
  // `nutCount`, whose total this has to match.
  // Only what the drawing has on goes into the ქანჩი + დისკო: no nut for a
  // rod or a connector that is not there.
  const nuts: Array<[string, number]> = !on.nuts ? [] : [
    ...(on.rods ? rods : []).flatMap(([k, n]): Array<[string, number]> => [
      [`${k}:a`, n],
      [`${k}:b`, n],
    ]),
    ...(on.connectors ? connectors : []).map(([k, n]): [string, number] => [`c:${k}`, n]),
    // ...and one on each ვოლერის შტირი, two to a waler.
    ...(on.walers ? soloPanels(pieces, byId) : []).map((s): [string, number] => [
      `w:${Math.round(s.box.x)}:${Math.round(s.box.y)}:${Math.round(s.piece.z ?? 0)}`,
      s.walers * WALER_RODS_EACH,
    ]),
    // ...and one on the outer end of each კუთხის კონექტორი 25 სმ and each
    // half-head შტირი 40 სმ.
    // (Not the inside-corner ones: those take the small ბარაშკა.)
    ...cornerConnectorSpots(pieces, byId)
      .filter((s) => !s.inner && (s.filler === 10 ? on.halfHead : on.cornerConnectors))
      .map((s): [string, number] => [`cc:${s.dir}:${Math.round(s.at)}:${Math.round(s.outer.x)}:${Math.round(s.outer.y)}`, s.count]),
  ];

  const latches: Array<[string, number]> = [
    ...openLatches(pieces, byId).map((s): [string, number] => [spotKey(s), s.levels.length]),
    ...placed(isLatch).map(({ p, m }): [string, number] => [spotKey(pieceCentre(p, m)), 1]),
  ];

  // პანელის ბეტონზე სამაგრი: only what was placed, one each - nothing worked out.
  const holders: Array<[string, number]> = placed(isPanelHolder).map(({ p, m }): [string, number] => [
    `${spotKey(pieceCentre(p, m))}:${Math.round(p.z ?? 0)}`,
    1,
  ]);

  return {
    connectors: on.connectors ? grouped(connectors) : [],
    rods: on.rods ? grouped(rods) : [],
    nuts: grouped(nuts),
    latches: on.latches ? grouped(latches) : [],
    holders: on.holders ? grouped(holders) : [],
  };
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
    holders: r.holders !== false,
  };
}
