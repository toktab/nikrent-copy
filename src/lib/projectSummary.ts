import type { DrawingDoc, Material } from '../types';
import { CATEGORY_ORDER } from '../data/categories';
import { countPieces } from './inventory';

/**
 * One drawing in a few numbers: what it uses and how much of it.
 *
 * For the drawings menu - the hover line and the details window - which look
 * at drawings other than the open one, so this works from a `DrawingDoc` and
 * never from the store's mirrored `pieces`.
 */
export interface ProjectPart {
  material: Material;
  count: number;
}

export interface ProjectSummary {
  /** pieces placed */
  pieces: number;
  /** distinct components */
  kinds: number;
  /** kg, over the parts whose weight is known */
  weightKg: number;
  /** most-used first, then by category order and name - the hover reads the top */
  parts: ProjectPart[];
  /** pieces whose material has left the catalog */
  orphans: number;
}

export function projectSummary(doc: DrawingDoc, materials: Material[]): ProjectSummary {
  const byId = new Map(materials.map((m) => [m.id, m]));
  const rank = new Map(CATEGORY_ORDER.map((c, i) => [c, i]));
  const parts: ProjectPart[] = [];
  let orphans = 0;
  let weightKg = 0;
  for (const [id, count] of countPieces(doc.pieces)) {
    const material = byId.get(id);
    if (!material) {
      orphans += count;
      continue;
    }
    parts.push({ material, count });
    weightKg += count * material.weight;
  }
  parts.sort(
    (a, b) =>
      b.count - a.count ||
      (rank.get(a.material.category) ?? 0) - (rank.get(b.material.category) ?? 0) ||
      a.material.name.localeCompare(b.material.name, 'ka'),
  );
  return { pieces: doc.pieces.length, kinds: parts.length, weightKg, parts, orphans };
}
