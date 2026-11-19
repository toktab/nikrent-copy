import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { formworkCorners, nearestCorner, pieceOutline } from '../measure';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

describe('ხაზვა lands on the corners of the formwork (the user, 2026-11-19)', () => {
  it('finds the corner of a შიდა კუთხე off the 5 cm grid', () => {
    const corner: Piece = { id: 'c', materialId: 'corner-inner-20x20x300', x: 101.5, y: 203, rot: 0 };
    const pts = formworkCorners([corner], byId);
    const real = pieceOutline(corner, byId.get('corner-inner-20x20x300')!);
    expect(pts).toHaveLength(real.length);
    const near = nearestCorner(pts, { x: real[2].x + 2, y: real[2].y - 1 }, 4)!;
    expect(near.x).toBeCloseTo(real[2].x);
    expect(near.y).toBeCloseTo(real[2].y);
  });
  it('never a კონექტორი disc', () => {
    const disc: Piece = { id: 'd', materialId: 'corner-connector', x: 0, y: 0, rot: 0 };
    expect(formworkCorners([disc], byId)).toHaveLength(0);
  });
});
