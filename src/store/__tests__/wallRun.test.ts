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
  ...over,
});

describe('generateWallRun', () => {
  beforeEach(() => {
    useEditorStore.setState({ materials, pieces: [], sketch: [], past: [], future: [] });
  });

  it('leaves the setting-out lines as well as the formwork', () => {
    const out = useEditorStore.getState().generateWallRun(spec());
    expect(out.added).toBeGreaterThan(0);
    const sketch = useEditorStore.getState().sketch;
    // A wall is two faces, so it is two lines.
    expect(sketch).toHaveLength(2);
    expect(sketch.every((k) => k.points.length === 2)).toBe(true);
    expect(useEditorStore.getState().pieces).toHaveLength(out.added);
  });

  // The typed thickness is spent setting the two faces apart and nowhere else.
  it('draws a line along each face, the thickness apart', () => {
    useEditorStore.getState().generateWallRun(spec({ originY: 100, thickness: 20 }));
    const ys = useEditorStore.getState().sketch.map((k) => k.points[0].y).sort((a, b) => a - b);
    expect(ys).toEqual([100, 120]);
  });

  it('stands each face outward, so nothing lands in the pour', () => {
    useEditorStore.getState().generateWallRun(spec({ originY: 100, thickness: 20 }));
    const tops = useEditorStore
      .getState()
      .pieces.map((p) => pieceBounds(p, byId.get(p.materialId)!).y);
    // Panels above the near face at 100, and below the far face at 120.
    expect(new Set(tops)).toEqual(new Set([91, 120]));
  });

  it('orders the face and nothing behind it', () => {
    useEditorStore.getState().generateWallRun(spec());
    const cats = new Set(
      useEditorStore.getState().pieces.map((p) => byId.get(p.materialId)!.category),
    );
    expect([...cats].every((c) => ['panel', 'filler', 'corner'].includes(c))).toBe(true);
  });

  /**
   * A 300 cm wall is 90 + 90 + 90 + 30 and nothing else.
   *
   * It used not to be. The faces ran 9 cm past the pour at each end to wrap a
   * stop-end, which put every face 4 off the catalog's 5 cm grid and left a
   * strip at the end of the run that no part could close. Taking the stop-end
   * out took the leftover with it.
   */
  it('leaves nothing over on a wall that is a whole number of panels', () => {
    useEditorStore.getState().generateWallRun(spec());
    const fillers = useEditorStore
      .getState()
      .pieces.filter((p) => byId.get(p.materialId)!.category === 'filler');
    expect(fillers).toHaveLength(0);
  });

  it('is one undo step, line and panels together', () => {
    useEditorStore.getState().generateWallRun(spec());
    useEditorStore.getState().undo();
    expect(useEditorStore.getState().pieces).toHaveLength(0);
    expect(useEditorStore.getState().sketch).toHaveLength(0);
  });
});
