import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { soloPanels } from '../walers';
import { pieceBounds } from '../geometry';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const p = (id: string, mat: string, x: number, y: number): Piece => ({ id, materialId: mat, x, y, rot: 0 });

describe('walers where the face across steps (the user, მეიდ, 2026-11-16)', () => {
  it('a panel facing a niche in the other face gets walers; plain wall panels do not', () => {
    const depth = pieceBounds(p('t', 'panel-60x300', 0, 0), byId.get('panel-60x300')!).h;
    const top = [
      p('a', 'panel-30x300', 0, 0),
      p('b', 'panel-60x300', 30, 0),
      p('c', 'panel-60x300', 90, 0),
      p('d', 'panel-60x300', 150, 0),
      p('e', 'panel-60x300', 210, 0),
      p('f', 'panel-30x300', 270, 0),
    ];
    const wall = 30;
    const y = depth + wall;
    const bottom = [
      p('g', 'panel-60x300', 0, y),
      p('h', 'panel-60x300', 60, y),
      // the niche: this stretch of the face stands 30 cm further out
      p('i', 'panel-60x300', 120, y + 30),
      p('j', 'panel-60x300', 180, y),
      p('k', 'panel-60x300', 240, y),
    ];
    const solo = soloPanels([...top, ...bottom], byId);
    const jog = solo.filter((s) => s.reason === 'jog').map((s) => s.piece.id).sort();
    expect(jog).toEqual(['c', 'd']);
    // the walers go on the outside of the top face
    expect(solo.find((s) => s.piece.id === 'c')?.back).toBe(-1);
  });
});
