import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import type { Material, Piece } from '../../types';

/**
 * Dragging a piece up against one already placed.
 *
 * The case that matters is a corner profile, because nothing about a corner
 * lands on the grid: a 24 cm leg standing off a 9 cm panel, meeting faces that
 * sit 10 and 19 either side of a centreline. Panels hid the problem — they are
 * 30 to 90 in fifteens, so the grid leaves them nearly flush and a small nudge
 * finished the job.
 */

const material = (over: Partial<Material>): Material => ({
  id: 'x',
  name: 'x',
  category: 'panel',
  w: 90,
  h: 300,
  depth: 9,
  shape: 'rect',
  color: '#000',
  builtin: false,
  stock: {},
  weight: 0,
  article: '',
  supplier: '',
  ...over,
});

const PANEL = material({ id: 'panel', name: 'პანელი 90*300' });
const CORNER = material({
  id: 'corner',
  name: 'გარე კუთხე 300',
  category: 'corner',
  w: 24,
  depth: 24,
  shape: 'L',
});

/** The panel occupies x 0…90; the corner starts well clear of it, at x 200. */
const layout = (): Piece[] => [
  { id: 'p1', materialId: 'panel', x: 0, y: 0, rot: 0, z: 0 },
  { id: 'c1', materialId: 'corner', x: 200, y: 0, rot: 0, z: 0 },
];

const cornerX = () => useEditorStore.getState().pieces.find((p) => p.id === 'c1')!.x;

describe('edge snap beats the grid', () => {
  beforeEach(() => {
    useEditorStore.setState({
      materials: [PANEL, CORNER],
      pieces: layout(),
      selectedIds: ['c1'],
      snap: true,
      snapStep: 15,
      edgeSnap: true,
      // Two pixels to the centimetre, so the grid's worst case — half a step,
      // 7.5 cm — is further than the snap can reach when it is applied on top
      // of the grid rather than instead of it.
      zoom: 2,
      surfaceView: 'plan',
    });
  });

  it('lands the corner exactly against the panel', () => {
    const baseline = layout();
    // Aiming for flush at x = 90, and stopping 3 cm short of it by hand.
    useEditorStore.getState().moveSelectionBy(-107, 0, baseline);
    expect(cornerX()).toBe(90);
  });

  // What it used to do: the grid took the corner to the nearest multiple of 15
  // from where it started, 5 cm past flush, and the nudge could only reach 4.
  it('does not leave it on the grid five centimetres out', () => {
    const baseline = layout();
    useEditorStore.getState().moveSelectionBy(-107, 0, baseline);
    expect(cornerX()).not.toBe(95);
  });

  it('reports the line it caught, so the drag can show it', () => {
    useEditorStore.getState().moveSelectionBy(-107, 0, layout());
    expect(useEditorStore.getState().guideX).toBe(90);
  });

  it('still uses the grid where there is nothing to catch on', () => {
    const baseline = layout();
    // Dragging away from the panel, into open space.
    useEditorStore.getState().moveSelectionBy(107, 0, baseline);
    expect(cornerX()).toBe(305); // 200 + 105, a whole number of steps
  });

  it('leaves the grid alone on the axis that caught nothing', () => {
    const baseline = layout();
    // Flush across, and a nudge down that no edge is near.
    useEditorStore.getState().moveSelectionBy(-107, 40, baseline);
    expect(cornerX()).toBe(90);
    expect(useEditorStore.getState().pieces.find((p) => p.id === 'c1')!.y).toBe(45);
  });

  it('does nothing at all when edge snapping is off', () => {
    useEditorStore.setState({ edgeSnap: false });
    useEditorStore.getState().moveSelectionBy(-107, 0, layout());
    expect(cornerX()).toBe(95);
  });
});
