import { describe, expect, it } from 'vitest';
import { remainingRows } from '../remaining';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Material, Piece } from '../../types';

const withStock = (materials: Material[], stock: Record<string, number>): Material[] =>
  materials.map((m) => (m.id in stock ? { ...m, stock: { main: stock[m.id] } } : m));

let seq = 0;
const place = (materialId: string, count: number): Piece[] =>
  Array.from({ length: count }, () => ({ id: `p${seq++}`, materialId, x: 0, y: 0, rot: 0 }));

const rowsOf = (r: ReturnType<typeof remainingRows>) => r.groups.flatMap((g) => g.rows);
const rowOf = (r: ReturnType<typeof remainingRows>, id: string) =>
  rowsOf(r).find((row) => row.material.id === id);

describe('remainingRows - the ნაშთი sheet', () => {
  // The Britania workbook: 59 × 90*300 against a yard of 500, and 35 inner
  // corners against 30 - the one row that came out −5.
  const materials = withStock(createSeedMaterials(), {
    'panel-90x300': 500,
    'corner-inner-20x20x300': 30,
  }).map((m) => (m.id === 'panel-90x300' ? { ...m, weight: 94.9 } : m));
  const pieces = [...place('panel-90x300', 59), ...place('corner-inner-20x20x300', 35)];

  it('takes what this drawing uses off the stock', () => {
    const r = remainingRows(materials, pieces);
    expect(rowOf(r, 'panel-90x300')).toMatchObject({ stock: 500, used: 59, left: 441, short: false });
    expect(rowOf(r, 'corner-inner-20x20x300')).toMatchObject({ stock: 30, used: 35, left: -5, short: true });
    expect(r.shortages).toBe(1);
    expect(r.used).toBe(94);
  });

  it('lists every component in the catalog by default, used or not', () => {
    const r = remainingRows(materials, pieces);
    expect(rowsOf(r)).toHaveLength(materials.length);
    expect(rowOf(r, 'waler-100')).toMatchObject({ used: 0, left: 0, short: false });
    expect(r.groups.map((g) => g.category)).toEqual(['panel', 'waler', 'corner', 'post', 'filler', 'rod', 'acc']);
  });

  it('shows only what is used, or only what is short, when asked', () => {
    expect(rowsOf(remainingRows(materials, pieces, { show: 'used' })).map((row) => row.material.id).sort()).toEqual([
      'corner-inner-20x20x300',
      'panel-90x300',
    ]);
    expect(rowsOf(remainingRows(materials, pieces, { show: 'short' })).map((row) => row.material.id)).toEqual([
      'corner-inner-20x20x300',
    ]);
  });

  it('searches by name, and a search never changes the totals', () => {
    const r = remainingRows(materials, pieces, { query: '90*300' });
    expect(rowsOf(r).map((row) => row.material.id)).toEqual(['panel-90x300']);
    expect(r.shortages).toBe(1);
    expect(r.used).toBe(94);
  });

  it('weighs what is used, and says how much of it has no weight', () => {
    const r = remainingRows(materials, pieces);
    expect(rowOf(r, 'panel-90x300')!.weightKg).toBeCloseTo(59 * 94.9);
    expect(r.weightKg).toBeCloseTo(59 * 94.9);
    expect(r.unweighed).toBe(1); // the corners
  });

  it('keeps a row being edited on screen after it stops matching the filter', () => {
    // The corner's shortage is fixed by typing 40 - under "short only" the row
    // would vanish mid-number, unless it is being kept.
    const fixed = materials.map((m) => (m.id === 'corner-inner-20x20x300' ? { ...m, stock: { main: 40 } } : m));
    expect(rowsOf(remainingRows(fixed, pieces, { show: 'short' }))).toEqual([]);

    const kept = remainingRows(fixed, pieces, { show: 'short', keep: new Set(['corner-inner-20x20x300']) });
    expect(rowsOf(kept).map((row) => row.material.id)).toEqual(['corner-inner-20x20x300']);
    expect(kept.shortages).toBe(0);
  });

  it('ignores pieces with no material', () => {
    expect(remainingRows(materials, [...pieces, ...place('gone', 3)]).used).toBe(94);
  });
});
