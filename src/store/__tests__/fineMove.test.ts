import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import type { Material, Piece } from '../../types';

/**
 * Putting a piece exactly one centimetre off something.
 *
 * The case that matters: a 4 cm leftover no part in the catalog closes, which
 * becomes a 5 cm one that a ჩაკერება does — so the whole job is to sit just off
 * an edge, and every snap in the app is trying to prevent that.
 */
const PANEL: Material = {
  id: 'panel', name: 'პანელი 90*300', category: 'panel', w: 90, h: 300, depth: 9,
  shape: 'rect', color: '#000', builtin: false, stock: {}, weight: 0, article: '', supplier: '',
};

const layout = (): Piece[] => [
  { id: 'a', materialId: 'panel', x: 0, y: 0, rot: 0, z: 0 },
  { id: 'b', materialId: 'panel', x: 200, y: 0, rot: 0, z: 0 },
];

const bx = () => useEditorStore.getState().pieces.find((p) => p.id === 'b')!.x;

describe('moving a piece off the snap', () => {
  beforeEach(() => {
    useEditorStore.setState({
      materials: [PANEL], pieces: layout(), selectedIds: ['b'],
      snap: true, snapStep: 15, edgeSnap: true, zoom: 2, surfaceView: 'plan',
      past: [], future: [],
    });
  });

  it('normally catches the edge it is dragged near', () => {
    useEditorStore.getState().moveSelectionBy(-107, 0, layout());
    expect(bx()).toBe(90); // flush against the panel ending at 90
  });

  it('lands exactly where the pointer is when the snap is suspended', () => {
    useEditorStore.getState().moveSelectionBy(-107, 0, layout(), undefined, true);
    expect(bx()).toBe(93);
  });

  it('sets an exact position outright', () => {
    useEditorStore.getState().setPosition(95, 0);
    expect(bx()).toBe(95);
  });

  it('nudges a whole centimetre without snapping anywhere', () => {
    useEditorStore.getState().nudgeSelection(1, 0);
    expect(bx()).toBe(201);
  });

  // An exact position is a decision, so it belongs in the undo history.
  it('is undoable', () => {
    useEditorStore.getState().setPosition(95, 0);
    useEditorStore.getState().undo();
    expect(bx()).toBe(200);
  });

  it('refuses an exact position for a group, which has no one position', () => {
    useEditorStore.setState({ selectedIds: ['a', 'b'] });
    useEditorStore.getState().setPosition(95, 0);
    expect(bx()).toBe(200);
  });
});
