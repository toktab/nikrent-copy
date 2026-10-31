import type { SketchPath } from '../types';
import { MAX_WALL_CM, offsetPath, outwardSide } from './sketchFill';
import { uid } from './ids';

/**
 * Drawing a wall as ONE line: the pen draws the face you trace, and the other
 * face of the pour is put in for you, a wall's thickness away.
 *
 * A wall is two drawn lines (docs/FORMWORK.md) and both have to be there for
 * the fill to panel them as a matched pair. Drawing the second one by hand,
 * parallel and at exactly the thickness, is slow and is where a 20 cm wall
 * turns into a 19.5 cm one.
 */

/** Thinner than this is not a pour; thicker is not one wall (`MAX_WALL_CM`). */
export const MIN_WALL_CM = 5;

/** A thickness to draw walls with, or null for "draw single lines". */
export function normalizeWallThickness(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(n) && n >= MIN_WALL_CM && n <= MAX_WALL_CM ? Math.round(n) : null;
}

/**
 * The other face of the wall `path` is one face of: the same run moved across
 * the pour by `thickness` - away from the side its panels stand on, which is
 * where the concrete is - and drawn as the opposite perimeter, so its panels
 * face the other way.
 *
 * The corners move with it the way a wall's corners do (see `offsetPath`): the
 * inner face of an L is shorter than the outer one by the thickness.
 */
export function wallPartner(path: SketchPath, thickness: number): SketchPath {
  const side = outwardSide(path);
  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    id: uid('sk'),
    points: offsetPath(path, -side * thickness).map((p) => ({ x: round(p.x), y: round(p.y) })),
    ...(path.closed ? { closed: true as const } : {}),
    perimeter: path.perimeter === 'inner' ? 'outer' : 'inner',
  };
}

/**
 * The other face of the wall `path` is one face of, if the drawing has it: a
 * line with the same shape a wall's thickness to one side, as `wallPartner`
 * draws it. Found from the geometry rather than a stored link, because a line
 * is redrawn, imported (fresh ids) and edited, and none of that should lose
 * the wall it belongs to.
 */
export function findWallMate(
  path: SketchPath,
  sketch: SketchPath[],
): { mate: SketchPath; thickness: number } | null {
  const near = (a: number, b: number) => Math.abs(a - b) <= 0.6;
  for (const q of sketch) {
    if (q.id === path.id || q.points.length !== path.points.length || !!q.closed !== !!path.closed) continue;
    const a = path.points[0];
    const b = q.points[0];
    const thickness = Math.max(Math.abs(a.x - b.x), Math.abs(a.y - b.y));
    if (thickness < MIN_WALL_CM || thickness > MAX_WALL_CM) continue;
    for (const sign of [1, -1]) {
      const pts = offsetPath(path, sign * thickness);
      if (pts.every((p, i) => near(p.x, q.points[i].x) && near(p.y, q.points[i].y))) {
        return { mate: q, thickness: Math.round(thickness * 10) / 10 };
      }
    }
  }
  return null;
}

/**
 * The same wall with its body on the other side of `path`: `path` stays where
 * it was drawn, its panels turn to the other side, and its mate is put back a
 * thickness away on that side - the "which side" choice for a wall drawn with
 * the კედელი pen, made after it is finished (the user, 2026-10-30).
 */
export function flipWall(path: SketchPath, mate: SketchPath, thickness: number): [SketchPath, SketchPath] {
  const turned: SketchPath = { ...path, perimeter: path.perimeter === 'inner' ? 'outer' : 'inner' };
  return [turned, { ...wallPartner(turned, thickness), id: mate.id }];
}
