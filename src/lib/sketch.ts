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

/**
 * Editing an orthogonal path without ever leaving it un-orthogonal.
 *
 * Dragging a vertex is the obvious idea and the wrong one: a vertex belongs to
 * two legs at right angles, so moving it freely breaks both, and the fixes
 * cascade down the path. Dragging a *leg* has no such problem. A horizontal leg
 * only moves up and down; that changes the length of the vertical legs either
 * side of it and nothing else, because they were already perpendicular to the
 * direction it moved in. The right angles survive by construction rather than
 * by being repaired.
 *
 * Which is also how the edit is described on site: not "put that corner there"
 * but "that wall needs to come out 20 centimetres".
 */

/** True for a leg that runs across rather than down. */
export function isHorizontal(a: Point, b: Point): boolean {
  return Math.abs(b.x - a.x) >= Math.abs(b.y - a.y);
}

/** Length of one leg in cm. */
export function legLength(a: Point, b: Point): number {
  return Math.abs(b.x - a.x) + Math.abs(b.y - a.y);
}

/** The two vertex indices a leg joins, wrapping for the closing leg. */
function legEnds(path: SketchPath, index: number): [number, number] {
  const n = path.points.length;
  return index === n - 1 ? [n - 1, 0] : [index, index + 1];
}

/**
 * Slide one leg sideways. Movement along its own axis is dropped — that would
 * only slide the leg through itself and shorten its neighbours for nothing.
 */
export function moveSegment(
  path: SketchPath,
  index: number,
  dx: number,
  dy: number,
): SketchPath {
  const legs = segments(path);
  if (index < 0 || index >= legs.length) return path;
  const [a, b] = legs[index];
  const horizontal = isHorizontal(a, b);
  const [i, j] = legEnds(path, index);
  const points = path.points.map((p, k) =>
    k === i || k === j
      ? horizontal
        ? { x: p.x, y: p.y + dy }
        : { x: p.x + dx, y: p.y }
      : p,
  );
  return { ...path, points };
}

/**
 * Extend or shorten an open run from one of its ends.
 *
 * Only along the leg it belongs to. Moving an end vertex sideways would tip its
 * leg off square, and the way to move a whole wall is to drag the wall.
 */
export function moveEndpoint(
  path: SketchPath,
  vertex: number,
  dx: number,
  dy: number,
): SketchPath {
  const n = path.points.length;
  if (path.closed || n < 2) return path;
  if (vertex !== 0 && vertex !== n - 1) return path;
  const neighbour = vertex === 0 ? 1 : n - 2;
  const horizontal = isHorizontal(path.points[vertex], path.points[neighbour]);
  const points = path.points.map((p, k) =>
    k === vertex
      ? horizontal
        ? { x: p.x + dx, y: p.y }
        : { x: p.x, y: p.y + dy }
      : p,
  );
  return { ...path, points };
}

export interface SegmentHit {
  pathId: string;
  /** index into `segments(path)` */
  index: number;
  /** set when the pointer is on an end vertex rather than the leg's middle */
  endpoint?: number;
}

/**
 * What the pointer is over: an end vertex if it is near one, otherwise a leg.
 *
 * Endpoints win inside the tolerance because they are the smaller target and
 * the one you have to aim at; a leg can be grabbed anywhere along its length.
 */
export function segmentAt(
  paths: SketchPath[],
  at: Point,
  tolerance: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  let bestD = tolerance;

  for (const path of paths) {
    if (!path.closed) {
      const ends = [0, path.points.length - 1];
      for (const v of ends) {
        const p = path.points[v];
        if (!p) continue;
        const d = Math.hypot(at.x - p.x, at.y - p.y);
        if (d <= bestD) {
          bestD = d;
          best = { pathId: path.id, index: v === 0 ? 0 : path.points.length - 2, endpoint: v };
        }
      }
    }
  }
  if (best) return best;

  for (const path of paths) {
    segments(path).forEach(([a, b], index) => {
      const nx = Math.max(Math.min(a.x, b.x), Math.min(at.x, Math.max(a.x, b.x)));
      const ny = Math.max(Math.min(a.y, b.y), Math.min(at.y, Math.max(a.y, b.y)));
      const d = Math.hypot(at.x - nx, at.y - ny);
      if (d <= bestD) {
        bestD = d;
        best = { pathId: path.id, index };
      }
    });
  }
  return best;
}
