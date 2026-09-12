import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { DEFAULT_MEASURE_STYLE, freeAnchor } from '../../lib/measure';
import { diffSnapshots } from '../../lib/syncDiff';
import type { DrawingDoc } from '../../types';

/**
 * Measured lines are part of the drawing: saved with it, undone like any other
 * edit, carried along when it is copied, and noticed by the sync.
 */

const doc = (id: string): DrawingDoc => ({
  id,
  name: id,
  updatedAt: 1,
  projectName: '',
  revision: 'A',
  scale: 50,
  pieces: [],
  sketch: [],
  measures: [],
});

const measure = (ax: number, ay: number, bx: number, by: number) => {
  const s = useEditorStore.getState();
  s.measureStart(freeAnchor({ x: ax, y: ay }));
  useEditorStore.getState().measureFinish({ x: bx, y: by });
};

const active = () => {
  const s = useEditorStore.getState();
  return s.documents.find((d) => d.id === s.activeDocId)!;
};

describe('measured lines', () => {
  beforeEach(() => {
    const first = doc('d1');
    useEditorStore.setState({
      documents: [first, doc('d2')],
      activeDocId: first.id,
      pieces: [],
      sketch: [],
      measures: [],
      past: [],
      future: [],
      tool: 'measure',
      measureFirst: null,
      selectedMeasureId: null,
      selectedIds: [],
      selectedSketchIds: [],
      measureStyle: { ...DEFAULT_MEASURE_STYLE },
    });
  });

  it('saves a line into the drawing, and undo takes it back out', () => {
    measure(0, -15, 45, -15);
    let s = useEditorStore.getState();
    expect(s.measures).toHaveLength(1);
    expect(s.measures[0]).toMatchObject({ a: { x: 0, y: -15 }, b: { x: 45, y: -15 } });
    expect(active().measures).toEqual(s.measures);
    expect(s.measureFirst).toBeNull();
    expect(s.tool).toBe('measure');

    s.undo();
    s = useEditorStore.getState();
    expect(s.measures).toHaveLength(0);
    expect(active().measures).toHaveLength(0);
  });

  it('ignores a line shorter than the drawing grid and keeps the first point', () => {
    measure(0, 0, 3, 0);
    const s = useEditorStore.getState();
    expect(s.measures).toHaveLength(0);
    expect(s.measureFirst).not.toBeNull();
    expect(s.past).toHaveLength(0);
  });

  it('deletes the picked line with the rest of the selection', () => {
    measure(0, 0, 100, 0);
    const id = useEditorStore.getState().measures[0].id;
    useEditorStore.getState().selectMeasure(id);
    useEditorStore.getState().deleteSelected();
    const s = useEditorStore.getState();
    expect(s.measures).toHaveLength(0);
    expect(s.selectedMeasureId).toBeNull();
  });

  it('picking a line drops any piece selection, and picking a piece drops the line', () => {
    measure(0, 0, 100, 0);
    const id = useEditorStore.getState().measures[0].id;
    useEditorStore.setState({ selectedIds: ['p1'] });
    useEditorStore.getState().selectMeasure(id);
    expect(useEditorStore.getState().selectedIds).toEqual([]);
    useEditorStore.getState().select('p1');
    expect(useEditorStore.getState().selectedMeasureId).toBeNull();
  });

  it('belongs to its own drawing when switching, and is copied with new ids', () => {
    measure(0, 0, 100, 0);
    const original = useEditorStore.getState().measures[0];

    useEditorStore.getState().switchDocument('d2');
    expect(useEditorStore.getState().measures).toEqual([]);

    useEditorStore.getState().switchDocument('d1');
    expect(useEditorStore.getState().measures).toEqual([original]);

    useEditorStore.getState().duplicateDocument('d1');
    const copy = useEditorStore.getState().measures;
    expect(copy).toHaveLength(1);
    expect(copy[0].id).not.toBe(original.id);
    expect(copy[0].a).toEqual(original.a);
  });

  it('putting the tool down abandons a half-placed line', () => {
    useEditorStore.getState().measureStart(freeAnchor({ x: 0, y: 0 }));
    useEditorStore.getState().setTool('select');
    expect(useEditorStore.getState().measureFirst).toBeNull();
  });

  it('is noticed by the sync as a change to the drawing', () => {
    const s = useEditorStore.getState();
    const before = { materials: s.materials, warehouses: s.warehouses, documents: s.documents };
    measure(0, 0, 100, 0);
    const after = useEditorStore.getState();
    const plan = diffSnapshots(before, {
      materials: after.materials,
      warehouses: after.warehouses,
      documents: after.documents,
    });
    expect(plan.documentsUpsert.map((d) => d.id)).toEqual(['d1']);
  });

  it('display settings change field by field and go back to the defaults', () => {
    useEditorStore.getState().setMeasureStyle({ color: '#70a6f5', opacity: 3 });
    expect(useEditorStore.getState().measureStyle).toMatchObject({ color: '#70a6f5', opacity: 1 });
    useEditorStore.getState().resetMeasureStyle();
    expect(useEditorStore.getState().measureStyle).toEqual(DEFAULT_MEASURE_STYLE);
  });
});
