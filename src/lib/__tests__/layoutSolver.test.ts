import { describe, expect, it } from 'vitest';
import { joinLines, solveLayout, type LayoutFilters, type LayoutVariant } from '../layoutSolver';
import { checkPath } from '../lengthCheck';
import { pieceBounds } from '../geometry';
import { connectedLines } from '../sketch';
import { enclosed, legsForOffset, offsetFace, offsetSide, panelSide, piecesOnLines } from '../outerLines';
import { createSeedMaterials } from '../../data/seedCatalog';
import type { Piece, SketchPath } from '../../types';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

/**
 * The architect's own job, "ნახაზი 1" (exported/du-layout-2026-10-14-corrected.json):
 * an inner rectangle, and an outer one drawn in two strokes round it. The wall
 * is 20 thick at the top and right, 15 at the left, 10 at the bottom.
 */
const INNER: SketchPath = {
  id: 'inner',
  points: [
    { x: 100, y: 100 },
    { x: 455, y: 100 },
    { x: 455, y: 270 },
    { x: 110, y: 270 },
    { x: 100, y: 270 },
    { x: 100, y: 240 },
  ],
  closed: true,
  perimeter: 'outer',
};
const OUTER_TOP: SketchPath = { id: 'outer-top', points: [{ x: 100, y: 80 }, { x: 455, y: 80 }], perimeter: 'outer' };
const OUTER_REST: SketchPath = {
  id: 'outer-rest',
  points: [
    { x: 455, y: 80 },
    { x: 475, y: 80 },
    { x: 475, y: 280 },
    { x: 85, y: 280 },
    { x: 85, y: 125 },
    { x: 85, y: 80 },
    { x: 100, y: 80 },
  ],
  perimeter: 'outer',
};
const JOB = [INNER, OUTER_TOP, OUTER_REST];

/** What he placed by hand: material, x, y, rot. */
const HIS: Array<[string, number, number, number]> = [
  ['C', 435, 100, 180], ['C', 435, 250, 270], ['C', 100, 250, 0], ['C', 100, 100, 90],
  ['P90', 120, 100, 0], ['P90', 210, 100, 0], ['P90', 300, 100, 0], ['P45', 390, 100, 0],
  ['P90', 120, 71, 0], ['P90', 210, 71, 0], ['P90', 300, 71, 0], ['P45', 390, 71, 0],
  ['P45', 75, 71, 0], ['P45', 58, 98, 90], ['F5', 102, 118, 90], ['P45', 58, 263, 90],
  ['F5', 102, 243, 90], ['P60', 50.5, 150.5, 90], ['P60', 50.5, 210.5, 90], ['P60', 74.5, 150.5, 90],
  ['P60', 74.5, 210.5, 90], ['P45', 85, 280, 0], ['F10', 120, 261, 0], ['P45', 457, 263, 90],
  ['P45', 430, 280, 0], ['F5', 430, 261, 0], ['P90', 130, 280, 0], ['P90', 220, 280, 0],
  ['P90', 340, 280, 0], ['P30', 310, 280, 0], ['P90', 130, 261, 0], ['P90', 220, 261, 0],
  ['P90', 340, 261, 0], ['P30', 310, 261, 0], ['P60', 435, 71, 0], ['P45', 457, 98, 90],
  ['F5', 448, 118, 90], ['F5', 448, 243, 90], ['P60', 449.5, 150.5, 90], ['P60', 449.5, 210.5, 90],
  ['P60', 420.5, 150.5, 90], ['P60', 420.5, 210.5, 90],
];
const material = (code: string) =>
  code === 'C'
    ? 'corner-inner-20x20x300-joni'
    : code.startsWith('P')
      ? `panel-${code.slice(1)}x300`
      : `filler-${code.slice(1)}x300`;
const hisPieces: Piece[] = HIS.map(([code, x, y, rot], i) => ({ id: `his${i}`, materialId: material(code), x, y, rot, z: 0 }));

const solve = (paths: SketchPath[], filters: Partial<LayoutFilters> = {}, pieces: Piece[] = []) =>
  solveLayout({ paths, height: 300, includeCorners: true, materials, pieces, filters });

const allOk = (paths: SketchPath[], pieces: Piece[]) =>
  paths.map((p) => checkPath(p, paths, pieces, byId)).every((c) => c.ok && c.courses.length > 0);

