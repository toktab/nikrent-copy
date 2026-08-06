import { describe, expect, it } from 'vitest';
import { componentThatFits, nearestGap } from '../gap';
import type { Material } from '../../types';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

const mat = (name: string, w: number, category: Material['category'], h = 300): Material =>
  ({ id: name, name, category, w, h, depth: 9, shape: 'rect', color: '#000', stock: {} }) as Material;

describe('nearestGap', () => {
  it('reports the height of the piece across the gap, so a fill can match it', () => {
    const gap = nearestGap(rect(0, 0, 90, 9), [{ ...rect(135, 0, 90, 9), heightCm: 300 }]);
    expect(gap?.size).toBe(45);
    expect(gap?.againstHeight).toBe(300);
  });

  it('measures the clear distance to the panel beside it', () => {
    const moving = rect(0, 0, 90, 300);
    const gap = nearestGap(moving, [rect(100, 0, 90, 300)]);
    expect(gap?.size).toBe(10);
    expect(gap?.axis).toBe('u');
    // label sits in the middle of the gap, and halfway down the shared edge
    expect(gap?.u).toBe(95);
    expect(gap?.v).toBe(150);
  });

  it('measures a gap on the left as readily as one on the right', () => {
    const gap = nearestGap(rect(100, 0, 90, 300), [rect(0, 0, 45, 300)]);
    expect(gap?.size).toBe(55);
    expect(gap?.u).toBe(72.5);
  });

  it('ignores a piece that shares no edge — it is not in the same run', () => {
    // Far below, so the two never face each other across the gap.
    expect(nearestGap(rect(0, 0, 90, 300), [rect(100, 900, 90, 300)])).toBeNull();
  });

  it('reports the smallest gap when a piece has neighbours on both sides', () => {
    const gap = nearestGap(rect(100, 0, 90, 300), [
      rect(0, 0, 90, 300), // 10 to the left
      rect(200, 0, 90, 300), // 10 to the right
      rect(100, 320, 90, 300), // 20 below
    ]);
    expect(gap?.size).toBe(10);
  });

  it('finds a gap below as well as beside', () => {
    const gap = nearestGap(rect(0, 0, 90, 150), [rect(0, 175, 90, 150)]);
    expect(gap?.size).toBe(25);
    expect(gap?.axis).toBe('v');
    expect(gap?.v).toBe(162.5);
  });

  it('does not call touching panels a gap', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(90, 0, 90, 300)])).toBeNull();
  });

  // The one that got through the first time: a touching neighbour was discarded
  // as "not a gap", so the panel beyond it won and the drawing reported a 90 cm
  // hole measured straight through the panel in between.
  it('does not measure through the panel next to it', () => {
    const run = [rect(90, 0, 90, 300), rect(180, 0, 90, 300), rect(270, 0, 90, 300)];
    expect(nearestGap(rect(0, 0, 90, 300), run)).toBeNull();
  });

  it('reports the leftover at the end of a butted run', () => {
    const run = [rect(90, 0, 90, 300), rect(180, 0, 90, 300), rect(405, 0, 45, 300)];
    // 270 is the last butted panel; the next thing is 45 cm past its end.
    expect(nearestGap(rect(270, 0, 90, 300), run)?.size).toBe(45);
  });

  it('does not call an overlap a gap', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(80, 0, 90, 300)])).toBeNull();
  });

  it('ignores a neighbour too far away to be a joint', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(900, 0, 90, 300)], 400)).toBeNull();
  });

  // In plan a panel on the ground and one on the next lift have the same
  // footprint, so without the third dimension the clear air between two courses
  // reads as a hole in a wall.
  it('does not measure between two different courses', () => {
    const onGround = { ...rect(0, 0, 90, 9), span: [0, 300] as [number, number] };
    const nextLift = { ...rect(135, 0, 90, 9), span: [300, 600] as [number, number] };
    expect(nearestGap(onGround, [nextLift])).toBeNull();
  });

  // In plan a panel is 90 wide and 9 thick. What sits beyond its length is the
  // next panel in the run; what sits across its thickness is the far side of
  // the same wall, and the distance between them is the concrete.
  it('does not measure across the thickness of a wall', () => {
    const face = { ...rect(0, 0, 90, 9), faceAxis: 'u' as const };
    const farSide = rect(0, 36, 90, 9);
    expect(nearestGap(face, [farSide])).toBeNull();
  });

  it('still measures along the run when the face axis is set', () => {
    const face = { ...rect(0, 0, 90, 9), faceAxis: 'u' as const };
    expect(nearestGap(face, [rect(135, 0, 90, 9)])?.size).toBe(45);
  });

  it('measures both ways in an elevation, where above is the next course', () => {
    const silhouette = rect(0, -300, 90, 300);
    expect(nearestGap(silhouette, [rect(0, -620, 90, 300)])?.axis).toBe('v');
  });

  it('still measures between two pieces on the same course', () => {
    const a = { ...rect(0, 0, 90, 9), span: [0, 300] as [number, number] };
    const b = { ...rect(135, 0, 90, 9), span: [0, 300] as [number, number] };
    expect(nearestGap(a, [b])?.size).toBe(45);
  });
});

