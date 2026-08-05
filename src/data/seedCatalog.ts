import type { Category, Material, Shape } from '../types';
import { categoryColor } from './categories';
import { DEFAULT_WAREHOUSE } from '../lib/inventory';

/**
 * The 41 built-in Du column-formwork materials, extracted verbatim from the v1
 * prototype (`Du-Formwork-Editor.html`). Names, categories and cm dimensions are
 * unchanged; only stable ids and a draw `shape` have been added.
 *
 * Sizes are approximate, derived from the material names
 * (e.g. "პანელი 45*300" = 45 × 300 cm). Walers / tie rods are sized by their
 * length with a thin profile; small hardware uses representative sizes.
 * Everything here is editable at runtime through the catalog UI.
 */
type Seed = [id: string, name: string, category: Category, w: number, h: number, shape: Shape];

const SEEDS: Seed[] = [
  // ---- Panels (w × h in cm) ------------------------------------------------
  ['panel-30x300', 'პანელი 30*300', 'panel', 30, 300, 'rect'],
  ['panel-45x150', 'პანელი 45*150', 'panel', 45, 150, 'rect'],
  ['panel-45x300', 'პანელი 45*300', 'panel', 45, 300, 'rect'],
  ['panel-60x150', 'პანელი 60*150', 'panel', 60, 150, 'rect'],
  ['panel-60x300', 'პანელი 60*300', 'panel', 60, 300, 'rect'],
  ['panel-75x090', 'პანელი 75*090', 'panel', 75, 90, 'rect'],
  ['panel-75x150', 'პანელი 75*150', 'panel', 75, 150, 'rect'],
  ['panel-75x300', 'პანელი 75*300', 'panel', 75, 300, 'rect'],
  ['panel-90x300', 'პანელი 90*300', 'panel', 90, 300, 'rect'],

  // ---- Walers (length × profile) ------------------------------------------
  ['waler-100', 'waler 100', 'waler', 100, 12, 'line'],
  ['waler-120', 'waler 120', 'waler', 120, 12, 'line'],
  ['waler-150', 'waler 150', 'waler', 150, 12, 'line'],
  ['waler-300', 'waler 300', 'waler', 300, 12, 'line'],
  ['waler-600', 'waler 600', 'waler', 600, 12, 'line'],

  // ---- Corners -------------------------------------------------------------
  // 24 cm plan leg: an outer corner wraps the OUTSIDE of the box, so with a
  // 9 cm panel it covers 24 − 9 = 15 cm of concrete face. The name carries only
  // the 300 (height), so the leg was a guess in the v1 port — and the original
  // 15 was geometrically impossible: it cannot both wrap a 9 cm panel and cover
  // 15 cm of face, which is what left holes between corners and panels.
  ['corner-outer-300', 'გარე კუთხე 300', 'corner', 24, 300, 'L'],
  ['corner-inner-20x20x150', 'შიდა კუთხე 20*20*150', 'corner', 20, 150, 'L'],
  ['corner-inner-20x20x300', 'შიდა კუთხე 20*20*300', 'corner', 20, 300, 'L'],
  ['corner-inner-20x20x300-joni', 'შიდა კუთხე 20*20*300 ჯონი', 'corner', 20, 300, 'L'],
  ['corner-plate', 'კუთხის თეფში', 'corner', 15, 15, 'rect'],
  ['corner-connector', 'კუთხის კონექტორი', 'corner', 8, 8, 'rect'],
  ['corner-connector-40', 'კუთხის კონექტორი 40სმ', 'corner', 8, 40, 'rect'],

  // ---- Posts ---------------------------------------------------------------
  ['post-100', 'დგარი 100', 'post', 10, 100, 'line'],
  ['post-200', 'დგარი 200', 'post', 10, 200, 'line'],

  // ---- Fillers -------------------------------------------------------------
  ['filler-5x150', 'ჩაკერება 5*150', 'filler', 5, 150, 'rect'],
  ['filler-5x300', 'ჩაკერება 5*300', 'filler', 5, 300, 'rect'],
  ['filler-10x150', 'ჩაკერება 10*150', 'filler', 10, 150, 'rect'],
  ['filler-10x300', 'ჩაკერება 10*300', 'filler', 10, 300, 'rect'],

  // ---- Tie rods / studs ----------------------------------------------------
  ['rod-60', 'ჭანჭიკი (შტირი 0,60 სმ)', 'rod', 60, 3, 'line'],
  ['rod-80', 'ჭანჭიკი (შტირი 0,80 სმ)', 'rod', 80, 3, 'line'],
  ['rod-100', 'ჭანჭიკი (შტირი 100 სმ)', 'rod', 100, 3, 'line'],
  ['rod-150', 'ჭანჭიკი (შტირი 150 სმ)', 'rod', 150, 3, 'line'],

  // ---- Accessories ---------------------------------------------------------
  ['acc-crane-hook', 'კაუჭი ამწესთვის', 'acc', 15, 25, 'rect'],
  ['acc-panel-clamp-set', 'პანელზე სამაგრი კომპლექტი', 'acc', 12, 12, 'rect'],
  ['acc-panel-concrete-anchor', 'პანელის ბეტონზე სამაგრი', 'acc', 12, 12, 'rect'],
  ['acc-nut-washer', 'ქანჩი + დისკო', 'acc', 8, 8, 'rect'],
  ['acc-latch-fix', 'ჩამკეტი fix', 'acc', 10, 20, 'rect'],
  ['acc-latch-adjustable', 'ჩამკეტი რეგულირებადი', 'acc', 10, 25, 'rect'],
  ['acc-base-clamp', 'ძირის სამაგრი', 'acc', 15, 15, 'rect'],
  ['acc-scaffold-foot', 'ხარაჩოს ფეხი', 'acc', 20, 30, 'rect'],
  ['acc-fixator-sleeve', 'გილზა ფიქსატორის', 'acc', 5, 15, 'rect'],
  ['acc-fixator-nut', 'ქანჩი (გაიკა) ფიქსატორის', 'acc', 6, 6, 'rect'],
];