/** Pairs of pieces whose footprints overlap by more than half a centimetre. */
function overlaps(pieces: Piece[]): number {
  const boxes = pieces.map((p) => ({ z: p.z ?? 0, b: pieceBounds(p, byId.get(p.materialId)!) }));
  let n = 0;
  for (let i = 0; i < boxes.length; i++) {
    for (let j = i + 1; j < boxes.length; j++) {
      const a = boxes[i];
      const c = boxes[j];
      if (a.z !== c.z) continue;
      const w = Math.min(a.b.x + a.b.w, c.b.x + c.b.w) - Math.max(a.b.x, c.b.x);
      const h = Math.min(a.b.y + a.b.h, c.b.y + c.b.h) - Math.max(a.b.y, c.b.y);
      if (w > 0.5 && h > 0.5) n++;
    }
  }
  return n;
}

const fillersBetweenPanels = (v: LayoutVariant) => v.nianguri;

describe('joinLines', () => {
  it('joins a face drawn in two strokes into the closed line it is', () => {
    const chains = joinLines([OUTER_TOP, OUTER_REST]);
    expect(chains).toHaveLength(1);
    expect(chains[0].path.closed).toBe(true);
    expect(chains[0].sources.sort()).toEqual(['outer-rest', 'outer-top']);
  });

  it('leaves three lines meeting at a point alone', () => {
    const a: SketchPath = { id: 'a', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }] };
    const b: SketchPath = { id: 'b', points: [{ x: 100, y: 0 }, { x: 200, y: 0 }] };
    const c: SketchPath = { id: 'c', points: [{ x: 100, y: 0 }, { x: 100, y: 100 }] };
    expect(joinLines([a, b, c])).toHaveLength(3);
  });
});

describe("the architect's job", { timeout: 20000 }, () => {
  it('his own layout checks clean - lapped corners and all', () => {
    expect(allOk(JOB, hisPieces)).toBe(true);
  });

  it('gives exactly his layout as #1', () => {
    const footprint = (p: Piece) => {
      const m = byId.get(p.materialId)!;
      const b = pieceBounds(p, m);
      // His corner profiles are the ჯონი ones; any inner profile is the same part.
      const kind = m.category === 'corner' ? 'corner' : p.materialId;
      return `${kind}@${Math.round(b.x)},${Math.round(b.y)},${Math.round(b.w)},${Math.round(b.h)}`;
    };
    const best = solve(JOB).variants[0];
    // He placed by hand and some pieces sit half a centimetre off; rounding
    // brings both to the same whole centimetres.
    expect(best.add.map(footprint).sort()).toEqual(hisPieces.map(footprint).sort());
  });

  it('is solved with every corner closed, both faces matched, and as many pieces as he used', () => {
    const { variants } = solve(JOB);
    expect(variants.length).toBeGreaterThan(1);
    const best = variants[0];
    expect(best.openCm).toBe(0);
    expect(best.unmatched).toBe(0);
    expect(fillersBetweenPanels(best)).toBe(0);
    expect(best.corners).toBe(4);
    expect(best.panels + best.fillers).toBe(38);
    expect(overlaps(best.add)).toBe(0);
    expect(allOk(JOB, best.add)).toBe(true);
    expect(best.walls).toHaveLength(4);
    expect(best.walls.every((w) => w.faces.length === 2)).toBe(true);
  });

  it('every variant it lists is buildable', () => {
    for (const v of solve(JOB).variants) {
      expect(overlaps(v.add)).toBe(0);
      expect(allOk(JOB, v.add)).toBe(true);
    }
  });

  it('the old way, corners open, still leaves them open', () => {
    const best = solve(JOB, { outerCorners: 'open' }).variants[0];
    expect(best.openCm).toBeGreaterThan(0);
    expect(overlaps(best.add)).toBe(0);
  });

  it('builds round his pieces when they are kept, and adds nothing where he already has', () => {
    const best = solve(JOB, { keepPlaced: true }, hisPieces).variants[0];
    expect(best?.add.length ?? 0).toBe(0);
    expect(best?.remove.length ?? 0).toBe(0);
  });

  it('replaces his pieces when they are not kept', () => {
    const best = solve(JOB, { keepPlaced: false }, hisPieces).variants[0];
    expect(best.remove.sort()).toEqual(hisPieces.map((p) => p.id).sort());
    expect(overlaps(best.add)).toBe(0);
  });
});

