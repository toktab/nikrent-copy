import { describe, expect, it } from 'vitest';
import { findProblems, lineStatuses } from '../problems';
import { planSketchFillAll } from '../sketchFill';
import { pieceBounds } from '../geometry';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Material, Piece, SketchPath } from '../../types';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

const WALL: SketchPath[] = [
  { id: 'near', points: [{ x: 0, y: 0 }, { x: 490, y: 0 }], perimeter: 'outer' },
  { id: 'far', points: [{ x: 0, y: 20 }, { x: 490, y: 20 }], perimeter: 'inner' },
];
const fill = (height = 300) => planSketchFillAll(WALL, { height, includeCorners: true }, materials).pieces;

/** A panel standing on the near face. */
const nearPanel = (pieces: Piece[]) =>
  pieces.find((p) => byId.get(p.materialId)!.category === 'panel' && pieceBounds(p, byId.get(p.materialId)!).y < 0)!;

describe('findProblems - one list of everything wrong', () => {
  it('finds nothing on a wall the fill laid, and colours both lines done', () => {
    const report = findProblems({ materials, pieces: fill(), sketch: WALL });
    expect(report.problems).toEqual([]);
    expect([...report.lines.values()]).toEqual(['ok', 'ok']);
  });

  it('reports a missing panel on its own line, at the segment, as an error', () => {
    const pieces = fill();
    const gone = nearPanel(pieces);
    const report = findProblems({ materials, pieces: pieces.filter((p) => p.id !== gone.id), sketch: WALL });

    const length = report.problems.filter((p) => p.kind === 'length');
    expect(length).toHaveLength(1);
    expect(length[0]).toMatchObject({ severity: 'error', pathId: 'near', at: { y: 0 } });
    expect(length[0].detail).toContain('აკლია');
    // The hole is the line's own finding, not a second "gap".
    expect(report.problems.some((p) => p.kind === 'gap')).toBe(false);
    expect(report.lines.get('near')).toBe('bad');
    expect(report.lines.get('far')).toBe('ok');
    expect(report.errors).toBe(1);
  });

  it('flags a line with nothing on it as a warning', () => {
    const lonely: SketchPath = { id: 'lonely', points: [{ x: 0, y: 400 }, { x: 300, y: 400 }] };
    const report = findProblems({ materials, pieces: fill(), sketch: [...WALL, lonely] });
    expect(report.problems).toEqual([expect.objectContaining({ kind: 'empty', severity: 'warning', pathId: 'lonely' })]);
    expect(report.lines.get('lonely')).toBe('empty');
  });

  it('groups pieces placed on top of each other, but not a course standing on a course', () => {
    const pieces = fill();
    const copy = { ...nearPanel(pieces), id: 'copy' };
    const report = findProblems({ materials, pieces: [...pieces, copy], sketch: WALL });
    const overlap = report.problems.filter((p) => p.kind === 'overlap');
    expect(overlap).toHaveLength(1);
    expect(overlap[0].pieceIds).toContain('copy');

    const stacked = findProblems({ materials, pieces: fill(450), sketch: WALL });
    expect(stacked.problems.filter((p) => p.kind === 'overlap')).toEqual([]);
  });

  it('measures a hole between pieces that no line accounts for, and names what closes it', () => {
    const panel = (id: string, x: number): Piece => ({ id, materialId: 'panel-90x300', x, y: 0, rot: 0, z: 0 });
    const report = findProblems({ materials, pieces: [panel('a', 0), panel('b', 120)], sketch: [] });
    const gap = report.problems.find((p) => p.kind === 'gap')!;
    expect(gap.detail).toContain('30 სმ');
    expect(gap.detail).toContain('პანელი 30*300');
    expect(gap.at).toMatchObject({ x: 105 });
  });

  it('lists shortages only once stock has been entered', () => {
    expect(findProblems({ materials, pieces: fill(), sketch: WALL }).problems).toEqual([]);

    const stocked: Material[] = materials.map((m) => (m.id === 'panel-90x300' ? { ...m, stock: { main: 1 } } : m));
    const report = findProblems({ materials: stocked, pieces: fill(), sketch: WALL });
    expect(report.problems.find((p) => p.materialId === 'panel-90x300')).toMatchObject({
      kind: 'shortage',
      severity: 'warning',
    });
  });

  it('gives the canvas the same colours on their own', () => {
    const pieces = fill();
    expect([...lineStatuses(WALL, pieces, byId).values()]).toEqual(['ok', 'ok']);
    expect(lineStatuses(WALL, [], byId).get('near')).toBe('empty');
  });
});
