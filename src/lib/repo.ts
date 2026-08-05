import type { DrawingDoc, Material, Piece, StockByWarehouse, Warehouse } from '../types';
import { requireSupabase } from './supabase';
import type { DataSnapshot, SyncPlan } from './syncDiff';

/**
 * Every read and write of company data. The rest of the app talks to this,
 * never to the Supabase client directly, so the row shapes stay in one file.
 */

/** Thrown when a drawing was saved by someone else since we last read it. */
export class ConflictError extends Error {
  constructor(public readonly documentId: string) {
    super(`document ${documentId} was changed by someone else`);
    this.name = 'ConflictError';
  }
}

/**
 * Thrown when the server refused a write because of the user's role.
 *
 * Distinct from an ordinary failure because retrying cannot help: the change
 * will be refused every time, so the sync engine must stop rather than queue
 * it forever, and the user has to be told what was refused instead of seeing
 * a permanent "saving failed".
 */
export class PermissionError extends Error {
  constructor(public readonly what: string) {
    super(`not allowed to change ${what}`);
    this.name = 'PermissionError';
  }
}

interface PostgrestLikeError {
  message: string;
  code?: string;
}

/**
 * Turn a Postgrest error into ours, keeping the distinction between "try
 * again" and "you will never be allowed to do this".
 *
 * 42501 is Postgres's insufficient_privilege, which covers both a missing
 * table grant and a row-level security policy refusing the row. The message
 * text is checked too, because the RPCs raise their own exceptions.
 */
function wrapError(what: string, error: PostgrestLikeError): Error {
  const text = error.message.toLowerCase();
  const denied =
    error.code === '42501' ||
    text.includes('permission denied') ||
    text.includes('row-level security') ||
    text.includes('only an admin');
  if (denied) return new PermissionError(what);
  return new Error(`${what}: ${error.message}`);
}

/**
 * Server version of each drawing we have seen, used for optimistic locking.
 *
 * Deliberately not in the editor store: it is bookkeeping about the server,
 * not user data, and putting it in the store would drag it into undo history
 * and the persisted snapshot.
 */
const versions = new Map<string, number>();

export function knownVersion(id: string): number | undefined {
  return versions.get(id);
}

export function forgetVersions(): void {
  versions.clear();
}

// ── row shapes ─────────────────────────────────────────────────────────────

interface MaterialRow {
  id: string;
  name: string;
  category: Material['category'];
  w: number;
  h: number;
  depth: number;
  shape: Material['shape'];
  color: string;
  builtin: boolean;
  weight: number;
  article: string;
  supplier: string;
}

interface DocumentRow {
  id: string;
  name: string;
  project_name: string;
  revision: string;
  scale: number;
  pieces: Piece[];
  version: number;
  updated_at: string;
}

/** Stock lives in its own table, so it is stripped on the way out. */
function materialToRow(m: Material): MaterialRow {
  return {
    id: m.id,
    name: m.name,
    category: m.category,
    w: m.w,
    h: m.h,
    depth: m.depth,
    shape: m.shape,
    color: m.color,
    builtin: m.builtin,
    weight: m.weight,
    article: m.article,
    supplier: m.supplier,
  };
}

function rowToMaterial(row: MaterialRow, stock: StockByWarehouse): Material {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    w: Number(row.w),
    h: Number(row.h),
    depth: Number(row.depth),
    shape: row.shape,
    color: row.color,
    builtin: row.builtin,
    weight: Number(row.weight),
    article: row.article,
    supplier: row.supplier,
    stock,
  };
}

function documentToRow(d: DrawingDoc) {
  return {
    id: d.id,
    name: d.name,
    project_name: d.projectName,
    revision: d.revision,
    scale: d.scale,
    pieces: d.pieces,
  };
}

function rowToDocument(row: DocumentRow): DrawingDoc {
  return {
    id: row.id,
    name: row.name,
    projectName: row.project_name,
    revision: row.revision,
    scale: row.scale,
    pieces: Array.isArray(row.pieces) ? row.pieces : [],
    updatedAt: new Date(row.updated_at).getTime(),
  };
}

// ── reads ──────────────────────────────────────────────────────────────────

