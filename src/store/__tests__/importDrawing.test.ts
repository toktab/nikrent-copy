import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';
import { buildLayoutFile, parseLayoutFile } from '../../lib/catalogFile';
import type { DrawingDoc, Material, SketchPath } from '../../types';

/**
 * A drawing taken to another computer has to open as the same drawing.
 *
 * The file used to carry the panels and nothing else, so the setting-out lines
 * were lost on the way and any material the other catalog lacked took its
 * pieces with it.
 */

const seeds = createSeedMaterials();
const panel = seeds.find((m) => m.category === 'panel')!;
const custom: Material = {
  ...panel,
  id: 'custom-panel-37',
  name: 'პანელი 37*300',
  w: 37,
  builtin: false,
  stock: {},
};

const home: DrawingDoc = {
  id: 'home',
  name: 'ბლოკი A',
  updatedAt: 1,
  projectName: 'ვაკე',
  revision: 'B',
  scale: 25,
  pieces: [
    { id: 'p1', materialId: panel.id, x: 0, y: 0, rot: 0, z: 0 },
    { id: 'p2', materialId: custom.id, x: 90, y: 0, rot: 0, z: 0 },
  ],
  sketch: [{ id: 'k', points: [{ x: 0, y: 9 }, { x: 127, y: 9 }], perimeter: 'outer' }],
  measures: [{ id: 'm', a: { x: 0, y: -15 }, b: { x: 127, y: -15 } }],
};

/** The file, exactly as another machine would receive it. */
const received = () => parseLayoutFile(JSON.stringify(buildLayoutFile(home, [...seeds, custom])));

const existing: DrawingDoc = {
  id: 'existing',
  name: 'ნახაზი 1',
  updatedAt: 1,
  projectName: '',
  revision: 'A',
  scale: 50,
  pieces: [{ id: 'e1', materialId: panel.id, x: 500, y: 500, rot: 0, z: 0 }],
  sketch: [],
  measures: [],
};

describe('importDrawing', () => {
  beforeEach(() => {
    // The other computer: seed catalog only, one drawing already open.
    useEditorStore.setState({
      materials: createSeedMaterials(),
      removedBuiltins: [],
      documents: [existing],
      activeDocId: existing.id,
      pieces: existing.pieces,
      sketch: existing.sketch,
      measures: existing.measures,
      past: [],
      future: [],
    });
  });

  it('opens the file as a new active drawing identical to the one exported', () => {
    const result = useEditorStore.getState().importDrawing(received(), { addMissingMaterials: true });
    const s = useEditorStore.getState();

    expect(result).toMatchObject({ created: true, added: 2, droppedPieces: 0, addedMaterials: 1 });
    expect(s.documents).toHaveLength(2);
    expect(s.activeDocId).not.toBe(existing.id);

    const doc = s.documents.find((d) => d.id === s.activeDocId)!;
    expect(doc).toMatchObject({ name: 'ბლოკი A', projectName: 'ვაკე', revision: 'B', scale: 25 });
    const strip = <T extends { id: string }>(xs: T[]) => xs.map(({ id: _id, ...rest }) => rest);
    expect(strip(doc.pieces)).toEqual(strip(home.pieces));
    expect(strip(doc.sketch)).toEqual(strip(home.sketch));
    expect(strip(doc.measures)).toEqual(strip(home.measures));

    // The top-level copies mirror the new drawing, not the old one.
    expect(s.pieces).toBe(doc.pieces);
    expect(s.sketch).toBe(doc.sketch);
    expect(s.measures).toBe(doc.measures);
  });

  it('leaves the drawing that was already open untouched', () => {
    useEditorStore.getState().importDrawing(received(), { addMissingMaterials: true });
    const before = useEditorStore.getState().documents.find((d) => d.id === existing.id);
    expect(before).toEqual(existing);
  });

  it('adds a material the catalog lacks under its own id, without stock', () => {
    useEditorStore.getState().importDrawing(received(), { addMissingMaterials: true });
    const added = useEditorStore.getState().materials.find((m) => m.id === custom.id);
    expect(added).toMatchObject({ w: 37, builtin: false, stock: {} });
  });

  it('drops and counts the pieces whose material may not be added', () => {
    const result = useEditorStore.getState().importDrawing(received(), { addMissingMaterials: false });
    const s = useEditorStore.getState();
    expect(result).toMatchObject({ created: true, added: 1, droppedPieces: 1, addedMaterials: 0 });
    expect(s.materials.some((m) => m.id === custom.id)).toBe(false);
    expect(s.pieces.map((p) => p.materialId)).toEqual([panel.id]);
    // The lines and measurements still come across in full.
    expect(s.sketch).toHaveLength(1);
    expect(s.measures).toHaveLength(1);
  });

  it('keeps the local size of a part both catalogs have, and says so', () => {
    const parsed = received();
    parsed.materials = parsed.materials.map((m) => (m.id === panel.id ? { ...m, w: panel.w + 5 } : m));
    const result = useEditorStore.getState().importDrawing(parsed, { addMissingMaterials: true });
    expect(result.mismatched).toBe(1);
    expect(useEditorStore.getState().materials.find((m) => m.id === panel.id)!.w).toBe(panel.w);
  });

  it('creates nothing when nothing in the file can be placed', () => {
    const parsed = received();
    parsed.pieces = parsed.pieces.filter((p) => p.materialId === custom.id);
    parsed.sketch = [];
    parsed.measures = [];
    const result = useEditorStore.getState().importDrawing(parsed, { addMissingMaterials: false });
    expect(result.created).toBe(false);
    expect(useEditorStore.getState().documents).toHaveLength(1);
  });
});

describe('appendSketch', () => {
  beforeEach(() => {
    useEditorStore.setState({
      documents: [existing],
      activeDocId: existing.id,
      pieces: existing.pieces,
      sketch: [],
      measures: [],
      past: [],
      future: [],
    });
  });

  it('lands the lines in the saved drawing, and one undo takes them back out', () => {
    const paths: SketchPath[] = [
      { id: 'd1', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] },
      { id: 'd2', points: [{ x: 0, y: 50 }, { x: 100, y: 50 }] },
    ];
    useEditorStore.getState().appendSketch(paths);
    let s = useEditorStore.getState();
    expect(s.sketch).toHaveLength(2);
    expect(s.documents.find((d) => d.id === existing.id)!.sketch).toHaveLength(2);

    s.undo();
    s = useEditorStore.getState();
    expect(s.sketch).toHaveLength(0);
    expect(s.documents.find((d) => d.id === existing.id)!.sketch).toHaveLength(0);
  });

  it('does not add an empty undo step', () => {
    useEditorStore.getState().appendSketch([]);
    expect(useEditorStore.getState().past).toHaveLength(0);
  });
});

describe('newDocument', () => {
  it('starts on an empty sheet rather than showing the last drawing\'s lines', () => {
    useEditorStore.setState({
      documents: [existing],
      activeDocId: existing.id,
      sketch: [{ id: 'old', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] }],
      measures: [{ id: 'mm', a: { x: 0, y: 0 }, b: { x: 50, y: 0 } }],
    });
    useEditorStore.getState().newDocument('ახალი');
    const s = useEditorStore.getState();
    expect(s.sketch).toEqual([]);
    expect(s.measures).toEqual([]);
  });
});
