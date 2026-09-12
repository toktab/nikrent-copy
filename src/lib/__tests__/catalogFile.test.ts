import { describe, expect, it } from 'vitest';
import {
  buildLayoutFile,
  parseCatalogFile,
  parseLayoutFile,
  sanitizeMaterial,
} from '../catalogFile';
import type { DrawingDoc } from '../../types';
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

  it('starts with no stock or weight — those are company data', () => {
    for (const m of createSeedMaterials()) {
      expect(totalStock(m)).toBe(0);
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
  it('reads a pieces-only (v2) file', () => {
    const file = JSON.stringify({
      version: 2,
      pieces: [{ id: 'p1', materialId: 'panel-45x300', x: 10, y: 20, rot: 90 }],
    });
    const parsed = parseLayoutFile(file);
    expect(parsed.pieces[0]).toMatchObject({ materialId: 'panel-45x300', x: 10, y: 20, rot: 90 });
    expect(parsed.sketch).toEqual([]);
    expect(parsed.measures).toEqual([]);
    expect(parsed.meta.scale).toBeNull();
  });

  it('reads v1 prototype layouts that referenced materials by index', () => {
    const file = JSON.stringify({ pieces: [{ id: 1, matIndex: 2, x: 5, y: 5, rot: 0 }] });
    expect(parseLayoutFile(file).pieces[0].materialId).toBe(SEED_IDS_IN_ORDER[2]);
  });

  it('normalises odd rotations to quarter turns', () => {
    const file = JSON.stringify({ pieces: [{ materialId: 'a', x: 0, y: 0, rot: -90 }] });
    expect(parseLayoutFile(file).pieces[0].rot).toBe(270);
  });

  it('throws on a file with nothing usable in it', () => {
    expect(() => parseLayoutFile(JSON.stringify({ pieces: [] }))).toThrow();
    expect(() => parseLayoutFile(JSON.stringify({ pieces: [], sketch: [], measures: [] }))).toThrow();
    expect(() => parseLayoutFile(JSON.stringify({ nope: 1 }))).toThrow();
  });

  it('reads a drawing of lines alone', () => {
    const file = JSON.stringify({
      pieces: [],
      sketch: [{ id: 'k', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], perimeter: 'inner' }],
    });
    const parsed = parseLayoutFile(file);
    expect(parsed.pieces).toEqual([]);
    expect(parsed.sketch[0]).toMatchObject({
      points: [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      perimeter: 'inner',
    });
  });

  it('drops broken points and lines instead of inventing them at the origin', () => {
    const file = JSON.stringify({
      sketch: [
        { points: [{ x: 0, y: 0 }, { x: 'x', y: 5 }, { x: 100, y: 0 }] },
        { points: [{ x: 1, y: 1 }] },
        { points: 'nope' },
      ],
      measures: [
        { a: { x: 0, y: 0 }, b: { x: 2, y: 0 } },
        { a: { x: 0, y: 0 }, b: { x: 50, y: 0 } },
      ],
    });
    const parsed = parseLayoutFile(file);
    expect(parsed.sketch).toHaveLength(1);
    expect(parsed.sketch[0].points).toEqual([{ x: 0, y: 0 }, { x: 100, y: 0 }]);
    // Shorter than the 5 cm drawing grid is not a measurement.
    expect(parsed.measures).toHaveLength(1);
  });
});

describe('drawing file round trip', () => {
  const materials = createSeedMaterials();
  const panel = materials.find((m) => m.category === 'panel')!;
  const custom = {
    ...panel,
    id: 'custom-panel-37',
    name: 'პანელი 37*300',
    w: 37,
    builtin: false,
    stock: { main: 12 },
  };
  const doc: DrawingDoc = {
    id: 'doc1',
    name: 'ბლოკი A',
    updatedAt: 1,
    projectName: 'ვაკე',
    revision: 'C',
    scale: 25,
    pieces: [
      { id: 'p1', materialId: panel.id, x: 10, y: 20, rot: 90, z: 150 },
      { id: 'p2', materialId: custom.id, x: 47, y: 20, rot: 0, z: 0 },
    ],
    sketch: [
      { id: 'k1', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }], perimeter: 'outer' },
      {
        id: 'k2',
        points: [{ x: 50, y: 50 }, { x: 150, y: 50 }, { x: 150, y: 150 }],
        closed: true,
        perimeter: 'inner',
      },
    ],
    measures: [{ id: 'm1', a: { x: 0, y: -15 }, b: { x: 45, y: -15 } }],
  };

  const roundTrip = () =>
    parseLayoutFile(JSON.stringify(buildLayoutFile(doc, [...materials, custom])));

  it('brings back every piece, line and measurement exactly', () => {
    const parsed = roundTrip();
    const strip = <T extends { id: string }>(xs: T[]) => xs.map(({ id: _id, ...rest }) => rest);
    expect(strip(parsed.pieces)).toEqual(strip(doc.pieces));
    expect(strip(parsed.sketch)).toEqual(strip(doc.sketch));
    expect(strip(parsed.measures)).toEqual(strip(doc.measures));
  });

  it('carries the name and the title block', () => {
    expect(roundTrip().meta).toEqual({ name: 'ბლოკი A', projectName: 'ვაკე', revision: 'C', scale: 25 });
  });

  it('carries only the materials the pieces use, without stock', () => {
    const parsed = roundTrip();
    expect(parsed.materials.map((m) => m.id).sort()).toEqual([custom.id, panel.id].sort());
    expect(parsed.materials.find((m) => m.id === custom.id)).toMatchObject({ w: 37, stock: {} });
  });

  it('mints fresh ids, so the same file imported twice cannot collide', () => {
    const parsed = roundTrip();
    expect(parsed.pieces.map((p) => p.id)).not.toContain('p1');
    expect(parsed.sketch.map((k) => k.id)).not.toContain('k1');
    expect(parsed.measures[0].id).not.toBe('m1');
    expect(roundTrip().pieces[0].id).not.toBe(parsed.pieces[0].id);
  });
});
