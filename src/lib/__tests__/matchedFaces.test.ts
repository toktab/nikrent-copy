import { describe, expect, it } from 'vitest';
import { solveLayout, wallMates, type LayoutVariant } from '../layoutSolver';
import { findRods } from '../bolts';
import { enclosing, offsetFace, offsetSide, panelSide } from '../outerLines';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

/*
 * The user's ნახაზი 3 (2026-10-23): the გარე line drawn and filled first, the
 * შიდა line made 20 cm in from it and picked alone. Filled blind, the inner
 * face's joints were nowhere near the outer ones and no შტირი could go through
 * the wall - and the two far outer faces were tied across the room instead.
 */

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const OUTER: SketchPath = {
  id: 'outer',
  points: [
    { x: 100, y: 100 },
    { x: 700, y: 100 },
    { x: 700, y: 400 },
    { x: 100, y: 400 },
  ],
  closed: true,
  perimeter: 'outer',
};

const apply = (pieces: Piece[], v: LayoutVariant) => [
  ...pieces.filter((p) => !v.remove.includes(p.id)),
  ...v.add,
];
const solve = (paths: SketchPath[], pieces: Piece[]) =>
  solveLayout({ paths, height: 300, includeCorners: true, materials, pieces, filters: { keepPlaced: true } })
    .variants[0];

describe('the inner face made from a built outer one', () => {
  const outerPieces = apply([], solve([OUTER], []));
  const side = panelSide(OUTER, [OUTER], outerPieces, materials);
  const inner = offsetFace(OUTER, offsetSide(OUTER, side, 'inner'), [20], 'inner')!;
  inner.id = 'inner';

  it('picked alone, brings the outer line round it into the solve', () => {
    expect(enclosing(inner, [OUTER, inner])).toEqual(['outer']);
    // A far bigger line round it is not its wall's other face.
    const site: SketchPath = { ...OUTER, id: 'site', points: OUTER.points.map((p) => ({ x: p.x * 3 - 600, y: p.y * 3 - 600 })) };
    expect(enclosing(inner, [site, inner])).toEqual([]);
  });

  it('is filled with its joints facing the outer ones, so the wall takes შტირი all round', () => {
    const blind = apply(outerPieces, solve([inner], outerPieces));
    const matched = apply(outerPieces, solve([inner, OUTER], outerPieces));
    const across = (pieces: Piece[]) => findRods(pieces, byId).filter((r) => r.to - r.from < 40).length;
    expect(across(matched)).toBeGreaterThan(across(blind));
    // Every rod goes through the one wall - none across the room.
    expect(findRods(matched, byId).every((r) => r.to - r.from < 40)).toBe(true);
    // The outer face is kept as it was built.
    expect(matched.filter((p) => outerPieces.some((q) => q.id === p.id))).toHaveLength(outerPieces.length);
  });

  it('re-solved together, every joint on both faces lines up', () => {
    const both = solveLayout({
      paths: [inner, OUTER],
      height: 300,
      includeCorners: true,
      materials,
      pieces: outerPieces,
      filters: { keepPlaced: false },
    }).variants[0];
    expect(both.unmatched).toBe(0);
    const built = apply(outerPieces, both);
    expect(findRods(built, byId).length).toBeGreaterThan(findRods(apply(outerPieces, solve([inner, OUTER], outerPieces)), byId).length);
  });
});

describe('one wall, one solve', () => {
  const outerPieces = apply([], solve([OUTER], []));
  const side = panelSide(OUTER, [OUTER], outerPieces, materials);
  const inner = { ...offsetFace(OUTER, offsetSide(OUTER, side, 'inner'), [20], 'inner')!, id: 'inner' };
  // Another wall on its own, well away from this one.
  const other: SketchPath = { id: 'other', points: [{ x: 1200, y: 100 }, { x: 1500, y: 100 }] };

  it('picking either face brings in the other, and nothing else', () => {
    const sketch = [OUTER, inner, other];
    expect(wallMates(sketch, ['inner']).sort()).toEqual(['inner', 'outer']);
    expect(wallMates(sketch, ['outer']).sort()).toEqual(['inner', 'outer']);
    expect(wallMates(sketch, ['other'])).toEqual(['other']);
  });

  it('works for open lines and a face drawn in two strokes', () => {
    const top: SketchPath = { id: 'top', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] };
    const a: SketchPath = { id: 'a', points: [{ x: 0, y: 20 }, { x: 150, y: 20 }] };
    const b: SketchPath = { id: 'b', points: [{ x: 150, y: 20 }, { x: 300, y: 20 }] };
    expect(wallMates([top, a, b], ['top']).sort()).toEqual(['a', 'b', 'top']);
  });

  it('with შტირები პირველ რიგში, matches every joint even round a face already built', () => {
    const strict = solveLayout({
      paths: [inner, OUTER],
      height: 300,
      includeCorners: true,
      materials,
      pieces: outerPieces,
      filters: { keepPlaced: true, rodsFirst: true },
    }).variants[0];
    const loose = solve([inner, OUTER], outerPieces);
    expect(strict.unmatched).toBeLessThanOrEqual(loose.unmatched);
  });
});

describe('a შტირი goes through one wall only', () => {
  const put = (materialId: string, x: number, y: number, rot = 0): Piece => ({ id: `${materialId}@${x},${y}`, materialId, x, y, rot, z: 0 });
  // Two faces 91 cm apart with joints lined up at x 90, and a panel between them.
  const far = [put('panel-90x300', 0, 0), put('panel-90x300', 90, 0), put('panel-90x300', 0, 100), put('panel-90x300', 90, 100)];

  it('is not put across a room through the panels standing in it', () => {
    expect(findRods(far, byId)).toHaveLength(1);
    expect(findRods([...far, put('panel-90x300', 45, 50)], byId)).toHaveLength(0);
  });
});
