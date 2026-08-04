import type { Material, Piece } from '../types';
import { planH, planW } from './geometry';
import { planOutline } from './shapePath';

/**
 * Axonometric 3D projection for the read-only visualisation.
 *
 * The editor works in PLAN: a piece occupies `w × depth` on the ground and its
 * `h` is the height standing up out of the page. The 3D view simply extrudes
 * each footprint to that height, which is the whole point — seeing how tall the
 * formwork actually stands.
 *
 * World axes: x/y are the plan coordinates in cm, z is height in cm (up).
 * Projection is a plain orbit camera, no perspective, so parallel edges stay
 * parallel and the drawing keeps a measurable, CAD-like feel.
 *
 * Orientation matters here. Plan y grows *downward* on screen, so (x, y, z) is
 * a left-handed triple and the obvious camera formula silently mirrors the
 * model — which reads as looking at the assembly from underneath. The camera
 * below is built so that at elevation π/2 the view is exactly the 2D plan
 * (x right, y down) and every lower elevation just tips that plan toward the
 * viewer, keeping the eye above the ground at all times.
 */

export interface Vec3 {
  x: number;
  y: number;
  z: number;
}

export interface Camera {
  /** rotation around the vertical axis, radians */
  azimuth: number;
  /** tilt above the horizon, radians (0 = eye level, π/2 = straight down) */
  elevation: number;
}

export interface Projected {
  x: number;
  y: number;
  /** larger = nearer the camera; used for painter's-algorithm sorting */
  depth: number;
}

/** Default three-quarter view from above, also what the "reset angle" button uses. */
export const DEFAULT_CAMERA: Camera = { azimuth: -0.9, elevation: 0.48 };

/** Unit vector pointing from the scene toward the camera. */
export function viewDirection(cam: Camera): Vec3 {
  const ce = Math.cos(cam.elevation);
  return {
    x: ce * Math.sin(cam.azimuth),
    y: ce * Math.cos(cam.azimuth),
    z: Math.sin(cam.elevation),
  };
}

/**
 * Project a world point to screen units (y grows downward, before any zoom or
 * pan is applied by the renderer).
 */
export function project(p: Vec3, cam: Camera): Projected {
  const ca = Math.cos(cam.azimuth);
  const sa = Math.sin(cam.azimuth);
  const ce = Math.cos(cam.elevation);
  const se = Math.sin(cam.elevation);

  // `along` runs away from the camera on the ground, `across` runs to the right
  // of the screen. At azimuth 0 they are plan y and plan x untouched, which is
  // what keeps the top-down view identical to the 2D plan.
  const across = p.x * ca - p.y * sa;
  const along = p.x * sa + p.y * ca;

  return {
    x: across,
    // Height lifts a point up the screen; ground distance pushes it down, which
    // is what gives the view its sense of depth.
    y: se * along - ce * p.z,
    depth: ce * along + se * p.z,
  };
}

export interface Prism {
  /** the base ring first, then the top ring in the same order */
  vertices: Vec3[];
  /** vertex indices per face, wound counter-clockwise seen from outside */
  faces: number[][];
}

/**
 * A placed piece extruded from its elevation to its full height.
 *
 * The footprint comes from `planOutline`, so an L-corner is extruded as an
 * actual L and not as its bounding box — corners used to show up in 3D as plain
 * squares that swallowed the notch the panels tuck into.
 */
export function piecePrism(piece: Piece, m: Material): Prism {
  const pw = planW(m);
  const pd = planH(m);
  const cx = piece.x + pw / 2;
  const cy = piece.y + pd / 2;

  const rad = (piece.rot * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);

  const base = piece.z ?? 0;
  const top = base + m.h;

  const outline = planOutline(m);
  const n = outline.length;
  const vertices: Vec3[] = new Array(n * 2);

  for (let i = 0; i < n; i++) {
    // outline is relative to the piece's top-left; rotate about its centre
    const ox = outline[i][0] - pw / 2;
    const oy = outline[i][1] - pd / 2;
    const x = cx + ox * cos - oy * sin;
    const y = cy + ox * sin + oy * cos;
    vertices[i] = { x, y, z: base };
    vertices[i + n] = { x, y, z: top };
  }

  // The outline winds so that, read as the top ring, it faces +Z. The base is
  // therefore the same ring reversed, and each wall follows an outline edge.
  const faces: number[][] = [];
  faces.push(Array.from({ length: n }, (_, i) => n - 1 - i)); // bottom, -Z
  faces.push(Array.from({ length: n }, (_, i) => i + n)); // top, +Z
  for (let i = 0; i < n; i++) {
    const j = (i + 1) % n;
    faces.push([i, j, j + n, i + n]);
  }

  return { vertices, faces };
}

