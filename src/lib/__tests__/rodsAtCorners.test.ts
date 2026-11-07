import { describe, expect, it } from 'vitest';
import { solveLayout, type LayoutVariant } from '../layoutSolver';
import { findRods } from '../bolts';
import { offsetFace, offsetSide, panelSide } from '../outerLines';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

/*
 * The user's room (2026-11-07): the inner line drawn, the outer one made from
 * it, both filled, შტირები asked for. Each inside corner's leg ends on the
 * first panel of the run, straight across from a joint in the outer face - and
 * that pair took no შტირი; he circled the four.
 */
const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));
const INNER: SketchPath = {
  id: 'inner',
  points: [
    { x: 520, y: 320 },
    { x: 1040, y: 320 },
    { x: 1040, y: 610 },
    { x: 520, y: 610 },
  ],
  closed: true,
  perimeter: 'inner',
};
const apply = (pieces: Piece[], v: LayoutVariant) => [...pieces.filter((p) => !v.remove.includes(p.id)), ...v.add];

describe('a შტირი where an inside corner leg ends', () => {
  it('ties the leg end to the outer joint across from it, at all four corners', () => {
    const side = panelSide(INNER, [INNER], [], materials);
    const outer = offsetFace(INNER, offsetSide(INNER, side, 'outer'), [20], 'outer')!;
    outer.id = 'outer';
    const v = solveLayout({
      paths: [INNER, outer],
      height: 300,
      includeCorners: true,
      materials,
      pieces: [],
      filters: { keepPlaced: true },
    }).variants[0];
    const rods = findRods(apply([], v), byId);
    // Next to each corner, on the long walls: x 540 and 1020, top and bottom.
    const at = (x: number, y: number) => rods.some((r) => r.dir === 'v' && r.x === x && r.y === y);
    expect([at(540, 310), at(1020, 310), at(540, 620), at(1020, 620)]).toEqual([true, true, true, true]);
    // ...and every rod still goes through one wall only.
    expect(rods.every((r) => r.to - r.from < 40)).toBe(true);
  });
});
