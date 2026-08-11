import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { pathLength, segments } from '../../lib/sketch';
import type { SketchPath } from '../../types';

/** Joining the two ends of a run that was finished open. */
const U = (): SketchPath => ({
  id: 'k',
  points: [
    { x: 0, y: 0 },
    { x: 400, y: 0 },
    { x: 400, y: 300 },
    { x: 0, y: 300 },
  ],
});

const path = () => useEditorStore.getState().sketch[0];

describe('closeSketchPath', () => {
  beforeEach(() => {
    useEditorStore.setState({ sketch: [U()], past: [], future: [] });
  });

  it('adds the leg back to the first point without adding a point', () => {
    expect(segments(path())).toHaveLength(3);
    useEditorStore.getState().closeSketchPath('k', true);
    expect(segments(path())).toHaveLength(4);
    expect(path().points).toHaveLength(4);
    expect(pathLength(path())).toBe(1400);
  });

  it('opens it again', () => {
    useEditorStore.getState().closeSketchPath('k', true);
    useEditorStore.getState().closeSketchPath('k', false);
    expect(segments(path())).toHaveLength(3);
  });

  it('is undoable', () => {
    useEditorStore.getState().closeSketchPath('k', true);
    useEditorStore.getState().undo();
    expect(path().closed).toBeFalsy();
  });

  // Two points enclose nothing — there is no loop to be made of a single leg.
  it('refuses a run with nothing to enclose', () => {
    useEditorStore.setState({ sketch: [{ id: 'k', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] }] });
    useEditorStore.getState().closeSketchPath('k', true);
    expect(path().closed).toBeFalsy();
  });
});
