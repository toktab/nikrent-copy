import { describe, expect, it } from 'vitest';
import { boltTotals } from '../boltMarks';
import { pieceCentre, rodCount } from '../bolts';
import { materializeBolts, replaceKindOf, replacementsFor, replacePieces } from '../replace';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const mat = (id: string) => byId.get(id)!;
let n = 0;
const newId = () => `n${n++}`;
const put = (materialId: string, x: number, y: number): Piece => ({ id: `p${n++}`, materialId, x, y, rot: 0 });

// Two faces of a wall along x with a joint at x 90 on each: one rod spot, five up.
const wall = () => [
  put('panel-90x300', 0, 0),
  put('panel-90x300', 90, 0),
  put('panel-90x300', 0, 30),
  put('panel-90x300', 90, 30),
];

describe('what a piece can be replaced with', () => {
  it('is the same ჭანჭიკი kind, or the same catalog category', () => {
    const rods = replacementsFor([mat('rod-60')], SEED_MATERIALS);
    expect(rods.map((m) => m.id)).toEqual(['rod-60', 'rod-80', 'rod-100', 'rod-150']);
    expect(replacementsFor([mat('panel-90x300')], SEED_MATERIALS).every((m) => m.category === 'panel')).toBe(true);
    expect(replaceKindOf(mat('corner-inner-20x20x300'))).toBe('corner:inner');
  });

  it('is nothing when the selection mixes kinds', () => {
    expect(replacementsFor([mat('rod-60'), mat('panel-90x300')], SEED_MATERIALS)).toEqual([]);
  });
});

describe('turning a ჭანჭიკი kind into pieces so it can be selected', () => {
  it('places every rod a mark stands for, and the count stays the same', () => {
    const pieces = wall();
    const before = rodCount(pieces, byId);
    const { pieces: after, added } = materializeBolts(pieces, byId, SEED_MATERIALS, 'rods', newId);
    expect(added).toHaveLength(5);
    expect(rodCount(after, byId)).toBe(before);
    expect(boltTotals(after, byId)).toEqual(boltTotals(pieces, byId));
  });

  it('does the same for the nuts and the ჩამკეტი fix', () => {
    const pieces = wall();
    const totals = boltTotals(pieces, byId);
    const nuts = materializeBolts(pieces, byId, SEED_MATERIALS, 'nuts', newId);
    expect(nuts.added).toHaveLength(totals.nuts);
    const latches = materializeBolts(pieces, byId, SEED_MATERIALS, 'latches', newId);
    expect(latches.added).toHaveLength(totals.latches);
    expect(boltTotals(latches.pieces, byId)).toEqual(totals);
  });
});

describe('replacing', () => {
  it('swaps a rod for a longer one in the same spot, at the same height', () => {
    const { pieces, added } = materializeBolts(wall(), byId, SEED_MATERIALS, 'rods', newId);
    const out = replacePieces(pieces, new Set(added), mat('rod-80'), byId);
    const rods = out.filter((p) => added.includes(p.id));
    expect(rods.every((p) => p.materialId === 'rod-80')).toBe(true);
    const was = pieces.find((p) => p.id === added[0])!;
    const now = rods.find((p) => p.id === added[0])!;
    expect(pieceCentre(now, mat('rod-80'))).toEqual(pieceCentre(was, mat('rod-60')));
    expect((now.z ?? 0) + mat('rod-80').h / 2).toBe((was.z ?? 0) + mat('rod-60').h / 2);
    // Still on its spot, so no worked-out rod comes back beside it.
    expect(rodCount(out, byId)).toBe(5);
  });

  it('leaves what was not selected alone', () => {
    const pieces = wall();
    const out = replacePieces(pieces, new Set([pieces[0].id]), mat('panel-60x300'), byId);
    expect(out[0].materialId).toBe('panel-60x300');
    expect(out.slice(1)).toEqual(pieces.slice(1));
  });
});
