import { describe, expect, it } from 'vitest';
import { BOLT_INFO, boltInfoOf, type BoltInfoId } from '../boltInfo';
import { SEED_MATERIALS } from '../../data/seedCatalog';

/** The card every ჭანჭიკი gets in the რეკომენდაცია tab (the user, 2026-11-07). */
describe('ჭანჭიკი cards', () => {
  const ids = Object.keys(BOLT_INFO) as BoltInfoId[];

  it('say for each what it is, what for, the 300 and 150 / 90 counts and an example', () => {
    for (const id of ids) {
      const i = BOLT_INFO[id];
      for (const field of [i.name, i.what, i.use, i.per300, i.per150, i.example, i.placing]) expect(field.length).toBeGreaterThan(0);
    }
  });

  it('link only to cards that exist, both ways where one needs another', () => {
    for (const id of ids) {
      for (const n of BOLT_INFO[id].needs) expect(ids).toContain(n.id);
      for (const u of BOLT_INFO[id].usedBy) expect(ids).toContain(u);
    }
    expect(BOLT_INFO.rods.needs.map((n) => n.id)).toEqual(['nuts', 'latches']);
    expect(BOLT_INFO.nuts.usedBy).toContain('rods');
  });

  it('open from every ჭანჭიკი in the catalog', () => {
    const of = (id: string) => boltInfoOf(SEED_MATERIALS.find((m) => m.id === id)!);
    expect(of('rod-60')).toBe('rods');
    expect(of('acc-nut-washer')).toBe('nuts');
    expect(of('acc-latch-adjustable')).toBe('crocodiles');
    expect(of('acc-frog')).toBe('frogs');
    expect(of('acc-panel-concrete-anchor')).toBe('holders');
    expect(of('waler-rod-40')).toBe('walerRod');
    expect(of('waler-rod-lock')).toBe('walerLock');
    expect(of('rod-40-half-head')).toBe('halfHead');
    expect(of('acc-small-barashka')).toBe('smallNut');
    expect(of('panel-90x300')).toBeNull();
  });
});

describe('the 40 სმ heads put down by hand (the user, 2026-11-07)', () => {
  it('count with the worked-out ones: 5 by a 300', async () => {
    const { cornerConnectorTotals, cornerConnectorSpots } = await import('../cornerConnectors');
    const { findCornerRods } = await import('../bolts');
    const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
    const pieces = [
      { id: 'p', materialId: 'panel-90x300', x: 0, y: 0, rot: 0 },
      { id: 'h', materialId: 'rod-40-half-head', x: 10, y: 9, rot: 0 },
      { id: 'f', materialId: 'rod-40-full-head', x: 50, y: 9, rot: 0 },
    ];
    expect(cornerConnectorTotals(cornerConnectorSpots(pieces, byId)).halfHead).toBe(5);
    expect(findCornerRods(pieces, byId).reduce((n, r) => n + r.count, 0)).toBe(5);
    expect(boltInfoOf(byId.get('rod-40-full-head')!)).toBe('fullHead');
  });
});
