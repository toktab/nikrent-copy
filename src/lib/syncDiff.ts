import type { DrawingDoc, Material, Warehouse } from '../types';

/**
 * Works out what changed between two snapshots of the editor's data, so the
 * sync engine can push only that.
 *
 * Kept free of Supabase on purpose: this is the part with the interesting
 * edge cases (a deleted warehouse, stock going to zero, a renamed drawing) and
 * it should be testable without a network or a mock client.
 *
 * Change detection leans on the store being immutable. Zustand replaces the
 * objects it touches and leaves the rest alone, so an unchanged item is still
 * the *same reference* and can be skipped without comparing any fields. A
 * false positive only costs a redundant upsert; a false negative would lose
 * data, so the comparison deliberately errs towards sending too much.
 */

export interface DataSnapshot {
  materials: Material[];
  warehouses: Warehouse[];
  documents: DrawingDoc[];
}

export interface StockChange {
  materialId: string;
  warehouseId: string;
  quantity: number;
}

export interface SyncPlan {
  materialsUpsert: Material[];
  materialsDelete: string[];
  warehousesUpsert: Warehouse[];
  warehousesDelete: string[];
  documentsUpsert: DrawingDoc[];
  documentsDelete: string[];
  stockSet: StockChange[];
}

export function emptyPlan(): SyncPlan {
  return {
    materialsUpsert: [],
    materialsDelete: [],
    warehousesUpsert: [],
    warehousesDelete: [],
    documentsUpsert: [],
    documentsDelete: [],
    stockSet: [],
  };
}

export function isEmptyPlan(plan: SyncPlan): boolean {
  return (
    plan.materialsUpsert.length === 0 &&
    plan.materialsDelete.length === 0 &&
    plan.warehousesUpsert.length === 0 &&
    plan.warehousesDelete.length === 0 &&
    plan.documentsUpsert.length === 0 &&
    plan.documentsDelete.length === 0 &&
    plan.stockSet.length === 0
  );
}

function byId<T extends { id: string }>(items: T[]): Map<string, T> {
  return new Map(items.map((item) => [item.id, item]));
}

/**
 * Stock quantities that differ between two versions of the same material.
 *
 * A warehouse that disappears from the map counts as a change to zero rather
 * than being ignored — otherwise clearing a store's count would look like no
 * change at all and the old quantity would stay on the server forever.
 */
export function diffStock(previous: Material | undefined, next: Material): StockChange[] {
  const before = previous?.stock ?? {};
  const after = next.stock ?? {};
  const warehouseIds = new Set([...Object.keys(before), ...Object.keys(after)]);

  const changes: StockChange[] = [];
  for (const warehouseId of warehouseIds) {
    const from = before[warehouseId] ?? 0;
    const to = after[warehouseId] ?? 0;
    if (from !== to) changes.push({ materialId: next.id, warehouseId, quantity: to });
  }
  return changes;
}

export function diffSnapshots(previous: DataSnapshot, next: DataSnapshot): SyncPlan {
  const plan = emptyPlan();

  // ── materials, and the stock hanging off them ──
  const prevMaterials = byId(previous.materials);
  for (const material of next.materials) {
    const before = prevMaterials.get(material.id);
    if (before === material) continue;
    plan.materialsUpsert.push(material);
    plan.stockSet.push(...diffStock(before, material));
  }
  const nextMaterialIds = new Set(next.materials.map((m) => m.id));
  for (const material of previous.materials) {
    if (!nextMaterialIds.has(material.id)) plan.materialsDelete.push(material.id);
  }

  // ── warehouses ──
  const prevWarehouses = byId(previous.warehouses);
  for (const warehouse of next.warehouses) {
    if (prevWarehouses.get(warehouse.id) === warehouse) continue;
    plan.warehousesUpsert.push(warehouse);
  }
  const nextWarehouseIds = new Set(next.warehouses.map((w) => w.id));
  for (const warehouse of previous.warehouses) {
    if (!nextWarehouseIds.has(warehouse.id)) plan.warehousesDelete.push(warehouse.id);
  }

  // ── drawings ──
  const prevDocs = byId(previous.documents);
  for (const doc of next.documents) {
    if (prevDocs.get(doc.id) === doc) continue;
    plan.documentsUpsert.push(doc);
  }
  const nextDocIds = new Set(next.documents.map((d) => d.id));
  for (const doc of previous.documents) {
    if (!nextDocIds.has(doc.id)) plan.documentsDelete.push(doc.id);
  }

  return plan;
}

/**
 * Fold a plan that failed to send into the next one, so nothing is dropped
 * when a push fails and is retried.
 *
 * Later entries win for the same id: a retry must not resurrect a stale copy
 * of a row that has been edited since, and an id queued for deletion must not
 * also be upserted.
 */
export function mergePlans(older: SyncPlan, newer: SyncPlan): SyncPlan {
  const dedupeById = <T extends { id: string }>(a: T[], b: T[]): T[] => {
    const merged = new Map<string, T>();
    for (const item of [...a, ...b]) merged.set(item.id, item);
    return [...merged.values()];
  };

  const materialsDelete = [...new Set([...older.materialsDelete, ...newer.materialsDelete])];
  const warehousesDelete = [...new Set([...older.warehousesDelete, ...newer.warehousesDelete])];
  const documentsDelete = [...new Set([...older.documentsDelete, ...newer.documentsDelete])];

  // Last write wins per (material, warehouse) pair.
  const stock = new Map<string, StockChange>();
  for (const change of [...older.stockSet, ...newer.stockSet]) {
    stock.set(`${change.materialId}\u0000${change.warehouseId}`, change);
  }

  return {
    materialsUpsert: dedupeById(older.materialsUpsert, newer.materialsUpsert).filter(
      (m) => !materialsDelete.includes(m.id),
    ),
    materialsDelete,
    warehousesUpsert: dedupeById(older.warehousesUpsert, newer.warehousesUpsert).filter(
      (w) => !warehousesDelete.includes(w.id),
    ),
    warehousesDelete,
    documentsUpsert: dedupeById(older.documentsUpsert, newer.documentsUpsert).filter(
      (d) => !documentsDelete.includes(d.id),
    ),
    documentsDelete,
    stockSet: [...stock.values()].filter((c) => !materialsDelete.includes(c.materialId)),
  };
}
