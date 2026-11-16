import { describe, expect, it } from 'vitest';
import { secondPoint, type RefEdge } from '../measure';

describe('measure - running along a wall stops at the end of a panel', () => {
  // A wall face y=0 made of a 60 and a 45, measured 30 cm off it.
  const edges: RefEdge[] = [
    { a: { x: 0, y: 0 }, b: { x: 60, y: 0 }, key: 'pc:p1:0' },
    { a: { x: 60, y: 0 }, b: { x: 105, y: 0 }, key: 'pc:p2:0' },
  ];
  const ctx = {
    first: { x: 0, y: -30 },
    firstEdge: edges[0],
    suggestion: null,
    edges,
    measures: [],
    zoom: 1,
    step: 5,
    shift: false,
    helper: true,
  };
  it('lines up with the joint at 60 when the pointer is nearly there', () => {
    const r = secondPoint({ x: 62, y: -31 }, ctx);
    expect(r.point.x).toBeCloseTo(60);
    expect(r.point.y).toBeCloseTo(-30);
    expect(r.via).toBe('track');
  });
  it('and with the far end of the wall at 105', () => {
    expect(secondPoint({ x: 103.5, y: -29 }, ctx).point.x).toBeCloseTo(105);
  });
});
