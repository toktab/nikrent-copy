import { describe, expect, it } from 'vitest';
import { zoomAbout } from '../iso3d';

/**
 * The 3D view zoomed about the middle of the canvas, so every notch dragged the
 * model away from whatever the user was pointing at.
 *
 * The property under test is the one the user actually feels: whatever sits
 * under the cursor is still under the cursor afterwards. So rather than check
 * the arithmetic, these replay the renderer's own mapping —
 *
 *     screen = size / 2 + pan + projected · zoom
 *
 * — for a fixed projected point, and assert the screen position does not move.
 */

const size = { w: 800, h: 600 };

/** Where a projected point lands on screen, exactly as the renderer places it. */
const screenOf = (
  projected: { x: number; y: number },
  pan: { x: number; y: number },
  zoom: number,
) => ({
  x: size.w / 2 + pan.x + projected.x * zoom,
  y: size.h / 2 + pan.y + projected.y * zoom,
});

/** What is under `point` right now, in projected units. */
const projectedUnder = (
  point: { x: number; y: number },
  pan: { x: number; y: number },
  zoom: number,
) => ({
  x: (point.x - size.w / 2 - pan.x) / zoom,
  y: (point.y - size.h / 2 - pan.y) / zoom,
});

const holds = (
  cursor: { x: number; y: number },
  pan: { x: number; y: number },
  zoom: number,
  factor: number,
) => {
  const world = projectedUnder(cursor, pan, zoom);
  const before = screenOf(world, pan, zoom);
  const next = zoomAbout(cursor, size, pan, zoom, factor);
  const after = screenOf(world, next.pan, next.zoom);
  return { before, after, next };
};

describe('zoomAbout', () => {
  it('holds the point under the cursor when zooming in', () => {
    const { before, after } = holds({ x: 140, y: 140 }, { x: 0, y: 0 }, 1, 1.12);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('holds it when zooming out too', () => {
    const { before, after } = holds({ x: 620, y: 510 }, { x: -80, y: 45 }, 2.5, 1 / 1.12);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });

  it('holds it through a burst of notches from an already panned view', () => {
    let pan = { x: 120, y: -60 };
    let zoom = 0.7;
    const cursor = { x: 210, y: 480 };
    const world = projectedUnder(cursor, pan, zoom);
    const before = screenOf(world, pan, zoom);
    for (let i = 0; i < 8; i++) {
      const next = zoomAbout(cursor, size, pan, zoom, 1.12);
      pan = next.pan;
      zoom = next.zoom;
    }
    const after = screenOf(world, pan, zoom);
    expect(after.x).toBeCloseTo(before.x, 6);
    expect(after.y).toBeCloseTo(before.y, 6);
  });

  it('leaves the canvas centre alone, which is the old behaviour', () => {
    const centre = { x: size.w / 2, y: size.h / 2 };
    const { next } = holds(centre, { x: 0, y: 0 }, 1, 1.12);
    expect(next.pan).toEqual({ x: 0, y: 0 });
  });

  // Against a limit the scale stops changing. A correction computed from the
  // requested factor would go on sliding the model sideways while nothing was
  // getting bigger — which reads as the model drifting for no reason.
  it('does not pan when the zoom is already against its limit', () => {
    const pan = { x: 30, y: 30 };
    expect(zoomAbout({ x: 100, y: 100 }, size, pan, 40, 1.12).pan).toBe(pan);
    expect(zoomAbout({ x: 100, y: 100 }, size, pan, 0.02, 1 / 1.12).pan).toBe(pan);
  });

  it('clamps the zoom to the usable range', () => {
    expect(zoomAbout({ x: 0, y: 0 }, size, { x: 0, y: 0 }, 39, 4).zoom).toBe(40);
    expect(zoomAbout({ x: 0, y: 0 }, size, { x: 0, y: 0 }, 0.05, 0.1).zoom).toBe(0.02);
  });

  // Partway into a clamp the factor applied is smaller than the one asked for,
  // and the pan has to agree with what actually happened.
  it('holds the cursor even when the step is cut short by the limit', () => {
    const cursor = { x: 700, y: 100 };
    const pan = { x: 15, y: -25 };
    const world = projectedUnder(cursor, pan, 38);
    const before = screenOf(world, pan, 38);
    const next = zoomAbout(cursor, size, pan, 38, 1.5); // wants 57, gets 40
    expect(next.zoom).toBe(40);
    const after = screenOf(world, next.pan, next.zoom);
    expect(after.x).toBeCloseTo(before.x, 9);
    expect(after.y).toBeCloseTo(before.y, 9);
  });
});