function sub(a: Vec3, b: Vec3): Vec3 {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a: Vec3, b: Vec3): Vec3 {
  return {
    x: a.y * b.z - a.z * b.y,
    y: a.z * b.x - a.x * b.z,
    z: a.x * b.y - a.y * b.x,
  };
}

function dot(a: Vec3, b: Vec3): number {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

/** Outward normal of a face, from its first three corners. */
export function faceNormal(corners: Vec3[], face: readonly number[]): Vec3 {
  const a = corners[face[0]];
  const b = corners[face[1]];
  const c = corners[face[2]];
  return cross(sub(b, a), sub(c, b));
}

/** A face is drawn only when its outward normal points toward the camera. */
export function isFrontFacing(corners: Vec3[], face: readonly number[], cam: Camera): boolean {
  return dot(faceNormal(corners, face), viewDirection(cam)) > 0;
}

/**
 * How lit a face looks, 0..1. A cheap lambert term against a fixed overhead
 * light so tops read brighter than sides and the shape stays legible.
 */
export function faceShade(corners: Vec3[], face: readonly number[]): number {
  const n = faceNormal(corners, face);
  const len = Math.hypot(n.x, n.y, n.z) || 1;
  const light = { x: -0.35, y: -0.45, z: 0.82 };
  const lambert = (n.x * light.x + n.y * light.y + n.z * light.z) / len;
  return 0.45 + 0.55 * Math.max(0, lambert);
}

export interface Bounds3 {
  min: Vec3;
  max: Vec3;
}

/** Axis-aligned extent of every placed piece, including height. */
export function contentBounds3(pieces: Piece[], byId: Map<string, Material>): Bounds3 | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = 0;
  let found = false;

  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    found = true;
    for (const c of piecePrism(p, m).vertices) {
      minX = Math.min(minX, c.x);
      minY = Math.min(minY, c.y);
      maxX = Math.max(maxX, c.x);
      maxY = Math.max(maxY, c.y);
      maxZ = Math.max(maxZ, c.z);
    }
  }

  if (!found) return null;
  return { min: { x: minX, y: minY, z: 0 }, max: { x: maxX, y: maxY, z: maxZ } };
}

/** Centre of a bounds box — the point the camera orbits around. */
export function boundsCentre(b: Bounds3): Vec3 {
  return {
    x: (b.min.x + b.max.x) / 2,
    y: (b.min.y + b.max.y) / 2,
    z: (b.min.z + b.max.z) / 2,
  };
}

/**
 * Zoom (screen px per cm) that fits the whole model in a viewport, with margin.
 * Every corner is projected because an axonometric silhouette depends on the
 * camera angle, not just the bounding box dimensions.
 */
export function fitZoom(
  pieces: Piece[],
  byId: Map<string, Material>,
  cam: Camera,
  viewW: number,
  viewH: number,
  pad = 48,
): { zoom: number; centre: Vec3 } | null {
  const bounds = contentBounds3(pieces, byId);
  if (!bounds) return null;
  const centre = boundsCentre(bounds);

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;

  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    for (const c of piecePrism(p, m).vertices) {
      const q = project(sub(c, centre), cam);
      minX = Math.min(minX, q.x);
      maxX = Math.max(maxX, q.x);
      minY = Math.min(minY, q.y);
      maxY = Math.max(maxY, q.y);
    }
  }

  const w = Math.max(1, maxX - minX);
  const h = Math.max(1, maxY - minY);
  const zoom = Math.min((viewW - pad * 2) / w, (viewH - pad * 2) / h);
  return { zoom: Math.max(0.05, Math.min(20, zoom)), centre };
}

export { sub as subtract };
