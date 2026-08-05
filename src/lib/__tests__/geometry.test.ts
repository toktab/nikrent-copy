import { describe, expect, it } from 'vitest';
import type { Material, Piece } from '../../types';
import {
  computeEdgeSnap,
  contentBounds,
  findOverlaps,
  niceStep,
  normalizeRot,
  pieceBounds,
  planH,
  planW,
  rectsOverlap,
  rotatedExtent,
  screenToWorld,
  snapValue,
  unionRect,
  worldToScreen,
} from '../geometry';

function material(over: Partial<Material> = {}): Material {
  return {
    id: 'm1',
    name: 'test',
    category: 'panel',
    w: 45,
    h: 300,
    depth: 9,
    shape: 'rect',
    color: '#fff',
    builtin: false,
    stock: {},
    weight: 0,
    article: '',
    supplier: '',
    ...over,
  };
}

const piece = (over: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  materialId: 'm1',
  x: 0,
  y: 0,
  rot: 0,
  ...over,
});

describe('world ↔ screen', () => {
  const view = { zoom: 2, panX: 40, panY: 60 };

  it('round-trips a point', () => {
    const s = worldToScreen(100, 250, view);
    expect(s).toEqual({ x: 240, y: 560 });
    expect(screenToWorld(s.x, s.y, view)).toEqual({ x: 100, y: 250 });
  });

  it('treats zoom as screen px per cm', () => {
    expect(worldToScreen(1, 0, { zoom: 3, panX: 0, panY: 0 }).x).toBe(3);
  });
});

describe('snapValue', () => {
  it('rounds to the step when enabled', () => {
    expect(snapValue(12, 5, true)).toBe(10);
    expect(snapValue(13, 5, true)).toBe(15);
  });

  it('passes the value through when disabled', () => {
    expect(snapValue(12.7, 5, false)).toBe(12.7);
  });
});

describe('plan dimensions', () => {
  // The surface is a plan view: "პანელი 45*300" is 45 wide and 9 thick on
  // screen; the 300 is height and points out of the page.
  it('draws width × depth, not width × height', () => {
    expect(planW(material())).toBe(45);
    expect(planH(material())).toBe(9);
  });
});

describe('pieceBounds', () => {
  it('is width × depth when upright', () => {
    expect(pieceBounds(piece({ rot: 0 }), material())).toEqual({ x: 0, y: 0, w: 45, h: 9 });
    // 180° goes through the trig path, so allow for float dust
    const flipped = pieceBounds(piece({ rot: 180 }), material());
    expect(flipped.w).toBeCloseTo(45);
    expect(flipped.h).toBeCloseTo(9);
  });

  it('swaps extents at 90° about the same centre', () => {
    const b = pieceBounds(piece({ rot: 90 }), material());
    expect(b.w).toBeCloseTo(9);
    expect(b.h).toBeCloseTo(45);
    // centre is rotation-invariant
    expect(b.x + b.w / 2).toBeCloseTo(22.5);
    expect(b.y + b.h / 2).toBeCloseTo(4.5);
  });

  it('handles negative rotations', () => {
    expect(pieceBounds(piece({ rot: -90 }), material()).h).toBeCloseTo(45);
  });

  it('grows the bounding box at an arbitrary angle', () => {
    const b = pieceBounds(piece({ rot: 45 }), material());
    // 45×9 turned 45° spans (45+9)/√2 ≈ 38.2 each way
    expect(b.w).toBeCloseTo(38.18, 1);
    expect(b.h).toBeCloseTo(38.18, 1);
  });
});

describe('rotatedExtent', () => {
  it('is exact at quarter turns', () => {
    expect(rotatedExtent(45, 9, 0)).toEqual({ w: 45, h: 9 });
    expect(rotatedExtent(45, 9, 90).w).toBeCloseTo(9);
    expect(rotatedExtent(45, 9, 270).h).toBeCloseTo(45);
  });

  it('is symmetric about 180°', () => {
    const a = rotatedExtent(45, 9, 30);
    const b = rotatedExtent(45, 9, 210);
    expect(a.w).toBeCloseTo(b.w);
    expect(a.h).toBeCloseTo(b.h);
  });
});

describe('normalizeRot', () => {
  it('wraps into [0, 360)', () => {
    expect(normalizeRot(0)).toBe(0);
    expect(normalizeRot(370)).toBe(10);
    expect(normalizeRot(-90)).toBe(270);
    expect(normalizeRot(-450)).toBe(270);
  });
});

