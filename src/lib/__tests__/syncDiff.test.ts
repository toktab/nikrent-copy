import { describe, expect, it } from 'vitest';
import {
  diffSnapshots,
  diffStock,
  emptyPlan,
  isEmptyPlan,
  mergePlans,
  type DataSnapshot,
} from '../syncDiff';
import type { DrawingDoc, Material, Warehouse } from '../../types';

function material(id: string, patch: Partial<Material> = {}): Material {
  return {
    id,
    name: id,
    category: 'panel',
    w: 30,
    h: 300,
    depth: 9,
    shape: 'rect',
    color: '#888888',
    builtin: false,
    stock: {},
    price: 0,
    weight: 0,
    article: '',
    supplier: '',
    ...patch,
  };
}

function doc(id: string, patch: Partial<DrawingDoc> = {}): DrawingDoc {
  return {
    id,
    name: id,
    updatedAt: 0,
    pieces: [],
    projectName: '',
    revision: 'A',
    scale: 50,
    ...patch,
  };
}

const warehouse = (id: string, name = id): Warehouse => ({ id, name });

function snapshot(patch: Partial<DataSnapshot> = {}): DataSnapshot {
  return { materials: [], warehouses: [], documents: [], ...patch };
}

describe('diffStock', () => {
  it('reports a quantity that changed', () => {
    const before = material('m', { stock: { main: 10 } });
    const after = material('m', { stock: { main: 25 } });
    expect(diffStock(before, after)).toEqual([
      { materialId: 'm', warehouseId: 'main', quantity: 25 },
    ]);
  });

  it('reports a newly stocked warehouse', () => {
    const before = material('m', { stock: { main: 10 } });
    const after = material('m', { stock: { main: 10, second: 4 } });
    expect(diffStock(before, after)).toEqual([
      { materialId: 'm', warehouseId: 'second', quantity: 4 },
    ]);
  });

  /**
   * The case that would otherwise strand stock on the server: a warehouse
   * dropping out of the map has to read as "now zero", not as "no news".
   */
  it('treats a warehouse that disappeared as zero', () => {
    const before = material('m', { stock: { main: 10, old: 7 } });
    const after = material('m', { stock: { main: 10 } });
    expect(diffStock(before, after)).toEqual([
      { materialId: 'm', warehouseId: 'old', quantity: 0 },
    ]);
  });

  it('says nothing when quantities are unchanged', () => {
    const before = material('m', { stock: { main: 10 } });
    const after = material('m', { stock: { main: 10 } });
    expect(diffStock(before, after)).toEqual([]);
  });

  it('treats a brand-new material as all of its stock', () => {
    const after = material('m', { stock: { main: 3 } });
    expect(diffStock(undefined, after)).toEqual([
      { materialId: 'm', warehouseId: 'main', quantity: 3 },
    ]);
  });
});

describe('diffSnapshots', () => {
  it('finds nothing between identical snapshots', () => {
    const shared = material('a');
    const before = snapshot({ materials: [shared] });
    const after = snapshot({ materials: [shared] });
    expect(isEmptyPlan(diffSnapshots(before, after))).toBe(true);
  });

  it('skips items that kept their identity, and sends the ones that did not', () => {
    const untouched = material('a');
    const edited = material('b', { name: 'old' });
    const before = snapshot({ materials: [untouched, edited] });
    const after = snapshot({ materials: [untouched, { ...edited, name: 'new' }] });

    const plan = diffSnapshots(before, after);
    expect(plan.materialsUpsert.map((m) => m.id)).toEqual(['b']);
    expect(plan.materialsDelete).toEqual([]);
  });

  it('reports removed materials, warehouses and drawings', () => {
    const before = snapshot({
      materials: [material('a')],
      warehouses: [warehouse('w1'), warehouse('w2')],
      documents: [doc('d1'), doc('d2')],
    });
    const after = snapshot({
      materials: [],
      warehouses: [before.warehouses[0]],
      documents: [before.documents[0]],
    });

    const plan = diffSnapshots(before, after);
    expect(plan.materialsDelete).toEqual(['a']);
    expect(plan.warehousesDelete).toEqual(['w2']);
    expect(plan.documentsDelete).toEqual(['d2']);
  });

  it('carries a new material and its opening stock together', () => {
    const before = snapshot();
    const after = snapshot({ materials: [material('a', { stock: { main: 12 } })] });

    const plan = diffSnapshots(before, after);
    expect(plan.materialsUpsert.map((m) => m.id)).toEqual(['a']);
    expect(plan.stockSet).toEqual([{ materialId: 'a', warehouseId: 'main', quantity: 12 }]);
  });

  it('treats an empty server as "everything is new"', () => {
    const after = snapshot({
      materials: [material('a')],
      warehouses: [warehouse('main')],
      documents: [doc('d1')],
    });
    const plan = diffSnapshots(snapshot(), after);
    expect(plan.materialsUpsert).toHaveLength(1);
    expect(plan.warehousesUpsert).toHaveLength(1);
    expect(plan.documentsUpsert).toHaveLength(1);
  });
});

describe('mergePlans', () => {
  it('keeps the newer copy of a row queued twice', () => {
    const older = { ...emptyPlan(), materialsUpsert: [material('a', { name: 'first' })] };
    const newer = { ...emptyPlan(), materialsUpsert: [material('a', { name: 'second' })] };
    expect(mergePlans(older, newer).materialsUpsert).toEqual([
      material('a', { name: 'second' }),
    ]);
  });

  /**
   * A retry must not recreate something the user has since deleted, which is
   * what makes the delete lists win over the upserts.
   */
  it('drops an upsert for a row that is now being deleted', () => {
    const older = { ...emptyPlan(), materialsUpsert: [material('a')] };
    const newer = { ...emptyPlan(), materialsDelete: ['a'] };
    const merged = mergePlans(older, newer);
    expect(merged.materialsUpsert).toEqual([]);
    expect(merged.materialsDelete).toEqual(['a']);
  });

  it('drops stock writes for a deleted material', () => {
    const older = {
      ...emptyPlan(),
      stockSet: [{ materialId: 'a', warehouseId: 'main', quantity: 5 }],
    };
    const newer = { ...emptyPlan(), materialsDelete: ['a'] };
    expect(mergePlans(older, newer).stockSet).toEqual([]);
  });

  it('keeps the latest quantity per material and warehouse', () => {
    const older = {
      ...emptyPlan(),
      stockSet: [{ materialId: 'a', warehouseId: 'main', quantity: 5 }],
    };
    const newer = {
      ...emptyPlan(),
      stockSet: [
        { materialId: 'a', warehouseId: 'main', quantity: 9 },
        { materialId: 'a', warehouseId: 'other', quantity: 2 },
      ],
    };
    expect(mergePlans(older, newer).stockSet).toEqual([
      { materialId: 'a', warehouseId: 'main', quantity: 9 },
      { materialId: 'a', warehouseId: 'other', quantity: 2 },
    ]);
  });

  it('does not duplicate the same delete', () => {
    const older = { ...emptyPlan(), documentsDelete: ['d1'] };
    const newer = { ...emptyPlan(), documentsDelete: ['d1'] };
    expect(mergePlans(older, newer).documentsDelete).toEqual(['d1']);
  });

  it('merging two empty plans stays empty', () => {
    expect(isEmptyPlan(mergePlans(emptyPlan(), emptyPlan()))).toBe(true);
  });
});
