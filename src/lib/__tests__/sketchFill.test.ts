import { describe, expect, it } from 'vitest';
import type { Material, Piece, SketchPath } from '../../types';
import { createSeedMaterials } from '../../data/seedCatalog';
import { pieceBounds, planW, planH, type Rect } from '../geometry';
import { legThickness } from '../shapePath';
import {
  legDir,
  leftNormal,
  offsetPath,
  planSketchFill,
  turnSign,
  type SketchFillSpec,
} from '../sketchFill';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const path = (points: Array<[number, number]>, closed = false): SketchPath => ({
  id: 'k',
  points: points.map(([x, y]) => ({ x, y })),
  ...(closed ? { closed: true } : {}),
});

const spec = (over: Partial<SketchFillSpec> = {}): SketchFillSpec => ({
  thickness: 20,
  height: 300,
  includeCorners: true,
  includeStopEnds: true,
  ...over,
});

const materialOf = (p: Piece): Material => {
  const m = byId.get(p.materialId);
  if (!m) throw new Error(`unknown material ${p.materialId}`);
  return m;
};

const ofCategory = (pieces: Piece[], ...categories: Material['category'][]) =>
  pieces.filter((p) => categories.includes(materialOf(p).category));

/** `+ 0` folds away negative zero, which is equal to zero but not `toEqual` it. */
const xy = (p: { x: number; y: number }) => [p.x + 0, p.y + 0];

// ── Test-only geometry, derived independently of the code under test ────────

/** Area two rectangles share, ignoring a hair of float noise. */
function overlapArea(a: Rect, b: Rect): number {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.01 && h > 0.01 ? w * h : 0;
}

/**
 * The concrete the formwork is holding, as rectangles.
 *
 * Each leg is its centreline widened by half the thickness, and squared off at
 * every corner it shares with another leg — which is what fills the corner
 * itself. Open ends are NOT extended: the pour stops at the drawn end, and a
 * stop-end panel legitimately sits just beyond it.
 */
function concreteRects(p: SketchPath, thickness: number): Rect[] {
  const pts = p.points;
  const n = pts.length;
  const closed = !!p.closed && n > 2;
  const legs = closed ? n : n - 1;
  const half = thickness / 2;
  const out: Rect[] = [];
  for (let j = 0; j < legs; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const d = legDir(a, b);
    const capStart = closed || j > 0 ? half : 0;
    const capEnd = closed || j < legs - 1 ? half : 0;
    const ax = a.x - d.x * capStart;
    const ay = a.y - d.y * capStart;
    const bx = b.x + d.x * capEnd;
    const by = b.y + d.y * capEnd;
    out.push({
      x: Math.min(ax, bx) - (d.x ? 0 : half),
      y: Math.min(ay, by) - (d.y ? 0 : half),
      w: Math.abs(bx - ax) + (d.x ? 0 : thickness),
      h: Math.abs(by - ay) + (d.y ? 0 : thickness),
    });
  }
  return out;
}

/** Every pair of face pieces standing on the same course that share any area. */
function clashes(pieces: Piece[]): Array<[Piece, Piece]> {
  const faces = ofCategory(pieces, 'panel', 'filler', 'corner');
  const found: Array<[Piece, Piece]> = [];
  for (let i = 0; i < faces.length; i++) {
    for (let j = i + 1; j < faces.length; j++) {
      // Different courses stack on top of each other and coincide in plan,
      // which is correct — only a clash within one course is a real one.
      if ((faces[i].z ?? 0) !== (faces[j].z ?? 0)) continue;
      const a = pieceBounds(faces[i], materialOf(faces[i]));
      const b = pieceBounds(faces[j], materialOf(faces[j]));
      if (overlapArea(a, b) > 0.01) found.push([faces[i], faces[j]]);
    }
  }
  return found;
}

/**
 * The solid a piece actually occupies, as rectangles.
 *
 * For everything but a corner that is just its bounding box. An L is the
 * exception and it matters here: its box necessarily covers the concrete
 * corner, because the whole point of the profile is that its NOTCH goes over
 * the pour while its two legs wrap the outside. Judging one by its box would
 * report every corner in the drawing as buried in concrete.
 */
