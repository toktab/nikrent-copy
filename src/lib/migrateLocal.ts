import type { EditorState } from '../store/useEditorStore';
import { STORAGE_KEY, mergeCatalog, restoreDocuments, restoreWarehouses } from '../store/useEditorStore';
import type { Piece } from '../types';
import type { DataSnapshot } from './syncDiff';

/**
 * One-time import of the data the app kept in localStorage before it had a
 * server.
 *
 * The parsing deliberately reuses the store's own restore helpers rather than
 * reimplementing them. They already cope with every shape this key has held —
 * v2's single top-level `pieces` array, stock stored as a bare number, a
 * missing warehouse list — and a second parser that disagreed with the first
 * would corrupt exactly the data this is meant to rescue.
 *
 * Nothing here deletes the local copy. It stays as a backup, and because the
 * app now writes preferences to a different key, it stays intact.
 */

interface PersistedEnvelope {
  state?: Partial<EditorState> & { pieces?: Piece[] };
  version?: number;
}

/** The old payload, or null if there is nothing usable there. */
export function readLegacyData(): DataSnapshot | null {
  let raw: string | null = null;
  try {
    raw = localStorage.getItem(STORAGE_KEY);
  } catch {
    return null; // private browsing, storage disabled
  }
  if (!raw) return null;

  let envelope: PersistedEnvelope;
  try {
    envelope = JSON.parse(raw) as PersistedEnvelope;
  } catch {
    return null;
  }

  const saved = envelope?.state;
  if (!saved || typeof saved !== 'object') return null;

  const materials = mergeCatalog(saved.materials, saved.removedBuiltins);
  const warehouses = restoreWarehouses(saved.warehouses, materials);
  const { documents } = restoreDocuments(saved);

  const hasDrawnAnything = documents.some((d) => d.pieces.length > 0);
  const hasCustomCatalog = materials.some((m) => !m.builtin);
  const hasStock = materials.some((m) => Object.values(m.stock).some((q) => q > 0));

  // A catalog of untouched built-ins with no stock and no pieces is just the
  // seed data — importing it would be indistinguishable from a fresh start,
  // so it does not count as something worth offering to migrate.
  if (!hasDrawnAnything && !hasCustomCatalog && !hasStock) return null;

  return { materials, warehouses, documents };
}

/** A short human summary for the import prompt. */
export function describeLegacyData(snapshot: DataSnapshot): {
  drawings: number;
  pieces: number;
  materials: number;
  customMaterials: number;
  stockUnits: number;
} {
  return {
    drawings: snapshot.documents.length,
    pieces: snapshot.documents.reduce((sum, d) => sum + d.pieces.length, 0),
    materials: snapshot.materials.length,
    customMaterials: snapshot.materials.filter((m) => !m.builtin).length,
    stockUnits: snapshot.materials.reduce(
      (sum, m) => sum + Object.values(m.stock).reduce((a, b) => a + (b || 0), 0),
      0,
    ),
  };
}
