import { describe, expect, it } from 'vitest';
import { soloPanels, walerTotals } from '../walers';
import { nutCount, rodCount, connectorCount } from '../bolts';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const put = (id: string, materialId: string, x: number, y: number, z = 0): Piece => ({ id, materialId, x, y, rot: 0, z });

/** ვოლერები - the user, 2026-11-04. */
describe('walers', () => {
  // A 20 cm wall along x: face at y = 0 (panels above it), face at y = 20.
  const twoFaces = [put('a', 'panel-90x300', 0, -9), put('b', 'panel-90x300', 0, 20)];

  it('needs none where a panel faces a panel across the wall', () => {
    expect(soloPanels(twoFaces, byId)).toEqual([]);
  });

  it('needs three up a 300 and two up a 150 or a 90 with nothing facing it', () => {
    const solo = [put('a', 'panel-90x300', 0, -9), put('c', 'panel-60x150', 90, -9), put('d', 'panel-75x090', 150, -9)];
    const t = walerTotals(soloPanels(solo, byId));
    expect(t.panels).toBe(3);
    expect(t.walers).toBe(3 + 2 + 2);
    expect(t.rods).toBe(14);
    expect(t.locks).toBe(14);
    expect(t.nuts).toBe(14);
    expect(t.groups).toEqual([
      { places: 1, each: 3 },
      { places: 2, each: 2 },
    ]);
  });

  it('puts the waler on the back, away from the drawn line', () => {
    const line: SketchPath = { id: 'l', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] };
    // Panel above the line: its face is its bottom edge, its back the top.
    expect(soloPanels([put('a', 'panel-90x300', 0, -9)], byId, [line])[0].back).toBe(-1);
  });

  it('adds a ქანჩი + დისკო on every waler rod to the total', () => {
    const solo = [put('a', 'panel-90x300', 0, -9)];
    expect(nutCount(solo, byId)).toBe(rodCount(solo, byId) * 2 + connectorCount(solo, byId) + 6);
  });
});
