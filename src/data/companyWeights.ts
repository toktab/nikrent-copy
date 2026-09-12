import type { Material } from '../types';

/**
 * Unit weights, kg, as the company's own workbook has them - the ერთეულის წონა
 * column of the architect's ჯამი sheet (`files/column_formulas.xlsx`), keyed by
 * built-in material id.
 *
 * The seed catalog leaves weight at 0 on purpose: a guessed weight feeds crane
 * and truck figures and is worse than a blank. These are not guesses - they are
 * the figures the office already loads trucks by - so they may fill a blank,
 * but they never write over a weight somebody typed. The concrete anchor is 0
 * in the workbook too, and stays unset.
 */
export const COMPANY_WEIGHTS: Readonly<Record<string, number>> = {
  'panel-30x300': 46.5,
  'panel-45x150': 25,
  'panel-45x300': 58.6,
  'panel-60x150': 36,
  'panel-60x300': 70.7,
  'panel-75x090': 28.6,
  'panel-75x150': 42.5,
  'panel-75x300': 82.8,
  'panel-90x300': 94.9,

  'waler-100': 10,
  'waler-120': 12,
  'waler-150': 15,
  'waler-300': 30,
  'waler-600': 60,

  'corner-outer-300': 20,
  'corner-inner-20x20x150': 38,
  'corner-inner-20x20x300': 56.6,
  'corner-inner-20x20x300-joni': 56.6,
  'corner-plate': 2.5,
  'corner-connector': 0.7,
  'corner-connector-40': 1,

  'post-100': 8.5,
  'post-200': 17,

  'filler-5x150': 7.5,
  'filler-5x300': 15,
  'filler-10x150': 15,
  'filler-10x300': 30,

  'rod-60': 1,
  'rod-80': 1.3,
  'rod-100': 1.63,
  'rod-150': 2,

  'acc-crane-hook': 6.6,
  'acc-panel-clamp-set': 2.73,
  'acc-nut-washer': 1.1,
  'acc-latch-fix': 1.2,
  'acc-latch-adjustable': 4.6,
  'acc-base-clamp': 3.05,
  'acc-scaffold-foot': 11,
  'acc-fixator-sleeve': 0.1,
  'acc-fixator-nut': 0.15,
};

/**
 * The catalog with every blank weight the workbook knows filled in, and how
 * many that was. Unchanged - the same array - when there was nothing to fill,
 * so pressing the button twice is not a second edit.
 */
export function withCompanyWeights(materials: Material[]): { materials: Material[]; filled: number } {
  let filled = 0;
  const next = materials.map((m) => {
    const weight = COMPANY_WEIGHTS[m.id];
    if (m.weight > 0 || !weight) return m;
    filled++;
    return { ...m, weight };
  });
  return { materials: filled ? next : materials, filled };
}
