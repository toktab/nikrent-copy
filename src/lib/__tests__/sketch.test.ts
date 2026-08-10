import { describe, expect, it } from 'vitest';
import {
  distanceToPath,
  legLength,
  closestOnLeg,
  insertVertex,
  legAngle,
  moveVertex,
  setLegAngle,
  setLegLength,
  removeVertex,
  snapToSketch,
  moveSegment,
  orthogonal,
  pathAt,
  pathLength,
  segmentAt,
  segments,
  sketchSnapTargets,
} from '../sketch';
import type { SketchPath } from '../../types';

const path = (points: Array<[number, number]>, closed = false): SketchPath => ({
  id: 'k',
  points: points.map(([x, y]) => ({ x, y })),
  ...(closed ? { closed: true } : {}),
});

describe('orthogonal', () => {
  const from = { x: 100, y: 100 };

  it('runs across when the pointer has travelled further across', () => {
    expect(orthogonal(from, { x: 400, y: 160 })).toEqual({ x: 400, y: 100 });
  });

  it('runs down when the pointer has travelled further down', () => {
    expect(orthogonal(from, { x: 160, y: 400 })).toEqual({ x: 100, y: 400 });
  });

  it('works backwards as readily as forwards', () => {
    expect(orthogonal(from, { x: -300, y: 90 })).toEqual({ x: -300, y: 100 });
    expect(orthogonal(from, { x: 95, y: -50 })).toEqual({ x: 100, y: -50 });
  });

  // A diagonal drag is exactly the ambiguous case. It has to resolve to
  // something rather than wobble between the two as the pointer jitters.
  it('settles on one axis for a perfect diagonal', () => {
    expect(orthogonal(from, { x: 200, y: 200 })).toEqual({ x: 200, y: 100 });
  });

  it('always leaves the two points sharing an x or a y', () => {
    for (const to of [
      { x: 137, y: 942 },
      { x: -88, y: 13 },
      { x: 0, y: 0 },
      { x: 501, y: -501 },
    ]) {
      const p = orthogonal(from, to);
      expect(p.x === from.x || p.y === from.y).toBe(true);
    }
  });
});

describe('segments', () => {
  it('walks the drawn legs in order', () => {
    expect(segments(path([[0, 0], [300, 0], [300, 200]]))).toEqual([
      [{ x: 0, y: 0 }, { x: 300, y: 0 }],
      [{ x: 300, y: 0 }, { x: 300, y: 200 }],
    ]);
  });

  it('closes the loop when the path is closed', () => {
    const legs = segments(path([[0, 0], [300, 0], [300, 200], [0, 200]], true));
    expect(legs).toHaveLength(4);
    expect(legs[3]).toEqual([{ x: 0, y: 200 }, { x: 0, y: 0 }]);
  });

  it('does not close a path with too few points to enclose anything', () => {
    expect(segments(path([[0, 0], [300, 0]], true))).toHaveLength(1);
  });
});

describe('pathLength', () => {
  it('adds up the run of wall the layout describes', () => {
    expect(pathLength(path([[0, 0], [300, 0], [300, 200]]))).toBe(500);
  });

  it('counts the closing leg of a room', () => {
    expect(pathLength(path([[0, 0], [400, 0], [400, 300], [0, 300]], true))).toBe(1400);
  });
});

describe('sketchSnapTargets', () => {
  // Handed to the existing edge-snapper, which butts panels to the edges of
  // nearby rectangles — so a drawn line has to arrive as one.
  it('gives each leg as a flat rectangle the snapper already understands', () => {
    expect(sketchSnapTargets([path([[0, 0], [300, 0], [300, 200]])])).toEqual([
      { x: 0, y: 0, w: 300, h: 0 },
      { x: 300, y: 0, w: 0, h: 200 },
    ]);
  });

  it('normalises a leg drawn right to left', () => {
    expect(sketchSnapTargets([path([[300, 50], [0, 50]])])).toEqual([
      { x: 0, y: 50, w: 300, h: 0 },
    ]);
  });
});

describe('picking', () => {
  const room = path([[0, 0], [400, 0], [400, 300]]);

  it('measures zero on the line', () => {
    expect(distanceToPath(room, { x: 200, y: 0 })).toBe(0);
  });

  it('measures the perpendicular distance beside a leg', () => {
    expect(distanceToPath(room, { x: 200, y: 25 })).toBe(25);
  });

  // Past the end of a leg the nearest point is its endpoint, not the infinite
  // line it sits on — otherwise a click far off the end of a wall picks it.
  it('measures to the end of a leg, not to the line it lies on', () => {
    expect(distanceToPath(path([[0, 0], [100, 0]]), { x: 200, y: 0 })).toBe(100);
  });

  it('picks the nearest path within tolerance', () => {
    const near = path([[0, 0], [100, 0]]);
    const far = { ...path([[0, 500], [100, 500]]), id: 'far' };
    expect(pathAt([near, far], { x: 50, y: 6 }, 10)?.id).toBe('k');
  });

  it('picks nothing when the pointer is not near a line', () => {
    expect(pathAt([room], { x: 200, y: 90 }, 10)).toBeNull();
  });
});

