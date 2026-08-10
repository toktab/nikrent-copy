import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import type { SketchPath } from '../../types';

/** Every edit to a drawn layout has to be undoable, or none of them is trusted. */
const L = (): SketchPath => ({
  id: 'k',
  points: [{ x: 0, y: 0 }, { x: 400, y: 0 }, { x: 400, y: 300 }],
});

const points = () => useEditorStore.getState().sketch[0]?.points;

describe('undo covers the layout edits', () => {
  beforeEach(() => {
    useEditorStore.setState({ sketch: [L()], past: [], future: [], snap: false });
  });

  it('undoes a leg swung to a new bearing', () => {
    const before = JSON.stringify(points());
    useEditorStore.getState().setLegAngle('k', 0, 30);
    expect(JSON.stringify(points())).not.toBe(before);
    useEditorStore.getState().undo();
    expect(JSON.stringify(points())).toBe(before);
  });

  it('undoes a leg set to a new length', () => {
    const before = JSON.stringify(points());
    useEditorStore.getState().setLegLength('k', 0, 555);
    useEditorStore.getState().undo();
    expect(JSON.stringify(points())).toBe(before);
  });

  it('undoes a junction added and a junction taken out', () => {
    const before = JSON.stringify(points());
    useEditorStore.getState().insertSketchVertex('k', 0, { x: 120, y: 0 });
    expect(points()).toHaveLength(4);
    useEditorStore.getState().undo();
    expect(JSON.stringify(points())).toBe(before);

    useEditorStore.getState().removeSketchVertex('k', 1);
    expect(points()).toHaveLength(2);
    useEditorStore.getState().undo();
    expect(JSON.stringify(points())).toBe(before);
  });
});
