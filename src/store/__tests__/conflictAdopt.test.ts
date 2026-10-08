import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { freeAnchor } from '../../lib/measure';
import type { DrawingDoc } from '../../types';

/**
 * Taking the server's copy after a conflict has to replace everything the
 * screen shows of that drawing. Replacing only the pieces left the rejected
 * lines and measurements up, and the next edit wrote them back over the copy
 * that had just been accepted.
 */

const doc = (id: string, over: Partial<DrawingDoc> = {}): DrawingDoc => ({
  id,
  name: id,
  updatedAt: 1,
  projectName: '',
  revision: 'A',
  scale: 50,
  pieces: [],
  sketch: [],
  measures: [],
  ...over,
});

const mine = doc('x', {
  sketch: [{ id: 'mine', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
  measures: [{ id: 'mm', a: { x: 0, y: -15 }, b: { x: 100, y: -15 } }],
});
const theirs = doc('x', {
  sketch: [{ id: 'theirs', points: [{ x: 0, y: 50 }, { x: 300, y: 50 }] }],
  measures: [],
});

describe('adoptServerDocument', () => {
  beforeEach(() => {
    useEditorStore.setState({
      documents: [mine, doc('other')],
      activeDocId: 'x',
      pieces: mine.pieces,
      sketch: mine.sketch,
      measures: mine.measures,
      selectedMeasureId: 'mm',
      selectedSketchIds: ['mine'],
      past: [],
      future: [],
    });
  });

  it('replaces every mirror of the open drawing with the server copy', () => {
    useEditorStore.getState().adoptServerDocument('x', theirs);
    const s = useEditorStore.getState();
    expect(s.sketch.map((k) => k.id)).toEqual(['theirs']);
    expect(s.measures).toEqual([]);
    expect(s.selectedMeasureId).toBeNull();
    expect(s.selectedSketchIds).toEqual([]);
  });

  it('keeps the server copy when the next edit lands', () => {
    useEditorStore.getState().adoptServerDocument('x', theirs);
    // Any committed edit runs syncDoc, which copies the mirrors into the drawing.
    useEditorStore.getState().measureStart(freeAnchor({ x: 0, y: 0 }));
    useEditorStore.getState().measureFinish({ x: 50, y: 0 });
    const x = useEditorStore.getState().documents.find((d) => d.id === 'x')!;
    expect(x.sketch.map((k) => k.id)).toEqual(['theirs']);
    expect(x.measures).toHaveLength(1);
  });

  it('moves to another drawing when the server no longer has the open one', () => {
    useEditorStore.getState().adoptServerDocument('x', null);
    const s = useEditorStore.getState();
    expect(s.documents.map((d) => d.id)).toEqual(['other']);
    expect(s.activeDocId).toBe('other');
    expect(s.sketch).toEqual([]);
    expect(s.measures).toEqual([]);
  });
});

describe('a picked measured line and undo', () => {
  beforeEach(() => {
    const d = doc('d');
    useEditorStore.setState({
      documents: [d],
      activeDocId: 'd',
      pieces: [],
      sketch: [],
      measures: [],
      measureFirst: null,
      selectedMeasureId: null,
      past: [],
      future: [],
    });
  });

  it('undo lets go of it, so a later Delete cannot wipe the redo history', () => {
    const s = useEditorStore.getState();
    s.measureStart(freeAnchor({ x: 0, y: 0 }));
    useEditorStore.getState().measureFinish({ x: 100, y: 0 });
    useEditorStore.getState().selectMeasure(useEditorStore.getState().measures[0].id);

    useEditorStore.getState().undo();
    expect(useEditorStore.getState().selectedMeasureId).toBeNull();

    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().future).toHaveLength(1);
  });

  it('Delete ignores a picked id whose line is already gone', () => {
    useEditorStore.setState({ selectedMeasureId: 'gone' });
    useEditorStore.getState().deleteSelected();
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});
