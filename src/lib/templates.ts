import type { Material, Piece } from '../types';
import { pieceBounds, unionRect } from './geometry';
import { uid } from './ids';
import { requireSupabase } from './supabase';

/**
 * Saved assemblies that can be dropped into any drawing.
 *
 * Pieces are stored relative to their own top-left corner rather than at the
 * coordinates they happened to occupy when saved. Otherwise a template would
 * reappear wherever it was first drawn, which on a large layout can be far off
 * screen — the user clicks "insert" and nothing visibly happens.
 */

export interface Template {
  id: string;
  name: string;
  pieces: Piece[];
  width: number;
  height: number;
}

interface TemplateRow {
  id: string;
  name: string;
  pieces: Piece[];
  width: number;
  height: number;
}

export async function listTemplates(): Promise<Template[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('templates')
    .select('id, name, pieces, width, height')
    .order('name');
  if (error) throw new Error(error.message);
  return ((data ?? []) as TemplateRow[]).map((r) => ({
    ...r,
    pieces: Array.isArray(r.pieces) ? r.pieces : [],
    width: Number(r.width),
    height: Number(r.height),
  }));
}

/**
 * Move a set of pieces so their combined bounding box starts at the origin,
 * and report that box.
 */
export function normalize(
  pieces: Piece[],
  byId: Map<string, Material>,
): { pieces: Piece[]; width: number; height: number } {
  const rects = pieces.map((p) => byId.get(p.materialId)).map((m, i) =>
    m ? pieceBounds(pieces[i], m) : null,
  );
  const box = unionRect(rects.filter((r): r is NonNullable<typeof r> => r !== null));
  if (!box) return { pieces: pieces.map((p) => ({ ...p })), width: 0, height: 0 };

  return {
    pieces: pieces.map((p) => ({ ...p, x: p.x - box.x, y: p.y - box.y })),
    width: Math.round(box.w),
    height: Math.round(box.h),
  };
}

/**
 * Copy a template's pieces to a drop point, with fresh ids.
 *
 * New ids matter: reusing them would make the second copy of a template share
 * identity with the first, so selecting one would select both and deleting one
 * would delete both.
 */
export function instantiate(template: Template, atX: number, atY: number): Piece[] {
  return template.pieces.map((p) => ({
    ...p,
    id: uid(),
    x: p.x + atX,
    y: p.y + atY,
  }));
}

export async function saveTemplate(
  name: string,
  pieces: Piece[],
  byId: Map<string, Material>,
): Promise<Template> {
  const supabase = requireSupabase();
  const normalized = normalize(pieces, byId);
  const row: TemplateRow = {
    id: uid('tpl'),
    name: name.trim(),
    pieces: normalized.pieces,
    width: normalized.width,
    height: normalized.height,
  };

  const { error } = await supabase.from('templates').insert(row);
  if (error) throw new Error(error.message);
  return row;
}

export async function renameTemplate(id: string, name: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('templates').update({ name: name.trim() }).eq('id', id);
  if (error) throw new Error(error.message);
}

export async function deleteTemplate(id: string): Promise<void> {
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
