import { describe, expect, it } from 'vitest';
import { normalizeWallThickness, wallPartner } from '../wallPen';
import { planSketchFillAll } from '../sketchFill';
import { lineStatuses } from '../problems';
import { SCENARIOS } from './scenarios';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { SketchPath } from '../../types';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

describe('wallPartner - one line drawn, both faces of the wall', () => {
  it('puts the other face of a straight wall on the concrete side, facing away', () => {
    const near: SketchPath = { id: 'near', points: [{ x: 0, y: 0 }, { x: 490, y: 0 }], perimeter: 'outer' };
    const far = wallPartner(near, 20);
    expect(far.points).toEqual([{ x: 0, y: 20 }, { x: 490, y: 20 }]);
    expect(far.perimeter).toBe('inner');

    // The two are panelled as a matched pair, and both read ცდომილება 0.
    const plan = planSketchFillAll([near, far], { height: 300, includeCorners: true }, materials);
    expect(plan.runs).toHaveLength(1);
    expect(plan.runs[0].faces).toBe(2);
    expect([...lineStatuses([near, far], plan.pieces, byId).values()]).toEqual(['ok', 'ok']);
  });

  it('turns corners the way a wall does - exactly the drawn L wall of the scenarios', () => {
    const scenario = SCENARIOS.find((s) => s.name === 'l-wall-east-then-south')!;
    const [near, far] = scenario.paths;
    expect(wallPartner(near, 20).points).toEqual(far.points);
  });

  it('draws single lines unless a real wall thickness is set', () => {
    expect(normalizeWallThickness(20)).toBe(20);
    expect(normalizeWallThickness('25')).toBe(25);
    expect(normalizeWallThickness(null)).toBeNull();
    expect(normalizeWallThickness(2)).toBeNull();
    expect(normalizeWallThickness(500)).toBeNull();
    expect(normalizeWallThickness('abc')).toBeNull();
  });
});
