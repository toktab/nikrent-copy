import { describe, expect, it } from 'vitest';
import type { Material, Piece, SketchPath } from '../../types';
import { createSeedMaterials } from '../../data/seedCatalog';
import { pieceBounds, type Rect } from '../geometry';
import { coverFace } from '../formwork';
import { allGaps, faceBands } from '../gap';
import {
  legDir,
  leftNormal,
  offsetPath,
  outwardSide,
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
  height: 300,
  includeCorners: true,
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
 * Anything that has strayed onto the concrete side of the line.
 *
 * The line IS the face, so the test is simply which side of it a piece sits
 * on: everything belongs on one side and nothing may cross. `side` is +1 for
 * the left of travel, matching the generator.
 */
function crossesLine(pieces: Piece[], p: SketchPath, side: 1 | -1): Piece[] {
  const pts = p.points;
  return ofCategory(pieces, 'panel', 'filler', 'corner').filter((piece) => {
    const b = pieceBounds(piece, materialOf(piece));
    return pts.some((_, j) => {
      const a = pts[j];
      const c = pts[(j + 1) % pts.length];
      if (j === pts.length - 1 && !p.closed) return false;
      const d = legDir(a, c);
      // Same convention as the generator: left of travel is (y, -x).
      const nrm = { x: side * d.y, y: side * -d.x };
      // Only the legs this piece actually lies alongside can judge it.
      if (d.x && (b.x + b.w < Math.min(a.x, c.x) || b.x > Math.max(a.x, c.x))) return false;
      if (d.y && (b.y + b.h < Math.min(a.y, c.y) || b.y > Math.max(a.y, c.y))) return false;
      if (d.x) return nrm.y > 0 ? b.y < a.y - 0.01 : b.y + b.h > a.y + 0.01;
      return nrm.x > 0 ? b.x < a.x - 0.01 : b.x + b.w > a.x + 0.01;
    });
  });
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
    expect(planSketchFill(path([[0, 0], [300, 0]]), spec({ height: 0 }), materials).warnings)
      .toHaveLength(1);
  });

  describe('a straight run', () => {
    const line = path([[0, 0], [300, 0]]);

    // The line is the edge of the pour, which is what gets chalked on the
    // slab. Panels stand ON it, on one side, and never straddle it.
    it('stands one row of panels along the line', () => {
      const plan = planSketchFill(line, spec(), materials);
      const faces = ofCategory(plan.pieces, 'panel', 'filler');
      const tops = new Set(faces.map((p) => pieceBounds(p, materialOf(p)).y));
      expect(tops).toEqual(new Set([-9]));
    });

    it('puts them on the other side when told to', () => {
      const plan = planSketchFill(line, spec({ flip: true }), materials);
      const faces = ofCategory(plan.pieces, 'panel', 'filler');
      const tops = new Set(faces.map((p) => pieceBounds(p, materialOf(p)).y));
      expect(tops).toEqual(new Set([0]));
    });

    it('never crosses onto the concrete', () => {
      expect(crossesLine(planSketchFill(line, spec(), materials).pieces, line, 1)).toHaveLength(0);
      expect(
        crossesLine(planSketchFill(line, spec({ flip: true }), materials).pieces, line, -1),
      ).toHaveLength(0);
    });

    it('covers the run exactly when the catalog can', () => {
      const plan = planSketchFill(line, spec(), materials);
      expect(plan.warnings).toHaveLength(0);
      expect(plan.summary.runLength).toBe(300);
    });

    it('places no two pieces on top of each other', () => {
      expect(clashes(planSketchFill(line, spec(), materials).pieces)).toHaveLength(0);
    });
  });

  describe('a corner', () => {
    const corner = path([[0, 0], [300, 0], [300, 200]]);

    it('counts the turn', () => {
      expect(planSketchFill(corner, spec(), materials).summary.turns).toBe(1);
    });

    // One run of panels turning a corner needs one part, not a matched pair:
    // whichever profile suits the way it turns.
    it('closes it with a single profile', () => {
      expect(ofCategory(planSketchFill(corner, spec(), materials).pieces, 'corner')).toHaveLength(1);
    });

    it('takes the outer profile one way round and the inner the other', () => {
      const left = planSketchFill(corner, spec(), materials);
      const right = planSketchFill(corner, spec({ flip: true }), materials);
      const nameOf = (p: ReturnType<typeof planSketchFill>) =>
        materialOf(ofCategory(p.pieces, 'corner')[0]).name;
      expect(nameOf(left)).toContain('გარე');
      expect(nameOf(right)).toContain('შიდა');
    });

    it('never orders two pieces for the same spot', () => {
      for (const sd of [false, true] as const) {
        expect(clashes(planSketchFill(corner, spec({ flip: sd }), materials).pieces)).toHaveLength(0);
        expect(
          clashes(planSketchFill(corner, spec({ flip: sd, includeCorners: false }), materials).pieces),
        ).toHaveLength(0);
      }
    });

    it('closes the corner in all four turn directions', () => {
      const turns: SketchPath[] = [
        path([[0, 0], [300, 0], [300, 200]]),
        path([[0, 0], [300, 0], [300, -200]]),
        path([[300, 0], [0, 0], [0, 200]]),
        path([[300, 0], [0, 0], [0, -200]]),
      ];
      for (const t of turns) {
        const plan = planSketchFill(t, spec(), materials);
        expect(ofCategory(plan.pieces, 'corner')).toHaveLength(1);
        expect(clashes(plan.pieces)).toHaveLength(0);
      }
    });
  });

  describe('a closed room', () => {
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    const plan = planSketchFill(room, spec(), materials);

    it('turns four times and closes every one', () => {
      expect(plan.summary.turns).toBe(4);
      expect(ofCategory(plan.pieces, 'corner')).toHaveLength(4);
    });

    it('keeps clear of itself', () => {
      expect(clashes(plan.pieces)).toHaveLength(0);
    });
  });

  describe('courses', () => {
    it('stacks real pieces up the pour rather than multiplying', () => {
      const line = path([[0, 0], [300, 0]]);
      const one = planSketchFill(line, spec({ height: 300 }), materials);
      const two = planSketchFill(line, spec({ height: 450 }), materials);
      expect(two.summary.courses).toBeGreaterThan(one.summary.courses);
      expect(two.summary.panels).toBeGreaterThan(one.summary.panels);
    });
  });

  describe('geometry the catalog cannot meet', () => {
    it('reports a height no stack of panels reaches', () => {
      const plan = planSketchFill(path([[0, 0], [300, 0]]), spec({ height: 7 }), materials);
      expect(plan.warnings.some((w) => w.includes('სიმაღლე'))).toBe(true);
    });
  });
});