describe('one line', () => {
  const LINE: SketchPath = { id: 'l', points: [{ x: 0, y: 0 }, { x: 1000, y: 0 }] };

  it('is exact unless crossing its ends is allowed', () => {
    const exact = solve([LINE]).variants[0];
    const sum = exact.add.reduce((s, p) => s + byId.get(p.materialId)!.w, 0);
    expect(sum).toBe(1000);
    expect(exact.overhang).toBe(0);
  });

  it('runs past the end it may cross instead of taking a filler', () => {
    const v = solve([LINE], { overhangEnds: 'end', maxOverhang: 45 }).variants[0];
    expect(v.fillers).toBe(0);
    const xs = v.add.map((p) => pieceBounds(p, byId.get(p.materialId)!));
    expect(Math.min(...xs.map((b) => b.x))).toBe(0);
    expect(Math.max(...xs.map((b) => b.x + b.w))).toBeGreaterThan(1000);
    expect(Math.max(...xs.map((b) => b.x + b.w))).toBeLessThanOrEqual(1045);
  });

  it('runs past the start only when only the start may be crossed', () => {
    const v = solve([LINE], { overhangEnds: 'start', maxOverhang: 45 }).variants[0];
    const xs = v.add.map((p) => pieceBounds(p, byId.get(p.materialId)!));
    expect(Math.min(...xs.map((b) => b.x))).toBeLessThan(0);
    expect(Math.max(...xs.map((b) => b.x + b.w))).toBe(1000);
  });

  it('puts a ჩ5 against the end of the run, not between two panels (A5)', () => {
    const line: SketchPath = { id: 'l5', points: [{ x: 0, y: 0 }, { x: 545, y: 0 }] };
    const v = solve([line]).variants[0];
    expect(v.fillers).toBe(1);
    expect(v.nianguri).toBe(0);
    const parts = v.walls[0].faces[0].parts;
    expect(['ჩ5'].includes(parts[0]) || parts[parts.length - 1] === 'ჩ5').toBe(true);
  });

  it('keeps a panel placed by hand and builds the rest round it', () => {
    const mine: Piece = { id: 'mine', materialId: 'panel-60x300', x: 300, y: -9, rot: 0, z: 0 };
    const v = solve([LINE], { keepPlaced: true }, [mine]).variants[0];
    expect(v.remove).toEqual([]);
    expect(overlaps([...v.add, mine])).toBe(0);
    expect(allOk([LINE], [...v.add, mine])).toBe(true);

    const replaced = solve([LINE], { keepPlaced: false }, [mine]).variants[0];
    expect(replaced.remove).toEqual(['mine']);
  });
});

describe('an L-shaped wall, both faces', { timeout: 20000 }, () => {
  // Outer face round the outside of an L, inner face 20 cm in.
  const OUT: SketchPath = { id: 'out', points: [{ x: 0, y: 0 }, { x: 600, y: 0 }, { x: 600, y: 400 }], perimeter: 'outer' };
  const IN: SketchPath = { id: 'in', points: [{ x: 0, y: 20 }, { x: 580, y: 20 }, { x: 580, y: 400 }], perimeter: 'inner' };

  it('laps the outside corner and matches the faces', () => {
    const best = solve([OUT, IN]).variants[0];
    expect(best.unmatched).toBe(0);
    expect(overlaps(best.add)).toBe(0);
    expect(allOk([OUT, IN], best.add)).toBe(true);
  });
});

describe('connectedLines - Shift + click', () => {
  it('picks up a face drawn in two strokes, and not the face across the wall', () => {
    expect(connectedLines(JOB, 'outer-top')).toEqual(['outer-top', 'outer-rest']);
    expect(connectedLines(JOB, 'inner')).toEqual(['inner']);
  });

  it('follows a chain, and a wall hung off the side of another', () => {
    const a: SketchPath = { id: 'a', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] };
    const b: SketchPath = { id: 'b', points: [{ x: 150, y: 0 }, { x: 150, y: 200 }] };
    const c: SketchPath = { id: 'c', points: [{ x: 150, y: 200 }, { x: 400, y: 200 }] };
    const d: SketchPath = { id: 'd', points: [{ x: 0, y: 500 }, { x: 100, y: 500 }] };
    expect(connectedLines([a, b, c, d], 'c')).toEqual(['a', 'b', 'c']);
  });
});

