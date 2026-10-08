import { describe, expect, it } from 'vitest';
import { straighten } from '../StageCanvas';

/**
 * Holding a drag to one axis.
 *
 * The gesture is grab first, then hold Shift — pressing WITH Shift adjusts the
 * selection instead of starting a drag, the same as it always has. So this is
 * read live on every move, and has to behave sensibly being switched on and off
 * part-way through.
 */
describe('straighten', () => {
  it('leaves a drag alone when Shift is not down', () => {
    expect(straighten(40, -25, false)).toEqual({ dx: 40, dy: -25 });
  });

  it('drops the smaller component', () => {
    expect(straighten(40, -25, true)).toEqual({ dx: 40, dy: 0 });
    expect(straighten(-12, 90, true)).toEqual({ dx: 0, dy: 90 });
  });

  it('settles on one axis for a perfect diagonal rather than wobbling', () => {
    expect(straighten(50, 50, true)).toEqual({ dx: 50, dy: 0 });
    expect(straighten(-50, 50, true)).toEqual({ dx: -50, dy: 0 });
  });

  it('holds the axis the drag has actually travelled, not the last twitch', () => {
    // The total is what decides, so a hand wobbling near the end of a long
    // horizontal drag cannot flip it to vertical.
    expect(straighten(300, 4, true)).toEqual({ dx: 300, dy: 0 });
  });

  it('keeps a piece exactly on its line', () => {
    expect(straighten(137, 3, true).dy).toBe(0);
    expect(straighten(2, -410, true).dx).toBe(0);
  });
});
