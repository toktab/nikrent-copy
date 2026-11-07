import { describe, expect, it } from 'vitest';
import { clampEach, clampMaterial, clampPieces, clampSpots } from '../clamps';
import { boltGroups, boltTotals, groupsText } from '../boltMarks';
import { materializeBolts } from '../replace';
import { normalizeKindsOn } from '../boltKinds';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

/** ნიანგი and ბაყაყი (the user, 2026-11-07). */
const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const croc = clampMaterial(SEED_MATERIALS, 'crocodiles')!;
const frog = clampMaterial(SEED_MATERIALS, 'frogs')!;
let n = 0;
const put = (materialId: string, x: number, y: number, rot = 0): Piece => ({ id: `p${n++}`, materialId, x, y, rot });

describe('ნიანგი and ბაყაყი - where they go', () => {
  it('puts a ბაყაყი where two panels meet with nothing between, a ნიანგი where a ჩაკერება is', () => {
    // panel 0-90, panel 90-180, ჩ10 180-190, panel 190-280: all one face along x.
    const pieces = [
      put('panel-90x300', 0, 0),
      put('panel-90x300', 90, 0),
      put('filler-10x300', 180, 0),
      put('panel-90x300', 190, 0),
    ];
    const frogs = clampSpots(pieces, byId, 'frogs', frog);
    const crocs = clampSpots(pieces, byId, 'crocodiles', croc);
    expect(frogs.map((s) => s.x)).toEqual([90]);
    expect(crocs.map((s) => s.x)).toEqual([185]);
    // 4 up a 300.
    expect(frogs[0].each).toBe(4);
    expect(crocs[0].each).toBe(4);
  });

  it('takes 2 up a 150 or a 90', () => {
    const pieces = [put('panel-75x150', 0, 0), put('panel-75x150', 75, 0)];
    expect(clampSpots(pieces, byId, 'frogs', frog)[0].each).toBe(2);
  });

  it('goes on the back of the face, away from the panel facing it across the wall', () => {
    // Inner face at y 0-9, outer face at y 40-49 (9 deep in the seed).
    const pieces = [
      put('panel-90x300', 0, 0),
      put('panel-90x300', 90, 0),
      put('panel-90x300', 0, 40),
      put('panel-90x300', 90, 40),
    ];
    const ys = clampSpots(pieces, byId, 'frogs', frog)
      .map((s) => s.y)
      .sort((a, b) => a - b);
    // Above the top face (its back is -y), below the bottom one.
    expect(ys).toEqual([-2, 51]);
  });

  it('puts nothing where a ჩაკერება is between a panel and a corner', () => {
    const pieces = [put('panel-90x300', 0, 0), put('filler-10x300', 90, 0)];
    expect(clampSpots(pieces, byId, 'crocodiles', croc)).toHaveLength(0);
    expect(clampSpots(pieces, byId, 'frogs', frog)).toHaveLength(0);
  });
});

describe('ნიანგი and ბაყაყი - placed and counted', () => {
  it('the reset puts one at each place, and the menu reads places × 4', () => {
    const pieces = [put('panel-90x300', 0, 0), put('panel-90x300', 90, 0), put('panel-90x300', 180, 0)];
    const out = materializeBolts(pieces, byId, SEED_MATERIALS, 'frogs', () => `n${n++}`).pieces;
    expect(out.filter((p) => p.materialId === frog.id)).toHaveLength(2);
    const on = { ...normalizeKindsOn({}), frogs: true };
    expect(groupsText(boltGroups(out, byId, on).frogs)).toBe('2 × 4 = 8');
    expect(boltTotals(out, byId, on).frogs).toBe(8);
    // ...and not twice on a second run.
    expect(materializeBolts(out, byId, SEED_MATERIALS, 'frogs', () => `n${n++}`).pieces).toHaveLength(out.length);
  });

  it('counts a hand-placed one by the panel it is on', () => {
    const pieces = [put('panel-75x150', 0, 0), put('panel-75x150', 75, 0)];
    const [spot] = clampSpots(pieces, byId, 'frogs', frog);
    const [p] = clampPieces(frog, [spot], () => 'f');
    expect(clampEach(p, frog, [...pieces, p], byId)).toBe(2);
    expect(clampEach({ ...p, x: 500 }, frog, [...pieces, p], byId)).toBe(2);
  });
});
