import { describe, expect, it } from 'vitest';
import { cornerConnectorSpots, cornerConnectorTotals } from '../cornerConnectors';
import { nutCount } from '../bolts';
import { setPanelDepthOverride } from '../geometry';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));

/**
 * An outside corner: a 90 standing across at x 0..9 (turned, y 0..90), a ჩ5
 * against its side at x 9..14 and the run's first 90 at x 14..104 - the run's
 * face band y 81..90. The user's drawing, 2026-11-04.
 */
function corner(filler = 'filler-5x300'): Piece[] {
  setPanelDepthOverride(null); // the catalog's 9 cm
  return [
    { id: 't', materialId: 'panel-90x300', x: -40.5, y: 40.5, rot: 90, z: 0 },
    { id: 'f', materialId: filler, x: 9, y: 81, rot: 0, z: 0 },
    { id: 'r', materialId: 'panel-90x300', x: filler.includes('10x') ? 19 : 14, y: 81, rot: 0, z: 0 },
  ];
}

describe('კუთხის კონექტორი 25 სმ', () => {
  it('goes through the through panel and the ჩ5 into the run, nut outside', () => {
    const spots = cornerConnectorSpots(corner(), byId);
    expect(spots).toHaveLength(1);
    const s = spots[0];
    expect(s.dir).toBe('h');
    expect(s.outer.x).toBeCloseTo(0);
    expect(s.to - s.from).toBe(25);
    expect(s.count).toBe(5);
    const t = cornerConnectorTotals(spots);
    expect(t.connectors).toBe(5);
    expect(t.nuts).toBe(5);
    expect(t.halfHead).toBe(0);
  });

  it('is a half-head შტირი 40 სმ instead where the corner is closed with a ჩ10', () => {
    const spots = cornerConnectorSpots(corner('filler-10x300'), byId);
    expect(spots[0].to - spots[0].from).toBe(40);
    const t = cornerConnectorTotals(spots);
    expect(t.connectors).toBe(0);
    expect(t.halfHead).toBe(5);
    expect(t.nuts).toBe(5);
  });

  it('puts a ქანჩი + დისკო on each into the total', () => {
    const pieces = corner();
    const without = nutCount(pieces.filter((p) => p.id !== 'f'), byId);
    expect(nutCount(pieces, byId)).toBeGreaterThanOrEqual(5);
    expect(nutCount(pieces, byId) - without).toBeGreaterThanOrEqual(5);
  });
});
