import type {
  CatalogFile,
  Category,
  LayoutFile,
  Material,
  Piece,
  Shape,
  Warehouse,
} from '../types';
import { CATEGORIES, CATEGORY_ORDER, categoryColor, isCategory } from '../data/categories';
import { SEED_IDS_IN_ORDER } from '../data/seedCatalog';
import { downloadJson, stampedName } from './files';
import { makeMaterialId, uid } from './ids';
import { DEFAULT_WAREHOUSE, normalizeStock } from './inventory';
import { defaultDepth } from '../data/seedCatalog';

const FILE_VERSION = 2;
const SHAPES: Shape[] = ['rect', 'L', 'line'];

function num(value: unknown, fallback: number): number {
  const n = typeof value === 'number' ? value : Number(String(value ?? '').replace(',', '.'));
  return Number.isFinite(n) ? n : fallback;
}

function hexColor(value: unknown, fallback: string): string {
  const s = String(value ?? '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(s) ? s : fallback;
}

/**
 * Coerces anything that came from a file or localStorage into a valid Material.
 * Returns null when the row is too broken to repair (no name / no size).
 */
export function sanitizeMaterial(raw: unknown, taken: Set<string>): Material | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;

  const name = String(r.name ?? '').trim();
  if (!name) return null;

  const categoryRaw = String(r.category ?? '').trim();
  const category = isCategory(categoryRaw) ? categoryRaw : 'acc';

  const w = num(r.w, NaN);
  const h = num(r.h, NaN);
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return null;

  // Plan thickness; older files predate it, so fall back to the category rule.
  const depthRaw = num(r.depth, NaN);
  const depth =
    Number.isFinite(depthRaw) && depthRaw > 0 ? depthRaw : defaultDepth(category, w, h);

  const shapeRaw = String(r.shape ?? 'rect') as Shape;
  const shape = SHAPES.includes(shapeRaw) ? shapeRaw : 'rect';

  const id = typeof r.id === 'string' && r.id && !taken.has(r.id)
    ? r.id
    : makeMaterialId({ name, category, w, h }, taken);

  return {
    id,
    name,
    category,
    w,
    h,
    depth,
    shape,
    color: hexColor(r.color, categoryColor(category)),
    builtin: r.builtin === true,
    // handles both the legacy `stock: number` and the per-warehouse map
    stock: normalizeStock(r.stock),
    weight: Math.max(0, num(r.weight, 0)),
    article: String(r.article ?? '').trim(),
    supplier: String(r.supplier ?? '').trim(),
  };
}

// ── Catalog (materials + stock, no drawing) ──────────────────────────────────

export function exportCatalogFile(materials: Material[], warehouses: Warehouse[]): void {
  const data: CatalogFile = {
    app: 'du-formwork',
    kind: 'catalog',
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    materials,
    warehouses,
  };
  downloadJson(data, stampedName('du-catalog', 'json'));
}

export interface CatalogParseResult {
  materials: Material[];
  warehouses: Warehouse[];
  skipped: number;
}

export function parseCatalogFile(text: string): CatalogParseResult {
  const data = JSON.parse(text) as unknown;
  const list = Array.isArray(data)
    ? data
    : ((data as { materials?: unknown }).materials as unknown[] | undefined);
  if (!Array.isArray(list)) {
    throw new Error('ფაილში მასალების სია ვერ მოიძებნა (materials).');
  }

  const taken = new Set<string>();
  const materials: Material[] = [];
  let skipped = 0;
  for (const raw of list) {
    const m = sanitizeMaterial(raw, taken);
    if (!m) {
      skipped++;
      continue;
    }
    taken.add(m.id);
    materials.push(m);
  }
  if (!materials.length) throw new Error('ფაილში ვალიდური მასალა არ არის.');

  // Warehouses are optional: older catalogs and hand-written files just use one.
  const rawWarehouses = (data as { warehouses?: unknown }).warehouses;
  const warehouses: Warehouse[] = Array.isArray(rawWarehouses)
    ? rawWarehouses
        .filter((w): w is Warehouse => !!w && typeof (w as Warehouse).id === 'string')
        .map((w) => ({ id: w.id, name: String(w.name ?? w.id) }))
    : [];

  // Any warehouse referenced by stock but not declared still needs a name.
  const declared = new Set(warehouses.map((w) => w.id));
  for (const m of materials) {
    for (const key of Object.keys(m.stock)) {
      if (!declared.has(key)) {
        declared.add(key);
        warehouses.push({ id: key, name: key === DEFAULT_WAREHOUSE.id ? DEFAULT_WAREHOUSE.name : key });
      }
    }
  }
  if (!warehouses.length) warehouses.push({ ...DEFAULT_WAREHOUSE });

  return { materials, warehouses, skipped };
}

// ── Layout (placed pieces, no catalog) ───────────────────────────────────────

export function exportLayoutFile(pieces: Piece[]): void {
  const data: LayoutFile = {
    app: 'du-formwork',
    kind: 'layout',
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    pieces,
  };
  downloadJson(data, stampedName('du-layout', 'json'));
}

/**
 * Reads a layout file. Also accepts the v1 prototype format, where each piece
 * referenced a material by its index in the seed array (`matIndex`).
 */
export function parseLayoutFile(text: string): Piece[] {
  const data = JSON.parse(text) as { pieces?: unknown };
  const list = data?.pieces;
  if (!Array.isArray(list)) throw new Error('ფაილში ელემენტების სია ვერ მოიძებნა (pieces).');

  const pieces: Piece[] = [];
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue;
    const r = raw as Record<string, unknown>;

    let materialId = typeof r.materialId === 'string' ? r.materialId : '';
    if (!materialId && typeof r.matIndex === 'number') {
      materialId = SEED_IDS_IN_ORDER[r.matIndex] ?? '';
    }
    if (!materialId) continue;

    // Any angle is allowed, not just quarter turns.
    const rot = ((num(r.rot, 0) % 360) + 360) % 360;
    pieces.push({
      id: typeof r.id === 'string' && r.id ? r.id : uid(),
      materialId,
      x: num(r.x, 0),
      y: num(r.y, 0),
      rot,
      // elevation is optional; files written before it existed sit on the ground
      z: Math.max(0, num(r.z, 0)),
    });
  }
  if (!pieces.length) throw new Error('ფაილში ვალიდური ელემენტი არ არის.');
  return pieces;
}

/** Category keys with labels — used by the material form dropdown. */
export const CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = CATEGORY_ORDER.map(
  (key) => ({ value: key, label: CATEGORIES[key].name }),
);
