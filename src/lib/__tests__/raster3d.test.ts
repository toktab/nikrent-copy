import { describe, expect, it } from 'vitest';
import {
  classifyEdge,
  createRaster,
  depthAt,
  fillFace,
  pickAt,
  rasterMatches,
  resetRaster,
  type ScreenPoint,
} from '../raster3d';

const WHITE = { r: 255, g: 255, b: 255 };
const RED = { r: 255, g: 0, b: 0 };

/** An axis-aligned quad at a constant depth, wound clockwise on screen. */
const quad = (
  x: number,
  y: number,
  w: number,
  h: number,
  depth: number,
): ScreenPoint[] => [
  { x, y, depth },
  { x: x + w, y, depth },
  { x: x + w, y: y + h, depth },
  { x, y: y + h, depth },
];

const colourAt = (
  raster: ReturnType<typeof createRaster>,
  x: number,
  y: number,
): [number, number, number, number] => {
  const i = (Math.floor(y * raster.scale) * raster.w + Math.floor(x * raster.scale)) * 4;
  return [raster.rgba[i], raster.rgba[i + 1], raster.rgba[i + 2], raster.rgba[i + 3]];
};

describe('createRaster', () => {
  it('starts empty, with nothing drawn and no depth anywhere', () => {
    const raster = createRaster(20, 10, 1);
    expect(raster.w).toBe(20);
    expect(raster.h).toBe(10);
    expect(depthAt(raster, 5, 5)).toBe(-Infinity);
    expect(colourAt(raster, 5, 5)[3]).toBe(0);
  });

  it('scales the buffer above CSS resolution', () => {
    const raster = createRaster(20, 10, 2);
    expect(raster.w).toBe(40);
    expect(raster.h).toBe(20);
  });

  it('is reusable only for the same viewport', () => {
    const raster = createRaster(20, 10, 1);
    expect(rasterMatches(raster, 20, 10, 1)).toBe(true);
    expect(rasterMatches(raster, 21, 10, 1)).toBe(false);
    expect(rasterMatches(raster, 20, 10, 2)).toBe(false);
    expect(rasterMatches(null, 20, 10, 1)).toBe(false);
  });

  it('clears back to empty', () => {
    const raster = createRaster(20, 10, 1);
    fillFace(raster, quad(0, 0, 20, 10, 5), WHITE);
    resetRaster(raster);
    expect(depthAt(raster, 5, 5)).toBe(-Infinity);
    expect(colourAt(raster, 5, 5)[3]).toBe(0);
  });
});

describe('fillFace', () => {
  it('paints inside the face and leaves the outside alone', () => {
    const raster = createRaster(40, 40, 1);
    fillFace(raster, quad(10, 10, 20, 20, 3), WHITE);
    expect(colourAt(raster, 20, 20)).toEqual([255, 255, 255, 255]);
    expect(colourAt(raster, 2, 2)[3]).toBe(0);
    expect(depthAt(raster, 20, 20)).toBeCloseTo(3);
  });

  it('interpolates depth across a tilted face', () => {
    const raster = createRaster(40, 40, 1);
    fillFace(
      raster,
      [
        { x: 0, y: 0, depth: 0 },
        { x: 40, y: 0, depth: 100 },
        { x: 40, y: 40, depth: 100 },
        { x: 0, y: 40, depth: 0 },
      ],
      WHITE,
    );
    // sampled at the pixel centre, so x = 20.5 of 40 → 51.25
    expect(depthAt(raster, 20, 20)).toBeCloseTo(51.25);
    expect(depthAt(raster, 4, 20)).toBeLessThan(depthAt(raster, 36, 20));
  });

  it('keeps the nearer face whatever order the faces arrive in', () => {
    for (const nearFirst of [true, false]) {
      const raster = createRaster(40, 40, 1);
      const near = () => fillFace(raster, quad(0, 0, 40, 40, 50), RED);
      const far = () => fillFace(raster, quad(0, 0, 40, 40, 10), WHITE);
      if (nearFirst) {
        near();
        far();
      } else {
        far();
        near();
      }
      expect(colourAt(raster, 20, 20)).toEqual([255, 0, 0, 255]);
      expect(depthAt(raster, 20, 20)).toBeCloseTo(50);
    }
  });

  it('does not let a long thin bar paint over the panel it passes behind', () => {
    // The exact case a painter's algorithm gets wrong: the bar's centroid is
    // nearer than the panel's, but the bar itself runs behind it.
    const raster = createRaster(100, 100, 1);
    fillFace(raster, quad(30, 0, 40, 100, 60), WHITE); // panel, near
    fillFace(raster, quad(0, 45, 100, 10, 20), RED); // bar, far, crosses it

    expect(colourAt(raster, 50, 50)).toEqual([255, 255, 255, 255]); // panel wins
    expect(colourAt(raster, 10, 50)).toEqual([255, 0, 0, 255]); // bar shows beside it
    expect(colourAt(raster, 90, 50)).toEqual([255, 0, 0, 255]);
  });

  it('ignores degenerate faces', () => {
    const raster = createRaster(20, 20, 1);
    fillFace(raster, quad(5, 5, 0, 10, 4), WHITE); // zero width
    fillFace(raster, [{ x: 1, y: 1, depth: 1 }], WHITE); // not a polygon
    expect(colourAt(raster, 5, 10)[3]).toBe(0);
  });

  it('clips to the buffer instead of writing out of bounds', () => {
    const raster = createRaster(20, 20, 1);
    expect(() => fillFace(raster, quad(-50, -50, 200, 200, 1), WHITE)).not.toThrow();
    expect(colourAt(raster, 10, 10)).toEqual([255, 255, 255, 255]);
  });
});

