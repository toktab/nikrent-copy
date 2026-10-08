import { describe, expect, it } from 'vitest';
import type { VectorDrawing } from '../../detection/pdf';
import {
  axisOf,
  extractSegments,
  mapSegments,
  segLength,
  viewportMapper,
  type Seg,
} from '../segments';
import { matchStroke, piecesOverlap, strokeAlong, strokeAsSegment } from '../match';
import { chainPaths, fitTracedLines, originAt, type TracedLine } from '../fit';

const drawing = (items: VectorDrawing['items']): VectorDrawing => ({
  type: 's',
  fill: null,
  stroke: [0, 0, 0],
  rect: { x0: 0, y0: 0, x1: 100, y1: 100 },
  items,
});

const line = (x0: number, y0: number, x1: number, y1: number) =>
  ({ type: 'l', p1: { x: x0, y: y0 }, p2: { x: x1, y: y1 } }) as const;

describe('extractSegments', () => {
  // A CAD exporter cuts a wall at every door, hatch and dimension that crosses
  // it. Tracing has to land on the wall, not on the piece under the pointer.
  it('puts a wall split into pieces back together', () => {
    const segs = extractSegments([drawing([line(0, 0, 40, 0), line(40, 0, 90, 0), line(90, 0, 120, 0)])]);
    expect(segs).toHaveLength(1);
    expect(segLength(segs[0])).toBeCloseTo(120);
  });

  it('joins across the small gap a door leaves, but not across a real one', () => {
    const near = extractSegments([drawing([line(0, 0, 40, 0), line(42, 0, 100, 0)])]);
    expect(near).toHaveLength(1);
    const far = extractSegments([drawing([line(0, 0, 40, 0), line(70, 0, 100, 0)])]);
    expect(far).toHaveLength(2);
  });

  it('keeps two walls a pour apart separate', () => {
    const segs = extractSegments([drawing([line(0, 0, 100, 0), line(0, 20, 100, 20)])]);
    expect(segs).toHaveLength(2);
  });

  it('reads a rectangle as its four edges', () => {
    const segs = extractSegments([
      drawing([{ type: 're', rect: { x0: 0, y0: 0, x1: 60, y1: 30 } }]),
    ]);
    expect(segs).toHaveLength(4);
    expect(segs.filter((s) => axisOf(s) === 'h')).toHaveLength(2);
    expect(segs.filter((s) => axisOf(s) === 'v')).toHaveLength(2);
  });

  it('drops hatch ticks and rounding specks', () => {
    const segs = extractSegments([drawing([line(0, 0, 100, 0), line(10, 10, 10.6, 10.6)])]);
    expect(segs).toHaveLength(1);
  });

  it('skips curves rather than flattening them into chords', () => {
    const segs = extractSegments([
      drawing([
        { type: 'c', p1: { x: 0, y: 0 }, c1: { x: 5, y: 9 }, c2: { x: 15, y: 9 }, p4: { x: 20, y: 0 } },
      ]),
    ]);
    expect(segs).toHaveLength(0);
  });

  it('offers the longest lines first', () => {
    const segs = extractSegments([drawing([line(0, 0, 30, 0), line(0, 10, 200, 10), line(0, 20, 90, 20)])]);
    expect(segs.map((s) => Math.round(segLength(s)))).toEqual([200, 90, 30]);
  });
});

describe('putting the lines where the page is drawn', () => {
  /**
   * The bug this exists for: an A3 sheet stored portrait with /Rotate 90.
   * The renderer turns it a quarter circle; the extracted geometry is not
   * turned, and was flipped with the rotated height, so it landed off the
   * page entirely - which is what made every traced line miss its wall.
   */
  it('turns a rotated page’s geometry onto the rendered sheet', () => {
    // pdf.js for /Rotate 90 on a 841.8 × 1190.52 page: (x, y) -> (y, x).
    const convert = (x: number, y: number) => [y, x];
    const map = viewportMapper(841.8, convert);
    // A point extraction reported above the page, as it does on these sheets.
    expect(map({ x: 93.6, y: -296.1 })).toEqual({ x: 1137.9, y: 93.6 });
    const inside = map({ x: 400, y: 600 });
    expect(inside.x).toBeCloseTo(241.8, 1);
    expect(inside.y).toBe(400);
  });

  it('leaves an unrotated page exactly where it was', () => {
    // The ordinary transform: flip y about the page height.
    const h = 842;
    const map = viewportMapper(h, (x, y) => [x, h - y]);
    expect(map({ x: 120, y: 300 })).toEqual({ x: 120, y: 300 });
  });

  it('moves both ends and keeps what the line is', () => {
    const list: Seg[] = [{ id: 'a', a: { x: 1, y: 2 }, b: { x: 3, y: 4 }, parts: 7 }];
    const moved = mapSegments(list, (p) => ({ x: p.x + 10, y: p.y * 2 }));
    expect(moved[0]).toEqual({ id: 'a', a: { x: 11, y: 4 }, b: { x: 13, y: 8 }, parts: 7 });
  });
});

