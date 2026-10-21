import type { Material, Piece } from '../types';
import { isConnector } from './geometry';
import {
  connectorCount,
  isLatch,
  isNut,
  isRod,
  LATCH_FIT,
  latchCount,
  nutCount,
  openBolts,
  openRodEnds,
  openRods,
  rodCount,
  ROD_OVERHANG_CM,
  rodMaterialFor,
  type Bolt,
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
  /** rod ends with no ჩამკეტი fix placed on them */
  latches: RodEnd[];
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
    connectors: once(openBolts(pieces, byId, true), (b) => `${Math.round(b.x)}:${Math.round(b.y)}`),
    rods: once(openRods(pieces, byId, true), (r) => `${r.dir}:${Math.round(r.x)}:${Math.round(r.y)}`),
    nuts: once(openRodEnds(pieces, byId), endKey),
    latches: once(openRodEnds(pieces, byId, LATCH_FIT), endKey),
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
