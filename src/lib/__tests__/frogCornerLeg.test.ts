import { describe, expect, it } from 'vitest';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import { clampSpots } from '../clamps';
import { pieceBounds } from '../geometry';
import { faceBands } from '../gap';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
const frog = byId.get('acc-frog')!;
const corner = byId.get('corner-inner-20x20x300')!;

describe('ბაყაყი where an inside corner leg runs straight on into a panel (the user, 2026-11-16)', () => {
  it('puts one at the leg end', () => {
    const c: Piece = { id: 'c', materialId: corner.id, x: 0, y: 0, rot: 0 };
    const r = pieceBounds(c, corner);
    // The horizontal leg of the L, and a panel carrying straight on from its free end.
    const leg = (faceBands(r, corner, 0, false) ?? []).find((b) => b.axis === 'u')!;
    const panel: Piece = { id: 'p', materialId: 'panel-60x300', x: r.x + r.w, y: leg.from, rot: 0 };
    const spots = clampSpots([c, panel], byId, 'frogs', frog);
    expect(spots).toHaveLength(1);
    expect(spots[0].x).toBeCloseTo(r.x + r.w);
    expect(spots[0].each).toBe(4);
  });
  it('none for a panel standing square against the leg end (a კონექტორი place)', () => {
    const c: Piece = { id: 'c', materialId: corner.id, x: 0, y: 0, rot: 0 };
    const r = pieceBounds(c, corner);
    const panel: Piece = { id: 'p', materialId: 'panel-60x300', x: r.x + r.w, y: r.y - 60, rot: 90 };
    expect(clampSpots([c, panel], byId, 'frogs', frog).filter((s) => s.each !== 12)).toHaveLength(0);
  });
});

import { findBolts } from '../bolts';

describe('a კონექტორი where an inside corner leg ends on a panel set square to it (the bottom case)', () => {
  it('is a T', () => {
    const c: Piece = { id: 'c', materialId: corner.id, x: 0, y: 0, rot: 0 };
    const panel: Piece = { id: 'p', materialId: 'panel-60x300', x: -20, y: -pieceBounds({ id: 'q', materialId: 'panel-60x300', x: 0, y: 0, rot: 0 }, byId.get('panel-60x300')!).h, rot: 0 };
    const bolts = findBolts([c, panel], byId);
    expect(bolts).toHaveLength(1);
    expect(bolts[0].kind).toBe('tee');
  });
});
