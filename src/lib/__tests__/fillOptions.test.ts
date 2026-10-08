import { describe, expect, it } from 'vitest';
import {
  courseStacks,
  fillerRemainder,
  freeStock,
  layOrder,
  recommendFills,
  stockEntered,
  stockPressure,
  variantSummary,
  type Variant,
} from '../fillOptions';
import { coverExact } from '../formwork';
import { createSeedMaterials } from '../../data/seedCatalog';

/**
 * The rules in docs/FILL-RULES.md, as examples. A failure here means either the
 * engine broke a rule or a rule changed - in which case change the file too.
 */

const materials = createSeedMaterials();
const fill = (length: number, over: Partial<Parameters<typeof recommendFills>[0]> = {}) =>
  recommendFills({ length, height: 300, materials, ...over });

/** One face, one course, as widths: fillers written `f5`. */
const widths = (v: Variant, course = 0) =>
  v.courses[course].sequence.map((p) => (p.filler ? `f${p.w}` : String(p.w))).join(' ');
const count = (v: Variant, w: number, filler = false) =>
  v.courses[0].sequence.filter((p) => p.w === w && p.filler === filler).length;

describe('the arithmetic: fillers needed are length mod 15', () => {
  it('panels alone reach only multiples of 15', () => {
    const panelWidths = [90, 75, 60, 45, 30];
    expect(fillerRemainder(510, panelWidths)).toBe(0);
    expect(fillerRemainder(515, panelWidths)).toBe(5);
    expect(fillerRemainder(520, panelWidths)).toBe(10);
  });
});

describe('R2 start from 90 - fewest pieces wins', () => {
  it('510: 5×90 + 60, with 4×90 + 2×75 listed below it', () => {
    const { variants } = fill(510);
    expect(widths(variants[0])).toBe('90 90 90 90 90 60');
    expect(variants[0].pieces).toBe(6);
    expect(variants[0].fillers).toBe(0);
    expect(variants.slice(1).some((v) => widths(v) === '90 90 90 90 75 75')).toBe(true);
  });

  it('matches the fewest-pieces answer of the existing cover search, plus one filler', () => {
    // 2000 = one 5 filler + 1995 of panels
    const { variants } = fill(2000);
    const panelsOnly = coverExact(1995, [90, 75, 60, 45, 30]).picks.length;
    expect(variants[0].pieces).toBe(panelsOnly + 1);
    expect(variants[0].fillers).toBe(1);
  });
});

describe('R4 / P2 one filler, of length mod 15', () => {
  it('515 takes one 5 and 520 one 10', () => {
    const v515 = fill(515).variants[0];
    expect(v515.fillers).toBe(1);
    expect(count(v515, 5, true)).toBe(1);
    const v520 = fill(520).variants[0];
    expect(v520.fillers).toBe(1);
    expect(count(v520, 10, true)).toBe(1);
  });

  it('a two-filler answer never ranks above a one-filler answer', () => {
    const { variants } = fill(520, { limit: 50 });
    const lastSingle = Math.max(...variants.map((v, i) => (v.fillers === 1 ? i : -1)));
    const firstDouble = variants.findIndex((v) => v.fillers === 2);
    expect(firstDouble === -1 || firstDouble > variants.findIndex((v) => v.fillers === 1)).toBe(true);
    expect(lastSingle).toBeGreaterThanOrEqual(0);
  });

  it('with no fillers allowed, a length that needs one says so instead of guessing', () => {
    const result = fill(515, { filters: { maxFillers: 0 } });
    expect(result.variants).toEqual([]);
    expect(result.warnings[0]).toContain('5 სმ');
  });
});

describe('R5 / P1 laying order', () => {
  it('puts the filler between the size groups, like the hand-drawn wall', () => {
    // 490 = a 10 filler + 480, laid 90s first: 5×90 and the 30 left over (R2 over P4)
    expect(widths(fill(490).variants[0])).toBe('90 90 90 90 90 f10 30');
    // 700 = a 10 filler + 690 = 7×90 + 60: the wall in the screenshot has this shape
    expect(widths(fill(700).variants[0])).toBe('90 90 90 90 90 90 90 f10 60');
  });

  it('with one size group there is nothing between, so the filler goes at the end', () => {
    expect(widths(fill(460).variants[0])).toBe('90 90 90 90 90 f10');
  });

  it('spreads two fillers between groups rather than side by side', () => {
    const p = (w: number, filler = false) => ({ materialId: String(w), w, filler });
    const order = layOrder([p(60), p(90), p(75), p(90)], [p(5, true), p(10, true)]);
    expect(order.map((x) => (x.filler ? `f${x.w}` : x.w)).join(' ')).toBe('90 90 f10 75 f5 60');
  });
});

describe('P4 / P5 tie-breakers at the same piece count', () => {
  it('765: 8×90 + 45 (two sizes) ranks above 7×90 + 75 + 60 (three sizes)', () => {
    const { variants } = fill(765);
    expect(widths(variants[0])).toBe('90 90 90 90 90 90 90 90 45');
    const three = variants.findIndex((v) => widths(v) === '90 90 90 90 90 90 90 75 60');
    expect(three).toBeGreaterThan(0);
    expect(variants[three].pieces).toBe(variants[0].pieces);
  });
});

