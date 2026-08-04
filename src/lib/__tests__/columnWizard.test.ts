import { describe, expect, it } from 'vitest';
import type { ColumnSpec, Material } from '../../types';
import { coverExact, planColumn } from '../columnWizard';
import { pieceBounds } from '../geometry';
import { createSeedMaterials } from '../../data/seedCatalog';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const spec = (over: Partial<ColumnSpec> = {}): ColumnSpec => ({
  sectionX: 60,
  sectionY: 60,
  height: 300,
  walerSpacing: 75,
  originX: 0,
  originY: 0,
  includeWalers: true,
  includeTies: true,
  includeCorners: true,
  ...over,
});

type Plan = ReturnType<typeof planColumn>;

const materialOf = (id: string): Material => byId.get(id)!;
const boxesOf = (plan: Plan, category: string) =>
  plan.pieces
    .filter((p) => materialOf(p.materialId).category === category)
    .map((p) => pieceBounds(p, materialOf(p.materialId)));
const countOf = (plan: Plan, category: string) => boxesOf(plan, category).length;

describe('coverExact', () => {
  // Greedy largest-first is the obvious approach and it is wrong: it commits to
  // a big piece and then strands a remainder that a different combination would
  // have covered exactly. Every case here is one greedy gets wrong.
  it('finds the exact answer greedy misses on a face width', () => {
    const result = coverExact(105, [90, 75, 60, 45, 30]);
    expect(result.remainder).toBe(0);
    expect(result.picks.map((i) => [90, 75, 60, 45, 30][i]).sort()).toEqual([30, 75]);
  });

  it('finds the exact answer greedy misses on a pour height', () => {
    const result = coverExact(180, [300, 150, 90]);
    expect(result.remainder).toBe(0);
    expect(result.picks.map((i) => [300, 150, 90][i])).toEqual([90, 90]);
  });

  it('uses as few pieces as possible', () => {
    // 180 is 90+90 or 60+60+60 or 90+60+30 — the two-piece answer must win
    expect(coverExact(180, [90, 60, 30]).picks).toHaveLength(2);
  });

  it('covers as much as it can and reports the rest when nothing lands exactly', () => {
    const result = coverExact(73, [90, 75, 60, 45, 30, 10, 5]);
    expect(result.remainder).toBe(3);
    expect(result.picks.length).toBeGreaterThan(0);
  });

  it('reports the whole target when nothing fits at all', () => {
    expect(coverExact(20, [45, 60])).toEqual({ picks: [], remainder: 20 });
  });

  it('handles half-centimetre sizes', () => {
    expect(coverExact(22.5, [7.5, 15]).remainder).toBe(0);
  });

  it('is safe with a zero or negative target and an empty catalog', () => {
    expect(coverExact(0, [30]).picks).toHaveLength(0);
    expect(coverExact(-5, [30]).remainder).toBe(0);
    expect(coverExact(60, []).remainder).toBe(60);
  });
});

