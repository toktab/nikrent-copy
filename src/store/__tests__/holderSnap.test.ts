import { describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Piece } from '../../types';

/**
 * A პანელის ბეტონზე სამაგრი moved up to a panel sticks to its face (the user,
 * 2026-11-07): its end on the face, running out on the side it came from.
 */
describe('პანელის ბეტონზე სამაგრი sticks to the panel', () => {
  // A 90 panel along x, its faces at y 0 and y 10; the სამაგრი 6 × 6 below it, loose.
  const panel: Piece = { id: 'panel', materialId: 'panel-90x300', x: 0, y: 0, rot: 0 };
  const holder: Piece = { id: 'h', materialId: 'acc-panel-concrete-anchor', x: 40, y: 30, rot: 0 };

  const drag = (du: number, dv: number) => {
    useEditorStore.setState({
      materials: createSeedMaterials(),
      pieces: [panel, holder],
      selectedIds: ['h'],
      surfaceView: 'plan',
      snap: true,
      snapStep: 5,
      zoom: 1,
    });
    const s = useEditorStore.getState();
    s.moveSelectionBy(du, dv, s.pieces, []);
    return useEditorStore.getState().pieces.find((p) => p.id === 'h')!;
  };

  it('lands flush on the face it is brought close to', () => {
    // Up 15: its middle at y 18, 8 cm off the face at y 10.
    const h = drag(0, -15);
    expect(h.y).toBe(10);
    expect(h.rot).toBe(0);
  });

  it('turns round on the other face', () => {
    const h = drag(0, -45);
    expect(h.y).toBe(-6);
    expect(h.rot).toBe(180);
  });

  it('moves loose on the grid away from any panel', () => {
    const h = drag(200, 0);
    expect([h.x, h.y]).toEqual([240, 30]);
  });
});