describe('contentBounds', () => {
  const byId = new Map([['m1', material()]]);

  it('returns null when nothing is placed', () => {
    expect(contentBounds([], byId)).toBeNull();
  });

  it('spans every piece', () => {
    const b = contentBounds([piece({ x: 0 }), piece({ id: 'p2', x: 100 })], byId);
    expect(b).toEqual({ x: 0, y: 0, w: 145, h: 9 });
  });

  it('ignores pieces whose material is missing', () => {
    const b = contentBounds([piece(), piece({ id: 'p2', materialId: 'gone' })], byId);
    expect(b?.w).toBe(45);
  });
});

describe('overlap detection', () => {
  it('does not flag edge-to-edge contact', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 45, h: 300 }, { x: 45, y: 0, w: 45, h: 300 })).toBe(false);
  });

  it('flags a genuine intersection', () => {
    expect(rectsOverlap({ x: 0, y: 0, w: 45, h: 300 }, { x: 20, y: 0, w: 45, h: 300 })).toBe(true);
  });

  it('reports both ids of an overlapping pair', () => {
    const byId = new Map([['m1', material()]]);
    const hits = findOverlaps([piece({ id: 'a' }), piece({ id: 'b', x: 10 })], byId);
    expect([...hits].sort()).toEqual(['a', 'b']);
  });

  it('leaves neatly butted panels alone', () => {
    const byId = new Map([['m1', material()]]);
    const hits = findOverlaps([piece({ id: 'a' }), piece({ id: 'b', x: 45 })], byId);
    expect(hits.size).toBe(0);
  });

  it('ignores linear pieces, which are meant to lie across panels', () => {
    // A waler crossing a panel is correct formwork, not a clash.
    const byId = new Map([
      ['m1', material()],
      ['waler', material({ id: 'waler', w: 300, h: 12, depth: 12, shape: 'line' })],
    ]);
    const hits = findOverlaps(
      [piece({ id: 'panel' }), piece({ id: 'w', materialId: 'waler', y: 100 })],
      byId,
    );
    expect(hits.size).toBe(0);
  });

  it('still flags two L-profiles in the same place', () => {
    const byId = new Map([['corner', material({ id: 'corner', w: 20, h: 300, depth: 20, shape: 'L' })]]);
    const hits = findOverlaps(
      [piece({ id: 'a', materialId: 'corner' }), piece({ id: 'b', materialId: 'corner', x: 5 })],
      byId,
    );
    expect(hits.size).toBe(2);
  });
});

describe('computeEdgeSnap', () => {
  const moving = { x: 47, y: 0, w: 45, h: 300 };

  it('pulls a near edge into contact', () => {
    const snap = computeEdgeSnap(moving, [{ x: 0, y: 0, w: 45, h: 300 }], 8);
    // moving.x 47 should snap back to the target's right edge at 45
    expect(snap.dx).toBe(-2);
    expect(snap.guideX).toBe(45);
  });

  it('ignores targets outside the tolerance', () => {
    const snap = computeEdgeSnap(moving, [{ x: 0, y: 0, w: 20, h: 300 }], 8);
    expect(snap.dx).toBe(0);
    expect(snap.guideX).toBeNull();
  });

  it('picks the closest of several candidates', () => {
    const snap = computeEdgeSnap(moving, [
      { x: 0, y: 0, w: 45, h: 300 }, // right edge 45 → dx -2
      { x: 0, y: 0, w: 46, h: 300 }, // right edge 46 → dx -1
    ], 8);
    expect(snap.dx).toBe(-1);
  });
});

describe('unionRect', () => {
  it('returns null for an empty list', () => {
    expect(unionRect([])).toBeNull();
  });

  it('covers every rect', () => {
    expect(
      unionRect([
        { x: 0, y: 0, w: 10, h: 10 },
        { x: 20, y: 5, w: 10, h: 30 },
      ]),
    ).toEqual({ x: 0, y: 0, w: 30, h: 35 });
  });
});

describe('niceStep', () => {
  it('grows the ruler step as you zoom out', () => {
    expect(niceStep(1)).toBeLessThan(niceStep(0.1));
  });

  it('stays within the ladder', () => {
    expect([10, 20, 50, 100, 200, 500, 1000, 2000]).toContain(niceStep(0.5));
  });
});
