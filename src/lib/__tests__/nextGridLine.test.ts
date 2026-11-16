import { describe, expect, it } from 'vitest';
import { nextGridLine } from '../geometry';

describe('nextGridLine - arrows land on the squares', () => {
  it('goes onto the nearest line that way from between the squares', () => {
    expect(nextGridLine(7, 5)).toBe(10);
    expect(nextGridLine(7, -5)).toBe(5);
  });
  it('moves exactly one square from a line', () => {
    expect(nextGridLine(10, 5)).toBe(15);
    expect(nextGridLine(10, -5)).toBe(5);
    expect(nextGridLine(-10, -5)).toBe(-15);
  });
  it('is not thrown by float noise', () => {
    expect(nextGridLine(14.9999999, 5)).toBe(20);
  });
});
