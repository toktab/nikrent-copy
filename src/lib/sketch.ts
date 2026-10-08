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
  for (const [a, b] of segments(path)) total += legLength(a, b);
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

/**
 * Length of one leg in cm.
 *
 * The straight-line distance, not the sum of the two sides. They agree for
 * every leg drawn square, and only differ once a run is allowed to turn at
 * something other than a right angle — where the sum is not a length anybody
 * would recognise: it calls a 3-4-5 leg seven metres long.
 */
export function legLength(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
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
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len = Math.hypot(vx, vy);
  if (!len) return path;

  // Only the part of the drag that is square to the leg counts. For a leg
  // lying on an axis this is the old behaviour exactly — a horizontal one
  // moves in y and ignores x — and it keeps meaning the same thing once a leg
  // is allowed to lie at an angle, where "sideways" is no longer either axis.
  const nx = -vy / len;
  const ny = vx / len;
  const along = dx * nx + dy * ny;
  const [i, j] = legEnds(path, index);
  const points = path.points.map((p, k) =>
    k === i || k === j ? { x: p.x + nx * along, y: p.y + ny * along } : p,
  );
  return { ...path, points };
}

/**
 * Move one junction, anywhere.
 *
 * Free, and deliberately so. It used to be locked to the leg's own axis, which
 * kept every run square but left no way to draw anything that is not — and a
 * junction is exactly where somebody reaches when a wall does not meet another
 * at ninety degrees. The two tools now divide cleanly: drag a LEG and the right
 * angles survive by construction; drag a JUNCTION and you are moving that
 * corner, wherever you put it.
 */
export function moveVertex(
  path: SketchPath,
  vertex: number,
  dx: number,
  dy: number,
): SketchPath {
  if (vertex < 0 || vertex >= path.points.length) return path;
  const points = path.points.map((p, k) =>
    k === vertex ? { x: p.x + dx, y: p.y + dy } : p,
  );
  return { ...path, points };
}

/** Slide a whole run without changing its shape. */
export function translatePath(path: SketchPath, dx: number, dy: number): SketchPath {
  if (!dx && !dy) return path;
  return { ...path, points: path.points.map((p) => ({ x: p.x + dx, y: p.y + dy })) };
}

/** True when every leg lies on an axis — what the formwork generator needs. */
export function isOrthogonal(path: SketchPath): boolean {
  return segments(path).every(([a, b]) => a.x === b.x || a.y === b.y);
}

export interface SegmentHit {
  pathId: string;
  /** index into `segments(path)` */
  index: number;
  /** set when the pointer is on a junction rather than the middle of a leg */
  vertex?: number;
}

/**
 * What the pointer is over: a junction if it is near one, otherwise a leg.
 *
 * Junctions win inside the tolerance because they are the smaller target and
 * the one you have to aim at; a leg can be grabbed anywhere along its length.
 * Every junction counts, not just the two free ends — the corner where two
 * walls meet is the thing most often being moved, and for a long time it was
 * the one thing on a layout that could not be picked up.
 */
