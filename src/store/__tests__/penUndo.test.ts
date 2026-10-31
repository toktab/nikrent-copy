import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';

/** Undo and redo while the pen is out walk the points of the line in hand. */
describe('undo while drawing', () => {
  beforeEach(() => {
    useEditorStore.setState({ sketch: [], pieces: [], past: [], future: [], penPoints: [], penRedo: [] });
    useEditorStore.getState().setTool('pen');
    for (const [x, y] of [
      [0, 0],
      [200, 0],
      [200, 100],
    ]) {
      useEditorStore.getState().penAddPoint(x, y);
    }
  });

  it('takes the last point off and puts it back', () => {
    const s = useEditorStore.getState();
    s.undo();
    expect(useEditorStore.getState().penPoints).toHaveLength(2);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().penPoints).toEqual([
      { x: 0, y: 0 },
      { x: 200, y: 0 },
      { x: 200, y: 100 },
    ]);
  });

  it('drops what was taken off once a new point goes down', () => {
    useEditorStore.getState().undo();
    useEditorStore.getState().penAddPoint(300, 0);
    expect(useEditorStore.getState().penRedo).toEqual([]);
  });

  it('undoes a finished line as one step', () => {
    useEditorStore.getState().penFinish();
    expect(useEditorStore.getState().sketch).toHaveLength(1);
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().sketch).toHaveLength(0);
    useEditorStore.getState().redo();
    expect(useEditorStore.getState().sketch).toHaveLength(1);
  });
});
