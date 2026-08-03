/** Random id for placed pieces (not user visible). */
export function uid(prefix = 'pc'): string {
  const rnd =
    typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID().replace(/-/g, '').slice(0, 10)
      : Math.random().toString(36).slice(2, 12);
  return `${prefix}_${Date.now().toString(36)}${rnd}`;
}

/** ASCII slug; Georgian text slugs to '' so callers must supply a fallback. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 32);
}

/**
 * Stable, human-readable id for a material. Georgian names produce no ASCII
 * slug, so we fall back to `<category>-<w>x<h>` and de-duplicate with a suffix.
 */
export function makeMaterialId(
  draft: { name: string; category: string; w: number; h: number },
  taken: Set<string>,
): string {
  const slug = slugify(draft.name);
  const base = slug
    ? `${draft.category}-${slug}`
    : `${draft.category}-${Math.round(draft.w)}x${Math.round(draft.h)}`;
  let id = base;
  let n = 2;
  while (taken.has(id)) id = `${base}-${n++}`;
  return id;
}
