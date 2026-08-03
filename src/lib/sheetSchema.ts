import type { Category, Material, MaterialDraft, Shape } from '../types';
import { CATEGORIES, CATEGORY_ORDER, categoryColor } from '../data/categories';
import { DEFAULT_WAREHOUSE } from './inventory';
import { defaultDepth } from '../data/seedCatalog';

/** One raw record straight out of a parsed sheet (keys = header cells). */
export type RawRow = Record<string, unknown>;

export interface ParsedRow {
  /** 1-based row number as the user sees it in the spreadsheet (header = 1) */
  row: number;
  draft: MaterialDraft | null;
  errors: string[];
  warnings: string[];
  raw: RawRow;
}

export interface ParseSummary {
  rows: ParsedRow[];
  okCount: number;
  errorCount: number;
  /** true when no recognised header column was found at all */
  headersMissing: boolean;
}

export const SHEET_TEMPLATE_HEADERS = [
  'name',
  'category',
  'width_cm',
  'height_cm',
  'shape',
  'color',
  'stock',
  'price',
  'weight',
  'article',
  'supplier',
];

// ── Header + value aliases ───────────────────────────────────────────────────

const HEADER_ALIASES: Record<keyof MaterialDraft | 'w' | 'h', string[]> = {
  name: ['name', 'title', 'material', 'component', 'დასახელება', 'კომპონენტი', 'მასალა'],
  category: ['category', 'cat', 'type', 'კატეგორია', 'ტიპი'],
  w: ['widthcm', 'width', 'w', 'სიგანე'],
  h: ['heightcm', 'height', 'h', 'სიმაღლე', 'სიგრძე', 'length', 'lengthcm'],
  depth: ['depthcm', 'depth', 'thickness', 'სისქე', 'სიღრმე'],
  shape: ['shape', 'form', 'ფორმა'],
  color: ['color', 'colour', 'ფერი'],
  stock: ['stock', 'qty', 'quantity', 'inventory', 'მარაგი', 'რაოდენობა'],
  price: ['price', 'cost', 'unitprice', 'ფასი', 'ღირებულება'],
  weight: ['weight', 'kg', 'weightkg', 'წონა'],
  article: ['article', 'articleno', 'code', 'sku', 'artno', 'არტიკული', 'კოდი'],
  supplier: ['supplier', 'vendor', 'manufacturer', 'მომწოდებელი'],
};

const CATEGORY_ALIASES: Record<string, Category> = (() => {
  const map: Record<string, Category> = {};
  for (const key of CATEGORY_ORDER) {
    map[key] = key;
    map[normalize(CATEGORIES[key].name)] = key;
  }
  // convenient English synonyms
  Object.assign(map, {
    panels: 'panel' as Category,
    walers: 'waler' as Category,
    waler: 'waler' as Category,
    corners: 'corner' as Category,
    posts: 'post' as Category,
    fillers: 'filler' as Category,
    rods: 'rod' as Category,
    rod: 'rod' as Category,
    accessory: 'acc' as Category,
    accessories: 'acc' as Category,
  });
  return map;
})();

const SHAPE_ALIASES: Record<string, Shape> = {
  rect: 'rect',
  rectangle: 'rect',
  box: 'rect',
  'მართკუთხედი': 'rect',
  l: 'L',
  lshape: 'L',
  lprofile: 'L',
  corner: 'L',
  'კუთხე': 'L',
  line: 'line',
  bar: 'line',
  linear: 'line',
  'ხაზი': 'line',
  'ღერო': 'line',
};

function normalize(value: unknown): string {
  return String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[\s_\-.*/]/g, '');
}

// ── Validation ───────────────────────────────────────────────────────────────

