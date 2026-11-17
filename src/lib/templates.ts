import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds, unionRect } from './geometry';
import { uid } from './ids';
import { translatePath } from './sketch';
import { isConfigured, requireSupabase } from './supabase';

/**
 * შაბლონები - saved assemblies that can be dropped into any drawing.
 *
 * Pieces are stored relative to their own top-left corner rather than at the
 * coordinates they happened to occupy when saved. Otherwise a template would
 * reappear wherever it was first drawn, which on a large layout can be far off
 * screen - the user clicks "insert" and nothing visibly happens.
 *
 * Mostly კოლონები (the user, 2026-11-16), and each has a price of its own: one
 * column of that type, delivered. Every drop is tagged (Piece.tpl / tplInst)
 * so the export can count how many of each went in and price the set - the
 * კომპლექტის ფასი.
 *
 * With a server they are the company's, in the `templates` table (price and
 * the drawn lines need migration 0015). Without one - the offline build - they
 * live in this browser, so the feature works there too instead of refusing.
 */

export interface Template {
  id: string;
  name: string;
  pieces: Piece[];
  /** the drawn lines that came with it, relative like the pieces */
  sketch: SketchPath[];
  width: number;
  height: number;
  /** price of one, in ₾; null = not set */
  price: number | null;
}

interface TemplateRow {
  id: string;
  name: string;
  pieces: Piece[];
  sketch?: SketchPath[] | null;
  width: number;
  height: number;
  price?: number | string | null;
}

const LOCAL_KEY = 'kubi.templates.v1';

function fromRow(r: TemplateRow): Template {
  const price = r.price === null || r.price === undefined || r.price === '' ? null : Number(r.price);
  return {
    id: r.id,
    name: r.name,
    pieces: Array.isArray(r.pieces) ? r.pieces : [],
    sketch: Array.isArray(r.sketch) ? r.sketch : [],
    width: Number(r.width),
    height: Number(r.height),
    price: price !== null && Number.isFinite(price) ? price : null,
  };
}

function readLocal(): Template[] {
  try {
    const raw = localStorage.getItem(LOCAL_KEY);
    const rows = raw ? (JSON.parse(raw) as TemplateRow[]) : [];
    return Array.isArray(rows) ? rows.map(fromRow) : [];
  } catch {
    return [];
  }
}

function writeLocal(rows: Template[]): void {
  try {
    localStorage.setItem(LOCAL_KEY, JSON.stringify(rows));
  } catch {
    // A full or blocked storage loses the save; the caller's toast still says
    // what was attempted, and nothing on the drawing depends on it.
  }
}

/** A column the database does not have yet - migration 0015 not run. */
function missingColumn(message: string): boolean {
  return /column .*(price|sketch)|(price|sketch).* does not exist|schema cache/i.test(message);
}

/** Whether the server has the price and lines columns - learnt on the first read. */
let serverHasExtras = true;

export async function listTemplates(): Promise<Template[]> {
  if (!isConfigured) return readLocal().sort((a, b) => a.name.localeCompare(b.name));
  const supabase = requireSupabase();
  const full = await supabase.from('templates').select('id, name, pieces, sketch, width, height, price').order('name');
  let data = full.data as TemplateRow[] | null;
  let error = full.error;
  if (error && missingColumn(error.message)) {
    // Before 0015: the templates still list, without a price.
    serverHasExtras = false;
    const old = await supabase.from('templates').select('id, name, pieces, width, height').order('name');
    data = old.data as TemplateRow[] | null;
    error = old.error;
  } else if (!error) serverHasExtras = true;
  if (error) throw new Error(error.message);
  return ((data ?? []) as TemplateRow[]).map(fromRow);
}

/** False when the server is missing migration 0015 - prices cannot be kept there yet. */
export function templatePricesSaved(): boolean {
  return !isConfigured || serverHasExtras;
}

/**
 * Move a set of pieces (and lines) so their combined bounding box starts at
 * the origin, and report that box.
 */
export function normalize(
  pieces: Piece[],
  byId: Map<string, Material>,
  sketch: SketchPath[] = [],
): { pieces: Piece[]; sketch: SketchPath[]; width: number; height: number } {
  const rects = pieces.map((p) => byId.get(p.materialId)).map((m, i) =>
    m ? pieceBounds(pieces[i], m) : null,
  );
  for (const k of sketch) {
    for (const pt of k.points) rects.push({ x: pt.x, y: pt.y, w: 0, h: 0 });
  }
  const box = unionRect(rects.filter((r): r is NonNullable<typeof r> => r !== null));
  if (!box) return { pieces: pieces.map((p) => ({ ...p })), sketch: sketch.map((k) => ({ ...k })), width: 0, height: 0 };

  return {
    // A template's own pieces are not from another template drop.
    pieces: pieces.map(({ tpl: _t, tplInst: _i, ...p }) => ({ ...p, x: p.x - box.x, y: p.y - box.y })),
    sketch: sketch.map((k) => translatePath(k, -box.x, -box.y)),
    width: Math.round(box.w),
    height: Math.round(box.h),
  };
}

/**
 * Copy a template's pieces and lines to a drop point, with fresh ids, tagged
 * as one drop of that template.
 *
 * New ids matter: reusing them would make the second copy of a template share
 * identity with the first, so selecting one would select both and deleting one
 * would delete both.
 */
export function instantiate(
  template: Template,
  atX: number,
  atY: number,
): { pieces: Piece[]; sketch: SketchPath[] } {
  const inst = uid('ti');
  return {
    pieces: template.pieces.map((p) => ({
      ...p,
      id: uid(),
      x: p.x + atX,
      y: p.y + atY,
      tpl: template.id,
      tplInst: inst,
    })),
    sketch: (template.sketch ?? []).map((k) => ({ ...translatePath(k, atX, atY), id: uid('sk') })),
  };
}

