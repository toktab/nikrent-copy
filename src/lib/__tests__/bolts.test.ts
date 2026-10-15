import { describe, expect, it } from 'vitest';
import { findBolts } from '../bolts';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
let n = 0;
const put = (materialId: string, x: number, y: number, rot = 0, z?: number): Piece => ({
  id: `p${n++}`,
  materialId,
  x,
  y,
  rot,
  ...(z !== undefined ? { z } : {}),
});

/**
 * A panel standing on its end, so its footprint is 9 wide and `w` tall with its
 * top-left at (x, y). Turned about its centre, so the stored x/y are offset.
 */
const upright = (materialId: string, x: number, y: number, z?: number): Piece => {
  const w = byId.get(materialId)!.w;
  return put(materialId, x - (w - 9) / 2, y + (w - 9) / 2, 90, z);
};

describe('findBolts', () => {
  it('puts one bolt where a panel ends against the face of another - the T', () => {
    const top = put('panel-90x300', 0, 0); // 0..90 across, 0..9 deep
    const leg = upright('panel-60x300', 40, 9); // 40..49 across, 9..69 down
    const bolts = findBolts([top, leg], byId);
    expect(bolts).toHaveLength(1);
    expect(bolts[0]).toMatchObject({ kind: 'tee', x: 44.5, y: 9 });
  });

  it('bolts the lap at an outside corner the same way', () => {
    const through = put('panel-90x300', 0, 0);
    const butt = upright('panel-60x300', 81, 9); // flush with the through panel's end
    expect(findBolts([through, butt], byId)).toHaveLength(1);
  });

  it('does not bolt two panels in line', () => {
    expect(findBolts([put('panel-90x300', 0, 0), put('panel-60x300', 90, 0)], byId)).toHaveLength(0);
  });

  it('does not bolt panels that only nearly touch', () => {
    const top = put('panel-90x300', 0, 0);
    expect(findBolts([top, upright('panel-60x300', 40, 14)], byId)).toHaveLength(0);
  });

  it('bolts an inner corner where its leg ends on a ჩაკერება 5', () => {
    const corner = put('corner-inner-20x20x300', 0, 0); // foot ends at x 20, y 11..20
    const filler = put('filler-5x300', 20, 11);
    const bolts = findBolts([corner, filler], byId);
    expect(bolts).toHaveLength(1);
    expect(bolts[0]).toMatchObject({ kind: 'corner', x: 20, y: 15.5 });
  });

  it('and on a ჩაკერება 10 at the end of the other leg, turned', () => {
    const corner = put('corner-inner-20x20x300', 0, 0, 90);
    // Turned 90° the L's upright leg end moves to the right side, x 20, y 0..9.
    const filler = put('filler-10x300', 20, 0);
    expect(findBolts([corner, filler], byId)).toEqual([
      expect.objectContaining({ kind: 'corner', x: 20, y: 4.5 }),
    ]);
  });

  it('does not bolt a filler that is beside the corner but not at a leg end', () => {
    const corner = put('corner-inner-20x20x300', 0, 0);
    const filler = put('filler-5x300', 20, 0); // against the box, not the foot
    expect(findBolts([corner, filler], byId)).toHaveLength(0);
  });

  it('counts each course of a stacked wall', () => {
    const pieces = [0, 300].flatMap((z) => [
      put('panel-90x300', 0, 0, 0, z),
      upright('panel-60x300', 40, 9, z),
    ]);
    expect(findBolts(pieces, byId)).toHaveLength(2);
  });
});
