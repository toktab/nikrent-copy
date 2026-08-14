import { describe, expect, it } from 'vitest';
import type { Material, Piece } from '../../types';
import { createSeedMaterials } from '../../data/seedCatalog';
import { pieceBounds, planW, type Rect } from '../geometry';
import { planSketchFillAll } from '../sketchFill';
import { SCENARIOS } from './scenarios';

/**
 * Every shape a real job contains, held to the statements that make formwork
 * buildable — see `scenarios.ts` for the layouts and what each should produce.
 *
 * The checks here are deliberately side-INDEPENDENT. They do not ask the fill
 * which side it decided was outside and then agree with it; they ask questions
 * a foreman could answer with a tape on the slab, so a wrong decision about the
 * side cannot satisfy them.
 */

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));
const SPEC = { height: 300, includeCorners: true };

const matOf = (p: Piece): Material => {
  const m = byId.get(p.materialId);
  if (!m) throw new Error(`unknown material ${p.materialId}`);
  return m;
};
const faces = (pieces: Piece[]) =>
  pieces.filter((p) => ['panel', 'filler', 'corner'].includes(matOf(p).category));

const shared = (a: Rect, b: Rect) => {
  const w = Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x);
  const h = Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y);
  return w > 0.01 && h > 0.01;
};

const plans = SCENARIOS.map((s) => ({ s, plan: planSketchFillAll(s.paths, SPEC, materials) }));

describe.each(plans)('$s.name', ({ s, plan }) => {
  it('plans without throwing and says what it did', () => {
    expect(plan.pieces).toBeInstanceOf(Array);
    expect(plan.openings.every((o) => o.cm > 0 && Number.isFinite(o.cm))).toBe(true);
  });

  /**
   * No drawn line may pass THROUGH a piece.
   *
   * The strongest thing that can be said without taking a view on which side is
   * concrete: whichever side that is, a panel straddling the face is half in
   * the pour, and no arrangement of sides makes that buildable.
   */
  it('never lets a face line cut through a piece', () => {
    const cut: string[] = [];
    for (const piece of faces(plan.pieces)) {
      const b = pieceBounds(piece, matOf(piece));
      for (const path of s.paths) {
        const pts = path.points;
        const legs = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
        for (let i = 0; i < legs; i++) {
          const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
          const across = Math.abs(p.y - q.y) < 0.01;
          const at = across ? p.y : p.x;
          const lo = across ? Math.min(p.x, q.x) : Math.min(p.y, q.y);
          const hi = across ? Math.max(p.x, q.x) : Math.max(p.y, q.y);
          // Strictly inside the piece on the perpendicular axis, and genuinely
          // alongside it on the other — a line touching an edge is a panel
          // standing correctly ON the face.
          const through = across
            ? at > b.y + 0.01 && at < b.y + b.h - 0.01 && b.x < hi - 0.01 && b.x + b.w > lo + 0.01
            : at > b.x + 0.01 && at < b.x + b.w - 0.01 && b.y < hi - 0.01 && b.y + b.h > lo + 0.01;
          if (through) cut.push(`${matOf(piece).name} cut by leg ${i}`);
        }
      }
    }
    expect(cut).toEqual([]);
  });

  it('orders nothing twice for the same place', () => {
    const boxes = faces(plan.pieces).map((p) => ({ z: p.z ?? 0, b: pieceBounds(p, matOf(p)) }));
    const hits: string[] = [];
    for (let i = 0; i < boxes.length; i++) {
      for (let j = i + 1; j < boxes.length; j++) {
        if (boxes[i].z !== boxes[j].z) continue;
        if (shared(boxes[i].b, boxes[j].b)) hits.push(`${i}/${j}`);
      }
    }
    expect(hits).toEqual([]);
  });

  /**
   * Every centimetre of drawn face is either covered or reported.
   *
   * A shortfall is formwork missing from a delivery; a surplus is pieces that
   * will not fit. Counted over one course, with an inner profile covering its
   * 20 cm reach on each of the two faces it closes.
   */
  it('accounts for every centimetre it was given', () => {
    const course = plan.pieces.filter((p) => (p.z ?? 0) === 0);
    const laid = course
      .filter((p) => matOf(p).category !== 'corner')
      .reduce((sum, p) => sum + planW(matOf(p)), 0);
    const profiles = course.filter((p) => matOf(p).category === 'corner').length;
    const open = plan.openings.reduce((sum, o) => sum + o.cm, 0);
    const drawn = s.paths.reduce((total, path) => {
      const pts = path.points;
      const legs = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
      let sum = 0;
      for (let i = 0; i < legs; i++) {
        const [p, q] = [pts[i], pts[(i + 1) % pts.length]];
        sum += Math.abs(q.x - p.x) + Math.abs(q.y - p.y);
      }
      return total + sum;
    }, 0);
    expect(Math.abs(drawn - (laid + profiles * 40 + open))).toBeLessThan(0.5);
  });
});
