import type { SketchPath } from '../types';
import type { Rect } from './geometry';

/**
 * The drawn layout: reference lines the formwork is set out to.
 *
 * Right angles only, and not as a simplification. Formwork is built square,
 * every corner profile in the catalog is 90°, and a junction at any other
 * angle has no component that closes it — an angled sketch would be drawing
 * something the tool could never tell anyone how to build.
 */

export interface Point {
  x: number;
  y: number;
}

/**
 * Pull a free pointer onto the right angle it is closest to.
 *
 * The pen never asks which direction this segment runs. Whichever axis the
 * pointer has travelled further along wins, which is how anyone drawing on
 * squared paper already behaves: you commit to across or down as you move, and
 * the line follows. The other coordinate is inherited from the previous vertex
 * so consecutive points always share an x or a y.
 */
export function orthogonal(from: Point, to: Point): Point {
  return Math.abs(to.x - from.x) >= Math.abs(to.y - from.y)
    ? { x: to.x, y: from.y }
    : { x: from.x, y: to.y };
}

/** Each drawn leg as a pair of endpoints, closing the loop if it is closed. */
export function segments(path: SketchPath): Array<[Point, Point]> {
  const out: Array<[Point, Point]> = [];
  for (let i = 1; i < path.points.length; i++) out.push([path.points[i - 1], path.points[i]]);
  if (path.closed && path.points.length > 2) {
    out.push([path.points[path.points.length - 1], path.points[0]]);
  }
  return out;
}

/** Total drawn length in cm — the run of wall the layout describes. */
export function pathLength(path: SketchPath): number {
  let total = 0;
  for (const [a, b] of segments(path)) total += Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
  return total;
}

/**
 * Every drawn leg as a zero-thickness rectangle.
 *
 * This is what makes the sketch worth keeping rather than just pretty: the
 * edge-snapper already butts a panel against the edges of nearby rectangles,
 * so handing it the drawn lines in the shape it already understands means
 * panels snap to the layout with no new snapping code at all.
 */
export function sketchSnapTargets(paths: SketchPath[]): Rect[] {
  const out: Rect[] = [];
  for (const path of paths) {
    for (const [a, b] of segments(path)) {
      out.push({
        x: Math.min(a.x, b.x),
        y: Math.min(a.y, b.y),
        w: Math.abs(b.x - a.x),
        h: Math.abs(b.y - a.y),
      });
    }
  }
  return out;
}

/** Bounding box of a path, for hit-testing and for fitting the view. */
export function pathBounds(path: SketchPath): Rect | null {
  if (!path.points.length) return null;
  const xs = path.points.map((p) => p.x);
  const ys = path.points.map((p) => p.y);
  const x = Math.min(...xs);
  const y = Math.min(...ys);
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y };
}

/**
 * Distance in cm from a point to the nearest part of a path.
 *
 * Used for picking. A drawn line has no area, so it cannot be hit-tested the
 * way a panel is — the pointer has to be allowed a tolerance, and the tolerance
 * belongs to the caller because it is a screen distance, not a world one.
 */
export function distanceToPath(path: SketchPath, at: Point): number {
  let best = Infinity;
  for (const [a, b] of segments(path)) {
    // Every segment is axis-aligned, so the nearest point on it is just the
    // pointer clamped to its span on the axis it runs along.
    const nx = Math.max(Math.min(a.x, b.x), Math.min(at.x, Math.max(a.x, b.x)));
    const ny = Math.max(Math.min(a.y, b.y), Math.min(at.y, Math.max(a.y, b.y)));
    best = Math.min(best, Math.hypot(at.x - nx, at.y - ny));
  }
  return best;
}

/** The path nearest `at`, within `tolerance` cm, or none. */
export function pathAt(paths: SketchPath[], at: Point, tolerance: number): SketchPath | null {
  let best: SketchPath | null = null;
  let bestD = tolerance;
  for (const path of paths) {
    const d = distanceToPath(path, at);
    if (d <= bestD) {
      bestD = d;
      best = path;
    }
  }
  return best;
}