function pick(row: RawRow, field: keyof typeof HEADER_ALIASES): unknown {
  const aliases = HEADER_ALIASES[field];
  for (const key of Object.keys(row)) {
    if (aliases.includes(normalize(key))) return row[key];
  }
  return undefined;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return value;
  const n = Number(String(value ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

/**
 * Validates rows against the expected columns
 * (`name, category, width_cm, height_cm, shape?, color?, stock?`).
 */
export function validateRows(rows: RawRow[], existing: Material[]): ParseSummary {
  const existingNames = new Set(existing.map((m) => m.name.trim().toLowerCase()));
  const seenNames = new Set<string>();

  const headersMissing =
    rows.length > 0 &&
    pick(rows[0], 'name') === undefined &&
    pick(rows[0], 'w') === undefined &&
    pick(rows[0], 'h') === undefined;

  const parsed: ParsedRow[] = rows.map((raw, i) => {
    const errors: string[] = [];
    const warnings: string[] = [];

    const name = String(pick(raw, 'name') ?? '').trim();
    if (!name) errors.push('სახელი ცარიელია');

    const categoryRaw = normalize(pick(raw, 'category'));
    const category = CATEGORY_ALIASES[categoryRaw];
    if (!categoryRaw) errors.push('კატეგორია ცარიელია');
    else if (!category) errors.push(`უცნობი კატეგორია: "${String(pick(raw, 'category'))}"`);

    const w = toNumber(pick(raw, 'w'));
    const h = toNumber(pick(raw, 'h'));
    if (!Number.isFinite(w) || w <= 0) errors.push('სიგანე უნდა იყოს დადებითი რიცხვი');
    if (!Number.isFinite(h) || h <= 0) errors.push('სიმაღლე უნდა იყოს დადებითი რიცხვი');

    const shapeRaw = normalize(pick(raw, 'shape'));
    let shape: Shape = 'rect';
    if (shapeRaw) {
      const mapped = SHAPE_ALIASES[shapeRaw];
      if (mapped) shape = mapped;
      else warnings.push(`უცნობი ფორმა "${String(pick(raw, 'shape'))}" — გამოყენდება rect`);
    }

    const colorRaw = String(pick(raw, 'color') ?? '').trim();
    let color = category ? categoryColor(category) : '#8fa1ad';
    if (colorRaw) {
      const withHash = colorRaw.startsWith('#') ? colorRaw : `#${colorRaw}`;
      if (/^#[0-9a-fA-F]{6}$/.test(withHash)) color = withHash;
      else warnings.push(`ფერი "${colorRaw}" არავალიდურია — გამოყენდება კატეგორიის ფერი`);
    }

    /** Optional non-negative number column; warns and falls back to 0. */
    const optionalNumber = (field: 'stock' | 'price' | 'weight' | 'depth', label: string): number => {
      const value = pick(raw, field);
      if (value === undefined || String(value).trim() === '') return 0;
      const n = toNumber(value);
      if (!Number.isFinite(n) || n < 0) {
        warnings.push(`${label} არავალიდურია — დაყენდება 0`);
        return 0;
      }
      return field === 'stock' ? Math.round(n) : n;
    };

    const stock = optionalNumber('stock', 'მარაგი');
    const depth = optionalNumber('depth', 'სისქე');
    const price = optionalNumber('price', 'ფასი');
    const weight = optionalNumber('weight', 'წონა');
    const article = String(pick(raw, 'article') ?? '').trim();
    const supplier = String(pick(raw, 'supplier') ?? '').trim();

    const lower = name.toLowerCase();
    if (name && existingNames.has(lower)) warnings.push('ასეთი სახელი კატალოგში უკვე არსებობს');
    if (name && seenNames.has(lower)) warnings.push('სახელი მეორდება ამ ფაილში');
    if (name) seenNames.add(lower);

    const draft: MaterialDraft | null =
      errors.length === 0 && category
        ? {
            name,
            category,
            w,
            h,
            depth: depth > 0 ? depth : defaultDepth(category, w, h),
            shape,
            color,
            stock: { [DEFAULT_WAREHOUSE.id]: stock },
            price,
            weight,
            article,
            supplier,
          }
        : null;

    return { row: i + 2, draft, errors, warnings, raw };
  });

  return {
    rows: parsed,
    okCount: parsed.filter((r) => r.draft).length,
    errorCount: parsed.filter((r) => !r.draft).length,
    headersMissing,
  };
}

