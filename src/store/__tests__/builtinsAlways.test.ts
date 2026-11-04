import { describe, expect, it } from 'vitest';
import { mergeCatalog, useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';

/** The built-in catalog always exists (the user, 2026-11-04). */
describe('built-ins', () => {
  it('come back when a saved catalog is missing one, removed or not', () => {
    const saved = createSeedMaterials().filter((m) => m.id !== 'corner-outer-300');
    const merged = mergeCatalog(saved, ['corner-outer-300']);
    const corner = merged.find((m) => m.id === 'corner-outer-300')!;
    expect(corner.name).toBe('გარე კუთხე 300');
    expect(corner.shape).toBe('L');
    expect(corner.leg).toBe(0.1);
  });

  it('cannot be deleted', () => {
    useEditorStore.setState({ materials: createSeedMaterials(), pieces: [] });
    useEditorStore.getState().deleteMaterial('corner-outer-300', true);
    expect(useEditorStore.getState().materials.some((m) => m.id === 'corner-outer-300')).toBe(true);
  });

  it('stay when a catalog is replaced from a file', () => {
    useEditorStore.setState({ materials: createSeedMaterials(), pieces: [] });
    const own = { ...createSeedMaterials()[0], id: 'mine', name: 'ჩემი', builtin: false };
    useEditorStore.getState().replaceCatalog([own]);
    const ids = useEditorStore.getState().materials.map((m) => m.id);
    expect(ids).toContain('mine');
    expect(ids).toContain('corner-outer-300');
    expect(ids).toContain('waler-rod-40');
  });

  it('come back from the server for someone who may save the catalog', () => {
    useEditorStore.getState().hydrateFromServer(
      { materials: createSeedMaterials().filter((m) => m.id !== 'corner-outer-300'), warehouses: [], documents: [] },
      { restoreBuiltins: true },
    );
    expect(useEditorStore.getState().materials.some((m) => m.id === 'corner-outer-300')).toBe(true);
  });
});
