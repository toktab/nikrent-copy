import type { DrawingDoc, Material, StockByWarehouse, Warehouse } from '../types';

/** Every catalog starts with one store; multi-warehouse is opt-in. */
export const DEFAULT_WAREHOUSE: Warehouse = { id: 'main', name: 'მთავარი საწყობი' };

/** Total owned across every warehouse. */
export function totalStock(m: Material): number {
  let sum = 0;
  for (const key of Object.keys(m.stock)) sum += m.stock[key] || 0;
  return sum;
}

/** Owned in one specific warehouse. */
export function stockIn(m: Material, warehouseId: string): number {
  return m.stock[warehouseId] || 0;
}

/** Immutably set the quantity held in one warehouse. */
export function withStockIn(
  stock: StockByWarehouse,
  warehouseId: string,
  quantity: number,
): StockByWarehouse {
  return { ...stock, [warehouseId]: Math.max(0, Math.round(quantity) || 0) };
}

/** Coerce anything (legacy number, junk) into a valid stock map. */
export function normalizeStock(value: unknown, fallbackWarehouse = DEFAULT_WAREHOUSE.id): StockByWarehouse {
  if (typeof value === 'number' && Number.isFinite(value)) {
    // v2 and earlier stored a single number.
    return { [fallbackWarehouse]: Math.max(0, Math.round(value)) };
  }
  if (value && typeof value === 'object') {
    const out: StockByWarehouse = {};
    for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
      const n = Number(raw);
      if (Number.isFinite(n)) out[key] = Math.max(0, Math.round(n));
    }
    return Object.keys(out).length ? out : { [fallbackWarehouse]: 0 };
  }
  return { [fallbackWarehouse]: 0 };
}

export interface Commitment {
  /** total placed across every drawing */
  committed: number;
  /** placed in the drawing currently open */
  inActive: number;
  /** per drawing name → quantity, only drawings that use the material */
  byDocument: Array<{ name: string; count: number; active: boolean }>;
}

/**
 * What the whole company has already committed to drawings.
 *
 * A single drawing's "used" count is not the real question when several sites
 * run at once — the useful number is how much of the stock is spoken for
 * everywhere, and therefore how much is genuinely free.
 */
export function commitmentsByMaterial(
  documents: DrawingDoc[],
  activeDocId: string,
): Map<string, Commitment> {
  const map = new Map<string, Commitment>();

  for (const doc of documents) {
    const perDoc = new Map<string, number>();
    for (const piece of doc.pieces) {
      perDoc.set(piece.materialId, (perDoc.get(piece.materialId) ?? 0) + 1);
    }
    const active = doc.id === activeDocId;
    for (const [materialId, count] of perDoc) {
      const entry = map.get(materialId) ?? { committed: 0, inActive: 0, byDocument: [] };
      entry.committed += count;
      if (active) entry.inActive += count;
      entry.byDocument.push({ name: doc.name, count, active });
      map.set(materialId, entry);
    }
  }

  for (const entry of map.values()) {
    entry.byDocument.sort((a, b) => b.count - a.count);
  }
  return map;
}

export function emptyCommitment(): Commitment {
  return { committed: 0, inActive: 0, byDocument: [] };
}

/** Free to allocate: owned minus everything already drawn anywhere. */
export function available(m: Material, commitment: Commitment | undefined): number {
  return totalStock(m) - (commitment?.committed ?? 0);
}