describe('editing', () => {
  // The invariant the whole editing model exists to protect. Anything that
  // leaves a leg off-square has drawn something the tool cannot cost.
  const square = (p: SketchPath) =>
    segments(p).every(([a, b]) => a.x === b.x || a.y === b.y);

  const L = () => path([[0, 0], [300, 0], [300, 200]]);

  describe('moveSegment', () => {
    it('slides a horizontal leg up and down, and nothing else', () => {
      const moved = moveSegment(L(), 0, 0, -50);
      expect(moved.points).toEqual([
        { x: 0, y: -50 },
        { x: 300, y: -50 },
        { x: 300, y: 200 },
      ]);
      expect(square(moved)).toBe(true);
    });

    it('slides a vertical leg left and right', () => {
      const moved = moveSegment(L(), 1, 40, 0);
      expect(moved.points).toEqual([
        { x: 0, y: 0 },
        { x: 340, y: 0 },
        { x: 340, y: 200 },
      ]);
      expect(square(moved)).toBe(true);
    });

    // Sliding a leg along itself would only shorten its neighbours for nothing.
    it('ignores movement along the leg', () => {
      expect(moveSegment(L(), 0, 999, 0).points).toEqual(L().points);
      expect(moveSegment(L(), 1, 0, 999).points).toEqual(L().points);
    });

    it('changes the neighbouring legs by exactly the distance moved', () => {
      const before = segments(L()).map(([a, b]) => legLength(a, b));
      const after = segments(moveSegment(L(), 0, 0, -50)).map(([a, b]) => legLength(a, b));
      expect(after[0]).toBe(before[0]); // the leg itself keeps its length
      expect(after[1]).toBe(before[1] + 50); // its neighbour absorbs the move
    });

    it('moves the closing leg of a room without opening it', () => {
      const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
      const moved = moveSegment(room, 3, -60, 0);
      expect(moved.points[3]).toEqual({ x: -60, y: 300 });
      expect(moved.points[0]).toEqual({ x: -60, y: 0 });
      expect(square(moved)).toBe(true);
    });

    it('leaves an out-of-range leg alone', () => {
      expect(moveSegment(L(), 9, 10, 10).points).toEqual(L().points);
    });
  });

  describe('moveVertex', () => {
    it('moves the junction it is given and nothing else', () => {
      const moved = moveVertex(L(), 1, 40, -25);
      expect(moved.points).toEqual([
        { x: 0, y: 0 },
        { x: 340, y: -25 },
        { x: 300, y: 200 },
      ]);
    });

    // Free on purpose. Dragging a LEG is the square-preserving tool; dragging a
    // JUNCTION is how a run is made to meet something at an angle, which is the
    // whole reason it exists.
    it('lets a run leave the right angle behind', () => {
      expect(square(moveVertex(L(), 1, 40, -25))).toBe(false);
    });

    it('moves an end of an open run as readily as a middle', () => {
      expect(moveVertex(L(), 0, -80, 25).points[0]).toEqual({ x: -80, y: 25 });
      expect(moveVertex(L(), 2, 25, 90).points[2]).toEqual({ x: 325, y: 290 });
    });

    it('leaves an out-of-range vertex alone', () => {
      expect(moveVertex(L(), 9, 10, 10).points).toEqual(L().points);
    });
  });

  describe('segmentAt', () => {
    it('finds the leg under the pointer', () => {
      expect(segmentAt([L()], { x: 150, y: 4 }, 10)).toMatchObject({ index: 0 });
      expect(segmentAt([L()], { x: 296, y: 120 }, 10)).toMatchObject({ index: 1 });
    });

    // The end is the smaller target and the one you have to aim at, so it wins
    // inside the tolerance even though the leg passes through it too.
    it('prefers an end vertex to the leg it sits on', () => {
      expect(segmentAt([L()], { x: 2, y: 2 }, 10)?.vertex).toBe(0);
      expect(segmentAt([L()], { x: 300, y: 198 }, 10)?.vertex).toBe(2);
    });

    // Every junction is grabbable, including the corners of a closed room and
    // the middle of an open run — the corner where two walls meet is the thing
    // most often being moved.
    it('offers the junctions of a closed room too', () => {
      const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
      expect(segmentAt([room], { x: 2, y: 2 }, 10)?.vertex).toBe(0);
      expect(segmentAt([room], { x: 398, y: 302 }, 10)?.vertex).toBe(2);
    });

    it('offers a junction in the middle of an open run', () => {
      expect(segmentAt([L()], { x: 298, y: 3 }, 10)?.vertex).toBe(1);
    });

    it('finds nothing out in the open', () => {
      expect(segmentAt([L()], { x: 150, y: 120 }, 10)).toBeNull();
    });
  });
});