describe('planColumn', () => {
  it('builds a 60×60×300 column from the real Du catalog with nothing left over', () => {
    const plan = planColumn(spec(), materials);
    expect(plan.summary.courses).toBe(1);
    expect(plan.summary.panels).toBe(4);
    expect(plan.summary.corners).toBe(4);
    expect(plan.summary.walers).toBe(16);
    expect(plan.summary.ties).toBe(8);
    expect(plan.warnings).toHaveLength(0);
  });

  describe('summary matches what is actually placed', () => {
    // The summary drives the wizard preview, the pieces drive the BOM. If they
    // disagree the company under-orders and the delivery is short.
    const check = (plan: Plan) => {
      expect(countOf(plan, 'panel')).toBe(plan.summary.panels);
      expect(countOf(plan, 'filler')).toBe(plan.summary.fillers);
      expect(countOf(plan, 'corner')).toBe(plan.summary.corners);
      expect(countOf(plan, 'waler')).toBe(plan.summary.walers);
      expect(countOf(plan, 'rod')).toBe(plan.summary.ties);
    };

    it('agrees for a single-course column', () => {
      check(planColumn(spec(), materials));
    });

    it('agrees for a tall column with several courses and waler rings', () => {
      const plan = planColumn(spec({ height: 450, walerSpacing: 75 }), materials);
      expect(plan.summary.courses).toBeGreaterThan(1);
      check(plan);
    });

    it('agrees when fillers are needed', () => {
      const plan = planColumn(spec({ sectionX: 100 }), materials);
      expect(plan.summary.fillers).toBeGreaterThan(0);
      check(plan);
    });
  });

  describe('the formwork box closes with no gaps', () => {
    // Corners used to be drawn 15×15 at the outer box corner while the panels
    // were laid as if the corner covered a full 15 cm of concrete face. It
    // cannot do both, and the mismatch left a 9 cm hole beside every corner.
    it('butts every panel straight against the corner profile', () => {
      const plan = planColumn(
        spec({ originX: 500, originY: 200, includeWalers: false }),
        materials,
      );
      const corners = boxesOf(plan, 'corner');
      const panels = boxesOf(plan, 'panel');
      expect(corners).toHaveLength(4);
      expect(panels).toHaveLength(4);

      // top-left corner, and the two panels that must meet it
      const topLeft = corners.find((b) => b.x < 501 && b.y < 201)!;
      const topFace = panels.find((b) => b.y + b.h <= 200.01 && b.w > b.h)!;
      const leftFace = panels.find((b) => b.x + b.w <= 500.01 && b.h > b.w)!;

      expect(topFace.x).toBeCloseTo(topLeft.x + topLeft.w); // no gap along x
      expect(leftFace.y).toBeCloseTo(topLeft.y + topLeft.h); // no gap along y
    });

    it('sets the corner in by the panel thickness it stands off', () => {
      // 24 cm leg wrapping a 9 cm panel reaches 15 cm along the concrete, so a
      // 60 cm face leaves 30 cm of panel between the two corners.
      const plan = planColumn(spec({ includeWalers: false }), materials);
      const panels = boxesOf(plan, 'panel');
      const topFace = panels.find((b) => b.w > b.h)!;
      expect(topFace.w).toBeCloseTo(30);
    });

    it('wraps two faces around the ends when corner profiles are turned off', () => {
      // Four faces each spanning only their own section leaves a
      // panel-thickness hole at every box corner, so the box has to pinwheel.
      const plan = planColumn(
        spec({ includeCorners: false, includeWalers: false }),
        materials,
      );
      const boxes = boxesOf(plan, 'panel');
      const wide = boxes.filter((b) => b.w > b.h);
      // 60 section + 9 cm of panel at each end
      for (const b of wide) expect(b.x).toBeCloseTo(-9);
      expect(plan.warnings.join()).toMatch(/გრძელდება/);
    });
  });

  describe('courses', () => {
    it('splits a tall pour into courses at real elevations', () => {
      const plan = planColumn(spec({ height: 450 }), materials);
      expect(plan.summary.courses).toBe(2); // 300 + 150
      const levels = [...new Set(plan.pieces.map((p) => p.z ?? 0))];
      expect(levels).toContain(0);
      expect(levels).toContain(300);
    });

    it('never puts a corner profile taller than the course it belongs to', () => {
      // A 300 cm corner repeated on a 150 cm course stands 150 cm proud of the
      // pour — which is what the wizard used to do.
      const plan = planColumn(spec({ height: 450 }), materials);
      const courseHeights = new Map<number, number>([
        [0, 300],
        [300, 150],
      ]);
      for (const p of plan.pieces) {
        const m = materialOf(p.materialId);
        if (m.category !== 'corner') continue;
        expect(m.h).toBe(courseHeights.get(p.z ?? 0));
      }
    });

    it('warns instead of rounding when the height does not divide', () => {
      expect(planColumn(spec({ height: 320 }), materials).warnings.join()).toMatch(
        /სიმაღლეში დარჩა/,
      );
    });

    it('keeps everything within the pour height', () => {
      for (const p of planColumn(spec({ height: 300 }), materials).pieces) {
        expect(p.z ?? 0).toBeLessThan(300);
      }
    });
  });

  describe('fillers', () => {
    it('closes a strip the panel widths cannot reach', () => {
      // 100 cm section → 70 cm face → 60 cm panel + a 10 cm ჩაკერება
      const plan = planColumn(spec({ sectionX: 100, includeWalers: false }), materials);
      expect(plan.summary.fillers).toBe(2); // one per wide face
      expect(plan.warnings).toHaveLength(0);
    });

    it('never builds a whole face out of fillers', () => {
      // The 150 cm course of a 450 pour leaves a 38 cm face and the narrowest
      // 150 cm panel is 45. Twelve 5 and 10 cm strips is not an answer — say so.
      const plan = planColumn(spec({ height: 450, includeWalers: false }), materials);
      const shortCourse = plan.pieces.filter((p) => (p.z ?? 0) === 300);
      expect(shortCourse.every((p) => materialOf(p.materialId).category !== 'filler')).toBe(true);
      expect(plan.warnings.join()).toMatch(/ვერ დაიფარა/);
    });

    it('still warns when neither panels nor fillers reach the size', () => {
      // 103 cm section → 73 cm face: 60 + 10 gets to 70 and 3 cm has no piece
      expect(planColumn(spec({ sectionX: 103 }), materials).warnings.join()).toMatch(/დარჩა 3/);
    });
  });

  describe('walers and ties', () => {
    const centreOf = (b: { x: number; w: number }) => b.x + b.w / 2;

    it('adds a ring at the requested spacing, one run per face', () => {
      const plan = planColumn(spec({ height: 300, walerSpacing: 75 }), materials);
      expect(plan.summary.walers).toBe(16); // 4 levels × 4 faces
      const levels = [
        ...new Set(
          plan.pieces
            .filter((p) => materialOf(p.materialId).category === 'waler')
            .map((p) => p.z ?? 0),
        ),
      ].sort((a, b) => a - b);
      expect(levels).toEqual([37.5, 112.5, 187.5, 262.5]);
    });

    it('sizes walers to the face, not to the whole unfolded width', () => {
      // A 60 cm face must not order the 600 cm waler that spans all four faces.
      const plan = planColumn(spec({ height: 300, walerSpacing: 300 }), materials);
      const ids = new Set(
        plan.pieces
          .map((p) => materialOf(p.materialId))
          .filter((m) => m.category === 'waler')
          .map((m) => m.id),
      );
      expect(ids.has('waler-600')).toBe(false);
      expect(ids.has('waler-100')).toBe(true); // shortest that covers 78 cm
    });

    it('centres the stock length on the column instead of overhanging one side', () => {
      // A 100 cm waler on a 78 cm side has 22 cm spare; hanging it all off one
      // end put the ring visibly askew in the 3D view.
      const plan = planColumn(spec({ walerSpacing: 300 }), materials);
      for (const b of boxesOf(plan, 'waler')) {
        const across = b.w > b.h ? centreOf(b) : b.y + b.h / 2;
        expect(across).toBeCloseTo(30); // column centre, 60/2
      }
    });

    it('centres the tie rods on the column', () => {
      const plan = planColumn(spec({ walerSpacing: 300 }), materials);
      const rods = boxesOf(plan, 'rod');
      expect(rods).toHaveLength(2);
      for (const b of rods) {
        expect(centreOf(b)).toBeCloseTo(30);
        expect(b.y + b.h / 2).toBeCloseTo(30);
      }
    });

    it('places two ties per waler ring', () => {
      expect(planColumn(spec({ height: 300, walerSpacing: 150 }), materials).summary.ties).toBe(4);
    });
  });

  it('only places materials that exist in the catalog', () => {
    const ids = new Set(materials.map((m) => m.id));
    for (const piece of planColumn(spec(), materials).pieces) {
      expect(ids.has(piece.materialId)).toBe(true);
    }
  });

  it('honours the include toggles', () => {
    const bare = planColumn(
      spec({ includeWalers: false, includeTies: false, includeCorners: false }),
      materials,
    );
    expect(bare.summary.walers).toBe(0);
    expect(bare.summary.ties).toBe(0);
    expect(bare.summary.corners).toBe(0);
    expect(bare.summary.panels).toBeGreaterThan(0);
  });

  it('degrades gracefully with an empty catalog', () => {
    const plan = planColumn(spec(), []);
    expect(plan.pieces).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('reports the outer formwork size, section plus both panel faces', () => {
    const plan = planColumn(spec({ sectionX: 60, sectionY: 45 }), materials);
    expect(plan.summary.outerX).toBe(60 + 18);
    expect(plan.summary.outerY).toBe(45 + 18);
  });

  it('does not repeat the same warning once per face and course', () => {
    const plan = planColumn(spec({ sectionX: 103, height: 600 }), materials);
    expect(new Set(plan.warnings).size).toBe(plan.warnings.length);
  });
});
