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

  it('does not call an overlap a gap', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(80, 0, 90, 300)])).toBeNull();
  });

  it('ignores a neighbour too far away to be a joint', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(900, 0, 90, 300)], 400)).toBeNull();
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

  // A waler is not a face — it never closes a gap in the formwork skin, so it
  // must not be offered as one even though its width would match.
  it('only offers panels and fillers', () => {
    expect(componentThatFits(100, catalog)).toBeUndefined();
  });
});
