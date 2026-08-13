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
  planSketchFillAll,
  turnSign,
  wallFaces,
  type SketchFillSpec,
} from '../sketchFill';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const path = (points: Array<[number, number]>, closed = false): SketchPath => ({
  id: 'k',
  points: points.map(([x, y]) => ({ x, y })),
  ...(closed ? { closed: true } : {}),
});

/** The same line, read as the far side of the pour instead of the near side. */
const inward = (p: SketchPath): SketchPath => ({ ...p, perimeter: 'inner' });

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
      /**
       * Only the legs this piece actually lies alongside can judge it, and
       * "alongside" has to mean a real overlap rather than a touch. A panel on
       * the leg into a corner ends exactly where the leg out of it begins, so
       * a zero-width overlap had every corner panel judged by the wrong leg —
       * which reads as the whole run standing in the concrete.
       */
      if (d.x && (b.x + b.w <= Math.min(a.x, c.x) + 0.01 || b.x >= Math.max(a.x, c.x) - 0.01))
        return false;
      if (d.y && (b.y + b.h <= Math.min(a.y, c.y) + 0.01 || b.y >= Math.max(a.y, c.y) - 0.01))
        return false;
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

    /**
     * An outside corner is not closed by this tool, ever.
     *
     * There is more than one right answer on site and which one it is depends
     * on the job, so the panels stop short and the corner is handed over as a
     * measured hole rather than as a part somebody has to take off again.
     */
    it('leaves an outside corner open by 20 cm of each face', () => {
      const plan = planSketchFill(corner, spec(), materials);
      expect(ofCategory(plan.pieces, 'corner')).toHaveLength(0);
      expect(plan.summary.openCorners).toBe(1);

      const faces = ofCategory(plan.pieces, 'panel', 'filler').map((p) =>
        pieceBounds(p, materialOf(p)),
      );
      // The vertex is (300, 0): nothing along the top comes past x 280, and
      // nothing down the side starts above y 20.
      const along = faces.filter((b) => b.h < b.w);
      const down = faces.filter((b) => b.w < b.h);
      expect(Math.max(...along.map((b) => b.x + b.w))).toBe(280);
      expect(Math.min(...down.map((b) => b.y))).toBe(20);
    });

    it('stands a profile in an inside corner, in the notch and not in the pour', () => {
      const plan = planSketchFill(inward(corner), spec(), materials);
      const profiles = ofCategory(plan.pieces, 'corner');
      expect(profiles).toHaveLength(1);
      expect(materialOf(profiles[0]).name).toContain('შიდა');
      // The panels close into the down-left quadrant of the vertex, and so
      // does the profile: 20 cm of each face, starting at the vertex itself.
      const box = pieceBounds(profiles[0], materialOf(profiles[0]));
      expect(box.x).toBeCloseTo(280, 6);
      expect(box.y).toBeCloseTo(0, 6);
      expect(box.w).toBeCloseTo(20, 6);
      expect(box.h).toBeCloseTo(20, 6);
    });

    it('builds the profile before the panels that measure off it', () => {
      const plan = planSketchFill(inward(corner), spec(), materials);
      expect(materialOf(plan.pieces[0]).category).toBe('corner');
    });

    it('never orders two pieces for the same spot', () => {
      for (const p of [corner, inward(corner)]) {
        expect(clashes(planSketchFill(p, spec(), materials).pieces)).toHaveLength(0);
        expect(
          clashes(planSketchFill(p, spec({ includeCorners: false }), materials).pieces),
        ).toHaveLength(0);
      }
    });

    it('handles all four turn directions, both perimeters', () => {
      const turns: SketchPath[] = [
        path([[0, 0], [300, 0], [300, 200]]),
        path([[0, 0], [300, 0], [300, -200]]),
        path([[300, 0], [0, 0], [0, 200]]),
        path([[300, 0], [0, 0], [0, -200]]),
      ];
      for (const t of turns) {
        const open = planSketchFill(t, spec(), materials);
        expect(ofCategory(open.pieces, 'corner')).toHaveLength(0);
        expect(clashes(open.pieces)).toHaveLength(0);
        expect(crossesLine(open.pieces, t, outwardSide(t))).toHaveLength(0);

        const shut = planSketchFill(inward(t), spec(), materials);
        expect(ofCategory(shut.pieces, 'corner')).toHaveLength(1);
        expect(clashes(shut.pieces)).toHaveLength(0);
        expect(crossesLine(shut.pieces, t, outwardSide(inward(t)))).toHaveLength(0);
      }
    });
  });

  describe('a closed room', () => {
    const room = path([[0, 0], [400, 0], [400, 300], [0, 300]], true);
    const plan = planSketchFill(room, spec(), materials);

    it('leaves all four outside corners to the builder', () => {
      expect(plan.summary.turns).toBe(4);
      expect(plan.summary.openCorners).toBe(4);
      expect(ofCategory(plan.pieces, 'corner')).toHaveLength(0);
    });

    // The same outline read as a void — a room, a shaft — is four inside
    // corners, and every one of them takes a profile.
    it('closes all four of a void, with the panels inside it', () => {
      const shaft = planSketchFill(inward(room), spec(), materials);
      expect(shaft.summary.openCorners).toBe(0);
      expect(ofCategory(shaft.pieces, 'corner')).toHaveLength(4);
      for (const q of ofCategory(shaft.pieces, 'panel', 'filler', 'corner')) {
        const b = pieceBounds(q, materialOf(q));
        const outside = b.x < -0.01 || b.y < -0.01 || b.x + b.w > 400.01 || b.y + b.h > 300.01;
        expect(outside).toBe(false);
      }
    });

    it('keeps clear of itself', () => {
      expect(clashes(plan.pieces)).toHaveLength(0);
      expect(clashes(planSketchFill(inward(room), spec(), materials).pieces)).toHaveLength(0);
    });
  });

  /**
   * A junction is a point somebody put on the drawing. It does not bend the
   * wall, and reading it as a corner put a profile in the middle of a straight
   * run and cut the run in two either side of it.
   */
  describe('a junction the run goes straight through', () => {
    const straight = path([[0, 0], [560, 0]]);
    const marked = path([[0, 0], [200, 0], [560, 0]]);

    it('builds the same wall as if it were not there', () => {
      const laid = (p: SketchPath) =>
        planSketchFill(p, spec(), materials)
          .pieces.map((q) => {
            const b = pieceBounds(q, materialOf(q));
            return `${materialOf(q).name}@${b.x},${b.y}`;
          })
          .sort();
      expect(laid(marked)).toEqual(laid(straight));
    });

    it('puts no corner there and counts no turn', () => {
      const plan = planSketchFill(marked, spec(), materials);
      expect(ofCategory(plan.pieces, 'corner')).toHaveLength(0);
      expect(plan.summary.turns).toBe(0);
    });

    it('still finds the corners that are real', () => {
      const withMark = path([[0, 0], [150, 0], [300, 0], [300, 200]]);
      expect(planSketchFill(inward(withMark), spec(), materials).summary.turns).toBe(1);
      expect(
        ofCategory(planSketchFill(inward(withMark), spec(), materials).pieces, 'corner'),
      ).toHaveLength(1);
    });

    it('takes them out of a closed outline too', () => {
      const room = path([[0, 0], [200, 0], [400, 0], [400, 300], [0, 300]], true);
      const plan = planSketchFill(room, spec(), materials);
      expect(plan.summary.turns).toBe(4);
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
  // The gap in the drawing: two corner treatments ten centimetres apart, with a
  // 10 cm ჩაკერება sitting unused in the catalog. The middle leg gives up 20 cm
  // at each end, so 125 leaves 85 — a panel and that strip.
  const z = path([[0, 0], [265, 0], [265, 125], [530, 125]]);
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

/**
 * Tie rods pass through the pour, so a panel on one face needs a panel on the
 * other for the rod to reach: joints that do not line up are holes that do not
 * line up. Filled a face at a time the two sides came out differently, because
 * each was fitted to its own length and the lengths differ.
 */
describe('a wall, drawn as its two faces', () => {
  // 20 thick, running east, turning south at the far end. The outer face is
  // longer than the inner one by the thickness of the wall.
  const outer = path([[0, 0], [600, 0], [600, 400]]);
  const inner = inward(path([[0, 20], [580, 20], [580, 400]]));
  const plan = planSketchFillAll([outer, inner], spec(), materials);

  /** Where the pieces standing on one face begin and end, along the wall. */
  const spansAt = (top: number) =>
    ofCategory(plan.pieces, 'panel', 'filler')
      .map((p) => pieceBounds(p, materialOf(p)))
      .filter((b) => Math.abs(b.y - top) < 0.01)
      .map((b) => `${Math.round(b.x)}-${Math.round(b.x + b.w)}`)
      .sort();

  it('puts the same panels on both sides, opposite each other', () => {
    expect(spansAt(-9).length).toBeGreaterThan(1);
    expect(spansAt(20)).toEqual(spansAt(-9));
  });

  it('gives the difference in length to the open corner, not to the panels', () => {
    // The inner face stops against its profile at 560; the outer one, which
    // could have run to 580, stops level with it and the extra 20 goes into
    // the corner nobody has decided about yet.
    expect(Math.max(...spansAt(-9).map((s) => Number(s.split('-')[1])))).toBe(560);
  });

  it('still closes the inside corner and leaves the outside one open', () => {
    expect(plan.summary.corners).toBe(1);
    expect(plan.summary.openCorners).toBe(1);
  });

  // The wizard is not a second generator: it draws the two faces and hands them
  // to the same call, so it gets the matching too.
  it('does the same for a straight wall typed into the wizard', () => {
    const faces = wallFaces({ length: 500, thickness: 20, height: 300, originX: 0, originY: 0 });
    const built = planSketchFillAll(faces, spec(), materials);
    const at = (top: number) =>
      ofCategory(built.pieces, 'panel', 'filler')
        .map((p) => pieceBounds(p, materialOf(p)))
        .filter((b) => Math.abs(b.y - top) < 0.01)
        .map((b) => `${Math.round(b.x)}-${Math.round(b.x + b.w)}`)
        .sort();
    // Panels outside both faces of a 20 cm wall on y 0 and y 20 - never in it.
    expect(at(-9).length).toBeGreaterThan(1);
    expect(at(20)).toEqual(at(-9));
  });

  it('leaves two faces too far apart to be a wall to themselves', () => {
    // A room is not a pour with two sides; each wall of it is.
    const room = planSketchFillAll(
      [path([[0, 0], [400, 0]]), inward(path([[0, 400], [400, 400]]))],
      spec(),
      materials,
    );
    expect(room.pieces.length).toBeGreaterThan(0);
    expect(clashes(room.pieces)).toHaveLength(0);
  });
});

/**
 * A hole you have been told about is a decision; one you have not is a leak.
 * The fill leaves face bare on purpose at every outside corner, and it has to
 * say how much and where rather than letting somebody find out on site.
 */
describe('what is left to fill', () => {
  it('reports the hole at an outside corner, on each face', () => {
    const corner = path([[0, 0], [300, 0], [300, 200]]);
    const plan = planSketchFill(corner, spec(), materials);
    // One corner, two faces meeting at it, 20 cm of each left standing open.
    expect(plan.openings.map((o) => o.cm)).toEqual([20, 20]);
    expect(plan.openings.every((o) => o.kind === 'corner')).toBe(true);
    expect(plan.summary.openCm).toBe(40);
  });

  it('says nothing is open where nothing is', () => {
    // A straight run with two free ends: no corner, and 300 covers exactly.
    const plan = planSketchFill(path([[0, 0], [300, 0]]), spec(), materials);
    expect(plan.openings).toHaveLength(0);
    expect(plan.summary.openCm).toBe(0);
  });

  it('counts what the catalog cannot close as open too', () => {
    // 4 cm is narrower than the narrowest ჩაკერება, so it stays a hole.
    const plan = planSketchFill(path([[0, 0], [304, 0]]), spec(), materials);
    const short = plan.openings.filter((o) => o.kind === 'short');
    expect(short.map((o) => o.cm)).toEqual([4]);
  });

  it('counts the length a face gives up to line up with the other one', () => {
    // 55 thick: the outer face gives 55 to the corner on top of its own 20.
    const outer = path([[0, 0], [600, 0], [600, 400]]);
    const inner = inward(path([[0, 55], [545, 55], [545, 400]]));
    const plan = planSketchFillAll([outer, inner], spec(), materials);
    expect(plan.openings.filter((o) => Math.abs(o.cm - 75) < 0.01)).toHaveLength(2);
    // The inner face's two ends against the profile stay closed, so the only
    // holes are the two the outer face has at its corner.
    expect(plan.summary.openCorners).toBe(1);
  });

  it('puts the hole where it actually is, not at the vertex', () => {
    const plan = planSketchFill(path([[0, 0], [300, 0], [300, 200]]), spec(), materials);
    const along = plan.openings.find((o) => Math.abs(o.y + 4.5) < 0.01);
    // The panels stop at x 280, so the hole is the 20 between there and 300.
    expect(along?.x).toBeCloseTo(290, 6);
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

  /**
   * The case the shape alone cannot answer: one wall, drawn as its two faces.
   *
   * Both lines turn the same way and wind the same way, so the winding puts
   * both lots of panels on the same side of the pair — and the inner face's
   * panels land in the concrete, between the two lines. What tells them apart
   * is what each line is FOR, which is why the pen asks.
   */
  it('keeps a wall\'s two faces out of the pour between them', () => {
    const thickness = 20;
    const outer = path([[0, 0], [300, 0], [300, 300]]);
    const inner = inward(path([
      [0, thickness],
      [300 - thickness, thickness],
      [300 - thickness, 300],
    ]));

    const between = (p: Piece) => {
      const b = pieceBounds(p, materialOf(p));
      // The pour is the L-shaped band between the two lines.
      const inArm = b.y > 0.01 && b.y + b.h < thickness - 0.01 && b.x + b.w < 300.01;
      const inLeg = b.x > 300 - thickness + 0.01 && b.x + b.w < 300.01 && b.y + b.h > 0.01;
      return inArm || inLeg;
    };

    for (const face of [outer, inner]) {
      const plan = planSketchFill(face, spec(), materials);
      expect(ofCategory(plan.pieces, 'panel', 'filler', 'corner').filter(between)).toHaveLength(0);
    }
  });

  it('reads the same shape either way round, given what it is for', () => {
    const shape = path([[0, 0], [300, 0], [300, 300]]);
    const sideOf = (p: SketchPath) => outwardSide(p);
    expect(sideOf(shape)).toBe(-sideOf(inward(shape)));
  });

  it('still lets the side be overridden, for a line with no outside', () => {
    const line = path([[0, 0], [300, 0]]);
    const up = planSketchFill(line, spec(), materials);
    const down = planSketchFill(line, spec({ flip: true }), materials);
    expect(pieceBounds(up.pieces[0], materialOf(up.pieces[0])).y).toBe(-9);
    expect(pieceBounds(down.pieces[0], materialOf(down.pieces[0])).y).toBe(0);
  });
});
