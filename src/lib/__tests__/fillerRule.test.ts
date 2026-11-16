import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { touchingFillers } from '../problems';
import { spreadFillers } from '../formwork';
import type { Material } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const filler = SEED_MATERIALS.find((m) => m.category === 'filler')!;
const panel = SEED_MATERIALS.find((m) => m.category === 'panel')!;
const opt = (m: Material) => ({ material: m, w: m.w }) as never;

describe('ჩაკერება never against another ჩაკერება', () => {
  it('two fillers side by side are reported', () => {
    const a = { id: 'a', materialId: filler.id, x: 0, y: 0, rot: 0 };
    const b = { id: 'b', materialId: filler.id, x: filler.w, y: 0, rot: 0 };
    expect(touchingFillers([a, b], byId)).toHaveLength(1);
    const c = { id: 'c', materialId: filler.id, x: filler.w + 60, y: 0, rot: 0 };
    expect(touchingFillers([a, c], byId)).toHaveLength(0);
  });
  it('a covered face puts two fillers one at each end, a panel between', () => {
    const out = spreadFillers([opt(panel), opt(panel), opt(filler), opt(filler)]);
    const kinds = out.map((o: { material: Material }) => o.material.category);
    for (let i = 1; i < kinds.length; i++) expect(kinds[i] === 'filler' && kinds[i - 1] === 'filler').toBe(false);
    expect(kinds[0]).toBe('filler');
    expect(kinds[kinds.length - 1]).toBe('filler');
  });
});
