/**
 * Depth-buffered software rasteriser for the read-only 3D view.
 *
 * A painter's algorithm cannot order formwork correctly: a 100 cm waler whose
 * centroid sits nearer than a 300 cm panel still passes *behind* that panel, so
 * sorting by depth paints it straight over the face it should be hidden by.
 * Faces are therefore rasterised into a real per-pixel depth buffer.
 *
 * The same buffer then answers "is this bit of edge behind something?", which
 * is what lets hidden lines be dropped or dashed instead of drawn through the
 * assembly. Depth interpolates linearly across a face because the projection is
 * parallel, so the interpolation is exact — no perspective correction needed.
 */

export interface ScreenPoint {
  /** CSS pixels */
  x: number;
  y: number;
  /** larger = nearer the camera, in world cm */
  depth: number;
}

export interface Rgb {
  r: number;
  g: number;
  b: number;
}

export interface DepthRaster {
  /** buffer size in raster pixels */
  w: number;
  h: number;
  /** raster pixels per CSS pixel */
  scale: number;
  /** viewport size in CSS pixels */
  cssW: number;
  cssH: number;
  depth: Float32Array;
  /** pinned to a plain ArrayBuffer so it can be handed straight to ImageData */
  rgba: Uint8ClampedArray<ArrayBuffer>;
}

export function createRaster(cssW: number, cssH: number, scale: number): DepthRaster {
  const w = Math.max(1, Math.round(cssW * scale));
  const h = Math.max(1, Math.round(cssH * scale));
  const raster: DepthRaster = {
    w,
    h,
    scale,
    cssW,
    cssH,
    depth: new Float32Array(w * h),
    rgba: new Uint8ClampedArray(w * h * 4),
  };
  resetRaster(raster);
  return raster;
}

/** Empty the buffer: nothing drawn, everything infinitely far away. */
export function resetRaster(raster: DepthRaster): void {
  raster.depth.fill(-Infinity);
  raster.rgba.fill(0);
}

/** True when the buffer already matches this viewport, so it can be reused. */
export function rasterMatches(
  raster: DepthRaster | null,
  cssW: number,
  cssH: number,
  scale: number,
): raster is DepthRaster {
  return !!raster && raster.cssW === cssW && raster.cssH === cssH && raster.scale === scale;
}

function fillTriangle(
  raster: DepthRaster,
  a: ScreenPoint,
  b: ScreenPoint,
  c: ScreenPoint,
  colour: Rgb,
): void {
  let area = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
  if (!Number.isFinite(area) || Math.abs(area) < 1e-12) return;
  // Wind consistently so the barycentric sign tests below are simple.
  if (area < 0) {
    const swap = b;
    b = c;
    c = swap;
    area = -area;
  }
  const inv = 1 / area;

  const minX = Math.max(0, Math.floor(Math.min(a.x, b.x, c.x)));
  const maxX = Math.min(raster.w - 1, Math.ceil(Math.max(a.x, b.x, c.x)));
  const minY = Math.max(0, Math.floor(Math.min(a.y, b.y, c.y)));
  const maxY = Math.min(raster.h - 1, Math.ceil(Math.max(a.y, b.y, c.y)));

  const { depth, rgba, w } = raster;

  for (let y = minY; y <= maxY; y++) {
    const py = y + 0.5;
    let idx = y * w + minX;
    for (let x = minX; x <= maxX; x++, idx++) {
      const px = x + 0.5;
      const w0 = ((b.x - px) * (c.y - py) - (b.y - py) * (c.x - px)) * inv;
      if (w0 < 0) continue;
      const w1 = ((c.x - px) * (a.y - py) - (c.y - py) * (a.x - px)) * inv;
      if (w1 < 0) continue;
      const w2 = 1 - w0 - w1;
      if (w2 < 0) continue;

      const d = w0 * a.depth + w1 * b.depth + w2 * c.depth;
      if (d <= depth[idx]) continue;

      depth[idx] = d;
      const o = idx * 4;
      rgba[o] = colour.r;
      rgba[o + 1] = colour.g;
      rgba[o + 2] = colour.b;
      rgba[o + 3] = 255;
    }
  }
}

function toRaster(raster: DepthRaster, p: ScreenPoint): ScreenPoint {
  return { x: p.x * raster.scale, y: p.y * raster.scale, depth: p.depth };
}

interface Point2 {
  x: number;
  y: number;
}