describe('R6 both faces', () => {
  it('doubles every count for a matched pair of faces', () => {
    const one = fill(510).variants[0];
    const two = fill(510, { faces: 2 }).variants[0];
    expect(widths(two)).toBe(widths(one));
    expect(two.total['panel-90x300']).toBe(10);
    expect(two.pieces).toBe(12);
  });
});

describe('height and stacking', () => {
  it('finds every stack that makes the pour exactly', () => {
    expect(courseStacks(300, [300, 150, 90])).toEqual([[300], [150, 150]]);
    expect(courseStacks(240, [300, 150, 90])).toEqual([[150, 90]]);
  });

  it('P3: one 300 course beats 150 + 150 by default', () => {
    expect(fill(510).variants[0].stack).toEqual([300]);
  });

  it('fewer 300s puts the stacked courses first - with no 90s, which only come at 300', () => {
    const best = fill(510, { filters: { fewer300: true } }).variants[0];
    expect(best.stack).toEqual([150, 150]);
    expect(best.courses.every((c) => c.sequence.every((p) => p.w !== 90))).toBe(true);
    // P6: both courses the same
    expect(widths(best, 0)).toBe(widths(best, 1));
    expect(best.reasons).toContain('300-ის პანელის გარეშე');
  });
});

describe('filters', () => {
  it('spare 90s brings a same-count variant with fewer 90s to the top', () => {
    const plain = fill(765).variants[0];
    const spared = fill(765, { filters: { spare90: true } }).variants[0];
    expect(spared.pieces).toBe(plain.pieces);
    expect(count(spared, 90)).toBeLessThan(count(plain, 90));
    expect(spared.reasons.some((r) => r.startsWith('90-ებს ზოგავს'))).toBe(true);
  });

  it('an excluded width is not used at all', () => {
    const { variants } = fill(510, { filters: { excludeWidths: [90] } });
    expect(variants.length).toBeGreaterThan(0);
    expect(variants.every((v) => v.courses.every((c) => c.sequence.every((p) => p.w !== 90)))).toBe(true);
  });

  it('sort by fillers ranks a filler-free variant first when one exists', () => {
    // 525 = 5×90 + 75 with no filler; mod 15 = 0 so this is also the default
    const best = fill(525, { filters: { sort: 'fillers' } }).variants[0];
    expect(best.fillers).toBe(0);
  });
});

describe('stock', () => {
  it('a variant needing more than is free sinks below every one that fits', () => {
    const free = new Map([['panel-90x300', 4]]);
    // A long list: the variant that does not fit sinks below every one that does.
    const { variants } = fill(510, { free, limit: 200 });
    expect(widths(variants[0])).toBe('90 90 90 90 75 75');
    expect(variants[0].feasible).toBe(true);
    const short = variants.find((v) => widths(v) === '90 90 90 90 90 60')!;
    expect(short.feasible).toBe(false);
    expect(short.reasons.some((r) => r.startsWith('მარაგი არ ყოფნის'))).toBe(true);
    expect(short.stock.find((s) => s.materialId === 'panel-90x300')).toMatchObject({ need: 5, free: 4, after: -1 });
  });

  it('ignores stock when told to', () => {
    const free = new Map([['panel-90x300', 4]]);
    expect(widths(fill(510, { free, filters: { useStock: false } }).variants[0])).toBe('90 90 90 90 90 60');
  });

  it('works out free stock and pressure from the open drawing', () => {
    const owned = materials.map((m) => (m.id === 'panel-90x300' ? { ...m, stock: { main: 10 } } : m));
    const pieces = Array.from({ length: 4 }, (_, i) => ({ id: `p${i}`, materialId: 'panel-90x300', x: 0, y: 0, rot: 0 }));
    expect(freeStock(owned, pieces).get('panel-90x300')).toBe(6);
    expect(stockPressure(owned, pieces).get('panel-90x300')).toBeCloseTo(0.4);
    // Nobody owns a 30: none of it is free, and it counts as fully spoken for.
    expect(freeStock(owned, pieces).get('panel-30x300')).toBe(0);
    expect(stockPressure(owned, pieces).get('panel-30x300')).toBe(1);
  });
});

describe('reading a variant', () => {
  it('sums a variant up in one line, in laying order', () => {
    expect(variantSummary(fill(700).variants[0])).toBe('7×90 · ჩ10 · 60');
    expect(variantSummary(fill(510, { filters: { fewer300: true } }).variants[0]).startsWith('150+150: ')).toBe(
      true,
    );
  });

  it('knows whether any stock has been entered yet', () => {
    expect(stockEntered(materials)).toBe(false);
    const stocked = materials.map((m) => (m.id === 'panel-90x300' ? { ...m, stock: { main: 500 } } : m));
    expect(stockEntered(stocked)).toBe(true);
  });
});

describe('the result is stable', () => {
  it('is the same every time', () => {
    const a = fill(1235, { faces: 2 }).variants.map((v) => v.key);
    const b = fill(1235, { faces: 2 }).variants.map((v) => v.key);
    expect(a).toEqual(b);
  });

  it('refuses a zero length and a height no stack makes', () => {
    expect(fill(0).warnings.length).toBe(1);
    expect(fill(510, { height: 100 }).variants).toEqual([]);
  });
});
