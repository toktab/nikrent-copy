import { describe, expect, it } from 'vitest';
import type { Material, Piece, WallSpec } from '../../types';
import { planWall } from '../wallWizard';
import { pieceBounds } from '../geometry';
import { createSeedMaterials } from '../../data/seedCatalog';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const spec = (over: Partial<WallSpec> = {}): WallSpec => ({
  length: 300,
  thickness: 20,
  height: 300,
  walerSpacing: 75,
  tieSpacing: 100,
  originX: 0,
  originY: 0,
  includeWalers: true,
  includeTies: true,
  includeStopEnds: true,
  ...over,
});

const materialOf = (p: Piece): Material => {
  const m = byId.get(p.materialId);
  if (!m) throw new Error(`unknown material ${p.materialId}`);
  return m;
};

const ofCategory = (pieces: Piece[], category: Material['category']) =>
  pieces.filter((p) => materialOf(p).category === category);

/** Does any part of this piece sit inside the concrete? */
function intrudesConcrete(p: Piece, s: WallSpec): boolean {
  const b = pieceBounds(p, materialOf(p));
  const eps = 0.01;
  return (
    b.x + b.w > s.originX + eps &&
    b.x < s.originX + s.length - eps &&
    b.y + b.h > s.originY + eps &&
    b.y < s.originY + s.thickness - eps
  );
}

describe('planWall', () => {
  it('produces a layout for an ordinary wall', () => {
    const plan = planWall(spec(), materials);
    expect(plan.pieces.length).toBeGreaterThan(0);
    expect(plan.summary.panels).toBeGreaterThan(0);
    expect(plan.summary.outerThickness).toBe(20 + 9 * 2);
  });

  /**
   * The formwork exists to hold the pour, so nothing may stand in it. This is
   * the check that catches an off-by-one in the stand-off or a face laid on the
   * wrong side of the concrete.
   */
  it('keeps every panel out of the concrete', () => {
    const s = spec();
    const plan = planWall(s, materials);
    const offenders = ofCategory(plan.pieces, 'panel').filter((p) => intrudesConcrete(p, s));
    expect(offenders).toEqual([]);
  });

  it('stands the two faces either side of the concrete', () => {
    const s = spec({ includeWalers: false, includeTies: false });
    const plan = planWall(s, materials);
    const panels = ofCategory(plan.pieces, 'panel').filter((p) => p.z === 0);

    const above = panels.filter((p) => pieceBounds(p, materialOf(p)).y < s.originY);
    const below = panels.filter(
      (p) => pieceBounds(p, materialOf(p)).y >= s.originY + s.thickness,
    );
    // Everything on the first course is a long face or an end; the two long
    // faces must be present and equal.
    expect(above.length).toBeGreaterThan(0);
    expect(below.length).toBe(above.length);
  });

  /**
   * The difference that matters versus a column: a column takes two ties per
   * ring whatever its size, a wall takes more the longer it gets. Getting this
   * wrong under-orders ties on every long pour.
   */
  it('adds ties along the run, so a longer wall takes more of them', () => {
    const short = planWall(spec({ length: 200 }), materials);
    const long = planWall(spec({ length: 800 }), materials);
    expect(long.summary.ties).toBeGreaterThan(short.summary.ties);
  });

  it('spaces ties at roughly the requested pitch', () => {
    const s = spec({ length: 600, tieSpacing: 100, walerSpacing: 300, height: 300 });
    const plan = planWall(s, materials);
    // One waler level at this spacing, so every tie belongs to it.
    expect(plan.summary.ties).toBe(6);
  });

  it('omits ties and walers when they are turned off', () => {
    const plan = planWall(spec({ includeWalers: false, includeTies: false }), materials);
    expect(plan.summary.walers).toBe(0);
    expect(plan.summary.ties).toBe(0);
    expect(plan.summary.panels).toBeGreaterThan(0);
  });

  it('closes the ends only when asked', () => {
    const closed = planWall(spec({ includeStopEnds: true }), materials);
    const open = planWall(spec({ includeStopEnds: false }), materials);
    expect(closed.summary.stopEnds).toBeGreaterThan(0);
    expect(open.summary.stopEnds).toBe(0);
  });

  /**
   * With stop-ends the long faces have to run past the concrete, or a
   * panel-thickness hole is left at each of the four corners — the same fault
   * the column wizard has when laid without corner profiles.
   */
  it('runs the faces past the concrete so the corners close', () => {
    // 312 + 2×9 = 330, a whole number of 15 cm panel steps, so the face covers
    // exactly and the assertion tests placement rather than catalog coverage.
    const s = spec({ length: 312, includeStopEnds: true, includeWalers: false, includeTies: false });
    const plan = planWall(s, materials);
    const faces = ofCategory(plan.pieces, 'panel').filter(
      (p) => p.z === 0 && p.rot === 0,
    );
    const left = Math.min(...faces.map((p) => pieceBounds(p, materialOf(p)).x));
    const right = Math.max(
      ...faces.map((p) => {
        const b = pieceBounds(p, materialOf(p));
        return b.x + b.w;
      }),
    );
    expect(left).toBeLessThanOrEqual(s.originX - 9 + 0.01);
    expect(right).toBeGreaterThanOrEqual(s.originX + s.length + 9 - 0.01);
  });

  it('stacks courses up the pour height', () => {
    const oneCourse = planWall(spec({ height: 300 }), materials);
    const twoCourses = planWall(spec({ height: 600 }), materials);
    expect(twoCourses.summary.courses).toBeGreaterThan(oneCourse.summary.courses);
    expect(twoCourses.summary.panels).toBeGreaterThan(oneCourse.summary.panels);
  });

  it('places every course at its own elevation', () => {
    const plan = planWall(spec({ height: 600, includeWalers: false, includeTies: false }), materials);
    const levels = new Set(plan.pieces.map((p) => p.z ?? 0));
    expect(levels.size).toBeGreaterThan(1);
  });

  it('warns rather than silently rounding a height it cannot make', () => {
    const plan = planWall(spec({ height: 317 }), materials);
    expect(plan.warnings.join(' ')).toMatch(/სიმაღლე/);
  });

  it('refuses a wall with no thickness instead of emitting nonsense', () => {
    const plan = planWall(spec({ thickness: 0 }), materials);
    expect(plan.pieces).toEqual([]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('reports an empty catalog rather than throwing', () => {
    const plan = planWall(spec(), []);
    expect(plan.pieces).toEqual([]);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });
});
