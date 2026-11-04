import { describe, expect, it } from 'vitest';
import { alignPieces } from '../gridAlign';
import { pieceBounds, setPanelDepthOverride } from '../geometry';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

describe('alignPieces', () => {
  it('puts a turned panel placed at 9 cm back on the line at 10, face on the line', () => {
    setPanelDepthOverride(10);
    // Placed against x = 675 when panels were 9 deep: x 666..675. At 10 it
    // spreads to 665.5..675.5 - half a centimetre off every grid line.
    const p: Piece = { id: 'p', materialId: 'panel-60x300', x: 640.5, y: 995.5, rot: 90, z: 0 };
    const line: SketchPath = { id: 'l', points: [{ x: 675, y: 900 }, { x: 675, y: 1200 }] };
    const [q] = alignPieces([p], byId, [line]);
    const b = pieceBounds(q, byId.get(q.materialId)!);
    expect(b.x + b.w).toBe(675);
    expect(b.x).toBe(665);
    expect(Number.isInteger(b.y)).toBe(true);
    setPanelDepthOverride(null);
  });

  it('leaves a piece on whole centimetres where it is', () => {
    const p: Piece = { id: 'p', materialId: 'panel-60x300', x: 100, y: 50, rot: 0, z: 0 };
    expect(alignPieces([p], byId, [])[0]).toBe(p);
  });
});

describe('alignPieces onto the squares', () => {
  it('pulls a panel placed by eye 1 cm off onto the 5 cm squares', () => {
    setPanelDepthOverride(10);
    const p: Piece = { id: 'p', materialId: 'panel-60x300', x: 666, y: 2010, rot: 0, z: 0 };
    const b = pieceBounds(alignPieces([p], byId, [])[0], byId.get('panel-60x300')!);
    expect(b.x).toBe(665);
    expect(b.y).toBe(2010);
    setPanelDepthOverride(null);
  });

  it('leaves one set 2 cm off - that was meant', () => {
    const p: Piece = { id: 'p', materialId: 'panel-60x300', x: 102, y: 50, rot: 0, z: 0 };
    expect(alignPieces([p], byId, [])[0]).toBe(p);
  });
});