describe('a strip too narrow for any panel', () => {
  const panels = [90, 75, 60, 45, 30].map((w) => ({ material: {} as Material, w }));
  const fillers = [10, 5].map((w) => ({ material: {} as Material, w }));

  // The rule "fillers only after the panels have covered something" reads as
  // "do not build a wall out of ჩაკერება", which is right — and it was also
  // refusing the one case ჩაკერება exists for.
  it('is closed by fillers alone', () => {
    expect(coverFace(10, panels, fillers).used.map((o) => o.w)).toEqual([10]);
    expect(coverFace(25, panels, fillers).remainder).toBe(0);
  });

  it('still refuses to build a whole face out of strips', () => {
    // 300 takes panels, so the fillers only ever see what is left of it.
    const out = coverFace(300, panels, fillers);
    expect(out.used.every((o) => o.w >= 30)).toBe(true);
  });

  it('reports what it cannot close rather than leaving it silently open', () => {
    expect(coverFace(4, panels, fillers).remainder).toBe(4);
  });
});

describe('a leg short enough that its two corners nearly meet', () => {
  // The gap in the drawing: two corner profiles ten centimetres apart, with a
  // 10 cm ჩაკერება sitting unused in the catalog.
  const z = path([[0, 0], [265, 0], [265, 120], [530, 120]]);
  const plan = planSketchFill(z, spec(), materials);

  it('fills the strip between them, turned to suit the run', () => {
    const turned = ofCategory(plan.pieces, 'filler').filter((p) => p.rot === 90);
    expect(turned.length).toBeGreaterThan(0);
    expect(turned.every((p) => materialOf(p).w === 10)).toBe(true);
  });

  it('leaves no ten-centimetre hole behind', () => {
    const rects = plan.pieces.flatMap((p) => {
      const m = materialOf(p);
      return [{ ...pieceBounds(p, m), heightCm: m.h, bands: faceBands(pieceBounds(p, m), m, p.rot, false) }];
    });
    expect(allGaps(rects).some((g) => Math.abs(g.size - 10) < 0.5)).toBe(false);
  });
});

describe('which side is outside', () => {
  const L = path([[0, 0], [300, 0], [300, 300]]);
  const reversed = path([[300, 300], [300, 0], [0, 0]]);

  /**
   * The side belongs to the shape, not to the person drawing it.
   *
   * When it was a setting, the panels landed inside or outside depending on
   * whether a run happened to be drawn left-to-right - which is not a decision
   * anybody made, and put half a layout's formwork in the pour.
   */
  it('comes out the same however the run was drawn', () => {
    expect(outwardSide(L)).toBe(1);
    expect(outwardSide(reversed)).toBe(-1);

    const geometry = (p: SketchPath) =>
      planSketchFill(p, spec(), materials)
        .pieces.map((q) => {
          const b = pieceBounds(q, materialOf(q));
          return `${materialOf(q).name}@${b.x},${b.y}`;
        })
        .sort();

    // Opposite windings, opposite normals - and the same formwork on the ground.
    expect(geometry(reversed)).toEqual(geometry(L));
  });

  it('puts a room\'s formwork outside it, drawn either way', () => {
    const clockwise = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    const anti = path([[0, 300], [400, 300], [400, 0], [0, 0]], true);
    for (const room of [clockwise, anti]) {
      const plan = planSketchFill(room, spec(), materials);
      for (const q of ofCategory(plan.pieces, 'panel', 'filler')) {
        const b = pieceBounds(q, materialOf(q));
        const inside =
          b.x > 0.01 && b.y > 0.01 && b.x + b.w < 399.99 && b.y + b.h < 299.99;
        expect(inside).toBe(false);
      }
    }
  });

  it('still lets the side be overridden, for a line with no outside', () => {
    const line = path([[0, 0], [300, 0]]);
    const up = planSketchFill(line, spec(), materials);
    const down = planSketchFill(line, spec({ flip: true }), materials);
    expect(pieceBounds(up.pieces[0], materialOf(up.pieces[0])).y).toBe(-9);
    expect(pieceBounds(down.pieces[0], materialOf(down.pieces[0])).y).toBe(0);
  });
});