function solidOf(p: Piece, m: Material): Rect[] {
  const box = pieceBounds(p, m);
  if (m.shape !== 'L') return [box];

  const w = planW(m);
  const h = planH(m);
  const t = legThickness(w, h);
  // As drawn: the upright leg down the left, the foot along the bottom.
  const local: Rect[] = [
    { x: 0, y: 0, w: t, h },
    { x: 0, y: h - t, w, h: t },
  ];

  // Rotation is about the centre of the un-rotated box — the same convention
  // `placeAt` stores positions in.
  const cx = p.x + w / 2;
  const cy = p.y + h / 2;
  const turn = (dx: number, dy: number) => {
    switch (((p.rot % 360) + 360) % 360) {
      case 90:
        return { x: -dy, y: dx };
      case 180:
        return { x: -dx, y: -dy };
      case 270:
        return { x: dy, y: -dx };
      default:
        return { x: dx, y: dy };
    }
  };
  return local.map((r) => {
    const a = turn(r.x - w / 2, r.y - h / 2);
    const b = turn(r.x + r.w - w / 2, r.y + r.h - h / 2);
    return {
      x: cx + Math.min(a.x, b.x),
      y: cy + Math.min(a.y, b.y),
      w: Math.abs(b.x - a.x),
      h: Math.abs(b.y - a.y),
    };
  });
}

/** Face pieces with any solid part of themselves inside the pour. */
function intruding(pieces: Piece[], p: SketchPath, thickness: number): Piece[] {
  const concrete = concreteRects(p, thickness);
  return ofCategory(pieces, 'panel', 'filler', 'corner').filter((piece) =>
    solidOf(piece, materialOf(piece)).some((s) =>
      concrete.some((c) => overlapArea(s, c) > 0.01),
    ),
  );
}

// ── Offsetting ──────────────────────────────────────────────────────────────

describe('legDir and leftNormal', () => {
  it('reads the four directions off a leg', () => {
    expect(xy(legDir({ x: 0, y: 0 }, { x: 100, y: 0 }))).toEqual([1, 0]);
    expect(xy(legDir({ x: 100, y: 0 }, { x: 0, y: 0 }))).toEqual([-1, 0]);
    expect(xy(legDir({ x: 0, y: 0 }, { x: 0, y: 100 }))).toEqual([0, 1]);
    expect(xy(legDir({ x: 0, y: 100 }, { x: 0, y: 0 }))).toEqual([0, -1]);
  });

  // World y points down, so "left of travel" is a quarter turn anticlockwise
  // on screen: heading east, left is north.
  it('turns a quarter anticlockwise on screen', () => {
    expect(xy(leftNormal({ x: 1, y: 0 }))).toEqual([0, -1]);
    expect(xy(leftNormal({ x: 0, y: 1 }))).toEqual([1, 0]);
  });
});

describe('turnSign', () => {
  it('is positive where the left side is on the outside of the turn', () => {
    expect(turnSign({ x: 1, y: 0 }, { x: 0, y: 1 })).toBeGreaterThan(0);
  });

  it('is negative where the left side is on the inside', () => {
    expect(turnSign({ x: 1, y: 0 }, { x: 0, y: -1 })).toBeLessThan(0);
  });
});

describe('offsetPath', () => {
  it('shifts a straight run perpendicular to itself', () => {
    expect(offsetPath(path([[0, 0], [300, 0]]), 10).map(xy)).toEqual([
      [0, -10],
      [300, -10],
    ]);
  });

  // The whole reason this is not just "move every point sideways": the corner
  // of the offset line is where the two offset legs cross, which is further out
  // on the outside of a turn and further in on the inside.
  it('pushes the corner out on the outside of a turn', () => {
    expect(offsetPath(path([[0, 0], [300, 0], [300, 200]]), 10).map(xy)).toEqual([
      [0, -10],
      [310, -10],
      [310, 200],
    ]);
  });

  it('pulls the corner in on the inside of a turn', () => {
    expect(offsetPath(path([[0, 0], [300, 0], [300, 200]]), -10).map(xy)).toEqual([
      [0, 10],
      [290, 10],
      [290, 200],
    ]);
  });

  it('grows and shrinks a closed room', () => {
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    expect(offsetPath(room, 10).map(xy)).toEqual([
      [-10, -10],
      [410, -10],
      [410, 310],
      [-10, 310],
    ]);
    expect(offsetPath(room, -10).map(xy)).toEqual([
      [10, 10],
      [390, 10],
      [390, 290],
      [10, 290],
    ]);
  });

  it('offsets both ways by the same distance, in opposite directions', () => {
    const p = path([[0, 0], [300, 0], [300, 200], [600, 200]]);
    const left = offsetPath(p, 12);
    const right = offsetPath(p, -12);
    left.forEach((l, i) => {
      // The two lines straddle the centreline: their midpoint is back on it.
      expect((l.x + right[i].x) / 2).toBeCloseTo(p.points[i].x, 6);
      expect((l.y + right[i].y) / 2).toBeCloseTo(p.points[i].y, 6);
    });
  });
});

