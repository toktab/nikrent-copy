import { describe, expect, it } from 'vitest';
import { solveLayout, type LayoutVariant } from '../layoutSolver';
import { findCornerRods, findRods } from '../bolts';
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

describe('a შტირი where an inside corner leg ends (the user, 2026-11-16 - not a 40 სმ head)', () => {
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
    const pieces = apply([], v);
    // No 40 სმ head worked out there any more...
    expect(findCornerRods(pieces, byId)).toHaveLength(0);
    // ...a tie rod instead, 5 up the 300, next to each corner on the long walls.
    const rods = findRods(pieces, byId).filter((r) => r.corner);
    expect(rods).toHaveLength(4);
    expect(rods.every((r) => r.count === 5)).toBe(true);
    const at = (x: number, y: number) => rods.some((r) => r.dir === 'v' && r.x === x && r.y === y);
    expect([at(540, 310), at(1020, 310), at(540, 620), at(1020, 620)]).toEqual([true, true, true, true]);
    // ...and every rod still goes through one wall only, a 20 cm wall: a 60.
    expect(rods.every((r) => r.to - r.from < 40)).toBe(true);
    expect(rods.every((r) => (r.wall ?? 0) <= 20)).toBe(true);
  });
});
