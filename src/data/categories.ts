import type { Category } from '../types';

export interface CategoryDef {
  /** Georgian label shown in the UI */
  name: string;
  /** default fill colour for materials of this category */
  color: string;
}

/** Copied verbatim from the v1 prototype's CATS map. */
export const CATEGORIES: Record<Category, CategoryDef> = {
  panel: { name: 'პანელები', color: '#c9a36a' },
  waler: { name: 'ვოლერები / სამაგრები', color: '#6fa8dc' },
  corner: { name: 'კუთხეები', color: '#93c47d' },
  post: { name: 'დგარები', color: '#b48ead' },
  filler: { name: 'ჩაკერებები', color: '#e0b872' },
  rod: { name: 'ჭანჭიკები / შტირები', color: '#d98880' },
  acc: { name: 'აქსესუარები', color: '#8fa1ad' },
};

/** Display order of the categories in every panel/list. */
export const CATEGORY_ORDER: Category[] = [
  'panel',
  'waler',
  'corner',
  'post',
  'filler',
  'rod',
  'acc',
];

export function isCategory(value: string): value is Category {
  return Object.prototype.hasOwnProperty.call(CATEGORIES, value);
}

export function categoryLabel(category: Category): string {
  return CATEGORIES[category]?.name ?? category;
}

export function categoryColor(category: Category): string {
  return CATEGORIES[category]?.color ?? '#8fa1ad';
}
