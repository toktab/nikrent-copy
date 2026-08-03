import { describe, expect, it } from 'vitest';
import type { ColumnSpec } from '../../types';
import { planColumn } from '../columnWizard';
import { pieceBounds } from '../geometry';
import { createSeedMaterials } from '../../data/seedCatalog';

const materials = createSeedMaterials();

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

describe('planColumn', () => {
  it('builds a 60×60×300 column from the real Du catalog', () => {
    const plan = planColumn(spec(), materials);
    expect(plan.pieces.length).toBeGreaterThan(0);
    // four faces, each covered by 60-wide panels at a single 300 course
    expect(plan.summary.courses).toBe(1);
    expect(plan.summary.panels).toBe(4);
    expect(plan.summary.corners).toBe(4);
    expect(plan.warnings).toHaveLength(0);
  });

  it('only places materials that exist in the catalog', () => {
    const ids = new Set(materials.map((m) => m.id));
    for (const piece of planColumn(spec(), materials).pieces) {
      expect(ids.has(piece.materialId)).toBe(true);
    }
  });

  it('splits a tall pour into courses', () => {
    // 450 = 300 + 150, both real panel heights
    const plan = planColumn(spec({ height: 450 }), materials);
    expect(plan.summary.courses).toBe(2);
    expect(plan.warnings).toHaveLength(0);
  });

  it('warns instead of rounding when the height does not divide', () => {
    const plan = planColumn(spec({ height: 320 }), materials);
    expect(plan.warnings.join()).toMatch(/სიმაღლეში დარჩა/);
  });

  it('warns instead of rounding when a face width does not divide', () => {
    // 100 cm face: 90 + 10 left over, and there is no 10-wide panel
    const plan = planColumn(spec({ sectionX: 100 }), materials);
    expect(plan.warnings.join()).toMatch(/დარჩა/);
  });

  it('covers a wide face with several panels', () => {
    const plan = planColumn(spec({ sectionX: 90, sectionY: 90, includeWalers: false, includeCorners: false }), materials);
    expect(plan.summary.panels).toBe(4); // one 90 panel per face
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

  it('adds waler rings at the requested spacing, one run per face', () => {
    const plan = planColumn(spec({ height: 300, walerSpacing: 75 }), materials);
    // 300 / 75 = 4 levels × 4 faces
    expect(plan.summary.walers).toBe(16);
  });

  it('sizes walers to the face, not to the whole unfolded width', () => {
    // A 60 cm face must not order the 600 cm waler that spans all four faces.
    const plan = planColumn(spec({ height: 300, walerSpacing: 300 }), materials);
    const walerIds = new Set(
      plan.pieces
        .map((p) => materials.find((m) => m.id === p.materialId)!)
        .filter((m) => m.category === 'waler')
        .map((m) => m.id),
    );
    expect(walerIds.has('waler-600')).toBe(false);
    expect(walerIds.has('waler-100')).toBe(true); // shortest that covers 60 cm
  });

  it('places two ties per waler ring', () => {
    const plan = planColumn(spec({ height: 300, walerSpacing: 150 }), materials);
    expect(plan.summary.ties).toBe(4); // 2 levels × 2
  });

  it('degrades gracefully with an empty catalog', () => {
    const plan = planColumn(spec(), []);
    expect(plan.pieces).toHaveLength(0);
    expect(plan.warnings.length).toBeGreaterThan(0);
  });

  it('closes the four panel faces into a box around the concrete', () => {
    // Rotation happens about the centre, so the check has to be on real
    // footprints — this is exactly what used to land the turned faces offset.
    const plan = planColumn(
      spec({ originX: 500, originY: 200, sectionX: 60, sectionY: 60, includeWalers: false, includeCorners: false }),
      materials,
    );
    const byId = new Map(materials.map((m) => [m.id, m]));
    const boxes = plan.pieces.map((p) => pieceBounds(p, byId.get(p.materialId)!));

    const top = boxes.filter((b) => Math.abs(b.y + b.h - 200) < 0.01);
    const bottom = boxes.filter((b) => Math.abs(b.y - (200 + 60)) < 0.01);
    const left = boxes.filter((b) => Math.abs(b.x + b.w - 500) < 0.01);
    const right = boxes.filter((b) => Math.abs(b.x - (500 + 60)) < 0.01);

    // every face present, each sitting exactly against the concrete
    expect(top.length).toBeGreaterThan(0);
    expect(bottom.length).toBeGreaterThan(0);
    expect(left.length).toBeGreaterThan(0);
    expect(right.length).toBeGreaterThan(0);

    // the turned faces really are 9 cm thick and 60 cm long
    expect(left[0].w).toBeCloseTo(9);
    expect(left[0].h).toBeCloseTo(60);
    expect(top[0].w).toBeCloseTo(60);
    expect(top[0].h).toBeCloseTo(9);
  });

  it('reports the outer formwork size, section plus both panel faces', () => {
    const plan = planColumn(spec({ sectionX: 60, sectionY: 45 }), materials);
    // 9 cm panels on each side
    expect(plan.summary.outerX).toBe(60 + 18);
    expect(plan.summary.outerY).toBe(45 + 18);
  });
});
