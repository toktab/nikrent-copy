import { describe, expect, it } from 'vitest';
import {
  distanceToPath,
  orthogonal,
  pathAt,
  pathLength,
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