export function segmentAt(
  paths: SketchPath[],
  at: Point,
  tolerance: number,
): SegmentHit | null {
  let best: SegmentHit | null = null;
  let bestD = tolerance;

  for (const path of paths) {
    path.points.forEach((p, v) => {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= bestD) {
        bestD = d;
        // The leg reported alongside is the one this junction starts, clamped
        // for the last vertex of an open run, which starts none.
        best = { pathId: path.id, index: Math.min(v, Math.max(0, path.points.length - 2)), vertex: v };
      }
    });
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

// ── Editing a run after it is drawn ─────────────────────────────────────────

/** Nearest point on one leg to `at`, clamped to the leg's own length. */
export function closestOnLeg(a: Point, b: Point, at: Point): Point {
  const vx = b.x - a.x;
  const vy = b.y - a.y;
  const len2 = vx * vx + vy * vy;
  if (!len2) return { x: a.x, y: a.y };
  const t = Math.max(0, Math.min(1, ((at.x - a.x) * vx + (at.y - a.y) * vy) / len2));
  return { x: a.x + vx * t, y: a.y + vy * t };
}

/**
 * Bearing of a leg in degrees, 0 pointing east and turning clockwise on screen.
 *
 * Clockwise because world y increases downward, so the direction that looks
 * like a positive turn on the drawing is the negative one in the maths. Anyone
 * typing 90 into a field means a quarter turn the way the drawing turns.
 */
export function legAngle(a: Point, b: Point): number {
  const deg = (Math.atan2(b.y - a.y, b.x - a.x) * 180) / Math.PI;
  return Math.round(((deg % 360) + 360) % 360 * 10) / 10;
}

/**
 * Put a new junction on an existing leg.
 *
 * The leg becomes two, and nothing else about the run changes — the point lands
 * on the line it was taken from, so the shape is identical until the new
 * junction is dragged somewhere. Which is the whole purpose: a run gains a bend
 * where there was none, without being redrawn.
 */
export function insertVertex(path: SketchPath, index: number, at: Point): SketchPath {
  const legs = segments(path);
  if (index < 0 || index >= legs.length) return path;
  const points = [...path.points];
  // The closing leg of a room ends at the first point, so the new junction goes
  // on the end of the list rather than in the middle of it.
  points.splice(index + 1, 0, { x: at.x, y: at.y });
  return { ...path, points };
}

/** Rotation of a point about a centre, by degrees clockwise on screen. */
function turnAbout(p: Point, centre: Point, deg: number): Point {
  const r = (deg * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const dx = p.x - centre.x;
  const dy = p.y - centre.y;
  return { x: centre.x + dx * cos - dy * sin, y: centre.y + dx * sin + dy * cos };
}

/**
 * Swing one leg to an exact bearing, in degrees.
 *
 * The rest of the run goes with it, rigidly, pivoting on the junction the leg
 * starts from — so every leg beyond keeps its own length and its own angle to
 * its neighbours, and only this joint opens or closes. Rotating the leg alone
 * would tear the run in half at the far end.
 *
 * Open runs only. A closed room cannot pivot one of its legs and still close.
 */
export function setLegAngle(path: SketchPath, index: number, deg: number): SketchPath {
  if (path.closed) return path;
  const legs = segments(path);
  if (index < 0 || index >= legs.length) return path;
  const [a, b] = legs[index];
  const delta = deg - legAngle(a, b);
  if (!delta) return path;
  const points = path.points.map((p, i) => (i > index ? turnAbout(p, a, delta) : p));
  return { ...path, points };
}

/**
 * Set one leg to an exact length, keeping its direction.
 *
 * Everything past it travels along the leg's own line, so the legs beyond keep
 * their lengths and the joints keep their angles.
 */
export function setLegLength(path: SketchPath, index: number, cm: number): SketchPath {
  if (path.closed) return path;
  const legs = segments(path);
  if (index < 0 || index >= legs.length || !(cm > 0)) return path;
  const [a, b] = legs[index];
  const len = legLength(a, b);
  if (!len) return path;
  const grow = cm - len;
  if (!grow) return path;
  const ux = (b.x - a.x) / len;
  const uy = (b.y - a.y) / len;
  const points = path.points.map((p, i) =>
    i > index ? { x: p.x + ux * grow, y: p.y + uy * grow } : p,
  );
  return { ...path, points };
}

/**
 * Pull a point onto the layout already drawn.
 *
 * A junction first, then any point along a leg. Without this a run drawn to
 * meet another one only looks joined: the two ends sit a few millimetres apart,
 * the fill treats them as separate walls, and nothing says why. Snapping to
 * what is there is what makes a layout one connected thing rather than a
 * picture of one.
 *
 * Beats the grid and beats the right-angle lock, both deliberately. Meeting the
 * wall you are drawing to is the point of the gesture; landing on a round
 * number is not — but the two only conflict at a junction. Anywhere ALONG a leg
 * they agree, because sliding the point up the leg to the nearest `step` keeps
 * it exactly on the line and puts it on a grid corner as well, so `step` is
 * taken and used where it costs nothing.
 */
export function snapToSketch(
  paths: SketchPath[],
  at: Point,
  tolerance: number,
  /** grid the point slides to along a leg; 0 leaves it wherever it landed */
  step = 0,
): { point: Point; onVertex: boolean } | null {
  let best: { point: Point; onVertex: boolean } | null = null;
  let bestD = tolerance;

  for (const path of paths) {
    for (const p of path.points) {
      const d = Math.hypot(at.x - p.x, at.y - p.y);
      if (d <= bestD) {
        bestD = d;
        best = { point: { x: p.x, y: p.y }, onVertex: true };
      }
    }
  }
  if (best) return best;

  for (const path of paths) {
    for (const [a, b] of segments(path)) {
      const on = alongLeg(a, b, closestOnLeg(a, b, at), step);
      const d = Math.hypot(at.x - on.x, at.y - on.y);
      if (d <= bestD) {
        bestD = d;
        best = { point: on, onVertex: false };
      }
    }
  }
  return best;
}

/**
 * Slide a point already on a leg to the nearest multiple of `step` along it.
 *
 * Only the coordinate that varies moves, so the point stays on the line, and
 * only on a leg that lies on an axis — a leg at an angle has no coordinate that
 * can be rounded without coming off it. Never past either end.
 */
function alongLeg(a: Point, b: Point, on: Point, step: number): Point {
  if (step <= 0) return on;
  const round = (v: number, lo: number, hi: number) =>
    Math.min(Math.max(Math.round(v / step) * step, Math.min(lo, hi)), Math.max(lo, hi));
  if (Math.abs(a.y - b.y) < 0.01) return { x: round(on.x, a.x, b.x), y: on.y };
  if (Math.abs(a.x - b.x) < 0.01) return { x: on.x, y: round(on.y, a.y, b.y) };
  return on;
}

/**
 * Take a junction out, joining the two legs it separated into one.
 *
 * The inverse of `insertVertex`, and needed for the same reason: a bend put in
 * the wrong place has to be removable without redrawing the run. Refuses to
 * leave less than a line behind — two points for an open run, three for a room.
 */
export function removeVertex(path: SketchPath, index: number): SketchPath | null {
  const n = path.points.length;
  if (index < 0 || index >= n) return path;
  const floor = path.closed ? 4 : 3;
  // Below the floor there is no run left to keep, so the caller drops it.
  if (n < floor) return null;
  return { ...path, points: path.points.filter((_, i) => i !== index) };
}