// ── The fill ────────────────────────────────────────────────────────────────

describe('planSketchFill', () => {
  it('refuses a path with nothing drawn on it', () => {
    expect(planSketchFill(path([[0, 0]]), spec(), materials).pieces).toHaveLength(0);
    expect(planSketchFill(path([[0, 0], [300, 0]]), spec({ thickness: 0 }), materials).warnings)
      .toHaveLength(1);
  });

  describe('a straight run', () => {
    const line = path([[0, 0], [300, 0]]);
    const plan = planSketchFill(line, spec(), materials);

    it('stands a face either side of the drawn line', () => {
      const faces = ofCategory(plan.pieces, 'panel', 'filler').filter((p) => (p.z ?? 0) === 0);
      const tops = faces.map((p) => pieceBounds(p, materialOf(p)).y);
      // Concrete is 20 thick centred on y = 0, so its faces are at ∓10 and the
      // panels stand outside them: one run at −19, one at +10.
      expect(new Set(tops.filter((t) => t === -19 || t === 10)).size).toBe(2);
    });

    it('treats the drawn line as the centreline, not a face', () => {
      // Each long face stands 10 cm clear of the line — half the 20 cm pour.
      // Set out to a face instead and one of the two would land ON the line.
      // (The stop-ends cross it, which is what closing the end means.)
      const long = ofCategory(plan.pieces, 'panel', 'filler').filter(
        (p) => p.rot === 0 && (p.z ?? 0) === 0,
      );
      const edges = long.map((p) => pieceBounds(p, materialOf(p)));
      expect(edges.filter((b) => b.y + b.h === -10).length).toBeGreaterThan(0);
      expect(edges.filter((b) => b.y === 10).length).toBeGreaterThan(0);
      expect(edges.every((b) => b.y + b.h === -10 || b.y === 10)).toBe(true);
    });

    // The face is the whole deliverable: what holds it up is decided on site
    // against the pour pressure, and a guessed tie count is worse than none.
    it('orders the face and nothing behind it', () => {
      expect(ofCategory(plan.pieces, 'waler', 'rod', 'post', 'acc')).toHaveLength(0);
      expect(ofCategory(plan.pieces, 'panel').length).toBeGreaterThan(0);
    });

    it('reports the run it was given', () => {
      expect(plan.summary.runLength).toBe(300);
      expect(plan.summary.turns).toBe(0);
    });

    it('leaves nothing standing in the concrete', () => {
      expect(intruding(plan.pieces, line, 20)).toHaveLength(0);
    });

    it('places no two pieces on top of each other', () => {
      expect(clashes(plan.pieces)).toHaveLength(0);
    });
  });

  describe('a corner', () => {
    const corner = path([[0, 0], [300, 0], [300, 200]]);

    it('counts the turn', () => {
      expect(planSketchFill(corner, spec(), materials).summary.turns).toBe(1);
    });

    it('closes it with an outer and an inner profile', () => {
      const plan = planSketchFill(corner, spec({ height: 300 }), materials);
      const corners = ofCategory(plan.pieces, 'corner');
      expect(corners).toHaveLength(2);
      const names = corners.map((p) => materialOf(p).name);
      expect(names.some((nm) => nm.includes('გარე'))).toBe(true);
      expect(names.some((nm) => nm.includes('შიდა'))).toBe(true);
    });

    it('puts the outer profile outside the turn and the inner one inside it', () => {
      const plan = planSketchFill(corner, spec(), materials);
      const [outer, inner] = ofCategory(plan.pieces, 'corner').sort(
        (a, b) => pieceBounds(a, materialOf(a)).y - pieceBounds(b, materialOf(b)).y,
      );
      // The run goes east then south, so the outside of the turn is up-and-right
      // of the corner at (300, 0) and the inside is down-and-left of it.
      const o = pieceBounds(outer, materialOf(outer));
      const i = pieceBounds(inner, materialOf(inner));
      expect(o.y).toBeLessThan(-10);
      expect(o.x + o.w).toBeGreaterThan(310);
      expect(i.y).toBeGreaterThan(10 - 0.01);
      expect(i.x + i.w).toBeLessThan(290 + 0.01);
    });

    // Two faces cannot both close a corner. Whichever way it is resolved, the
    // one thing that must never happen is both of them being ordered for it.
    it('never orders two pieces for the same corner', () => {
      expect(clashes(planSketchFill(corner, spec(), materials).pieces)).toHaveLength(0);
      expect(
        clashes(planSketchFill(corner, spec({ includeCorners: false }), materials).pieces),
      ).toHaveLength(0);
    });

    it('keeps the formwork out of the concrete, profiles or not', () => {
      expect(intruding(planSketchFill(corner, spec(), materials).pieces, corner, 20)).toHaveLength(0);
      expect(
        intruding(
          planSketchFill(corner, spec({ includeCorners: false }), materials).pieces,
          corner,
          20,
        ),
      ).toHaveLength(0);
    });

    it('closes the corner in all four turn directions', () => {
      const turns: SketchPath[] = [
        path([[0, 0], [300, 0], [300, 200]]), // east then south
        path([[0, 0], [300, 0], [300, -200]]), // east then north
        path([[300, 0], [0, 0], [0, 200]]), // west then south
        path([[300, 0], [0, 0], [0, -200]]), // west then north
      ];
      for (const t of turns) {
        const plan = planSketchFill(t, spec(), materials);
        expect(ofCategory(plan.pieces, 'corner')).toHaveLength(2);
        expect(clashes(plan.pieces)).toHaveLength(0);
        expect(intruding(plan.pieces, t, 20)).toHaveLength(0);
      }
    });
  });

  describe('a closed room', () => {
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    const plan = planSketchFill(room, spec(), materials);

    it('turns four times and closes every one', () => {
      expect(plan.summary.turns).toBe(4);
      expect(ofCategory(plan.pieces, 'corner')).toHaveLength(8);
    });

    it('has no ends to stop', () => {
      expect(plan.summary.stopEnds).toBe(0);
    });

    it('keeps clear of the concrete and of itself', () => {
      expect(intruding(plan.pieces, room, 20)).toHaveLength(0);
      expect(clashes(plan.pieces)).toHaveLength(0);
    });
  });

  describe('stop-ends', () => {
    const line = path([[0, 0], [300, 0]]);

    it('closes both ends when asked', () => {
      expect(planSketchFill(line, spec(), materials).summary.stopEnds).toBeGreaterThan(0);
    });

    it('leaves them open when the pour continues', () => {
      expect(
        planSketchFill(line, spec({ includeStopEnds: false }), materials).summary.stopEnds,
      ).toBe(0);
    });

    it('sets them back from the pour, not inside it', () => {
      const plan = planSketchFill(line, spec(), materials);
      expect(intruding(plan.pieces, line, 20)).toHaveLength(0);
      expect(clashes(plan.pieces)).toHaveLength(0);
    });
  });

  describe('courses', () => {
    it('stacks real pieces up the pour rather than multiplying', () => {
      const line = path([[0, 0], [300, 0]]);
      // 300 is one panel tall; 450 is a 300 with a 150 on top of it.
      const one = planSketchFill(line, spec({ height: 300 }), materials);
      const two = planSketchFill(line, spec({ height: 450 }), materials);
      expect(two.summary.courses).toBeGreaterThan(one.summary.courses);
      expect(two.summary.panels).toBeGreaterThan(one.summary.panels);
    });
  });

  describe('geometry the catalog cannot meet', () => {
    it('says so rather than rounding a leg away', () => {
      // 8 cm between two corners cannot take a panel once the profiles have
      // taken their reach out of it.
      const tight = path([[0, 0], [8, 0], [8, 200]]);
      const plan = planSketchFill(tight, spec(), materials);
      expect(plan.warnings.length).toBeGreaterThan(0);
    });

    it('reports a height no stack of panels reaches', () => {
      const plan = planSketchFill(path([[0, 0], [300, 0]]), spec({ height: 7 }), materials);
      expect(plan.warnings.some((w) => w.includes('სიმაღლე'))).toBe(true);
    });
  });
});
