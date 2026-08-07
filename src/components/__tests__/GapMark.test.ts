import { describe, expect, it } from 'vitest';
import { labelAnchor } from '../GapMark';

/**
 * One invariant, from two directions: the label never lands on the dimension
 * line it is annotating.
 *
 * This has gone wrong twice. First the label was centred on the void, so a
 * 227 px label across a 308 px dimension left two stubs and no line. Then the
 * pushed-out label was centred on a point past the void, which swung half of
 * it straight back across the line it had just been moved off. Both times the
 * marker still looked fine at a glance and had quietly stopped saying which
 * two edges it measured between.
 *
 * The CSS anchors the label by the edge nearest the line — translate(-50%,
 * -100%) for a horizontal dimension, translate(0, -50%) for a vertical one —
 * so "clear of the line" is exactly "this anchor is past the line".
 */

/** A horizontal dimension: the line runs across the middle at y = 125. */
const wide = { left: 400, top: 100, width: 300, height: 50 };
/** A vertical dimension: the line runs down the middle at x = 550. */
const tall = { left: 500, top: 100, width: 100, height: 300 };

describe('labelAnchor', () => {
  it('puts a horizontal label above the line, never on it', () => {
    const line = wide.top + wide.height / 2;
    expect(labelAnchor(wide, 'u', true).y).toBeLessThan(line);
    expect(labelAnchor(wide, 'u', false).y).toBeLessThan(line);
  });

  it('puts a vertical label beside the line, never on it', () => {
    const line = tall.left + tall.width / 2;
    expect(labelAnchor(tall, 'v', true).x).toBeGreaterThan(line);
    expect(labelAnchor(tall, 'v', false).x).toBeGreaterThan(line);
  });

  it('centres a horizontal label on the dimension it describes', () => {
    expect(labelAnchor(wide, 'u', true).x).toBe(550);
    expect(labelAnchor(wide, 'u', false).x).toBe(550);
  });

  it('centres a vertical label on the dimension it describes', () => {
    expect(labelAnchor(tall, 'v', true).y).toBe(250);
    expect(labelAnchor(tall, 'v', false).y).toBe(250);
  });

  // Pushed out, it has to clear the whole void — not just the line — or it
  // covers the witness ticks at the two ends.
  it('clears the entire void when it will not fit inside', () => {
    expect(labelAnchor(wide, 'u', false).y).toBeLessThan(wide.top);
    expect(labelAnchor(tall, 'v', false).x).toBeGreaterThan(tall.left + tall.width);
  });

  // A void thinner than the label is the common case in plan, where the hole
  // is only as deep as a panel.
  it('still clears the line on a void only a few pixels across', () => {
    const sliver = { left: 400, top: 100, width: 300, height: 6 };
    const line = sliver.top + sliver.height / 2;
    expect(labelAnchor(sliver, 'u', true).y).toBeLessThan(line);
    expect(labelAnchor(sliver, 'u', false).y).toBeLessThan(sliver.top);
  });
});