export async function saveTemplate(
  name: string,
  pieces: Piece[],
  byId: Map<string, Material>,
  extra: { sketch?: SketchPath[]; price?: number | null } = {},
): Promise<Template> {
  const normalized = normalize(pieces, byId, extra.sketch ?? []);
  const t: Template = {
    id: uid('tpl'),
    name: name.trim(),
    pieces: normalized.pieces,
    sketch: normalized.sketch,
    width: normalized.width,
    height: normalized.height,
    price: extra.price ?? null,
  };
  if (!isConfigured) {
    writeLocal([...readLocal(), t]);
    return t;
  }
  const supabase = requireSupabase();
  const base: Record<string, unknown> = { id: t.id, name: t.name, pieces: t.pieces, width: t.width, height: t.height };
  let { error } = await supabase
    .from('templates')
    .insert(serverHasExtras ? { ...base, sketch: t.sketch, price: t.price } : base);
  if (error && missingColumn(error.message)) {
    serverHasExtras = false;
    ({ error } = await supabase.from('templates').insert(base));
  }
  if (error) throw new Error(error.message);
  return t;
}

export async function updateTemplate(id: string, patch: { name?: string; price?: number | null }): Promise<void> {
  const clean: { name?: string; price?: number | null } = {};
  if (patch.name !== undefined) clean.name = patch.name.trim();
  if (patch.price !== undefined) clean.price = patch.price;
  if (!isConfigured) {
    writeLocal(readLocal().map((t) => (t.id === id ? { ...t, ...clean } : t)));
    return;
  }
  const supabase = requireSupabase();
  const { error } = await supabase.from('templates').update(clean).eq('id', id);
  if (error) {
    if (missingColumn(error.message)) {
      throw new Error('ფასის შესანახად სერვერზე migration 0015_template_price.sql უნდა გაეშვას.');
    }
    throw new Error(error.message);
  }
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  return updateTemplate(id, { name });
}

export async function deleteTemplate(id: string): Promise<void> {
  if (!isConfigured) {
    writeLocal(readLocal().filter((t) => t.id !== id));
    return;
  }
  const supabase = requireSupabase();
  const { error } = await supabase.from('templates').delete().eq('id', id);
  if (error) throw new Error(error.message);
}

/** Material ids a template needs that this catalog no longer has. */
export function missingMaterials(template: Template, byId: Map<string, Material>): string[] {
  const missing = new Set<string>();
  for (const p of template.pieces) if (!byId.has(p.materialId)) missing.add(p.materialId);
  return [...missing];
}

/**
 * How many of each template a drawing holds: one per drop still on it (any of
 * its pieces left). What the კომპლექტის ფასი multiplies by.
 */
export function templateCounts(pieces: Piece[]): Map<string, number> {
  const seen = new Map<string, Set<string>>();
  for (const p of pieces) {
    if (!p.tpl || !p.tplInst) continue;
    const set = seen.get(p.tpl) ?? new Set<string>();
    set.add(p.tplInst);
    seen.set(p.tpl, set);
  }
  return new Map([...seen].map(([id, s]) => [id, s.size]));
}

/**
 * Copies of template pieces (duplicate, paste, array) are new drops of that
 * template, not more pieces of the old one: each instance copied gets an id of
 * its own, so a duplicated column counts as a second column in the set price.
 */
export function freshTemplateInstances(pieces: Piece[]): Piece[] {
  const remap = new Map<string, string>();
  return pieces.map((p) => {
    if (!p.tplInst) return p;
    let next = remap.get(p.tplInst);
    if (!next) {
      next = uid('ti');
      remap.set(p.tplInst, next);
    }
    return { ...p, tplInst: next };
  });
}

/**
 * A template's shape as a key: every piece by part, place, turn and height,
 * relative to the whole - so the same column saved twice, wherever it stood,
 * reads the same (the user, 2026-11-16: "show that it already exists").
 */
export function templateKey(pieces: Piece[], byId: Map<string, Material>): string {
  const n = normalize(pieces, byId).pieces;
  return n
    .map((p) => `${p.materialId}@${Math.round(p.x)},${Math.round(p.y)},${Math.round(((p.rot % 360) + 360) % 360)},${Math.round(p.z ?? 0)}`)
    .sort()
    .join('|');
}

/** The saved template with exactly this layout, if there is one. */
export function sameTemplate(
  pieces: Piece[],
  byId: Map<string, Material>,
  templates: Template[],
): Template | null {
  if (!pieces.length) return null;
  const key = templateKey(pieces, byId);
  return templates.find((t) => t.pieces.length === pieces.length && templateKey(t.pieces, byId) === key) ?? null;
}

/** Columns built with the კოლონა button are a type of their own: "col:<short>x<long>x<height>". */
const COLUMN_TYPE = /^col:(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)$/;

/** The type id of a column from the კოლონა button - 40 × 60 and 60 × 40 are one type. */
export function columnTypeId(spec: { sectionX: number; sectionY: number; height: number }): string {
  const [a, b] = [spec.sectionX, spec.sectionY].sort((x, y) => x - y);
  return `col:${a}x${b}x${spec.height}`;
}

/** "კოლონა 40×60, 300 სმ" for a კოლონა-button type id; null for a saved template's id. */
export function columnTypeName(id: string): string | null {
  const m = COLUMN_TYPE.exec(id);
  return m ? `კოლონა ${m[1]}×${m[2]}, ${m[3]} სმ` : null;
}
