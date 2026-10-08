import { describe, expect, it } from 'vitest';
import { inZone, wallZones } from '../zones';
import type { Seg } from '../segments';

let n = 0;
const seg = (x1: number, y1: number, x2: number, y2: number): Seg => ({
  id: `s${n++}`,
  a: { x: x1, y: y1 },
  b: { x: x2, y: y2 },
  parts: 1,
});

/** A hatched wall: two faces 14 pt apart with ticks between them. */
function hatchedWall(y: number, from: number, to: number): Seg[] {
  const out = [seg(from, y, to, y), seg(from, y + 14, to, y + 14)];
  for (let x = from; x <= to; x += 4) out.push(seg(x, y, x + 3, y + 14));
  return out;
}

describe('wallZones', () => {
  it('shades a hatched wall', () => {
    const { rects, patches } = wallZones(hatchedWall(100, 50, 300), 600, 400);
    expect(patches).toBe(1);
    expect(rects.length).toBeGreaterThan(0);
    // The shading sits on the wall, not somewhere else on the sheet.
    const xs = rects.flatMap((r) => [r.x, r.x + r.w]);
    const ys = rects.flatMap((r) => [r.y, r.y + r.h]);
    expect(Math.min(...xs)).toBeGreaterThanOrEqual(30);
    expect(Math.max(...xs)).toBeLessThanOrEqual(330);
    expect(Math.min(...ys)).toBeGreaterThan(70);
    expect(Math.max(...ys)).toBeLessThan(150);
  });

  // The point of the shading: a dimension line is a line, not a wall.
  it('leaves a lone line alone', () => {
    expect(wallZones([seg(0, 200, 580, 200)], 600, 400).rects).toHaveLength(0);
  });

  it('ignores a speck of crowded ink', () => {
    const speck = [seg(10, 10, 14, 14), seg(10, 14, 14, 10), seg(10, 12, 14, 12)];
    expect(wallZones(speck, 600, 400).patches).toBe(0);
  });

  it('finds each wall of a room separately', () => {
    const room = [
      ...hatchedWall(60, 60, 400),
      ...hatchedWall(300, 60, 400),
    ];
    expect(wallZones(room, 600, 400).patches).toBe(2);
  });

  it('has nothing to say about an empty page', () => {
    expect(wallZones([], 600, 400)).toMatchObject({ rects: [], patches: 0 });
  });

  it('stays inside the sheet, even with ink drawn off it', () => {
    const off = [...hatchedWall(100, -200, 800)];
    const { rects } = wallZones(off, 600, 400);
    for (const r of rects) {
      expect(r.x).toBeGreaterThanOrEqual(0);
      expect(r.x + r.w).toBeLessThanOrEqual(600 + 7);
    }
  });

  it('can say whether a point landed in a shaded area', () => {
    const { rects } = wallZones(hatchedWall(100, 50, 300), 600, 400);
    expect(inZone({ x: 150, y: 107 }, rects)).toBe(true);
    expect(inZone({ x: 500, y: 350 }, rects)).toBe(false);
  });
});
