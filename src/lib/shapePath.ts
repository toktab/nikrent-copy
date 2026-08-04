import type { Material } from '../types';
import { planH, planW } from './geometry';

/**
 * Geometry for the three draw shapes, in the material's own cm coordinate space
 * (origin at the top-left of its w × h box). Shared by the SVG renderer used on
 * screen, the 2D-canvas renderer used for the PDF snapshot, and the 3D view, so
 * the drawing, the printout and the visualisation always agree.
 */

/** Leg thickness of an L-profile: a fraction of the smaller side. */
export function legThickness(w: number, h: number): number {
  return Math.max(0.5, Math.min(w, h) * 0.45);
}

/** L-profile: vertical leg on the left, horizontal leg along the bottom. */
export function lPoints(w: number, h: number): Array<[number, number]> {
  const t = legThickness(w, h);
  return [
    [0, 0],
    [t, 0],
    [t, h - t],
    [w, h - t],
    [w, h],
    [0, h],
  ];
}

export interface Bar {
  x: number;
  y: number;
  w: number;
  h: number;
  /** corner radius for the rounded ends */
  r: number;
  horizontal: boolean;
}

/** Thin bar centred along the longer axis (walers, tie rods, posts). */
export function barRect(w: number, h: number): Bar {
  const horizontal = w >= h;
  const t = Math.max(0.5, Math.min(w, h) * 0.62);
  return horizontal
    ? { x: 0, y: (h - t) / 2, w, h: t, r: t / 2, horizontal }
    : { x: (w - t) / 2, y: 0, w: t, h, r: t / 2, horizontal };
}

/**
 * The footprint a material occupies in plan, as a closed polygon in world cm
 * relative to the piece's top-left corner. This is what the 3D view extrudes.
 *
 * Wound so the shoelace area is **positive**, which is what tells the extruder
 * which way is up: taken as the top face the winding gives a +Z normal, and
 * every side wall built from it faces outwards.
 *
 * `line` materials deliberately keep their full box rather than the slimmed,
 * rounded bar the 2D view draws. That bar is a stylisation for legibility at
 * small scale; a waler's `depth` really is its profile, and in 3D the honest
 * section is the more useful thing to look at.
 */
export function planOutline(m: Material): Array<[number, number]> {
  const pw = planW(m);
  const ph = planH(m);
  if (m.shape === 'L') return lPoints(pw, ph);
  return [
    [0, 0],
    [pw, 0],
    [pw, ph],
    [0, ph],
  ];
}

/** Twice the signed area; positive means the winding described above. */
export function shoelace(points: Array<[number, number]>): number {
  let sum = 0;
  for (let i = 0; i < points.length; i++) {
    const [x1, y1] = points[i];
    const [x2, y2] = points[(i + 1) % points.length];
    sum += x1 * y2 - x2 * y1;
  }
  return sum;
}

/** `points` attribute for an SVG <polygon>. */
export function pointsAttr(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}
