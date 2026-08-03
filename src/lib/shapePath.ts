/**
 * Geometry for the three draw shapes, in the material's own cm coordinate space
 * (origin at the top-left of its w × h box). Shared by the SVG renderer used on
 * screen and the 2D-canvas renderer used for the PDF snapshot, so the drawing
 * and the printout always agree.
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

/** `points` attribute for an SVG <polygon>. */
export function pointsAttr(points: Array<[number, number]>): string {
  return points.map(([x, y]) => `${x},${y}`).join(' ');
}