export async function fetchAll(): Promise<DataSnapshot> {
  const supabase = requireSupabase();

  const [materialsRes, warehousesRes, stockRes, documentsRes] = await Promise.all([
    supabase.from('materials').select('*').order('name'),
    supabase.from('warehouses').select('*').order('name'),
    supabase.from('stock').select('material_id, warehouse_id, quantity'),
    supabase.from('documents').select('*').order('updated_at', { ascending: false }),
  ]);

  const failed = [materialsRes, warehousesRes, stockRes, documentsRes].find((r) => r.error);
  if (failed?.error) throw new Error(failed.error.message);

  const stockByMaterial = new Map<string, StockByWarehouse>();
  for (const row of (stockRes.data ?? []) as Array<{
    material_id: string;
    warehouse_id: string;
    quantity: number;
  }>) {
    const map = stockByMaterial.get(row.material_id) ?? {};
    map[row.warehouse_id] = row.quantity;
    stockByMaterial.set(row.material_id, map);
  }

  const documents = ((documentsRes.data ?? []) as DocumentRow[]).map((row) => {
    versions.set(row.id, row.version);
    return rowToDocument(row);
  });

  return {
    materials: ((materialsRes.data ?? []) as MaterialRow[]).map((row) =>
      rowToMaterial(row, stockByMaterial.get(row.id) ?? {}),
    ),
    warehouses: (warehousesRes.data ?? []) as Warehouse[],
    documents,
  };
}

/** True when the backend has no company data yet, so an import is offered. */
export async function isServerEmpty(): Promise<boolean> {
  const supabase = requireSupabase();
  const [materials, documents] = await Promise.all([
    supabase.from('materials').select('id', { count: 'exact', head: true }),
    supabase.from('documents').select('id', { count: 'exact', head: true }),
  ]);
  if (materials.error) throw new Error(materials.error.message);
  if (documents.error) throw new Error(documents.error.message);
  return (materials.count ?? 0) === 0 && (documents.count ?? 0) === 0;
}

// ── writes ─────────────────────────────────────────────────────────────────

/**
 * Push one plan.
 *
 * Ordering is load-bearing: warehouses and materials must exist before stock
 * can reference them, stock must be written before a warehouse it points at is
 * removed, and deletes come last so nothing is dropped that a later step in
 * the same plan still needs.
 */
export async function applyPlan(plan: SyncPlan): Promise<void> {
  const supabase = requireSupabase();

  if (plan.warehousesUpsert.length) {
    const { error } = await supabase.from('warehouses').upsert(plan.warehousesUpsert);
    if (error) throw wrapError('საწყობები', error);
  }

  if (plan.materialsUpsert.length) {
    const { error } = await supabase
      .from('materials')
      .upsert(plan.materialsUpsert.map(materialToRow));
    if (error) throw wrapError('მასალები', error);
  }

  for (const change of plan.stockSet) {
    const { error } = await supabase.rpc('set_stock', {
      p_material_id: change.materialId,
      p_warehouse_id: change.warehouseId,
      p_quantity: change.quantity,
      p_note: '',
    });
    if (error) throw wrapError('მარაგი', error);
  }

  for (const doc of plan.documentsUpsert) {
    await saveDocument(doc);
  }

  if (plan.documentsDelete.length) {
    const { error } = await supabase.from('documents').delete().in('id', plan.documentsDelete);
    if (error) throw wrapError('ნახაზები', error);
    for (const id of plan.documentsDelete) versions.delete(id);
  }

  if (plan.materialsDelete.length) {
    const { error } = await supabase.from('materials').delete().in('id', plan.materialsDelete);
    if (error) throw wrapError('მასალები', error);
  }

  if (plan.warehousesDelete.length) {
    const { error } = await supabase.from('warehouses').delete().in('id', plan.warehousesDelete);
    if (error) throw wrapError('საწყობები', error);
  }
}

/**
 * Insert or update one drawing.
 *
 * The update is conditional on the version we last read. If someone else saved
 * in the meantime the row no longer matches, nothing is written, and a
 * ConflictError is raised rather than their work being overwritten.
 */
export async function saveDocument(doc: DrawingDoc): Promise<number> {
  const supabase = requireSupabase();
  const expected = versions.get(doc.id);

  if (expected === undefined) {
    const { data, error } = await supabase
      .from('documents')
      .insert(documentToRow(doc))
      .select('version')
      .single();
    if (error) throw wrapError(`ნახაზი "${doc.name}"`, error);
    const version = (data as { version: number }).version;
    versions.set(doc.id, version);
    return version;
  }

  const { data, error } = await supabase
    .from('documents')
    .update(documentToRow(doc))
    .eq('id', doc.id)
    .eq('version', expected)
    .select('version');

  if (error) throw wrapError(`ნახაზი "${doc.name}"`, error);
  if (!data || data.length === 0) throw new ConflictError(doc.id);

  const version = (data[0] as { version: number }).version;
  versions.set(doc.id, version);
  return version;
}

/** Re-read one drawing, e.g. after a conflict, and adopt the server's version. */
export async function reloadDocument(id: string): Promise<DrawingDoc | null> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.from('documents').select('*').eq('id', id).maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const row = data as DocumentRow;
  versions.set(row.id, row.version);
  return rowToDocument(row);
}
