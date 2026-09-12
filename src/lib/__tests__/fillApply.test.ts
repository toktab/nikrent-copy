import { beforeEach, describe, expect, it } from 'vitest';
import { planSketchFillAll, wallFaces, type SketchFillSpec } from '../sketchFill';
import { choiceFromVariant, recommendFills } from '../fillOptions';
import { createSeedMaterials } from '../../data/seedCatalog';
import { useEditorStore } from '../../store/useEditorStore';
import type { DrawingDoc, Piece } from '../../types';

/**
 * A recommendation picked for a run is laid exactly as picked: the same
 * sequence, in order, on both faces and up every course - and only while it
 * still fits the run it was picked for.
 */

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));
const spec: SketchFillSpec = { height: 300, includeCorners: true };
// A straight 700 cm wall, 20 cm thick: two faces, matched.
const wall = () => wallFaces({ length: 700, thickness: 20, height: 300, originX: 0, originY: 0 });

/** Each face's pieces along the wall, as widths: fillers written `f10`. */
function faces(pieces: Piece[], z = 0): string[] {
  const rows = new Map<number, Piece[]>();
  for (const p of pieces.filter((q) => Math.round(q.z ?? 0) === z)) {
    const key = Math.round(p.y);
    rows.set(key, [...(rows.get(key) ?? []), p]);
  }
  return [...rows.keys()]
    .sort((a, b) => a - b)
    .map((k) =>
      rows
        .get(k)!
        .sort((a, b) => a.x - b.x)
        .map((p) => {
          const m = byId.get(p.materialId)!;
          return m.category === 'filler' ? `f${m.w}` : String(m.w);
        })
        .join(' '),
    );
}

const asWidths = (v: { courses: Array<{ sequence: Array<{ w: number; filler: boolean }> }> }, c = 0) =>
  v.courses[c].sequence.map((p) => (p.filler ? `f${p.w}` : String(p.w))).join(' ');

describe('the runs a fill lays', () => {
  it('names a matched wall once, with both faces and its length between corners', () => {
    const plan = planSketchFillAll(wall(), spec, materials);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0]).toMatchObject({ length: 700, faces: 2, heights: [300] });
  });

  it('gives the same key every time the unchanged drawing is planned', () => {
    const paths = wall();
    expect(planSketchFillAll(paths, spec, materials).runs[0].key).toBe(
      planSketchFillAll(paths, spec, materials).runs[0].key,
    );
  });
});

describe('laying a chosen variant', () => {
  it('lays the picked sequence, in order, on both faces', () => {
    const paths = wall();
    const run = planSketchFillAll(paths, spec, materials).runs[0];
    const { variants } = recommendFills({ length: run.length, height: 300, faces: run.faces, materials });
    // #2 spares two 90s: 90×6, the filler, 75 75
    const picked = variants[1];
    expect(asWidths(picked)).toBe('90 90 90 90 90 90 f10 75 75');

    const choice = choiceFromVariant(picked);
    const plan = planSketchFillAll(
      paths,
      { ...spec, stack: choice.stack, choices: { [run.key]: choice.sequences } },
      materials,
    );
    expect(faces(plan.pieces)).toEqual([asWidths(picked), asWidths(picked)]);
    expect(plan.pieces).toHaveLength(picked.pieces);
    expect(plan.warnings).toEqual([]);
  });

  it('without a choice, fills exactly as before', () => {
    const paths = wall();
    const plain = planSketchFillAll(paths, spec, materials);
    const withEmpty = planSketchFillAll(paths, { ...spec, choices: {} }, materials);
    expect(faces(withEmpty.pieces)).toEqual(faces(plain.pieces));
  });

  it('refuses a choice that no longer fits the run, fills it the usual way, and says so', () => {
    const paths = wall();
    const plain = planSketchFillAll(paths, spec, materials);
    const run = plain.runs[0];
    // A variant for a run 90 cm shorter, as if the wall had been redrawn.
    const stale = recommendFills({ length: 610, height: 300, faces: 2, materials }).variants[0];
    const plan = planSketchFillAll(
      paths,
      { ...spec, choices: { [run.key]: choiceFromVariant(stale).sequences } },
      materials,
    );
    expect(faces(plan.pieces)).toEqual(faces(plain.pieces));
    expect(plan.warnings.some((w) => w.includes('შერჩეული ვარიანტი'))).toBe(true);
  });

  it('stacks the picked courses: 150 + 150 instead of one 300', () => {
    const paths = wall();
    const run = planSketchFillAll(paths, spec, materials).runs[0];
    const best = recommendFills({
      length: run.length,
      height: 300,
      faces: run.faces,
      materials,
      filters: { fewer300: true },
    }).variants[0];
    expect(best.stack).toEqual([150, 150]);

    const choice = choiceFromVariant(best);
    const plan = planSketchFillAll(
      paths,
      { ...spec, stack: choice.stack, choices: { [run.key]: choice.sequences } },
      materials,
    );
    expect(new Set(plan.pieces.map((p) => p.z))).toEqual(new Set([0, 150]));
    expect(plan.pieces.every((p) => byId.get(p.materialId)!.h === 150)).toBe(true);
    expect(faces(plan.pieces, 0)).toEqual([asWidths(best, 0), asWidths(best, 0)]);
    expect(faces(plan.pieces, 150)).toEqual([asWidths(best, 1), asWidths(best, 1)]);
    expect(plan.summary.courses).toBe(2);
  });

  it('ignores a stack that does not make the height', () => {
    const plan = planSketchFillAll(wall(), { ...spec, stack: [150] }, materials);
    expect(plan.summary.courses).toBe(1);
    expect(new Set(plan.pieces.map((p) => byId.get(p.materialId)!.h))).toEqual(new Set([300]));
  });
});

describe('applyFillVariants', () => {
  beforeEach(() => {
    const paths = wall();
    const doc: DrawingDoc = {
      id: 'd',
      name: 'd',
      updatedAt: 1,
      projectName: '',
      revision: 'A',
      scale: 50,
      pieces: [],
      sketch: paths,
      measures: [],
    };
    useEditorStore.setState({
      materials,
      documents: [doc],
      activeDocId: 'd',
      pieces: [],
      sketch: paths,
      measures: [],
      past: [],
      future: [],
    });
  });

  it('places the picked variant as one undoable step', () => {
    const s = useEditorStore.getState();
    const pathIds = s.sketch.map((k) => k.id);
    const run = planSketchFillAll(s.sketch, spec, materials).runs[0];
    const picked = recommendFills({ length: run.length, height: 300, faces: 2, materials }).variants[1];

    const result = s.applyFillVariants(pathIds, spec, [{ runKey: run.key, variant: picked }]);
    let after = useEditorStore.getState();
    expect(result.added).toBe(picked.pieces);
    expect(faces(after.pieces)).toEqual([asWidths(picked), asWidths(picked)]);
    expect(after.documents[0].pieces).toHaveLength(picked.pieces);

    after.undo();
    after = useEditorStore.getState();
    expect(after.pieces).toEqual([]);
  });
});
