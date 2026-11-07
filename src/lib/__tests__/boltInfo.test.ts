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