/** Du panels are always 9 cm thick. */
export const PANEL_DEPTH_CM = 9;

/**
 * On-screen thickness of a material in the PLAN view.
 *
 * The name "პანელი 30*300" means 30 cm wide and 300 cm tall — the 300 is
 * height, not a plan dimension, so a panel is drawn 30 × 9.
 *  - panels and fillers: the fixed 9 cm system thickness
 *  - corners and posts: a square cross-section, so the width again
 *  - walers, tie rods, accessories: `h` is already their plan profile
 */
export function defaultDepth(category: Category, w: number, h: number): number {
  switch (category) {
    case 'panel':
    case 'filler':
      return PANEL_DEPTH_CM;
    case 'corner':
    case 'post':
      return w;
    default:
      return h;
  }
}

/**
 * Freshly built built-in catalog.
 *
 * Stock, price and weight all start at 0 — they are company data, not product
 * data. Weight in particular is deliberately left unset rather than estimated:
 * these numbers feed crane and truck load figures, and a plausible-looking
 * guess there is worse than an obvious blank.
 */
export function createSeedMaterials(): Material[] {
  return SEEDS.map(([id, name, category, w, h, shape]) => ({
    id,
    name,
    category,
    w,
    h,
    depth: defaultDepth(category, w, h),
    shape,
    color: categoryColor(category),
    builtin: true,
    stock: { [DEFAULT_WAREHOUSE.id]: 0 },
    weight: 0,
    article: '',
    supplier: '',
  }));
}

export const SEED_MATERIALS: Material[] = createSeedMaterials();

/** Ids in seed order — used to import v1 prototype layouts that stored `matIndex`. */
export const SEED_IDS_IN_ORDER: string[] = SEEDS.map(([id]) => id);