describe('putting a junction on an existing leg', () => {
  const L = () => path([[0, 0], [300, 0], [300, 200]]);

  it('finds the point on the line nearest the pointer', () => {
    expect(closestOnLeg({ x: 0, y: 0 }, { x: 300, y: 0 }, { x: 120, y: 40 })).toEqual({
      x: 120,
      y: 0,
    });
  });

  it('does not run off the end of the leg it was given', () => {
    expect(closestOnLeg({ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 400, y: 0 })).toEqual({
      x: 100,
      y: 0,
    });
  });

  it('splits the leg in two and changes nothing else', () => {
    const split = insertVertex(L(), 0, { x: 120, y: 0 });
    expect(split.points).toEqual([
      { x: 0, y: 0 },
      { x: 120, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
    ]);
    // The run is the same shape and the same length until the new junction moves.
    expect(pathLength(split)).toBe(pathLength(L()));
  });
});

describe('bearings', () => {
  it('reads 0 east and turns clockwise on screen', () => {
    expect(legAngle({ x: 0, y: 0 }, { x: 100, y: 0 })).toBe(0);
    expect(legAngle({ x: 0, y: 0 }, { x: 0, y: 100 })).toBe(90);
    expect(legAngle({ x: 0, y: 0 }, { x: -100, y: 0 })).toBe(180);
    expect(legAngle({ x: 0, y: 0 }, { x: 0, y: -100 })).toBe(270);
  });

  it('swings a leg to an exact angle', () => {
    const turned = setLegAngle(path([[0, 0], [100, 0]]), 0, 90);
    expect(turned.points[1].x).toBeCloseTo(0, 6);
    expect(turned.points[1].y).toBeCloseTo(100, 6);
  });

  // The rest of the run is carried round rigidly, so only the joint being set
  // opens or closes — every leg past it keeps its own length and its own angle.
  it('carries the rest of the run round with it', () => {
    const before = path([[0, 0], [100, 0], [100, 50]]);
    const turned = setLegAngle(before, 0, 90);
    expect(legLength(turned.points[1], turned.points[2])).toBeCloseTo(50, 6);
    expect(legAngle(turned.points[1], turned.points[2])).toBeCloseTo(180, 6);
  });

  it('leaves a closed room alone, having nowhere to put the slack', () => {
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    expect(setLegAngle(room, 0, 45).points).toEqual(room.points);
  });
});

describe('setLegLength', () => {
  it('sets the leg and carries the rest along its line', () => {
    const out = setLegLength(path([[0, 0], [100, 0], [100, 50]]), 0, 250);
    expect(out.points).toEqual([
      { x: 0, y: 0 },
      { x: 250, y: 0 },
      { x: 250, y: 50 },
    ]);
  });

  // Manhattan length called a diagonal longer than it is, so setting it moved
  // the tail the wrong distance.
  it('measures a rotated leg as a real distance', () => {
    const diagonal = path([[0, 0], [30, 40]]); // 50 long
    const out = setLegLength(diagonal, 0, 100);
    expect(legLength(out.points[0], out.points[1])).toBeCloseTo(100, 6);
    expect(legAngle(out.points[0], out.points[1])).toBeCloseTo(legAngle({ x: 0, y: 0 }, { x: 30, y: 40 }), 6);
  });
});

describe('snapping to the layout already drawn', () => {
  const L = () => path([[0, 0], [300, 0], [300, 200]]);

  it('takes a junction ahead of anything else', () => {
    const got = snapToSketch([L()], { x: 296, y: 4 }, 10);
    expect(got).toEqual({ point: { x: 300, y: 0 }, onVertex: true });
  });

  it('falls back to the nearest point along a leg', () => {
    const got = snapToSketch([L()], { x: 120, y: 5 }, 10);
    expect(got).toEqual({ point: { x: 120, y: 0 }, onVertex: false });
  });

  // A junction beats a leg even when the leg is nearer, because a run drawn to
  // meet another one is aiming at the corner, not at the wall beside it.
  it('prefers the junction to the leg running through it', () => {
    expect(snapToSketch([L()], { x: 299, y: 3 }, 10)?.onVertex).toBe(true);
  });

  it('finds nothing out in the open', () => {
    expect(snapToSketch([L()], { x: 150, y: 90 }, 10)).toBeNull();
  });
});

describe('removeVertex', () => {
  it('joins the two legs the junction divided', () => {
    const bent = path([[0, 0], [120, 0], [300, 0], [300, 200]]);
    const out = removeVertex(bent, 1);
    expect(out?.points).toEqual([
      { x: 0, y: 0 },
      { x: 300, y: 0 },
      { x: 300, y: 200 },
    ]);
  });

  it('refuses to leave less than a line behind', () => {
    // two points is a line; taking one away leaves nothing to keep
    expect(removeVertex(path([[0, 0], [300, 0]]), 0)).toBeNull();
    // a room needs three, so a four-cornered one may lose exactly one
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    expect(removeVertex(room, 0)?.points).toHaveLength(3);
    expect(removeVertex(path([[0, 0], [400, 0], [400, 300]], true), 0)).toBeNull();
  });
});
