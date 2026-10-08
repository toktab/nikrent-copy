import { describe, expect, it } from 'vitest';
import type { Material, Piece } from '../../types';
import {
  depthRanks,
  isElevation,
  projectPiece,
  projectedContentBounds,
  unprojectDelta,
  VIEW_ORDER,
  viewDepth,
  type ViewAxis,
} from '../projection';

const material = (over: Partial<Material> = {}): Material => ({
  id: 'panel',
  name: 'პანელი 45*300',
  category: 'panel',
  w: 45,
  h: 300,
  depth: 9,
  shape: 'rect',
  color: '#c9a36a',
  builtin: true,
  stock: {},
  weight: 0,
  article: '',
  supplier: '',
  ...over,
});

const piece = (over: Partial<Piece> = {}): Piece => ({
  id: 'p1',
  materialId: 'panel',
  x: 0,
  y: 0,
  rot: 0,
  ...over,
});

const ELEVATIONS: ViewAxis[] = ['front', 'side'];

describe('projectPiece', () => {
  const m = material();

  it('is the plan footprint in plan, and ignores elevation there', () => {
    const low = projectPiece(piece({ x: 10, y: 20, z: 0 }), m, 'plan');
    const high = projectPiece(piece({ x: 10, y: 20, z: 500 }), m, 'plan');
    expect(low).toEqual({ x: 10, y: 20, w: 45, h: 9 });
    expect(high).toEqual(low);
  });

  it('shows the standing height in an elevation, not the plan depth', () => {
    const front = projectPiece(piece({ x: 10, y: 20 }), m, 'front');
    expect(front.w).toBe(45); // the plan width
    expect(front.h).toBe(300); // the standing height
    const side = projectPiece(piece({ x: 10, y: 20 }), m, 'side');
    expect(side.w).toBe(9); // the plan depth
    expect(side.h).toBe(300);
  });

  it('puts a piece on the ground at surface y = -height', () => {
    for (const view of ELEVATIONS) {
      const r = projectPiece(piece({ z: 0 }), m, view);
      // Surface y grows downward, so the top edge is negative and the bottom
      // edge lands exactly on the ground line.
      expect(r.y).toBe(-300);
      expect(r.y + r.h).toBe(0);
    }
  });

  it('lifts a raised piece further up the surface', () => {
    for (const view of ELEVATIONS) {
      const ground = projectPiece(piece({ z: 0 }), m, view);
      const raised = projectPiece(piece({ z: 300 }), m, view);
      expect(raised.y).toBeLessThan(ground.y);
      expect(raised.y).toBe(-600);
      // A course sitting on the one below shares an edge, with no gap.
      expect(raised.y + raised.h).toBe(ground.y);
    }
  });

  it('reads a rotation as a wider silhouette, not a turned one', () => {
    // A quarter turn swaps which plan dimension faces the viewer.
    const turned = projectPiece(piece({ rot: 90 }), m, 'front');
    expect(turned.w).toBeCloseTo(9);
    expect(turned.h).toBe(300);
  });

  /**
   * A solid extruded from an L still casts a plain rectangle from the front,
   * so the silhouette is the bounding box — not a notched outline.
   */
  it('gives a concave footprint a rectangular silhouette', () => {
    const corner = material({ shape: 'L', w: 20, depth: 20, h: 250 });
    const r = projectPiece(piece(), corner, 'front');
    expect(r.h).toBe(250);
    expect(r.w).toBeGreaterThan(0);
  });
});