describe('componentThatFits', () => {
  const catalog = [
    // 150 deliberately first, so "the shorter one happened to come first in the
    // catalog" cannot pass by accident.
    mat('პანელი 45*150', 45, 'panel', 150),
    mat('პანელი 45*300', 45, 'panel', 300),
    mat('პანელი 90*300', 90, 'panel'),
    mat('ჩაკერება 10*300', 10, 'filler'),
    mat('waler 100', 100, 'waler'),
    mat('გარე კუთხე 300', 10, 'corner'),
  ];

  it('matches the height of the run it is closing', () => {
    expect(componentThatFits(45, catalog, 300)).toBe('პანელი 45*300');
    expect(componentThatFits(45, catalog, 150)).toBe('პანელი 45*150');
  });

  it('still answers when the height of the neighbour is unknown', () => {
    expect(componentThatFits(45, catalog)).toBe('პანელი 45*150');
  });

  it('names the panel that closes the gap', () => {
    expect(componentThatFits(45, catalog, 300)).toBe('პანელი 45*300');
  });

  it('names a filler for a small gap', () => {
    expect(componentThatFits(10, catalog)).toBe('ჩაკერება 10*300');
  });

  it('offers nothing when the gap has to be cut on site', () => {
    expect(componentThatFits(37, catalog)).toBeUndefined();
  });

  // The bug this file was reopened for: a 10 cm filler was offered to close a
  // 9.7 cm hole, because the tolerance was symmetric. Steel-framed ply does not
  // compress — a part wider than the gap is a wasted trip to the yard.
  it('never offers a component wider than the gap', () => {
    expect(componentThatFits(9.7, catalog, 300)).toBeUndefined();
    expect(componentThatFits(9.9, catalog, 300)).toBeUndefined();
  });

  it('accepts a hair of arithmetic noise off a drag', () => {
    expect(componentThatFits(9.95, catalog, 300)).toBe('ჩაკერება 10*300');
    expect(componentThatFits(10.1, catalog, 300)).toBe('ჩაკერება 10*300');
  });

  it('takes a component slightly narrower than the gap', () => {
    expect(componentThatFits(10.4, catalog, 300)).toBe('ჩაკერება 10*300');
  });

  // An L cannot close a straight run; it belongs where two faces meet.
  it('does not offer a corner as a fill', () => {
    expect(componentThatFits(10, [mat('გარე კუთხე', 10, 'corner')])).toBeUndefined();
  });

  // A waler is not a face — it never closes a gap in the formwork skin, so it
  // must not be offered as one even though its width would match.
  it('only offers panels and fillers', () => {
    expect(componentThatFits(100, catalog)).toBeUndefined();
  });
});
