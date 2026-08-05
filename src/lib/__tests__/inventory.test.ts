import { describe, expect, it } from 'vitest';
import type { DrawingDoc, Material } from '../../types';
import {
  available,
  commitmentsByMaterial,
  DEFAULT_WAREHOUSE,
  emptyCommitment,
  normalizeStock,
  stockIn,
  totalStock,
  withStockIn,
} from '../inventory';

const material = (over: Partial<Material> = {}): Material => ({
  id: 'm',
  name: 'm',
  category: 'panel',
  w: 10,
  h: 10,
  depth: 9,
  shape: 'rect',
  color: '#fff',
  builtin: false,
  stock: { main: 5, site: 3 },
  weight: 0,
  article: '',
  supplier: '',
  ...over,
});

const doc = (id: string, name: string, materialIds: string[]): DrawingDoc => ({
  id,
  name,
  updatedAt: 0,
  projectName: '',
  revision: 'A',
  scale: 50,
  pieces: materialIds.map((materialId, i) => ({
    id: `${id}-${i}`,
    materialId,
    x: 0,
    y: 0,
    rot: 0,
  })),
});

describe('stock helpers', () => {
  it('totals across warehouses', () => {
    expect(totalStock(material())).toBe(8);
  });

  it('reads one warehouse', () => {
    expect(stockIn(material(), 'site')).toBe(3);
    expect(stockIn(material(), 'nowhere')).toBe(0);
  });

  it('sets one warehouse without touching the others', () => {
    const next = withStockIn(material().stock, 'main', 9);
    expect(next).toEqual({ main: 9, site: 3 });
  });

  it('never stores a negative quantity', () => {
    expect(withStockIn({}, 'main', -5)).toEqual({ main: 0 });
  });
});

describe('normalizeStock', () => {
  it('upgrades a legacy number', () => {
    expect(normalizeStock(12)).toEqual({ [DEFAULT_WAREHOUSE.id]: 12 });
  });

  it('keeps a valid map', () => {
    expect(normalizeStock({ a: 1, b: 2 })).toEqual({ a: 1, b: 2 });
  });

  it('drops junk values', () => {
    expect(normalizeStock({ a: 'x', b: 3 })).toEqual({ b: 3 });
  });

  it('falls back to an empty default store', () => {
    expect(normalizeStock(undefined)).toEqual({ [DEFAULT_WAREHOUSE.id]: 0 });
    expect(normalizeStock('nonsense')).toEqual({ [DEFAULT_WAREHOUSE.id]: 0 });
  });
});

describe('commitmentsByMaterial', () => {
  const docs = [doc('d1', 'A', ['panel', 'panel', 'waler']), doc('d2', 'B', ['panel'])];

  it('adds up placements across every drawing', () => {
    const c = commitmentsByMaterial(docs, 'd1').get('panel')!;
    expect(c.committed).toBe(3);
    expect(c.inActive).toBe(2);
  });

  it('breaks the commitment down per drawing, biggest first', () => {
    const c = commitmentsByMaterial(docs, 'd1').get('panel')!;
    expect(c.byDocument).toEqual([
      { name: 'A', count: 2, active: true },
      { name: 'B', count: 1, active: false },
    ]);
  });

  it('omits materials nobody has placed', () => {
    expect(commitmentsByMaterial(docs, 'd1').get('corner')).toBeUndefined();
  });
});

describe('available', () => {
  it('is stock minus everything committed anywhere', () => {
    const c = commitmentsByMaterial([doc('d1', 'A', ['m', 'm'])], 'd1').get('m');
    expect(available(material(), c)).toBe(6); // 8 owned − 2 placed
  });

  it('equals total stock when nothing is placed', () => {
    expect(available(material(), emptyCommitment())).toBe(8);
  });

  it('goes negative when over-committed', () => {
    const c = commitmentsByMaterial([doc('d1', 'A', Array(10).fill('m'))], 'd1').get('m');
    expect(available(material(), c)).toBe(-2);
  });
});
