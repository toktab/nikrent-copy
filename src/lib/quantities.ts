import type { Material, Piece } from '../types';
import { boltInfoOf } from './boltInfo';
import { boltTotals } from './boltMarks';
import type { KindsOn } from './boltKinds';
import { connectorMaterial, fullHeadTotals, isRod, rodSizes } from './bolts';
import { isCrocodile, isFrog } from './clamps';
import {
  cornerConnectorSpots,
  cornerConnectorTotals,
  isHalfHeadPart,
  isSmallNutPart,
  placedHeadCount,
  smallNutTotals,
} from './cornerConnectors';
import { isLatch, isNut, isPanelHolder } from './geometry';
import { placedWalers, soloPanels, walerSizes, walerTotals } from './walers';

/**
 * The REAL quantity of every ჭანჭიკი the drawing needs, by catalog part.
 *
 * One mark on the plan is often several on site - five კონექტორები up a 300,
 * three ვოლერები, four ბაყაყი - and the delivery list counted the marks: two
 * კონექტორი symbols went out as "2" instead of 2 × 5 (the user, 2026-11-16 -
 * "don't let this kind of error occur again"). This is the one place that
 * turns marks into parts, worked out and placed together, the way the
 * ჭანჭიკები menu counts them, and the list, the PDF and the stock check all
 * read it.
 *
 * Keyed by material id. A material in it is counted from here and never from
 * its pieces on the plan; see `isCountedPart`.
 */
export function boltQuantities(
  pieces: Piece[],
  byId: Map<string, Material>,
  materials: Material[],
  on: KindsOn,
): Map<string, number> {
  const out = new Map<string, number>();
  const add = (m: Material | undefined, n: number) => {
    if (!m || !(n > 0)) return;
    out.set(m.id, (out.get(m.id) ?? 0) + n);
  };
  const first = (is: (m: Material) => boolean, id?: string) =>
    (id ? materials.find((m) => m.id === id) : undefined) ?? materials.find(is);

  const totals = boltTotals(pieces, byId, on);
  const spots = cornerConnectorSpots(pieces, byId);
  const cc = cornerConnectorTotals(spots);

  // კონექტორი 25 სმ: the T-joint ones and the corner ones are one part (2026-11-07).
  add(
    connectorMaterial(materials),
    totals.connectors + (on.cornerConnectors ? cc.connectors : 0) + (on.innerConnectors ? cc.innerConnectors : 0),
  );

  // შტირი by length - by the wall it goes through (rodSizes), or as placed.
  if (on.rods) for (const s of rodSizes(pieces, byId, materials)) add(s.material, s.count);
  else
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (m && isRod(m)) add(m, 1);
    }

  add(first(isNut, 'acc-nut-washer'), totals.nuts);
  add(first(isLatch, 'acc-latch-fix'), totals.latches);
  add(first(isPanelHolder, 'acc-panel-concrete-anchor'), totals.holders);
  add(first(isCrocodile, 'acc-latch-adjustable'), totals.crocodiles);
  add(first(isFrog, 'acc-frog'), totals.frogs);

  // დგარი და თავი: real pieces, one each - by which one.
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m?.category === 'post') add(m, 1);
  }

  // ვოლერი by size, and what each one takes.
  const solo = on.walers ? soloPanels(pieces, byId) : [];
  const placed = placedWalers(pieces, byId);
  for (const s of walerSizes(solo, placed, materials)) add(s.material, s.count);
  const w = walerTotals(solo, placed);
  add(first((m) => m.name.includes('ჩასაკეტი'), 'waler-rod-lock'), w.locks);

  // The two 40 სმ heads and the small ბარაშკა.
  add(
    materials.find((m) => m.id === 'corner-connector-40'),
    fullHeadTotals(pieces, byId, { fullHead: on.fullHead, walers: on.walers }).total,
  );
  let halfPlaced = 0;
  let smallPlaced = 0;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (m && isHalfHeadPart(m)) halfPlaced += placedHeadCount(p, m, pieces, byId);
    if (m && isSmallNutPart(m)) smallPlaced += placedHeadCount(p, m, pieces, byId);
  }
  add(first(isHalfHeadPart, 'rod-40-half-head'), (on.halfHead ? cc.halfHead : 0) + halfPlaced);
  const small = on.smallNuts ? smallNutTotals(spots, pieces, byId).total : smallPlaced;
  add(first(isSmallNutPart, 'acc-small-barashka'), small);

  return out;
}

/**
 * A part whose quantity is `boltQuantities`', not the number of its pieces on
 * the plan: every ჭანჭიკი kind, the ვოლერი beams and the შტირი.
 */
export function isCountedPart(m: Material): boolean {
  return boltInfoOf(m) !== null || m.category === 'waler' || isRod(m);
}
