import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { buildBom } from '../bom';
import { EVERY_KIND } from '../boltKinds';
import type { Piece } from '../../types';

describe('the list counts real parts, not marks (the user, 2026-11-16)', () => {
  it('two კონექტორი marks are 2 × 5', () => {
    const pieces: Piece[] = [
      { id: 'c1', materialId: 'corner-connector', x: 0, y: 0, rot: 0 },
      { id: 'c2', materialId: 'corner-connector', x: 100, y: 0, rot: 0 },
    ];
    const marks = buildBom(SEED_MATERIALS, pieces);
    const real = buildBom(SEED_MATERIALS, pieces, [], '', EVERY_KIND);
    const row = (b: typeof real) => b.groups.flatMap((g) => g.rows).find((r) => r.material.id === 'corner-connector');
    expect(row(marks)?.used).toBe(2);
    expect(row(real)?.used).toBe(10);
  });
});
