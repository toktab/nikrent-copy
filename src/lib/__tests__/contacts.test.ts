import { describe, expect, it } from 'vitest';
import { contactBetween, sketchEndContacts } from '../contacts';

describe('contacts - touching or nearly', () => {
  it('two panels side by side with no gap touch along their shared height', () => {
    const c = contactBetween({ x: 0, y: 0, w: 60, h: 10 }, { x: 60, y: 0, w: 90, h: 10 });
    expect(c).toMatchObject({ kind: 'touch', x1: 60, x2: 60, y1: 0, y2: 10 });
  });
  it('a 2 cm gap is nearly touching, red', () => {
    const c = contactBetween({ x: 0, y: 0, w: 60, h: 10 }, { x: 62, y: 0, w: 90, h: 10 });
    expect(c).toMatchObject({ kind: 'near', gap: 2 });
  });
  it('far apart or only corner to corner is nothing', () => {
    expect(contactBetween({ x: 0, y: 0, w: 60, h: 10 }, { x: 70, y: 0, w: 90, h: 10 })).toBeNull();
    expect(contactBetween({ x: 0, y: 0, w: 60, h: 10 }, { x: 60, y: 10, w: 10, h: 60 })).toBeNull();
  });
  it('a drawn line ending on another touches; one stopping short is near', () => {
    const wall = { id: 'a', points: [{ x: 0, y: 0 }, { x: 300, y: 0 }], closed: false };
    const onIt = { id: 'b', points: [{ x: 100, y: 0 }, { x: 100, y: 200 }], closed: false };
    const short = { id: 'c', points: [{ x: 200, y: 3 }, { x: 200, y: 200 }], closed: false };
    const ends = sketchEndContacts([wall, onIt, short] as never);
    expect(ends.find((e) => e.x === 100 && e.y === 0)?.kind).toBe('touch');
    expect(ends.find((e) => e.x === 200 && e.y === 3)?.kind).toBe('near');
  });
});
