import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import type { Material, Piece, SketchPath } from '../../types';

/**
 * A wall and the line it was set out to, moved as one thing.
 *
 * The point of testing it is the delta rather than the movement: pieces snap
 * to a neighbour's edge and a layout rounds to the grid, so moving the two
 * separately — even on the same drag — is how the wall ends up a centimetre
 * off the line it belongs on.
 */
const PANEL: Material = {
  id: 'panel', name: 'პანელი 90*300', category: 'panel', w: 90, h: 300, depth: 9,
  shape: 'rect', color: '#000', builtin: false, stock: {}, weight: 0, article: '', supplier: '',
};

const piece = (): Piece => ({ id: 'p1', materialId: 'panel', x: 100, y: 100, rot: 0, z: 0 });
const line = (): SketchPath => ({ id: 'k', points: [{ x: 100, y: 150 }, { x: 400, y: 150 }] });

const state = () => useEditorStore.getState();

describe('moving pieces and layout together', () => {
  beforeEach(() => {
    useEditorStore.setState({
      materials: [PANEL],
      pieces: [piece()],
      sketch: [line()],
      selectedIds: ['p1'],
      selectedSketchIds: ['k'],
      snap: false,
      edgeSnap: false,
      zoom: 1,
      surfaceView: 'plan',
      past: [],
      future: [],
    });
  });

  it('carries the drawn run along with the pieces', () => {
    state().moveSelectionBy(60, -25, [piece()], [line()]);
    expect(state().pieces[0]).toMatchObject({ x: 160, y: 75 });
    expect(state().sketch[0].points[0]).toEqual({ x: 160, y: 125 });
    expect(state().sketch[0].points[1]).toEqual({ x: 460, y: 125 });
  });

  it('moves both by exactly the same amount, whatever the snapping decides', () => {
    // Grid on, so the delta the pieces get is not the delta that was asked for.
    useEditorStore.setState({ snap: true, snapStep: 15 });
    state().moveSelectionBy(52, 0, [piece()], [line()]);
    const movedPiece = state().pieces[0].x - 100;
    const movedLine = state().sketch[0].points[0].x - 100;
    expect(movedLine).toBe(movedPiece);
    expect(movedPiece).toBe(45); // 52 rounded to the nearest step
  });

  it('leaves the layout alone when none of it is selected', () => {
    state().moveSelectionBy(60, 0, [piece()], []);
    expect(state().sketch[0].points[0]).toEqual({ x: 100, y: 150 });
  });

  it('select-all takes the layout as well as the pieces', () => {
    useEditorStore.setState({ selectedIds: [], selectedSketchIds: [] });
    state().selectAll();
    expect(state().selectedIds).toEqual(['p1']);
    expect(state().selectedSketchIds).toEqual(['k']);
  });
});
