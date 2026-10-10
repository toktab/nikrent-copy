import type { MeasureLine, SketchPath } from '../types';

/**
 * Resizing a whole drawn layout to the size it really is.
 *
 * A layout traced off a PDF, or imported from detection, has the right shape
 * at the wrong size - the scale was a guess, or the sheet was cropped before
 * anybody printed it. Correcting that wall by wall is work; the architect
 * usually knows one number for the whole thing ("the building is 58 metres
 * across"), and everything else follows from it.
 *
 * Uniform on purpose. Scaling width and height by different amounts keeps the
 * corners square - a plan would still look like a plan - but every length in
 * one direction would be wrong by a different factor than the other, and
 * nothing on the drawing would say so. One number, one factor.
 *
 * Placed pieces are never scaled: a 90*300 panel is 90 cm because that is the
 * panel the yard owns. Resizing the layout under them is a decision to fill
 * it again, and the dialog says so.
 */

export interface Box {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** The box the drawn layout occupies, in world cm. Null when there is none. */
export function sketchBounds(paths: SketchPath[], measures: MeasureLine[] = []): Box | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  const add = (x: number, y: number) => {
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    minX = Math.min(minX, x);
    minY = Math.min(minY, y);
    maxX = Math.max(maxX, x);
    maxY = Math.max(maxY, y);
  };

  for (const path of paths) for (const p of path.points) add(p.x, p.y);
  for (const m of measures) {
    add(m.a.x, m.a.y);
    add(m.b.x, m.b.y);
  }

  if (!Number.isFinite(minX)) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}

/**
 * The factor that turns `current` into `target`, or null when the pair cannot
 * produce one - a zero-width drawing has no scale to correct, and asking for
 * zero would collapse the layout to a point.
 */
export function scaleFactor(current: number, target: number): number | null {
  if (!(current > 0) || !(target > 0)) return null;
  const factor = target / current;
  return Number.isFinite(factor) && factor > 0 ? factor : null;
}

const round1 = (v: number) => Math.round(v * 10) / 10;

/** Every point moved away from `origin` by `factor`, to one decimal. */
export function scaleSketch(paths: SketchPath[], factor: number, origin: Box): SketchPath[] {
  return paths.map((path) => ({
    ...path,
    points: path.points.map((p) => ({
      x: round1(origin.x + (p.x - origin.x) * factor),
      y: round1(origin.y + (p.y - origin.y) * factor),
    })),
  }));
}

/** The same for measured lines: they annotate the drawing and travel with it. */
export function scaleMeasures(measures: MeasureLine[], factor: number, origin: Box): MeasureLine[] {
  const move = (p: { x: number; y: number }) => ({
    x: round1(origin.x + (p.x - origin.x) * factor),
    y: round1(origin.y + (p.y - origin.y) * factor),
  });
  return measures.map((m) => ({ ...m, a: move(m.a), b: move(m.b) }));
}
