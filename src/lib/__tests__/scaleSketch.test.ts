import { describe, expect, it } from 'vitest';
import type { MeasureLine, SketchPath } from '../../types';
import { scaleFactor, scaleMeasures, scaleSketch, sketchBounds } from '../scaleSketch';

const path = (id: string, pts: Array<[number, number]>): SketchPath => ({
  id,
  points: pts.map(([x, y]) => ({ x, y })),
});

/** An L-shaped run, 400 across and 300 down, starting at (100, 50). */
const layout: SketchPath[] = [
  path('a', [
    [100, 50],
    [500, 50],
  ]),
  path('b', [
    [500, 50],
    [500, 350],
  ]),
];

const measures: MeasureLine[] = [
  { id: 'm', a: { x: 100, y: 50 }, b: { x: 500, y: 50 } },
];

describe('sketchBounds', () => {
  it('measures the whole layout', () => {
    expect(sketchBounds(layout)).toEqual({ x: 100, y: 50, w: 400, h: 300 });
  });

  it('counts measured lines, which can reach past the walls', () => {
    const outside: MeasureLine[] = [{ id: 'm', a: { x: 60, y: 20 }, b: { x: 600, y: 20 } }];
    expect(sketchBounds(layout, outside)).toEqual({ x: 60, y: 20, w: 540, h: 330 });
  });

  it('has nothing to say about an empty drawing', () => {
    expect(sketchBounds([])).toBeNull();
  });
});

describe('scaleFactor', () => {
  it('is the ratio of what it should be to what it is', () => {
    expect(scaleFactor(400, 5800)).toBe(14.5);
  });

  // Zero would collapse the drawing to a point, and there is no undoing a
  // layout that has become one dot.
  it('refuses a size nobody could have meant', () => {
    expect(scaleFactor(400, 0)).toBeNull();
    expect(scaleFactor(0, 400)).toBeNull();
    expect(scaleFactor(400, -10)).toBeNull();
    expect(scaleFactor(400, Number.NaN)).toBeNull();
  });
});

describe('scaling a whole layout', () => {
  const box = sketchBounds(layout)!;

  it('makes the drawing the size it was told to be', () => {
    const scaled = scaleSketch(layout, scaleFactor(box.w, 800)!, box);
    const after = sketchBounds(scaled)!;
    expect(after.w).toBeCloseTo(800, 1);
    // ...and the height follows, because the shape is kept.
    expect(after.h).toBeCloseTo(600, 1);
  });

  it('leaves the drawing where it was', () => {
    const scaled = scaleSketch(layout, 3, box);
    const after = sketchBounds(scaled)!;
    expect(after.x).toBe(box.x);
    expect(after.y).toBe(box.y);
  });

  it('keeps walls joined at their corners', () => {
    const scaled = scaleSketch(layout, 2.5, box);
    const endOfFirst = scaled[0].points[1];
    const startOfSecond = scaled[1].points[0];
    expect(endOfFirst).toEqual(startOfSecond);
  });

  it('keeps square walls square', () => {
    const scaled = scaleSketch(layout, 1.7, box);
    expect(scaled[0].points[0].y).toBe(scaled[0].points[1].y);
    expect(scaled[1].points[0].x).toBe(scaled[1].points[1].x);
  });

  it('carries the measured lines with it', () => {
    const scaled = scaleMeasures(measures, 2, box);
    expect(scaled[0].a).toEqual({ x: 100, y: 50 });
    expect(scaled[0].b).toEqual({ x: 900, y: 50 });
  });

  it('keeps what a line is - closed runs stay closed, faces keep their side', () => {
    const room: SketchPath[] = [
      { ...path('r', [[0, 0], [100, 0], [100, 100]]), closed: true, perimeter: 'inner' },
    ];
    const scaled = scaleSketch(room, 2, sketchBounds(room)!);
    expect(scaled[0].closed).toBe(true);
    expect(scaled[0].perimeter).toBe('inner');
    expect(scaled[0].id).toBe('r');
  });
});