describe('classifyEdge', () => {
  const near = (raster: ReturnType<typeof createRaster>) =>
    fillFace(raster, quad(30, 0, 40, 100, 60), WHITE);

  it('reports an edge over empty space as fully visible', () => {
    const raster = createRaster(100, 100, 1);
    const runs = classifyEdge(
      raster,
      { x: 5, y: 50, depth: 10 },
      { x: 25, y: 50, depth: 10 },
      0.5,
    );
    expect(runs).toHaveLength(1);
    expect(runs[0].visible).toBe(true);
  });

  it('hides the stretch that runs behind a nearer face', () => {
    const raster = createRaster(100, 100, 1);
    near(raster);
    const runs = classifyEdge(
      raster,
      { x: 0, y: 50, depth: 20 },
      { x: 100, y: 50, depth: 20 },
      0.5,
    );
    expect(runs.length).toBe(3);
    expect(runs.map((r) => r.visible)).toEqual([true, false, true]);
    // the hidden stretch is the panel's 30..70 band
    expect(runs[1].from.x).toBeCloseTo(30, -1);
    expect(runs[1].to.x).toBeCloseTo(70, -1);
  });

  it('keeps an edge that passes in front of the same face', () => {
    const raster = createRaster(100, 100, 1);
    near(raster);
    const runs = classifyEdge(
      raster,
      { x: 0, y: 50, depth: 200 },
      { x: 100, y: 50, depth: 200 },
      0.5,
    );
    expect(runs.every((r) => r.visible)).toBe(true);
  });

  it('does not let a face hide its own outline', () => {
    // The edge lies exactly on the face it belongs to; without tolerance the
    // depth test is a coin flip and pieces lose their outlines.
    const raster = createRaster(100, 100, 1);
    fillFace(
      raster,
      [
        { x: 10, y: 10, depth: 100 },
        { x: 90, y: 10, depth: 140 },
        { x: 90, y: 90, depth: 140 },
        { x: 10, y: 90, depth: 100 },
      ],
      WHITE,
    );
    const runs = classifyEdge(
      raster,
      { x: 10, y: 10, depth: 100 },
      { x: 90, y: 10, depth: 140 },
      3,
    );
    expect(runs.every((r) => r.visible)).toBe(true);
  });

  it('covers the whole edge exactly once', () => {
    const raster = createRaster(100, 100, 1);
    near(raster);
    const runs = classifyEdge(
      raster,
      { x: 0, y: 50, depth: 20 },
      { x: 100, y: 50, depth: 20 },
      0.5,
    );
    expect(runs[0].from.x).toBeCloseTo(0);
    expect(runs[runs.length - 1].to.x).toBeCloseTo(100);
    for (let i = 1; i < runs.length; i++) {
      expect(runs[i].from.x).toBeCloseTo(runs[i - 1].to.x);
    }
  });

  it('handles a zero-length edge without looping forever', () => {
    const raster = createRaster(20, 20, 1);
    const runs = classifyEdge(
      raster,
      { x: 5, y: 5, depth: 1 },
      { x: 5, y: 5, depth: 1 },
      0.5,
    );
    expect(runs).toHaveLength(1);
  });
});

