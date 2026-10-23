import { describe, expect, it } from 'vitest';
import { boltKindOf, boltTotals, markedRodLength, normalizeBoltKinds, planMarks } from '../boltMarks';
import { connectorCount, nutCount, rodCount } from '../bolts';
import { DEFAULT_PDF_VISIBILITY, normalizePdfVisibility } from '../dimensions';
import { SEED_MATERIALS } from '../../data/seedCatalog';
import type { Piece } from '../../types';

const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
let n = 0;
const put = (materialId: string, x: number, y: number, z?: number): Piece => ({
  id: `p${n++}`,
  materialId,
  x,
  y,
  rot: 0,
  ...(z !== undefined ? { z } : {}),
});

// Two faces of a wall along x, joints facing each other at x 90: one rod spot.
const wall = (z?: number) => [
  put('panel-90x300', 0, 0, z),
  put('panel-90x300', 90, 0, z),
  put('panel-90x300', 0, 30, z),
  put('panel-90x300', 90, 30, z),
];

describe('planMarks - what the plan and the printed sheet draw', () => {
  it('draws a rod spot and a ქანჩი + დისკო on each of its two ends - no ჩამკეტი fix of its own', () => {
    const marks = planMarks(wall(), byId);
    expect(marks.rods).toHaveLength(1);
    expect(marks.nuts).toHaveLength(2);
    expect(Object.keys(marks)).toEqual(['connectors', 'rods', 'nuts']);
  });

  it('draws a stacked course once in plan, while the count keeps both courses', () => {
    const pieces = [...wall(0), ...wall(300)];
    const marks = planMarks(pieces, byId);
    expect(marks.rods).toHaveLength(1);
    expect(marks.nuts).toHaveLength(2);
    expect(boltTotals(pieces, byId).rods).toBe(rodCount(pieces, byId));
    expect(rodCount(pieces, byId)).toBeGreaterThan(5);
  });

  it('draws a worked-out rod as long as the catalog rod that would go there', () => {
    const [rod] = planMarks(wall(), byId).rods;
    expect(markedRodLength(SEED_MATERIALS, rod)).toBe(60);
  });
});

describe('boltTotals', () => {
  it('is the three counts the ჭანჭიკები menu shows', () => {
    const pieces = wall();
    expect(boltTotals(pieces, byId)).toEqual({
      connectors: connectorCount(pieces, byId),
      rods: rodCount(pieces, byId),
      nuts: nutCount(pieces, byId),
    });
  });
});

describe('boltKindOf', () => {
  it('names each ჭანჭიკი kind and nothing else', () => {
    expect(boltKindOf(byId.get('corner-connector')!)).toBe('connectors');
    expect(boltKindOf(byId.get('rod-60')!)).toBe('rods');
    expect(boltKindOf(byId.get('acc-nut-washer')!)).toBe('nuts');
    // A ჩამკეტი fix placed by hand shows and hides with the nuts it sits on.
    expect(boltKindOf(byId.get('acc-latch-fix')!)).toBe('nuts');
    expect(boltKindOf(byId.get('acc-latch-adjustable')!)).toBeNull();
    expect(boltKindOf(byId.get('panel-90x300')!)).toBeNull();
    expect(boltKindOf(byId.get('filler-5x300')!)).toBeNull();
  });
});

describe('the PDF switches for the key and the ჭანჭიკები', () => {
  it('print everything on a sheet saved before they existed', () => {
    const old = { wall: true, overall: false, pieces: true };
    const v = normalizePdfVisibility(old);
    expect(v).toMatchObject({ legend: true, connectors: true, rods: true, nuts: true, overall: false });
  });

  it('remember a kind switched off', () => {
    expect(normalizePdfVisibility({ ...DEFAULT_PDF_VISIBILITY, rods: false }).rods).toBe(false);
  });
});

describe('which ჭანჭიკები the plan shows', () => {
  it('shows every kind unless one was switched off', () => {
    expect(normalizeBoltKinds(undefined)).toEqual({ connectors: true, rods: true, nuts: true });
    expect(normalizeBoltKinds({ rods: false, nuts: 'x' })).toEqual({
      connectors: true,
      rods: false,
      nuts: true,
    });
  });
});
