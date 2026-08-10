import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';
import { pieceBounds } from '../../lib/geometry';

/**
 * The straight-wall shortcut.
 *
 * It exists for speed, not as a second way of building a wall — so what these
 * check is mostly that it is NOT a second way: the same generator, the same
 * materials, and the setting-out line left behind so the result can be edited
 * like anything else drawn.
 */
const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const spec = (over = {}) => ({
  length: 300,
  thickness: 20,
  height: 300,
  originX: 0,
  originY: 0,
  includeStopEnds: true,
  ...over,
});

describe('generateWallRun', () => {
  beforeEach(() => {
    useEditorStore.setState({ materials, pieces: [], sketch: [], past: [], future: [] });
  });

  it('leaves the setting-out line as well as the formwork', () => {
    const out = useEditorStore.getState().generateWallRun(spec());
    expect(out.added).toBeGreaterThan(0);
    const sketch = useEditorStore.getState().sketch;
    expect(sketch).toHaveLength(1);
    expect(sketch[0].points).toHaveLength(2);
    expect(useEditorStore.getState().pieces).toHaveLength(out.added);
  });

  it('draws the line down the middle of the wall, not along a face', () => {
    useEditorStore.getState().generateWallRun(spec({ originY: 100, thickness: 20 }));
    // Half a thickness below the top of the space it was placed in.
    expect(useEditorStore.getState().sketch[0].points[0].y).toBe(110);
  });

  it('orders the face and nothing behind it', () => {
    useEditorStore.getState().generateWallRun(spec());
    const cats = new Set(
      useEditorStore.getState().pieces.map((p) => byId.get(p.materialId)!.category),
    );
    expect([...cats].sort()).toEqual(['filler', 'panel']);
  });

  it('stands a face either side of the line', () => {
    useEditorStore.getState().generateWallRun(spec({ includeStopEnds: false }));
    const s = useEditorStore.getState();
    const tops = s.pieces.map((p) => pieceBounds(p, byId.get(p.materialId)!).y);
    // 20 thick centred on y = 10, so the faces stand at −9 and +20.
    expect(new Set(tops)).toEqual(new Set([-9, 20]));
  });

  it('is one undo step, line and panels together', () => {
    useEditorStore.getState().generateWallRun(spec());
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().pieces).toHaveLength(0);
    expect(useEditorStore.getState().sketch).toHaveLength(0);
  });
});