/** Twice the signed area of a triangle; > 0 for a convex turn in this winding. */
function turn(a: Point2, b: Point2, c: Point2): number {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function strictlyInside(p: Point2, a: Point2, b: Point2, c: Point2): boolean {
  const eps = 1e-9;
  return turn(a, b, p) > eps && turn(b, c, p) > eps && turn(c, a, p) > eps;
}

/**
 * Split a simple polygon into triangles by ear clipping.
 *
 * A triangle fan from the first vertex is the obvious approach and it is wrong
 * for any concave outline. On an L-corner the fan produces triangles that lie
 * *outside* the polygon, so colour spilled across the notch and left a diagonal
 * seam where the spill happened to end.
 */
export function triangulate(poly: Point2[]): Array<[number, number, number]> {
  const n = poly.length;
  if (n < 3) return [];
  if (n === 3) return [[0, 1, 2]];

  // Work on an index ring wound so that a convex corner has `turn` > 0.
  let area = 0;
  for (let i = 0; i < n; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % n];
    area += a.x * b.y - b.x * a.y;
  }
  const ring = poly.map((_, i) => i);
  if (area < 0) ring.reverse();

  const out: Array<[number, number, number]> = [];
  let guard = n * n;

  while (ring.length > 3 && guard-- > 0) {
    let clipped = false;
    for (let i = 0; i < ring.length; i++) {
      const i0 = ring[(i + ring.length - 1) % ring.length];
      const i1 = ring[i];
      const i2 = ring[(i + 1) % ring.length];
      const a = poly[i0];
      const b = poly[i1];
      const c = poly[i2];
      if (turn(a, b, c) <= 0) continue; // reflex vertex, not an ear

      let empty = true;
      for (const j of ring) {
        if (j === i0 || j === i1 || j === i2) continue;
        if (strictlyInside(poly[j], a, b, c)) {
          empty = false;
          break;
        }
      }
      if (!empty) continue;

      out.push([i0, i1, i2]);
      ring.splice(i, 1);
      clipped = true;
      break;
    }
    // Degenerate input (repeated or collinear points): stop rather than spin.
    if (!clipped) break;
  }

  if (ring.length === 3) out.push([ring[0], ring[1], ring[2]]);
  return out;
}

/** Rasterise one planar face given in CSS pixels. Concave outlines are fine. */
export function fillFace(raster: DepthRaster, pts: ScreenPoint[], colour: Rgb): void {
  if (pts.length < 3) return;
  const p = pts.map((q) => toRaster(raster, q));
  for (const [a, b, c] of triangulate(p)) {
    fillTriangle(raster, p[a], p[b], p[c], colour);
  }
}

/** Depth already written at a CSS-pixel location; -Infinity where nothing is. */
export function depthAt(raster: DepthRaster, x: number, y: number): number {
  const ix = Math.floor(x * raster.scale);
  const iy = Math.floor(y * raster.scale);
  if (ix < 0 || iy < 0 || ix >= raster.w || iy >= raster.h) return -Infinity;
  return raster.depth[iy * raster.w + ix];
}

export interface EdgeRun {
  from: { x: number; y: number };
  to: { x: number; y: number };
  visible: boolean;
}

/**
 * Split an edge into visible and hidden stretches by walking it against the
 * depth buffer.
 *
 * `tolerance` is in world cm and must cover the depth an edge gains across one
 * pixel of its own face — otherwise a face hides its own outline and the model
 * loses every edge it has.
 */
export function classifyEdge(
  raster: DepthRaster,
  from: ScreenPoint,
  to: ScreenPoint,
  tolerance: number,
  stepPx = 4,
): EdgeRun[] {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const steps = Math.max(1, Math.min(400, Math.ceil(Math.hypot(dx, dy) / stepPx)));

  const at = (t: number): ScreenPoint => ({
    x: from.x + dx * t,
    y: from.y + dy * t,
    depth: from.depth + (to.depth - from.depth) * t,
  });

  const runs: EdgeRun[] = [];
  let previous: boolean | null = null;

  for (let i = 0; i < steps; i++) {
    const mid = at((i + 0.5) / steps);
    const visible = mid.depth + tolerance >= depthAt(raster, mid.x, mid.y);
    if (visible === previous) {
      runs[runs.length - 1].to = at((i + 1) / steps);
    } else {
      runs.push({ from: at(i / steps), to: at((i + 1) / steps), visible });
      previous = visible;
    }
  }
  return runs;
}
