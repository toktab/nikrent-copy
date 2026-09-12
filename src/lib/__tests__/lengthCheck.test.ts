import { describe, expect, it } from 'vitest';
import { checkPath, type PathCheck } from '../lengthCheck';
import { planSketchFillAll, type SketchFillSpec } from '../sketchFill';
import { pieceBounds, planW } from '../geometry';
import { createSeedMaterials } from '../../data/seedCatalog';
import { SCENARIOS } from './scenarios';
import type { Piece, SketchPath } from '../../types';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));
const SPEC: SketchFillSpec = { height: 300, includeCorners: true };

const fill = (paths: SketchPath[], spec = SPEC) => planSketchFillAll(paths, spec, materials);

const faces = (check: PathCheck) => check.courses.flatMap((c) => c.faces);

/** The architect's own example: a 4.90 m wall, both faces, 20 thick. */
const WALL: SketchPath[] = [
  { id: 'near', points: [{ x: 0, y: 0 }, { x: 490, y: 0 }], perimeter: 'outer' },
  { id: 'far', points: [{ x: 0, y: 20 }, { x: 490, y: 20 }], perimeter: 'inner' },
];

/** A panel standing on the near face (above y = 0, where the air is). */
const nearPanel = (pieces: Piece[]) =>
  pieces.find((p) => {
    const m = byId.get(p.materialId)!;
    return m.category === 'panel' && pieceBounds(p, m).y < 0;
  })!;

describe('checkPath - ცდომილება', () => {
  it('reads 0 on a run the fill laid, on both faces of the wall', () => {
    const plan = fill(WALL);
    for (const path of WALL) {
      const check = checkPath(path, WALL, plan.pieces, byId);
      expect(check.ok).toBe(true);
      expect(check.courses).toHaveLength(1);
      const [face] = faces(check);
      expect(face).toMatchObject({ length: 490, required: 490, sum: 490, error: 0, gaps: [], overlaps: [] });
    }
  });

  it('reads −w and names the hole when a panel is taken away', () => {
    const plan = fill(WALL);
    const gone = nearPanel(plan.pieces);
    const w = planW(byId.get(gone.materialId)!);
    const pieces = plan.pieces.filter((p) => p.id !== gone.id);

    const [near] = faces(checkPath(WALL[0], WALL, pieces, byId));
    expect(near.error).toBe(-w);
    expect(near.ok).toBe(false);
    expect(near.gaps.reduce((sum, g) => sum + g.cm, 0)).toBe(w);
    // The other face is untouched.
    expect(checkPath(WALL[1], WALL, pieces, byId).ok).toBe(true);
  });

  it('reads +5 when a 5 cm filler is put down on top of the run', () => {
    const plan = fill(WALL);
    const under = pieceBounds(nearPanel(plan.pieces), byId.get(nearPanel(plan.pieces).materialId)!);
    const extra: Piece = { id: 'extra', materialId: 'filler-5x300', x: under.x, y: under.y, rot: 0, z: 0 };

    const [near] = faces(checkPath(WALL[0], WALL, [...plan.pieces, extra], byId));
    expect(near.error).toBe(5);
    expect(near.overlaps).toEqual([expect.objectContaining({ cm: 5 })]);
    expect(near.ok).toBe(false);
  });

  it('checks every course of a stacked pour on its own', () => {
    const plan = fill(WALL, { height: 450, includeCorners: true });
    const check = checkPath(WALL[0], WALL, plan.pieces, byId);
    expect(check.courses.map((c) => c.z)).toEqual([0, 300]);
    expect(check.ok).toBe(true);

    // Take a panel out of the upper course only: the lower one still reads 0.
    const upper = plan.pieces.find((p) => (p.z ?? 0) === 300 && byId.get(p.materialId)!.category === 'panel' && pieceBounds(p, byId.get(p.materialId)!).y < 0)!;
    const broken = checkPath(WALL[0], WALL, plan.pieces.filter((p) => p.id !== upper.id), byId);
    expect(broken.courses.map((c) => c.ok)).toEqual([true, false]);
  });

  it('reports an outside corner as open, not as an error, and counts the inside profile', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'l-wall-east-then-south')!;
    const plan = fill(scenario.paths);
    const [near, far] = scenario.paths.map((p) => checkPath(p, scenario.paths, plan.pieces, byId));

    expect(near.ok).toBe(true);
    // Its own 20 cm set-back plus the 20 cm given up to line up with the inner face.
    expect(faces(near).flatMap((f) => f.openCorners)).toEqual([40, 40]);

    expect(far.ok).toBe(true);
    expect(faces(far).flatMap((f) => f.openCorners)).toEqual([]);
    expect(faces(far).flatMap((f) => f.parts.map((p) => p.label))).toContain('კუთხე 20');
  });

  it('accepts an outside corner closed by hand, and still catches a piece past the corner', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'l-wall-east-then-south')!;
    const plan = fill(scenario.paths);
    const near = scenario.paths[0];
    // The near face's first leg: y = 0, panels above it, 40 cm left open at the
    // outside corner at x = 600 - the run stops at 560.
    const leg0 = (pieces: Piece[]) => checkPath(near, scenario.paths, pieces, byId).courses[0].faces[0];

    // A filler run on into the corner closes part of the hole: not an error.
    const closer: Piece = { id: 'closer', materialId: 'filler-10x300', x: 560, y: -9, rot: 0, z: 0 };
    expect(leg0([...plan.pieces, closer])).toMatchObject({ ok: true, error: 0, openCorners: [30] });

    // A panel carried on past the corner is too long by what sticks out.
    const past: Piece = { id: 'past', materialId: 'panel-90x300', x: 560, y: -9, rot: 0, z: 0 };
    const over = leg0([...plan.pieces, past]);
    expect(over.ok).toBe(false);
    expect(over.error).toBe(50);
  });

  it('says nothing about a line nobody has put anything on', () => {
    expect(checkPath(WALL[0], WALL, [], byId)).toMatchObject({ courses: [], ok: true });
  });

  it('agrees with the fill on every scenario a real job contains', () => {
    const failures: string[] = [];
    for (const scenario of SCENARIOS) {
      const plan = fill(scenario.paths);
      // Where the catalog could not close something the fill says so itself;
      // there the check may find the same hole, but never a piece too many.
      const exact = !plan.openings.some((o) => o.kind === 'short');
      for (const path of scenario.paths) {
        for (const face of faces(checkPath(path, scenario.paths, plan.pieces, byId))) {
          const tooLong = face.error > 0.5 || face.overlaps.length > 0;
          if (tooLong || (exact && !face.ok)) {
            failures.push(
              `${scenario.name} / ${path.id} leg ${face.leg}: error ${face.error}, ` +
                `gaps ${JSON.stringify(face.gaps)}, overlaps ${JSON.stringify(face.overlaps)}, ` +
                `open ${JSON.stringify(face.openCorners)}, parts ${face.parts.map((p) => `${p.label}×${p.count}`).join(' ')}`,
            );
          }
        }
      }
    }
    expect(failures, failures.slice(0, 6).join('\n')).toEqual([]);
  });
});
