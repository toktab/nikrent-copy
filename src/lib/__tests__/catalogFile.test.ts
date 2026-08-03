import { describe, expect, it } from 'vitest';
import { parseCatalogFile, parseLayoutFile, sanitizeMaterial } from '../catalogFile';
import { createSeedMaterials, SEED_IDS_IN_ORDER } from '../../data/seedCatalog';
import { totalStock } from '../inventory';

describe('seed catalog', () => {
  it('has all 41 built-in Du materials', () => {
    expect(createSeedMaterials()).toHaveLength(41);
  });

  it('gives every material a unique id', () => {
    const ids = createSeedMaterials().map((m) => m.id);
    expect(new Set(ids).size).toBe(41);
  });

  it('keeps the documented sizes', () => {
    const seeds = createSeedMaterials();
    const byName = (n: string) => seeds.find((m) => m.name === n)!;
    expect(byName('პანელი 45*300')).toMatchObject({ w: 45, h: 300, category: 'panel' });
    expect(byName('waler 600')).toMatchObject({ w: 600, h: 12, category: 'waler' });
    expect(byName('ჭანჭიკი (შტირი 150 სმ)')).toMatchObject({ w: 150, h: 3, category: 'rod' });
  });

  it('starts with no stock, price or weight — those are company data', () => {
    for (const m of createSeedMaterials()) {
      expect(totalStock(m)).toBe(0);
      expect(m.price).toBe(0);
      expect(m.weight).toBe(0);
    }
  });
});

describe('sanitizeMaterial', () => {
  it('rejects rows with no name or size', () => {
    expect(sanitizeMaterial({ w: 10, h: 10 }, new Set())).toBeNull();
    expect(sanitizeMaterial({ name: 'x', w: 0, h: 10 }, new Set())).toBeNull();
    expect(sanitizeMaterial(null, new Set())).toBeNull();
  });

  it('upgrades a legacy numeric stock into the per-warehouse map', () => {
    const m = sanitizeMaterial({ name: 'x', category: 'panel', w: 10, h: 10, stock: 7 }, new Set());
    expect(totalStock(m!)).toBe(7);
  });

  it('keeps a per-warehouse stock map', () => {
    const m = sanitizeMaterial(
      { name: 'x', category: 'panel', w: 10, h: 10, stock: { main: 2, site: 3 } },
      new Set(),
    );
    expect(totalStock(m!)).toBe(5);
  });

  it('falls back to a safe category and colour', () => {
    const m = sanitizeMaterial({ name: 'x', category: 'bogus', w: 10, h: 10 }, new Set())!;
    expect(m.category).toBe('acc');
    expect(m.color).toMatch(/^#[0-9a-f]{6}$/i);
  });

  it('de-duplicates ids', () => {
    const taken = new Set(['panel-10x10']);
    const m = sanitizeMaterial({ name: 'x', category: 'panel', w: 10, h: 10 }, taken)!;
    expect(taken.has(m.id)).toBe(false);
  });
});

describe('parseCatalogFile', () => {
  it('reads an exported catalog', () => {
    const file = JSON.stringify({
      app: 'du-formwork',
      kind: 'catalog',
      version: 2,
      materials: [{ id: 'a', name: 'A', category: 'panel', w: 10, h: 20, stock: { main: 4 } }],
      warehouses: [{ id: 'main', name: 'მთავარი' }],
    });
    const result = parseCatalogFile(file);
    expect(result.materials).toHaveLength(1);
    expect(result.warehouses[0].name).toBe('მთავარი');
  });

  it('invents a warehouse entry for any store stock references', () => {
    const file = JSON.stringify({
      materials: [{ id: 'a', name: 'A', category: 'panel', w: 10, h: 20, stock: { site7: 3 } }],
    });
    expect(parseCatalogFile(file).warehouses.map((w) => w.id)).toContain('site7');
  });

  it('counts unusable rows instead of failing the whole import', () => {
    const file = JSON.stringify({
      materials: [
        { id: 'a', name: 'A', category: 'panel', w: 10, h: 20 },
        { id: 'b', name: '', w: 0, h: 0 },
      ],
    });
    const result = parseCatalogFile(file);
    expect(result.materials).toHaveLength(1);
    expect(result.skipped).toBe(1);
  });

  it('throws when there is nothing usable', () => {
    expect(() => parseCatalogFile(JSON.stringify({ materials: [] }))).toThrow();
    expect(() => parseCatalogFile(JSON.stringify({ nope: 1 }))).toThrow();
  });
});

describe('parseLayoutFile', () => {
  it('reads the current format', () => {
    const file = JSON.stringify({
      pieces: [{ id: 'p1', materialId: 'panel-45x300', x: 10, y: 20, rot: 90 }],
    });
    expect(parseLayoutFile(file)[0]).toMatchObject({ materialId: 'panel-45x300', x: 10, y: 20, rot: 90 });
  });

  it('reads v1 prototype layouts that referenced materials by index', () => {
    const file = JSON.stringify({ pieces: [{ id: 1, matIndex: 2, x: 5, y: 5, rot: 0 }] });
    expect(parseLayoutFile(file)[0].materialId).toBe(SEED_IDS_IN_ORDER[2]);
  });

  it('normalises odd rotations to quarter turns', () => {
    const file = JSON.stringify({ pieces: [{ materialId: 'a', x: 0, y: 0, rot: -90 }] });
    expect(parseLayoutFile(file)[0].rot).toBe(270);
  });

  it('throws on a file with no usable pieces', () => {
    expect(() => parseLayoutFile(JSON.stringify({ pieces: [] }))).toThrow();
  });
});
