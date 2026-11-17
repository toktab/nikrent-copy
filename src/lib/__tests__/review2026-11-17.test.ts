import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { findProblems } from '../problems';
import { pieceContacts } from '../contacts';
import { remainingRows } from '../remaining';
import { EVERY_KIND } from '../boltKinds';
import { columnTypeId, columnTypeName } from '../templates';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

describe('review fixes (the user, 2026-11-17)', () => {
  const panels: Piece[] = [
    { id: 'a', materialId: 'panel-60x300', x: 0, y: 0, rot: 0 },
    { id: 'b', materialId: 'panel-60x300', x: 60, y: 0, rot: 0 },
  ];
  const connector: Piece = { id: 'c', materialId: 'corner-connector', x: 56, y: 1, rot: 0 };

  it('a კონექტორი on a seam is no overlap and gets no touching marks', () => {
    const report = findProblems({ materials: SEED_MATERIALS, pieces: [...panels, connector], sketch: [] });
    expect(report.problems.filter((p) => p.kind === 'overlap')).toHaveLength(0);
    expect(pieceContacts([...panels, connector], byId)).toHaveLength(1);
  });

  it('ნაშთი counts the real quantity, and a ჭანჭიკი with no stock entered is not short', () => {
    const r = remainingRows(SEED_MATERIALS, [...panels, connector], { kinds: EVERY_KIND });
    const row = r.groups.flatMap((g) => g.rows).find((x) => x.material.id === 'corner-connector')!;
    expect(row.used).toBe(5);
    expect(row.short).toBe(false);
  });

  it('a column from the კოლონა button is a priced type by its size', () => {
    const id = columnTypeId({ sectionX: 60, sectionY: 40, height: 300 });
    expect(id).toBe(columnTypeId({ sectionX: 40, sectionY: 60, height: 300 }));
    expect(columnTypeName(id)).toBe('კოლონა 40×60, 300 სმ');
  });
});

import { alignPieces } from '../gridAlign';

describe('grid alignment on open (2026-11-17)', () => {
  it('puts a panel half a cm off back on the squares, and leaves a კონექტორი on its seam', () => {
    const panel: Piece = { id: 'p', materialId: 'panel-60x300', x: 700.45, y: 940, rot: 0 };
    const conn: Piece = { id: 'c', materialId: 'corner-connector', x: 756.3, y: 941.2, rot: 0 };
    const [p, c] = alignPieces([panel, conn], byId, [], 5);
    expect(p.x).toBeCloseTo(700);
    expect(c).toBe(conn);
  });
});