describe('the outer line, made from the built inner one', () => {
  const innerOnly = hisPieces.filter((p) => {
    const b = pieceBounds(p, byId.get(p.materialId)!);
    // Inside the inner rectangle: his inner faces and the four profiles.
    return b.x >= 100 - 0.5 && b.x + b.w <= 455 + 0.5 && b.y >= 100 - 0.5 && b.y + b.h <= 270 + 0.5;
  });

  it('is his outer line, a different distance on each side', () => {
    const side = panelSide(INNER, [INNER], innerOnly, materials);
    expect(legsForOffset(INNER, side).map((l) => l.towards)).toEqual(['up', 'right', 'down', 'left']);
    const outer = offsetFace(INNER, side, [20, 20, 10, 15])!;
    expect(outer.closed).toBe(true);
    expect(outer.perimeter).toBe('outer');
    const xs = outer.points.map((p) => p.x);
    const ys = outer.points.map((p) => p.y);
    expect([Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)]).toEqual([85, 475, 80, 280]);
  });

  it('and filled round his inner face, gives his outer face', () => {
    const side = panelSide(INNER, [INNER], innerOnly, materials);
    const outer = offsetFace(INNER, side, [20, 20, 10, 15])!;
    const best = solve([outer, INNER], { keepPlaced: true }, innerOnly).variants[0];
    const outerHis = hisPieces.filter((p) => !innerOnly.includes(p));
    const key = (p: Piece) => {
      const b = pieceBounds(p, byId.get(p.materialId)!);
      return `${p.materialId}@${Math.round(b.x)},${Math.round(b.y)}`;
    };
    expect(best.remove).toEqual([]);
    expect(best.add.map(key).sort()).toEqual(outerHis.map(key).sort());
  });

  it('Shift + click picks up the panels standing on the line', () => {
    const on = piecesOnLines([INNER], hisPieces, materials);
    expect(on.sort()).toEqual(innerOnly.map((p) => p.id).sort());
  });

  it('a closed line knows what is inside it', () => {
    const outer = offsetFace(INNER, panelSide(INNER, [INNER], innerOnly, materials), [20, 20, 10, 15])!;
    const found = enclosed(outer, [INNER, outer], hisPieces, materials);
    expect(found.lines).toEqual(['inner']);
    expect(found.pieces).toBeGreaterThan(0);
  });
});

describe('making a line გარე or შიდა of the one picked', () => {
  const box = (p: SketchPath) => {
    const xs = p.points.map((q) => q.x);
    const ys = p.points.map((q) => q.y);
    return [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  };

  it('გარე goes outside the loop and შიდა inside, whichever side the panels are on', () => {
    for (const panels of [1, -1] as const) {
      const out = offsetFace(INNER, offsetSide(INNER, panels, 'outer'), [20], 'outer')!;
      const inn = offsetFace(INNER, offsetSide(INNER, panels, 'inner'), [20], 'inner')!;
      expect(box(out)).toEqual([80, 475, 80, 290]);
      expect(box(inn)).toEqual([120, 435, 120, 250]);
      expect(out.perimeter).toBe('outer');
      expect(inn.perimeter).toBe('inner');
    }
  });

  it('the same, drawn the other way round', () => {
    const reversed: SketchPath = { ...INNER, points: [...INNER.points].reverse() };
    const out = offsetFace(reversed, offsetSide(reversed, 1, 'outer'), [20])!;
    expect(box(out)).toEqual([80, 475, 80, 290]);
  });

  it('an open line: გარე is out past its panels', () => {
    const line: SketchPath = { id: 'o', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }] };
    const panel: Piece = { id: 'p', materialId: 'panel-90x300', x: 0, y: -9, rot: 0, z: 0 };
    const side = panelSide(line, [line], [panel], materials);
    const out = offsetFace(line, offsetSide(line, side, 'outer'), [20])!;
    expect(out.points.every((p) => p.y === -20)).toBe(true);
  });
});

describe('a შიდა line with its own panels inside it', () => {
  it('is not taken for an outer line', () => {
    const room: SketchPath = { ...INNER, perimeter: 'inner' };
    const own = hisPieces.filter((p) => piecesOnLines([INNER], [p], materials).length > 0);
    const found = enclosed(room, [room], own, materials);
    expect(found).toEqual({ lines: [], pieces: 0 });
  });
});
