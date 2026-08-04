import type { Material } from '../types';
import { planH, planW } from './geometry';

/**
 * Geometry for the three draw shapes, in the material's own cm coordinate space
 * (origin at the top-left of its w × h box). Shared by the SVG renderer used on
 * screen, the 2D-canvas renderer used for the PDF snapshot, and the 3D view, so
 * the drawing, the printout and the visualisation always agree.
 */

/** Du panels are 9 cm thick, and corner legs follow them. */
const PANEL_LEG_CM = 9;

/**
 * Leg thickness of an L-profile, in the same units as `w`/`h`.
 *
 * A corner profile wraps the outside of the formwork box, so its legs are as
 * thick as the panels they sit against — that is what makes its inner faces
 * line up with the panel faces and leave the concrete clear. The old flat 45 %
 * of the box gave a 24 cm corner a 10.8 cm leg, which reached 1.8 cm past the
 * panel line and into the pour. Falls back to the proportional rule only when
 * the box is too small to take a full panel thickness.
 */
export function legThickness(w: number, h: number, panelThickness = PANEL_LEG_CM): number {
  return Math.max(0.5, Math.min(panelThickness, Math.min(w, h) * 0.45));
}

/** L-profile: vertical leg on the left, horizontal leg along the bottom. */
export function lPoints(w: number, h: number, panelThickness = PANEL_LEG_CM): Array<[number, number]> {
  const t = legThickness(w, h, panelThickness);
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

/**
 * The same outline scaled into a renderer's own units — the px canvases work in
 * scaled pixels, but a corner's leg thickness is a real 9 cm and has to be
 * scaled with everything else rather than taken as 9 px.
 */
export function scaledOutline(m: Material, w: number, h: number): Array<[number, number]> {
  const sx = w / planW(m);
  const sy = h / planH(m);
  return planOutline(m).map(([x, y]): [number, number] => [x * sx, y * sy]);
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