describe('matchStroke', () => {
  const wall: Seg = { id: 'wall', a: { x: 0, y: 0 }, b: { x: 200, y: 0 }, parts: 1 };
  const other: Seg = { id: 'other', a: { x: 0, y: 60 }, b: { x: 200, y: 60 }, parts: 1 };
  const post: Seg = { id: 'post', a: { x: 100, y: -30 }, b: { x: 100, y: 30 }, parts: 1 };
  const segs = [wall, other, post];

  it('takes the line the stroke was drawn along, wobble and all', () => {
    const hit = matchStroke({ x: 20, y: 3 }, { x: 160, y: -2 }, segs);
    expect(hit?.seg.id).toBe('wall');
  });

  it('says so when the stroke covered only part of it', () => {
    const hit = matchStroke({ x: 10, y: 0 }, { x: 60, y: 0 }, segs)!;
    expect(hit.seg.id).toBe('wall');
    expect(hit.coverage).toBeCloseTo(0.25, 1);
  });

  it('ignores a line the stroke crosses instead of follows', () => {
    const hit = matchStroke({ x: 100, y: -20 }, { x: 100, y: 20 }, segs);
    expect(hit?.seg.id).toBe('post');
  });

  it('matches nothing when the stroke is over empty paper', () => {
    expect(matchStroke({ x: 0, y: 300 }, { x: 100, y: 300 }, segs)).toBeNull();
  });

  it('prefers the long wall to a short piece lying on it', () => {
    const chip: Seg = { id: 'chip', a: { x: 40, y: 0 }, b: { x: 55, y: 0 }, parts: 1 };
    const hit = matchStroke({ x: 42, y: 0 }, { x: 52, y: 0 }, [chip, wall]);
    expect(hit?.seg.id).toBe('wall');
  });

  it('keeps an unmatched stroke as the user’s own line', () => {
    const own = strokeAsSegment({ x: 0, y: 0 }, { x: 10, y: 0 }, 'hand1');
    expect(own).toMatchObject({ id: 'hand1', parts: 0 });
  });

  it('squares up a hand line that was nearly square already', () => {
    const own = strokeAsSegment({ x: 0, y: 0 }, { x: 200, y: 6 }, 'hand2');
    expect(own.b).toEqual({ x: 200, y: 0 });
    const upright = strokeAsSegment({ x: 0, y: 0 }, { x: 5, y: 150 }, 'hand3');
    expect(upright.b).toEqual({ x: 0, y: 150 });
    // ...and leaves a deliberate diagonal alone.
    const diagonal = strokeAsSegment({ x: 0, y: 0 }, { x: 100, y: 100 }, 'hand4');
    expect(diagonal.b).toEqual({ x: 100, y: 100 });
  });
});

describe('strokeAlong', () => {
  const wall = { a: { x: 0, y: 0 }, b: { x: 200, y: 0 } };

  it('takes what was drawn, straightened onto the line', () => {
    const piece = strokeAlong(wall, { x: 52, y: 4 }, { x: 140, y: -3 });
    expect(piece.a).toEqual({ x: 52, y: 0 });
    expect(piece.b).toEqual({ x: 140, y: 0 });
  });

  // Nobody hits the exact end of a wall by hand, and a corner that nearly
  // meets is the one defect that makes a traced drawing useless.
  it('runs to the corner when the stroke came close to it', () => {
    const piece = strokeAlong(wall, { x: 6, y: 1 }, { x: 191, y: -1 });
    expect(piece.a.x).toBe(0);
    expect(piece.b.x).toBe(200);
  });

  it('never runs past the line', () => {
    const piece = strokeAlong(wall, { x: -80, y: 0 }, { x: 320, y: 0 });
    expect(piece.a.x).toBe(0);
    expect(piece.b.x).toBe(200);
  });

  it('keeps a vertical wall vertical', () => {
    const upright = { a: { x: 10, y: 0 }, b: { x: 10, y: 300 } };
    const piece = strokeAlong(upright, { x: 13, y: 100 }, { x: 8, y: 220 });
    expect(piece.a).toEqual({ x: 10, y: 100 });
    expect(piece.b).toEqual({ x: 10, y: 220 });
  });

  it('spots a stretch of a wall that is already taken', () => {
    const first = { a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };
    expect(piecesOverlap(first, { a: { x: 50, y: 0 }, b: { x: 150, y: 0 } })).toBe(true);
    expect(piecesOverlap(first, { a: { x: 120, y: 0 }, b: { x: 190, y: 0 } })).toBe(false);
  });
});