describe('unprojectDelta', () => {
  it('leaves the plan alone and never changes elevation there', () => {
    expect(unprojectDelta(7, -3, 'plan')).toEqual({ dx: 7, dy: -3, dz: 0 });
  });

  it('maps the front view to width and height', () => {
    expect(unprojectDelta(7, -3, 'front')).toEqual({ dx: 7, dy: 0, dz: 3 });
  });

  it('maps the side view to depth and height', () => {
    expect(unprojectDelta(7, -3, 'side')).toEqual({ dx: 0, dy: 7, dz: 3 });
  });

  it('raises a piece when the pointer goes up the screen', () => {
    for (const view of ELEVATIONS) {
      // Screen y grows downward, so a negative dv is an upward drag.
      expect(unprojectDelta(0, -20, view).dz).toBeGreaterThan(0);
      expect(unprojectDelta(0, 20, view).dz).toBeLessThan(0);
    }
  });

  /**
   * The round trip that matters: dragging a piece by some surface delta must
   * land it exactly where the pointer went, in every view.
   */
  it('round-trips through projectPiece', () => {
    const m = material();
    for (const view of VIEW_ORDER) {
      for (const [du, dv] of [
        [30, 0],
        [0, -75],
        [-12.5, 40],
      ]) {
        const start = piece({ x: 100, y: 60, z: 150 });
        const before = projectPiece(start, m, view);
        const d = unprojectDelta(du, dv, view);
        const after = projectPiece(
          { ...start, x: start.x + d.dx, y: start.y + d.dy, z: (start.z ?? 0) + d.dz },
          m,
          view,
        );
        expect(after.x - before.x).toBeCloseTo(du);
        expect(after.y - before.y).toBeCloseTo(dv);
      }
    }
  });
});

describe('depth ordering', () => {
  const m = material();

  it('has no opinion in plan', () => {
    expect(viewDepth(piece(), m, 'plan')).toBe(0);
    expect(depthRanks([piece()], new Map([['panel', m]]), 'plan').size).toBe(0);
  });

  it('draws the nearer piece in front, in both elevations', () => {
    // Both elevations look along the positive axis, so a smaller coordinate is
    // nearer the viewer.
    expect(viewDepth(piece({ y: 0 }), m, 'front')).toBeGreaterThan(
      viewDepth(piece({ y: 500 }), m, 'front'),
    );
    expect(viewDepth(piece({ x: 0 }), m, 'side')).toBeGreaterThan(
      viewDepth(piece({ x: 500 }), m, 'side'),
    );
  });

  it('ranks from furthest to nearest, as small consecutive integers', () => {
    const byId = new Map([['panel', m]]);
    const near = piece({ id: 'near', y: 0 });
    const far = piece({ id: 'far', y: 900 });
    const ranks = depthRanks([near, far], byId, 'front');
    expect(ranks.get('far')).toBe(0);
    expect(ranks.get('near')).toBe(1);
  });

  it('skips a piece whose material has gone from the catalog', () => {
    const ranks = depthRanks([piece({ materialId: 'missing' })], new Map(), 'front');
    expect(ranks.size).toBe(0);
  });
});

describe('projectedContentBounds', () => {
  const m = material();
  const byId = new Map([['panel', m]]);

  it('is null with nothing placed', () => {
    expect(projectedContentBounds([], byId, 'front')).toBeNull();
  });

  it('covers a stack from the ground to the top of the highest course', () => {
    const stack = [piece({ id: 'a', z: 0 }), piece({ id: 'b', z: 300 })];
    const b = projectedContentBounds(stack, byId, 'front')!;
    expect(b.y).toBe(-600);
    expect(b.y + b.h).toBe(0);
    expect(b.h).toBe(600);
  });

  it('measures the plan in plan, where a stack collapses to one footprint', () => {
    const stack = [piece({ id: 'a', z: 0 }), piece({ id: 'b', z: 300 })];
    const b = projectedContentBounds(stack, byId, 'plan')!;
    expect(b.h).toBe(9);
  });

  it('ignores a piece whose material has gone from the catalog', () => {
    const b = projectedContentBounds(
      [piece({ id: 'a' }), piece({ id: 'gone', materialId: 'missing', x: 9999 })],
      byId,
      'front',
    )!;
    expect(b.x + b.w).toBeLessThan(9999);
  });
});

describe('isElevation', () => {
  it('is true for exactly the two views that can change height', () => {
    expect(isElevation('plan')).toBe(false);
    expect(isElevation('front')).toBe(true);
    expect(isElevation('side')).toBe(true);
    for (const v of VIEW_ORDER) {
      expect(isElevation(v)).toBe(unprojectDelta(0, 1, v).dz !== 0);
    }
  });
});
