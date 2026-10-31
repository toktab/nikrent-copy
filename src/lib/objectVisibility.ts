import type { Category, Material } from '../types';
import { CATEGORY_ORDER } from '../data/categories';

/**
 * Which kinds of thing the plan draws (პარამეტრები -> ხილვადობა).
 *
 * Hiding is for looking only: a hidden piece is still on the drawing, still in
 * the bill of materials, still counted against stock and still built around by
 * the fill. It is just not drawn on the main scheme, and so it cannot be picked
 * or dragged there either.
 *
 * Per category, with a per-material answer on top for the one kind in a
 * category that should go the other way - a ნიანგი among the accessories.
 */
export interface ObjectVisibility {
  categories: Record<Category, boolean>;
  /** material id -> shown, where it differs from its category */
  materials: Record<string, boolean>;
}

/**
 * What a new plan shows (the user, 2026-10-30): the panels - ჩაკერება and
 * კუთხე are panels of the system too - the walers and the ნიანგი. Everything
 * else is there, just not drawn until it is switched on.
 *
 * The ჭანჭიკები kinds are not here at all: they have their own show / hide in
 * the ჭანჭიკები menu, and two switches for one thing would contradict each
 * other.
 */
export const DEFAULT_OBJECT_VISIBILITY: ObjectVisibility = {
  categories: {
    panel: true,
    filler: true,
    corner: true,
    waler: true,
    post: false,
    rod: false,
    acc: false,
  },
  materials: {},
};

/** A ნიანგი is shown unless its own row says otherwise, whatever its category. */
const isNiangi = (m: Material) => m.name.includes('ნიანგ');

export function isMaterialShown(vis: ObjectVisibility, m: Material): boolean {
  const own = vis.materials[m.id];
  if (typeof own === 'boolean') return own;
  if (isNiangi(m)) return true;
  return vis.categories[m.category] !== false;
}

/** Anything saved - junk included - as a usable setting. */
export function normalizeObjectVisibility(raw: unknown): ObjectVisibility {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  const cats = (r.categories && typeof r.categories === 'object' ? r.categories : {}) as Record<string, unknown>;
  const mats = (r.materials && typeof r.materials === 'object' ? r.materials : {}) as Record<string, unknown>;
  const categories = { ...DEFAULT_OBJECT_VISIBILITY.categories };
  for (const c of CATEGORY_ORDER) if (typeof cats[c] === 'boolean') categories[c] = cats[c] as boolean;
  const materials: Record<string, boolean> = {};
  for (const [id, v] of Object.entries(mats)) if (typeof v === 'boolean') materials[id] = v;
  return { categories, materials };
}

/** The thickness every panel and ჩაკერება is drawn at by default, cm. */
export const DEFAULT_PANEL_DEPTH_CM = 10;

/** A usable thickness from anything saved: 1 to 30 cm, else the default. */
export function normalizePanelDepth(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 30 ? Math.round(n * 10) / 10 : DEFAULT_PANEL_DEPTH_CM;
}

/** A usable move step from anything saved: 1 to 50 cm, else five. */
export function normalizeMoveStep(raw: unknown): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 && n <= 50 ? Math.round(n) : 5;
}
