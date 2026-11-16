import { describe, expect, it } from 'vitest';
import { instantiate, templateCounts, type Template } from '../templates';

const tpl: Template = {
  id: 'tpl_a',
  name: 'კოლონა 60×60',
  pieces: [
    { id: 'p1', materialId: 'panel-60x300', x: 0, y: 0, rot: 0 },
    { id: 'p2', materialId: 'panel-60x300', x: 70, y: 0, rot: 90 },
  ],
  sketch: [{ id: 'k1', points: [{ x: 0, y: 0 }, { x: 60, y: 0 }], closed: false } as never],
  width: 80,
  height: 70,
  price: 250,
};

describe('templates - one drop is one unit of the set', () => {
  it('tags every piece of a drop with the template and one shared instance', () => {
    const a = instantiate(tpl, 100, 200);
    expect(a.pieces.every((p) => p.tpl === 'tpl_a')).toBe(true);
    expect(new Set(a.pieces.map((p) => p.tplInst)).size).toBe(1);
    expect(a.pieces[0]).toMatchObject({ x: 100, y: 200 });
    expect(a.sketch[0].points[0]).toEqual({ x: 100, y: 200 });
  });

  it('counts drops, not pieces', () => {
    const one = instantiate(tpl, 0, 0).pieces;
    const two = instantiate(tpl, 300, 0).pieces;
    const loose = { id: 'x', materialId: 'panel-60x300', x: 0, y: 0, rot: 0 };
    expect(templateCounts([...one, ...two, loose]).get('tpl_a')).toBe(2);
    // a drop with one piece deleted is still there
    expect(templateCounts([one[0], ...two]).get('tpl_a')).toBe(2);
  });
});

import { sameTemplate } from '../templates';
import { SEED_MATERIALS } from '../../data/seedCatalog';

describe('the same template twice', () => {
  const byId = new Map(SEED_MATERIALS.map((m) => [m.id, m]));
  it('is found wherever the copy stands; a different layout is not', () => {
    const copy = instantiate(tpl, 500, 120).pieces;
    expect(sameTemplate(copy, byId, [tpl])?.name).toBe('კოლონა 60×60');
    const moved = copy.map((p, i) => (i === 1 ? { ...p, x: p.x + 5 } : p));
    expect(sameTemplate(moved, byId, [tpl])).toBeNull();
  });
});