describe('fitTracedLines', () => {
  /** An L: 100 pt across, then 50 pt down from its right-hand end. */
  const elbow = (over: Partial<Record<'top' | 'side', number>> = {}): TracedLine[] => [
    {
      id: 'top',
      a: { x: 0, y: 0 },
      b: { x: 100, y: 0 },
      ...(over.top !== undefined ? { lengthCm: over.top } : {}),
    },
    {
      id: 'side',
      a: { x: 100, y: 0 },
      b: { x: 100, y: 50 },
      ...(over.side !== undefined ? { lengthCm: over.side } : {}),
    },
  ];

  it('scales everything off the one line whose length is known', () => {
    const fit = fitTracedLines(elbow(), { cmPerPoint: 2 });
    expect(fit.lines[0].lengthCm).toBeCloseTo(200, 1);
    expect(fit.lines[1].lengthCm).toBeCloseTo(100, 1);
  });

  it('gives a typed length exactly, and drags the corner with it', () => {
    const fit = fitTracedLines(elbow({ top: 490 }), { cmPerPoint: 1 });
    const top = fit.lines[0];
    const side = fit.lines[1];
    expect(top.lengthCm).toBeCloseTo(490, 2);
    expect(top.errorCm).toBeCloseTo(0, 2);
    // The corner is still a corner: the side starts where the top ends.
    expect(side.a.x).toBeCloseTo(top.b.x, 6);
    expect(side.a.y).toBeCloseTo(top.b.y, 6);
    // ...and the wall nobody corrected kept the length the page gave it.
    expect(side.lengthCm).toBeCloseTo(50, 1);
  });

  it('honours two typed lengths at once', () => {
    const fit = fitTracedLines(elbow({ top: 490, side: 275 }), { cmPerPoint: 1 });
    expect(fit.lines[0].lengthCm).toBeCloseTo(490, 2);
    expect(fit.lines[1].lengthCm).toBeCloseTo(275, 2);
    expect(fit.maxErrorCm).toBeLessThan(0.1);
    expect(fit.assigned).toBe(2);
  });

  it('keeps a wall straight: both its ends stay level', () => {
    const skewy: TracedLine[] = [
      { id: 'a', a: { x: 0, y: 0 }, b: { x: 100, y: 1.5 }, lengthCm: 300 },
    ];
    const fit = fitTracedLines(skewy, { cmPerPoint: 1 });
    expect(fit.lines[0].a.y).toBeCloseTo(fit.lines[0].b.y, 6);
    expect(fit.lines[0].lengthCm).toBeCloseTo(300, 2);
  });

  it('reports a typed length it cannot enforce on a line that is not square', () => {
    const diagonal: TracedLine[] = [
      { id: 'd', a: { x: 0, y: 0 }, b: { x: 100, y: 100 }, lengthCm: 400 },
    ];
    const fit = fitTracedLines(diagonal, { cmPerPoint: 1 });
    expect(fit.skewed).toEqual(['d']);
    expect(fit.lines[0].axis).toBe('free');
  });

  it('can sit the result on the drawing’s 5 cm rule without losing the typed length', () => {
    const fit = fitTracedLines(elbow({ top: 490 }), { cmPerPoint: 1.07, snapCm: 5 });
    expect(fit.lines[0].lengthCm).toBeCloseTo(490, 1);
    expect(fit.lines[1].a.x % 5).toBeCloseTo(0, 6);
  });

  it('leaves a drawing with no typed lengths where the page put it', () => {
    const fit = fitTracedLines(elbow(), { cmPerPoint: 1 });
    expect(fit.maxMovedCm).toBeLessThan(0.5);
  });
});

describe('chainPaths', () => {
  const pt = (x: number, y: number) => ({ x, y });

  it('strings walls that meet into one run', () => {
    const lines = [
      { a: pt(0, 0), b: pt(100, 0) },
      { a: pt(100, 0), b: pt(100, 80) },
    ];
    const paths = chainPaths(lines, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0].points).toHaveLength(3);
    expect(paths[0].closed).toBe(false);
  });

  it('closes a room that comes back to where it started', () => {
    const lines = [
      { a: pt(0, 0), b: pt(100, 0) },
      { a: pt(100, 0), b: pt(100, 100) },
      { a: pt(100, 100), b: pt(0, 100) },
      { a: pt(0, 100), b: pt(0, 0) },
    ];
    const paths = chainPaths(lines, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 2, b: 3 },
      { a: 3, b: 0 },
    ]);
    expect(paths).toHaveLength(1);
    expect(paths[0].closed).toBe(true);
    expect(paths[0].points).toHaveLength(4);
  });

  it('stops a run at a junction rather than guessing which way it goes', () => {
    const lines = [
      { a: pt(0, 0), b: pt(100, 0) },
      { a: pt(100, 0), b: pt(200, 0) },
      { a: pt(100, 0), b: pt(100, 90) },
    ];
    const paths = chainPaths(lines, [
      { a: 0, b: 1 },
      { a: 1, b: 2 },
      { a: 1, b: 3 },
    ]);
    expect(paths).toHaveLength(3);
  });

  it('leaves a line that touches nothing on its own', () => {
    const paths = chainPaths([{ a: pt(0, 0), b: pt(10, 0) }], [{ a: 0, b: 1 }]);
    expect(paths).toHaveLength(1);
    expect(paths[0].points).toHaveLength(2);
  });
});

describe('originAt', () => {
  it('brings the drawing back to the top-left corner of the sheet', () => {
    const moved = originAt([{ points: [{ x: 900, y: 700 }, { x: 1000, y: 700 }], closed: false }], 50);
    expect(moved[0].points[0]).toEqual({ x: 50, y: 50 });
    expect(moved[0].points[1]).toEqual({ x: 150, y: 50 });
  });
});
