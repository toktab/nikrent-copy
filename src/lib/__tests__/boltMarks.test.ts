import { describe, expect, it } from 'vitest';
import { boltGroups, boltKindOf, boltTotals, groupsText, markedRodLength, normalizeBoltKinds, planMarks } from '../boltMarks';
import { connectorCount, latchCount, nutCount, rodCount } from '../bolts';
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
  it('draws a rod spot, a ქანჩი + დისკო on each of its two ends and a ჩამკეტი fix on each face', () => {
    const marks = planMarks(wall(), byId);
    expect(marks.rods).toHaveLength(1);
    expect(marks.nuts).toHaveLength(2);
    expect(marks.latches).toHaveLength(2);
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
  it('is the four counts the ჭანჭიკები menu shows', () => {
    const pieces = wall();
    expect(boltTotals(pieces, byId)).toEqual({
      connectors: connectorCount(pieces, byId),
      rods: rodCount(pieces, byId),
      nuts: nutCount(pieces, byId),
      latches: latchCount(pieces, byId),
    });
  });
});

describe('boltGroups - places on the plan × how many at each = in all', () => {
  it('reads one rod spot up a 300 as 1 × 5, and its ends and clamps the same way', () => {
    const g = boltGroups(wall(), byId);
    expect(groupsText(g.rods)).toBe('1 × 5 = 5');
    expect(groupsText(g.nuts)).toBe('2 × 5 = 10');
    expect(groupsText(g.latches)).toBe('2 × 4 = 8');
    expect(groupsText(g.connectors)).toBe('0');
  });

  it('adds up to the totals, stacked courses and mixed heights included', () => {
    const tall = wall();
    const low = [
      put('panel-75x150', 300, 0),
      put('panel-75x150', 375, 0),
      put('panel-75x150', 300, 30),
      put('panel-75x150', 375, 30),
    ];
    const pieces = [...tall, ...wall(300), ...low];
    const g = boltGroups(pieces, byId);
    const totals = boltTotals(pieces, byId);
    for (const k of ['connectors', 'rods', 'nuts', 'latches'] as const) {
      expect(g[k].reduce((n, x) => n + x.places * x.each, 0)).toBe(totals[k]);
    }
    // The 300 spot has both courses on it in plan; the 150 one stands alone.
    expect(groupsText(g.rods)).toBe('1 × 10 + 1 × 2 = 12');
  });
});

describe('boltKindOf', () => {
  it('names each ჭანჭიკი kind and nothing else', () => {
    expect(boltKindOf(byId.get('corner-connector')!)).toBe('connectors');
    expect(boltKindOf(byId.get('rod-60')!)).toBe('rods');
    expect(boltKindOf(byId.get('acc-nut-washer')!)).toBe('nuts');
    expect(boltKindOf(byId.get('acc-latch-fix')!)).toBe('latches');
    expect(boltKindOf(byId.get('acc-latch-adjustable')!)).toBeNull();
    expect(boltKindOf(byId.get('panel-90x300')!)).toBeNull();
    expect(boltKindOf(byId.get('filler-5x300')!)).toBeNull();
  });
});

describe('the PDF switches for the key and the ჭანჭიკები', () => {
  it('print everything on a sheet saved before they existed', () => {
    const old = { wall: true, overall: false, pieces: true };
    const v = normalizePdfVisibility(old);
    expect(v).toMatchObject({ legend: true, connectors: true, rods: true, nuts: true, latches: true, overall: false });
  });

  it('remember a kind switched off', () => {
    expect(normalizePdfVisibility({ ...DEFAULT_PDF_VISIBILITY, rods: false }).rods).toBe(false);
  });
});

describe('which ჭანჭიკები the plan shows', () => {
  it('shows every kind unless one was switched off', () => {
    expect(normalizeBoltKinds(undefined)).toEqual({ connectors: true, rods: true, nuts: true, latches: true });
    expect(normalizeBoltKinds({ rods: false, nuts: 'x' })).toEqual({
      connectors: true,
      rods: false,
      nuts: true,
      latches: true,
    });
  });
});
