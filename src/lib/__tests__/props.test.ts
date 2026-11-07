import { describe, expect, it } from 'vitest';
import { propMaterial, propPieces, snapPost } from '../posts';
import { boltKindOf, boltTotals } from '../boltMarks';
import { normalizeKindsOn } from '../boltKinds';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

/** დგარი და თავი (the user, 2026-11-07). */
const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
let n = 0;
const put = (materialId: string, x: number, y: number): Piece => ({ id: `p${n++}`, materialId, x, y, rot: 0 });

describe('დგარი და თავი', () => {
  it('is a ჭანჭიკი kind, the small one for 150 / 90, the big one for 300', () => {
    expect(boltKindOf(byId.get('post-100')!)).toBe('props');
    expect(propMaterial(SEED_MATERIALS, 300)!.id).toBe('post-200');
    expect(propMaterial(SEED_MATERIALS, 150)!.id).toBe('post-100');
    expect(propMaterial(SEED_MATERIALS, 90)!.id).toBe('post-100');
  });

  it('the reset puts one on the back of each lone panel, square on its face, and none twice', () => {
    const pieces = [put('panel-90x300', 0, 0), put('panel-75x150', 200, 0)];
    const props = propPieces(pieces, byId, SEED_MATERIALS, [], () => `n${n++}`);
    expect(props.map((p) => p.materialId)).toEqual(['post-200', 'post-100']);
    // Head on the panel's back face (y 9 in the seed), running away from it.
    expect(props.every((p) => p.y === 9 && p.rot === 0)).toBe(true);
    expect(propPieces([...pieces, ...props], byId, SEED_MATERIALS, [], () => 'x')).toHaveLength(0);
    expect(boltTotals([...pieces, ...props], byId, { ...normalizeKindsOn({}), props: true }).props).toBe(2);
  });

  it('puts none where a panel faces the panel across the wall', () => {
    const pieces = [put('panel-90x300', 0, 0), put('panel-90x300', 0, 30)];
    expect(propPieces(pieces, byId, SEED_MATERIALS, [], () => 'x')).toHaveLength(0);
  });

  it('sticks to the face it is let go by', () => {
    const spot = snapPost({ x: 45, y: 30 }, byId.get('post-100')!, [put('panel-90x300', 0, 0)], byId, 40, 5);
    expect(spot).toMatchObject({ y: 9, rot: 0 });
  });
});
