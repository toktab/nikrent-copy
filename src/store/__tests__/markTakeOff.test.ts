import { describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';
import { soloPanels, WALER_OFF } from '../../lib/walers';
import type { Piece } from '../../types';

/** Every object can be picked (the user, 2026-11-07) - the worked-out ვოლერი too. */
describe('a worked-out ვოლერი picked and deleted', () => {
  it('is taken off that panel, and ავტომატურად თავიდან დასმა puts it back', () => {
    const materials = createSeedMaterials();
    const byId = new Map(materials.map((m) => [m.id, m]));
    const panel: Piece = { id: 'lone', materialId: 'panel-90x300', x: 0, y: 0, rot: 0 };
    useEditorStore.setState({ materials, pieces: [panel], selectedIds: [] });
    expect(soloPanels(useEditorStore.getState().pieces, byId)).toHaveLength(1);

    useEditorStore.getState().selectMark({ kind: 'waler', key: 'k', targets: [{ id: 'lone', tag: WALER_OFF }] });
    useEditorStore.getState().deleteSelected();
    const after = useEditorStore.getState();
    expect(after.pieces).toHaveLength(1);
    expect(after.selectedMark).toBeNull();
    expect(soloPanels(after.pieces, byId)).toHaveLength(0);

    after.resetBolts({ walers: true });
    expect(soloPanels(useEditorStore.getState().pieces, byId)).toHaveLength(1);
  });
});
