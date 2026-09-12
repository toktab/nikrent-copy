import type { Category, Material, Piece } from '../types';
import { CATEGORY_ORDER, categoryLabel } from '../data/categories';
import { totalStock } from './inventory';

/**
 * What stays in the yard once the open drawing is delivered - the architect's
 * ნაშთი sheet: stock, minus what this drawing uses, per component.
 *
 * Deliberately the open drawing only, not every drawing the company has: the
 * question at the desk is "can THIS job be served from what we hold", and
 * who else is waiting for the same 90s is decided by a person, not here.
 */

export interface RemainingRow {
  material: Material;
  /** owned, across every warehouse */
  stock: number;
  /** placed in the open drawing */
  used: number;
  /** stock − used; below zero is a shortage */
  left: number;
  short: boolean;
  /** used × unit weight, kg; 0 where the weight is not entered */
  weightKg: number;
}

export interface RemainingGroup {
  category: Category;
  label: string;
  rows: RemainingRow[];
}

export interface Remaining {
  /** the rows asked for, by category */
  groups: RemainingGroup[];
  /**
   * The totals are for the drawing, never for what is on screen: searching for
   * "90" must not make the shortages elsewhere look solved.
   */
  shortages: number;
  /** pieces in the drawing */
  used: number;
  /** what this drawing weighs, kg, over the parts whose weight is known */
  weightKg: number;
  /** used parts with no weight entered, so the weight is known to be short */
  unweighed: number;
}

/** Every component, only what this drawing uses, or only what it is short of. */
export type RemainingShow = 'all' | 'used' | 'short';

export function remainingRows(
  materials: Material[],
  pieces: Piece[],
  opts: {
    show?: RemainingShow;
    query?: string;
    /**
     * Rows that stay listed whatever the filter says - the ones being edited.
     * Typing a count that ends a shortage must not take the field away from
     * under the cursor halfway through the number.
     */
    keep?: ReadonlySet<string>;
  } = {},
): Remaining {
  const show = opts.show ?? 'all';
  const query = opts.query?.trim().toLowerCase() ?? '';

  const counts = new Map<string, number>();
  // A piece whose material has left the catalog has no stock row to count
  // against; the bill of materials already reports those.
  for (const p of pieces) counts.set(p.materialId, (counts.get(p.materialId) ?? 0) + 1);

  const groups: RemainingGroup[] = [];
  let shortages = 0;
  let used = 0;
  let weightKg = 0;
  let unweighed = 0;

  for (const category of CATEGORY_ORDER) {
    const rows: RemainingRow[] = [];
    for (const material of materials) {
      if (material.category !== category) continue;
      const count = counts.get(material.id) ?? 0;
      const stock = totalStock(material);
      const left = stock - count;
      const row: RemainingRow = {
        material,
        stock,
        used: count,
        left,
        short: left < 0,
        weightKg: count * material.weight,
      };

      if (row.short) shortages++;
      used += count;
      weightKg += row.weightKg;
      if (count > 0 && material.weight <= 0) unweighed++;

      if (!opts.keep?.has(material.id)) {
        if (show === 'used' && count === 0) continue;
        if (show === 'short' && !row.short) continue;
        if (
          query &&
          !material.name.toLowerCase().includes(query) &&
          !material.article.toLowerCase().includes(query)
        ) {
          continue;
        }
      }
      rows.push(row);
    }
    if (rows.length) groups.push({ category, label: categoryLabel(category), rows });
  }

  return { groups, shortages, used, weightKg, unweighed };
}
