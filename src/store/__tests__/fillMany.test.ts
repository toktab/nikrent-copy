import { beforeEach, describe, expect, it } from 'vitest';
import { useEditorStore } from '../useEditorStore';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { SketchPath } from '../../types';

/**
 * Filling a whole layout at once.
 *
 * A building is a few runs that happen to meet, so this is the selection people
 * actually have in front of them. One at a time meant retyping the same
 * thickness and height for each and adding the summaries up by hand.
 */
const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const runs = (): SketchPath[] => [
  { id: 'a', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] },
  { id: 'b', points: [{ x: 0, y: 400 }, { x: 600, y: 400 }] },
];

const spec = { thickness: 20, height: 300, includeCorners: true };
const state = () => useEditorStore.getState();

describe('filling several runs at once', () => {
  beforeEach(() => {
    useEditorStore.setState({
      materials, pieces: [], sketch: runs(), selectedIds: [],
      selectedSketchIds: ['a', 'b'], past: [], future: [],
    });
  });

  it('builds every run that was given, not just the first', () => {
    const one = state().fillSketch(['a'], spec).added;
    useEditorStore.setState({ pieces: [] });
    const both = state().fillSketch(['a', 'b'], spec).added;
    expect(both).toBeGreaterThan(one);
  });

  it('is one undo step for the lot', () => {
    state().fillSketch(['a', 'b'], spec);
    expect(state().pieces.length).toBeGreaterThan(0);
    state().undo();
    expect(state().pieces).toHaveLength(0);
  });

  it('orders the face and nothing behind it, across all of them', () => {
    state().fillSketch(['a', 'b'], spec);
    const cats = new Set(state().pieces.map((p) => byId.get(p.materialId)!.category));
    expect([...cats].every((c) => ['panel', 'filler', 'corner'].includes(c))).toBe(true);
  });

  it('says so rather than throwing when the ids match nothing', () => {
    expect(state().fillSketch(['nope'], spec)).toEqual({
      added: 0,
      warnings: ['ნახაზი ვერ მოიძებნა.'],
    });
  });

  it('plans each run separately — two runs that touch are not one corner', () => {
    // Two straight runs: neither turns, so neither has a corner, however they
    // happen to sit relative to each other.
    state().fillSketch(['a', 'b'], spec);
    const corners = state().pieces.filter((p) => byId.get(p.materialId)!.category === 'corner');
    expect(corners).toHaveLength(0);
  });
});
