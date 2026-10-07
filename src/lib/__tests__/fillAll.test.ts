import { describe, expect, it } from 'vitest';
import { planFillAll } from '../fillAll';
import { planSketchFillAll, type SketchFillSpec } from '../sketchFill';
import { choiceFromVariant, recommendFills } from '../fillOptions';
import { lineStatuses } from '../problems';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { SketchPath } from '../../types';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));
const SPEC: SketchFillSpec = { height: 300, includeCorners: true };

const WALL: SketchPath[] = [
  { id: 'near', points: [{ x: 0, y: 0 }, { x: 490, y: 0 }], perimeter: 'outer' },
  { id: 'far', points: [{ x: 0, y: 20 }, { x: 490, y: 20 }], perimeter: 'inner' },
];
const OTHER: SketchPath = { id: 'other', points: [{ x: 0, y: 400 }, { x: 765, y: 400 }] };

/** Build exactly what the button does: plan it, then apply the picks as the store would. */
const apply = (sketch: SketchPath[], plan: ReturnType<typeof planFillAll>) => {
  const choices: NonNullable<SketchFillSpec['choices']> = {};
  for (const { runKey, variant } of plan.picks) choices[runKey] = choiceFromVariant(variant).sequences;
  const paths = sketch.filter((p) => plan.pathIds.includes(p.id));
  return planSketchFillAll(paths, { ...SPEC, stack: plan.stack ?? undefined, choices }, materials).pieces;
};

describe('planFillAll - every empty wall with its best recommendation', () => {
  it('picks recommendation #1 for each run, on one stack', () => {
    const sketch = [...WALL, OTHER];
    const plan = planFillAll({ sketch, spec: SPEC, materials, pieces: [] });
    expect(plan.pathIds).toEqual(['near', 'far', 'other']);
    expect(plan.stack).toEqual([300]);
    expect(plan.unmatched).toEqual([]);

    // The pair is one run, the lone line another.
    expect(plan.picks).toHaveLength(2);
    const lone = plan.picks.find((p) => p.variant.pieces === recommendFills({ length: 765, height: 300, materials }).variants[0].pieces);
    expect(lone).toBeDefined();
  });

  it('builds walls that read ცდომილება 0', () => {
    const sketch = [...WALL, OTHER];
    const pieces = apply(sketch, planFillAll({ sketch, spec: SPEC, materials, pieces: [] }));
    expect([...lineStatuses(sketch, pieces, byId).values()]).toEqual(['ok', 'ok', 'ok']);
  });

  it('leaves a line that is already built alone, and never fills it twice', () => {
    const built = planSketchFillAll([OTHER], SPEC, materials).pieces;
    const plan = planFillAll({ sketch: [...WALL, OTHER], spec: SPEC, materials, pieces: built });
    expect(plan.pathIds).toEqual(['near', 'far']);
    expect(plan.skippedPathIds).toEqual(['other']);
  });

  it('fills only the selection when there is one', () => {
    const plan = planFillAll({ sketch: [...WALL, OTHER], pathIds: ['other'], spec: SPEC, materials, pieces: [] });
    expect(plan.pathIds).toEqual(['other']);
    expect(plan.skippedPathIds).toEqual([]);
  });

  it('does nothing when every line is already built', () => {
    const built = planSketchFillAll(WALL, SPEC, materials).pieces;
    expect(planFillAll({ sketch: WALL, spec: SPEC, materials, pieces: built })).toMatchObject({
      pathIds: [],
      picks: [],
      skippedPathIds: ['near', 'far'],
    });
  });
});
