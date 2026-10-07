import { describe, expect, it } from 'vitest';
import type { Material } from '../../types';
import { cornerLeg, drawnLeg, drawnOutline, planOutline, shoelace } from '../shapePath';
import { createSeedMaterials } from '../../data/seedCatalog';

const seed = createSeedMaterials();
const byId = (id: string) => seed.find((m) => m.id === id)!;

const xsOf = (m: Material) => [...new Set(planOutline(m).map(([x]) => x))].sort((a, b) => a - b);

describe('corner legs', () => {
  it('draws the outer corner as the architect\'s thin angle: 10 × 10, 0.1 thick', () => {
    const outer = byId('corner-outer-300');
    expect(outer).toMatchObject({ w: 10, depth: 10, leg: 0.1, shape: 'L' });
    expect(cornerLeg(outer)).toBe(0.1);
    expect(xsOf(outer)).toEqual([0, 0.1, 10]);
    expect(planOutline(outer)).toContainEqual([10, 9.9]);
  });

  it('keeps the inside corner on the panel-thickness rule', () => {
    const inner = byId('corner-inner-20x20x300');
    expect(inner.leg).toBeUndefined();
    expect(cornerLeg(inner)).toBe(9);
    expect(xsOf(inner)).toEqual([0, 9, 20]);
  });

  it('never draws a leg thicker than the box', () => {
    const odd: Material = { ...byId('corner-outer-300'), w: 4, depth: 4, leg: 6 };
    expect(cornerLeg(odd)).toBe(4);
  });

  it('ignores a leg that is not a positive number', () => {
    const zero: Material = { ...byId('corner-outer-300'), w: 24, depth: 24, leg: 0 };
    expect(cornerLeg(zero)).toBe(9);
  });

  it('keeps the winding the 3D extruder relies on', () => {
    expect(shoelace(planOutline(byId('corner-outer-300')))).toBeGreaterThan(0);
    expect(shoelace(drawnOutline(byId('corner-outer-300')))).toBeGreaterThan(0);
  });
});

describe('drawn corner legs', () => {
  // 0.1 cm at 800 % is under a pixel: the corner vanished from the drawing.
  it('draws the thin outer corner thick enough to see, without changing its real leg', () => {
    const outer = byId('corner-outer-300');
    expect(drawnLeg(outer)).toBe(2);
    expect([...new Set(drawnOutline(outer).map(([x]) => x))].sort((a, b) => a - b)).toEqual([0, 2, 10]);
    expect(cornerLeg(outer)).toBe(0.1);
  });

  it('draws the inside corner exactly as it really is', () => {
    const inner = byId('corner-inner-20x20x300');
    expect(drawnOutline(inner)).toEqual(planOutline(inner));
  });

  it('lets a real leg thicker than the floor through untouched', () => {
    const thick: Material = { ...byId('corner-outer-300'), leg: 3 };
    expect(drawnLeg(thick)).toBe(3);
  });

  it('keeps the floor to a fifth of a small box', () => {
    const tiny: Material = { ...byId('corner-outer-300'), w: 5, depth: 5 };
    expect(drawnLeg(tiny)).toBe(1);
  });

  it('leaves every other shape alone', () => {
    const panel = byId('panel-90x300');
    expect(drawnOutline(panel)).toEqual(planOutline(panel));
  });
});