describe('pickAt', () => {
  it('reports nothing on empty background', () => {
    const raster = createRaster(60, 60, 1);
    expect(pickAt(raster, 30, 30)).toBe(-1);
  });

  it('reports the face under the cursor', () => {
    const raster = createRaster(60, 60, 1);
    fillFace(raster, quad(10, 10, 30, 30, 5), WHITE, 7);
    expect(pickAt(raster, 25, 25)).toBe(7);
  });

  /**
   * The whole reason to reuse the depth buffer: whichever piece the user can
   * actually see is the one that gets picked, with no extra sorting.
   */
  it('picks the nearer piece where two overlap, whichever was drawn first', () => {
    const near = createRaster(60, 60, 1);
    fillFace(near, quad(10, 10, 30, 30, 1), WHITE, 1); // far, drawn first
    fillFace(near, quad(20, 20, 30, 30, 9), RED, 2); // near, drawn second
    expect(pickAt(near, 25, 25)).toBe(2);

    const reversed = createRaster(60, 60, 1);
    fillFace(reversed, quad(20, 20, 30, 30, 9), RED, 2); // near, drawn first
    fillFace(reversed, quad(10, 10, 30, 30, 1), WHITE, 1); // far, drawn second
    expect(pickAt(reversed, 25, 25)).toBe(2);
  });

  /**
   * An L-corner's notch is inside its bounding box but outside the piece. A
   * box hit-test would claim it; going through the rasterised outline cannot.
   */
  it('does not pick the empty notch of a concave outline', () => {
    const raster = createRaster(60, 60, 1);
    const L: ScreenPoint[] = [
      { x: 10, y: 10, depth: 5 },
      { x: 40, y: 10, depth: 5 },
      { x: 40, y: 20, depth: 5 },
      { x: 20, y: 20, depth: 5 },
      { x: 20, y: 40, depth: 5 },
      { x: 10, y: 40, depth: 5 },
    ];
    fillFace(raster, L, WHITE, 3);
    expect(pickAt(raster, 14, 14)).toBe(3); // on the piece
    // Well inside the bounding box, well outside the L. Radius 0 so the
    // forgiving search cannot wander back onto the arm.
    expect(pickAt(raster, 34, 34, 0)).toBe(-1);
  });

  it('forgives a near miss, but prefers an exact hit', () => {
    const raster = createRaster(60, 60, 1);
    fillFace(raster, quad(20, 20, 4, 20, 5), WHITE, 4); // a thin, edge-on waler
    expect(pickAt(raster, 26, 30, 0)).toBe(-1); // strictly beside it
    expect(pickAt(raster, 26, 30, 4)).toBe(4); // within reach

    // Two candidates near the cursor: the one actually under it wins.
    fillFace(raster, quad(30, 20, 4, 20, 5), RED, 5);
    expect(pickAt(raster, 31, 30, 6)).toBe(5);
  });

  it('is cleared by a reset, so a stale pick cannot outlive its frame', () => {
    const raster = createRaster(60, 60, 1);
    fillFace(raster, quad(10, 10, 30, 30, 5), WHITE, 7);
    resetRaster(raster);
    expect(pickAt(raster, 25, 25)).toBe(-1);
  });

  it('leaves unidentified scenery unpickable', () => {
    const raster = createRaster(60, 60, 1);
    fillFace(raster, quad(10, 10, 30, 30, 5), WHITE); // no id passed
    expect(pickAt(raster, 25, 25)).toBe(-1);
  });

  it('stays inside the buffer when the cursor leaves the viewport', () => {
    const raster = createRaster(60, 60, 1);
    fillFace(raster, quad(10, 10, 30, 30, 5), WHITE, 7);
    expect(pickAt(raster, -50, -50)).toBe(-1);
    expect(pickAt(raster, 500, 500)).toBe(-1);
  });

  it('works at a raster coarser than the display', () => {
    const raster = createRaster(60, 60, 0.5);
    fillFace(raster, quad(10, 10, 30, 30, 5), WHITE, 8);
    expect(pickAt(raster, 25, 25)).toBe(8);
  });
});
