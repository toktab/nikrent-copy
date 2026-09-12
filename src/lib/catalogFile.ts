import type {
  CatalogFile,
  Category,
  DrawingDoc,
  LayoutFile,
  Material,
  MeasureLine,
  Piece,
  Shape,
  SketchPath,
  Warehouse,
} from '../types';
import { CATEGORIES, CATEGORY_ORDER, categoryColor, isCategory } from '../data/categories';
import { SEED_IDS_IN_ORDER } from '../data/seedCatalog';
import { downloadJson, stampedName } from './files';
import { makeMaterialId, uid } from './ids';
import { DEFAULT_WAREHOUSE, normalizeStock } from './inventory';
import { defaultDepth } from '../data/seedCatalog';
import { DRAW_STEP_CM } from './geometry';

/** 3 = the whole drawing: sketch, measured lines, title block, used materials. */
const FILE_VERSION = 3;
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

// ── Layout (one whole drawing) ───────────────────────────────────────────────

/**
 * Everything needed to open this drawing somewhere else, as a plain object.
 *
 * Separate from the download so the round trip can be tested without a
 * browser. Only the materials the pieces actually use go along, and without
 * their stock: the receiving machine needs to know what a "პანელი 45*300" is,
 * not how many this yard happens to own.
 */
export function buildLayoutFile(doc: DrawingDoc, materials: Material[]): LayoutFile {
  const used = new Set(doc.pieces.map((p) => p.materialId));
  return {
    app: 'du-formwork',
    kind: 'layout',
    version: FILE_VERSION,
    exportedAt: new Date().toISOString(),
    name: doc.name,
    projectName: doc.projectName,
    revision: doc.revision,
    scale: doc.scale,
    pieces: doc.pieces,
    sketch: doc.sketch ?? [],
    measures: doc.measures ?? [],
    materials: materials.filter((m) => used.has(m.id)).map((m) => ({ ...m, stock: {} })),
  };
}

export function exportLayoutFile(doc: DrawingDoc, materials: Material[]): void {
  downloadJson(buildLayoutFile(doc, materials), stampedName('du-layout', 'json'));
}

export interface LayoutMeta {
  name: string;
  projectName: string;
  revision: string;
  /** null when the file did not say, so the receiving drawing keeps its default */
  scale: number | null;
}

export interface ParsedLayout {
  meta: LayoutMeta;
  pieces: Piece[];
  sketch: SketchPath[];
  measures: MeasureLine[];
  /** definitions the file offers for the materials its pieces use */
  materials: Material[];
}

function point(raw: unknown): { x: number; y: number } | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const x = num(r.x, NaN);
  const y = num(r.y, NaN);
  return Number.isFinite(x) && Number.isFinite(y) ? { x, y } : null;
}

/**
 * One drawn run from a file, or null when there is no line left in it.
 *
 * A point that does not parse is dropped rather than read as 0,0: a stray
 * vertex at the origin would drag a wall across the whole drawing, which is
 * worse than a leg going missing.
 */
export function sanitizeSketchPath(raw: unknown): SketchPath | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  if (!Array.isArray(r.points)) return null;
  const points = r.points.map(point).filter((p): p is { x: number; y: number } => p !== null);
  if (points.length < 2) return null;
  return {
    id: uid('sk'),
    points,
    ...(r.closed === true ? { closed: true } : {}),
    ...(r.perimeter === 'outer' || r.perimeter === 'inner' ? { perimeter: r.perimeter } : {}),
  };
}

/** One measured line from a file; shorter than the drawing grid is not a measurement. */
export function sanitizeMeasure(raw: unknown): MeasureLine | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const a = point(r.a);
  const b = point(r.b);
  if (!a || !b || Math.hypot(b.x - a.x, b.y - a.y) < DRAW_STEP_CM) return null;
  return { id: uid('ms'), a, b };
}

/**
 * Reads a drawing file: the current whole-drawing format, the older one that
 * held only pieces, and the v1 prototype format, where each piece referenced a
 * material by its index in the seed array (`matIndex`).
 *
 * Every id is minted fresh. The file becomes a new drawing, and importing the
 * same file twice must not produce two drawings sharing piece and line ids.
 */
export function parseLayoutFile(text: string): ParsedLayout {
  const data = JSON.parse(text) as Record<string, unknown> | null;
  if (
    !data ||
    typeof data !== 'object' ||
    (!Array.isArray(data.pieces) && !Array.isArray(data.sketch) && !Array.isArray(data.measures))
  ) {
    throw new Error('ფაილში ნახაზის ელემენტები ვერ მოიძებნა (pieces).');
  }

  const pieces: Piece[] = [];
  for (const raw of Array.isArray(data.pieces) ? data.pieces : []) {
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
      id: uid(),
      materialId,
      x: num(r.x, 0),
      y: num(r.y, 0),
      rot,
      // elevation is optional; files written before it existed sit on the ground
      z: Math.max(0, num(r.z, 0)),
    });
  }

  const sketch = (Array.isArray(data.sketch) ? data.sketch : [])
    .map(sanitizeSketchPath)
    .filter((k): k is SketchPath => k !== null);
  const measures = (Array.isArray(data.measures) ? data.measures : [])
    .map(sanitizeMeasure)
    .filter((m): m is MeasureLine => m !== null);

  if (!pieces.length && !sketch.length && !measures.length) {
    throw new Error('ფაილში ვალიდური ელემენტი არ არის.');
  }

  // Material ids have to survive exactly - they are what the pieces point at.
  const taken = new Set<string>();
  const materials: Material[] = [];
  for (const raw of Array.isArray(data.materials) ? data.materials : []) {
    const m = sanitizeMaterial(raw, taken);
    if (!m) continue;
    taken.add(m.id);
    materials.push({ ...m, stock: {} });
  }

  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '');
  // Only a real number counts. `num` reads a missing value as 0, and 0 is the
  // "auto scale" setting - an old file would have switched the drawing to it.
  const scale = typeof data.scale === 'number' ? data.scale : NaN;
  return {
    meta: {
      name: str(data.name),
      projectName: str(data.projectName),
      revision: str(data.revision),
      scale: Number.isFinite(scale) && scale >= 0 ? scale : null,
    },
    pieces,
    sketch,
    measures,
    materials,
  };
}

/** Category keys with labels — used by the material form dropdown. */
export const CATEGORY_OPTIONS: Array<{ value: Category; label: string }> = CATEGORY_ORDER.map(
  (key) => ({ value: key, label: CATEGORIES[key].name }),
);
