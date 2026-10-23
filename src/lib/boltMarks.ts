import type { Material, Piece } from '../types';
import { isConnector } from './geometry';
import {
  connectorCount,
  isLatch,
  isNut,
  isRod,
  nutCount,
  openBolts,
  openRodEnds,
  openRods,
  rodCount,
  ROD_OVERHANG_CM,
  rodMaterialFor,
  type Bolt,
  type BoltKinds,
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
  };
}

/** How long a worked-out rod is drawn: the catalog rod that would go there, tip to tip. */
export function markedRodLength(materials: Material[], rod: Rod): number {
  const span = rod.to - rod.from;
  const m = rodMaterialFor(materials, span);
  return m ? Math.max(m.w, m.h) : span + ROD_OVERHANG_CM * 2;
}

/**
 * Which of the three ჭანჭიკი kinds a material is, if any. The wing piece on
 * every rod end is part of the ქანჩი + დისკო, so a ჩამკეტი fix placed by hand
 * is no kind of its own: it shows and hides with the nuts it sits on, and is
 * not counted in them.
 */
export type BoltKindName = 'connectors' | 'rods' | 'nuts';

export function boltKindOf(m: Material): BoltKindName | null {
  if (isConnector(m)) return 'connectors';
  if (isRod(m)) return 'rods';
  if (isNut(m) || isLatch(m)) return 'nuts';
  return null;
}

/** How many of each kind the drawing needs - worked out and placed, every course. */
export function boltTotals(pieces: Piece[], byId: Map<string, Material>): Record<BoltKindName, number> {
  return {
    connectors: connectorCount(pieces, byId),
    rods: rodCount(pieces, byId),
    nuts: nutCount(pieces, byId),
  };
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
  };
}
