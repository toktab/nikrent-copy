import { describe, expect, it } from 'vitest';
import {
  anchorFromEdge,
  DEFAULT_MEASURE_STYLE,
  firstPoint,
  magnetToMeasures,
  measureAt,
  measureContacts,
  nearestEdge,
  normalizeMeasureStyle,
  parallelEdge,
  pieceAt,
  referenceEdges,
  secondPoint,
  suggestEnd,
  type RefEdge,
} from '../measure';
import { legLength, type Point } from '../sketch';
import { createSeedMaterials } from '../../data/seedCatalog';

const expectPoint = (p: Point, x: number, y: number) => {
  expect(p.x).toBeCloseTo(x);
  expect(p.y).toBeCloseTo(y);
};

/** The wall in the sketch: 45 cm, running across. */
const wall: RefEdge = { a: { x: 0, y: 0 }, b: { x: 45, y: 0 }, key: 'sk:w:0' };
const opts = { step: 5, endSnapCm: 3 };

const second = (
  at: Point,
  over: Partial<Parameters<typeof secondPoint>[1]> & { first: Point },
) =>
  secondPoint(at, {
    firstEdge: null,
    suggestion: null,
    edges: [],
    measures: [],
    zoom: 1,
    step: 5,
    shift: false,
    helper: true,
    ...over,
  });

describe('holding a point off an edge', () => {
  it('snaps to the end of the wall and measures the offset in whole steps', () => {
    // The first picture: pointer just above the right-hand end, not clicked.
    const a = anchorFromEdge(wall, { x: 44, y: -14 }, opts);
    expectPoint(a.foot!, 45, 0);
    expectPoint(a.point, 45, -15);
    expect(Math.abs(a.offsetCm)).toBe(15);
    expect(a.atEnd).toBe('b');
  });

  it('suggests the far end the same distance off, so the line comes out parallel', () => {
    const first = anchorFromEdge(wall, { x: 44, y: -14 }, opts);
    const suggestion = suggestEnd(wall, first);
    expectPoint(suggestion.point, 0, -15);
    expectPoint(suggestion.foot!, 0, 0);
    expect(suggestion.atEnd).toBe('a');
    expect(legLength(first.point, suggestion.point)).toBeCloseTo(45);
  });

  it('lands mid-edge on the grid, never past either end', () => {
    const a = anchorFromEdge(wall, { x: 22, y: 8 }, opts);
    expectPoint(a.foot!, 20, 0);
    expectPoint(a.point, 20, 10);
    expect(a.atEnd).toBeNull();
    expectPoint(anchorFromEdge(wall, { x: 90, y: 40 }, { step: 5, endSnapCm: 1 }).foot!, 45, 0);
  });

  it('works off a diagonal edge', () => {
    const diag: RefEdge = { a: { x: 0, y: 0 }, b: { x: 30, y: 40 }, key: 'd' }; // 50 long
    const n = { x: -0.8, y: 0.6 };
    const at = { x: 15 + n.x * 12, y: 20 + n.y * 12 };
    const a = anchorFromEdge(diag, at, opts);
    expect(a.offsetCm).toBe(10);
    expectPoint(a.foot!, 15, 20);
    expect(legLength(a.foot!, a.point)).toBeCloseTo(10);
  });
});

describe('the snaps while placing a line', () => {
  const base = { edges: [wall], measures: [], zoom: 1, step: 5, helper: true };

  it('first click: held off the nearest edge within reach, or on the grid', () => {
    const near = firstPoint({ x: 44, y: -14 }, base);
    expectPoint(near.point, 45, -15);
    expect(near.helper?.edgeKey).toBe('sk:w:0');
    const free = firstPoint({ x: 212, y: 307 }, base);
    expectPoint(free.point, 210, 305);
    expect(free.helper).toBeNull();
  });

  it('first click: reaches a wall 45 cm away even when zoomed right in', () => {
    // At zoom 3.3 the old 40 px reach was 12 cm, and this missed the wall.
    const r = firstPoint({ x: 44, y: -44 }, { ...base, zoom: 3.3 });
    expect(r.via).toBe('edge');
    expectPoint(r.point, 45, -45);
  });

  it('90, not 90.1: a line from an off-grid panel corner comes out a whole length', () => {
    // A panel placed by edge snapping, its corner at x = 41.3, nothing else in reach.
    const r = second({ x: 131, y: -15.4 }, { first: { x: 41.3, y: -15 }, zoom: 3.3 });
    expect(legLength({ x: 41.3, y: -15 }, r.point)).toBeCloseTo(90);
    expect(r.point.y).toBeCloseTo(-15);
  });

  it('stays the same distance off the wall the first end was taken from', () => {
    const panel: RefEdge = { a: { x: 41.3, y: 0 }, b: { x: 131.3, y: 0 }, key: 'pc:p:0' };
    const first = anchorFromEdge(panel, { x: 42, y: -44 }, { step: 5, endSnapCm: 3 });
    const r = second({ x: 100, y: -47 }, { first: first.point, firstEdge: panel, edges: [panel], zoom: 3.3 });
    expect(r.via).toBe('parallel');
    expect(r.point.y).toBeCloseTo(first.point.y);
  });

  it('second click: takes the suggestion when the pointer is near it', () => {
    const first = anchorFromEdge(wall, { x: 44, y: -14 }, opts);
    const suggestion = suggestEnd(wall, first);
    const r = second({ x: 3, y: -11 }, { first: first.point, suggestion, edges: [wall], zoom: 2 });
    expect(r.via).toBe('suggestion');
    expectPoint(r.point, 0, -15);
  });

  it('second click: an exact corner beats a distance off an edge', () => {
    const r = second({ x: 44, y: 2 }, { first: { x: 0, y: -100 }, edges: [wall] });
    expect(r.via).toBe('vertex');
    expectPoint(r.point, 45, 0);
  });

  it('Shift holds the line to 15 degrees and a whole-step length', () => {
    const lock = { first: { x: 0, y: 0 }, shift: true };
    expectPoint(second({ x: 100, y: 8 }, lock).point, 100, 0);
    const diag = second({ x: 70, y: 72 }, lock).point;
    expect(Math.atan2(diag.y, diag.x) * (180 / Math.PI)).toBeCloseTo(45);
    expect(legLength({ x: 0, y: 0 }, diag)).toBeCloseTo(100);
  });

  it('with the helper off, ignores edges and the suggestion and just steps from the first point', () => {
    const first = anchorFromEdge(wall, { x: 44, y: -14 }, opts);
    const suggestion = suggestEnd(wall, first);
    const r = second({ x: 3, y: -11 }, { first: first.point, suggestion, edges: [wall], helper: false });
    expect(r.via).toBe('free');
    // Whole steps from the first point (45, -15): -40 across, +5 down.
    expectPoint(r.point, 5, -10);
    expect(firstPoint({ x: 44, y: -14 }, { ...base, helper: false }).via).toBe('free');
  });
});

describe('the magnet between measured lines', () => {
  const other = { id: 'o', a: { x: 0, y: 50 }, b: { x: 100, y: 50 } };

  it('pulls onto another line, and onto its end ahead of its middle', () => {
    expectPoint(magnetToMeasures({ x: 60, y: 53 }, [other], 5)!.point, 60, 50);
    expectPoint(magnetToMeasures({ x: 97, y: 52 }, [other], 5)!.point, 100, 50);
    expect(magnetToMeasures({ x: 60, y: 70 }, [other], 5)).toBeNull();
  });

  it('is used by both clicks while the helper is on', () => {
    const firstClick = firstPoint({ x: 60, y: 53 }, { edges: [], measures: [other], zoom: 1, step: 5, helper: true });
    expect(firstClick.via).toBe('magnet');
    const r = second({ x: 98, y: 48 }, { first: { x: 100, y: 0 }, measures: [other] });
    expect(r.via).toBe('magnet');
    expectPoint(r.point, 100, 50);
  });
});

describe('where measured lines meet', () => {
  const a = { id: 'a', a: { x: 0, y: 0 }, b: { x: 100, y: 0 } };

  it('marks an end resting on another line as touching', () => {
    const endToEnd = { id: 'c', a: { x: 100, y: 0 }, b: { x: 100, y: 50 } };
    const endOnLine = { id: 'd', a: { x: 20, y: 0 }, b: { x: 20, y: -30 } };
    const contacts = measureContacts([a, endToEnd, endOnLine]);
    expect(contacts.map((c) => c.kind)).toEqual(['touch', 'touch']);
    expect(contacts.some((c) => c.point.x === 100 && c.point.y === 0)).toBe(true);
    expect(contacts.some((c) => c.point.x === 20 && c.point.y === 0)).toBe(true);
  });

  it('marks two lines running through each other as crossing', () => {
    const through = { id: 'b', a: { x: 50, y: -20 }, b: { x: 50, y: 20 } };
    const [c] = measureContacts([a, through]);
    expect(c.kind).toBe('cross');
    expectPoint(c.point, 50, 0);
  });

  it('checks the line being placed as well, and ignores lines that do not meet', () => {
    expect(measureContacts([a], { a: { x: 50, y: 10 }, b: { x: 50, y: -10 } })[0].kind).toBe('cross');
    expect(measureContacts([a, { id: 'far', a: { x: 0, y: 30 }, b: { x: 100, y: 30 } }])).toEqual([]);
  });
});

describe('what can be measured off', () => {
  const materials = createSeedMaterials();
  const panel = materials.find((m) => m.category === 'panel')!;
  const byId = new Map(materials.map((m) => [m.id, m]));

  it('includes every edge of a placed piece, turned as it is on screen', () => {
    const edges = referenceEdges([], [{ id: 'p', materialId: panel.id, x: 0, y: 0, rot: 90 }], byId, []);
    expect(edges).toHaveLength(4);
    const xs = edges.flatMap((e) => [e.a.x, e.b.x]);
    const ys = edges.flatMap((e) => [e.a.y, e.b.y]);
    const cx = panel.w / 2;
    const cy = panel.depth / 2;
    expect(Math.min(...xs)).toBeCloseTo(cx - panel.depth / 2);
    expect(Math.max(...xs)).toBeCloseTo(cx + panel.depth / 2);
    expect(Math.min(...ys)).toBeCloseTo(cy - panel.w / 2);
    expect(Math.max(...ys)).toBeCloseTo(cy + panel.w / 2);
  });

  it('includes drawn legs and lines already measured', () => {
    const edges = referenceEdges(
      [{ id: 'k', points: [{ x: 0, y: 0 }, { x: 100, y: 0 }, { x: 100, y: 50 }] }],
      [],
      byId,
      [{ id: 'm', a: { x: 0, y: -15 }, b: { x: 45, y: -15 } }],
    );
    expect(edges.map((e) => e.key)).toEqual(['sk:k:0', 'sk:k:1', 'ms:m']);
  });

  it('finds the nearest edge within reach only', () => {
    expect(nearestEdge([wall], { x: 20, y: 30 }, 40)?.edge.key).toBe('sk:w:0');
    expect(nearestEdge([wall], { x: 20, y: 60 }, 40)).toBeNull();
  });

  it('finds the piece under the pointer, turned as it is on screen', () => {
    const pieces = [{ id: 'p', materialId: panel.id, x: 0, y: 0, rot: 90 }];
    const cx = panel.w / 2;
    const cy = panel.depth / 2;
    expect(pieceAt(pieces, byId, { x: cx, y: cy + panel.w / 2 - 1 })).toBe('p');
    // Where it was before being turned is empty now.
    expect(pieceAt(pieces, byId, { x: 2, y: cy })).toBeNull();
  });
});

describe('reading a saved line', () => {
  const saved = { id: 'm', a: { x: 0, y: -15 }, b: { x: 45, y: -15 } };

  it('finds the wall it runs alongside and how far each end stands off it', () => {
    const found = parallelEdge(saved, [wall])!;
    expect(found.edge.key).toBe('sk:w:0');
    expect(found.offA).toBeCloseTo(15);
    expect(found.offB).toBeCloseTo(15);
    expectPoint(found.footA, 0, 0);
    expectPoint(found.footB, 45, 0);
  });

  it('ignores edges that are not parallel, not beside it, or the line itself', () => {
    const across: RefEdge = { a: { x: 0, y: 0 }, b: { x: 0, y: 45 }, key: 'x' };
    const elsewhere: RefEdge = { a: { x: 500, y: 0 }, b: { x: 545, y: 0 }, key: 'e' };
    const itself: RefEdge = { a: saved.a, b: saved.b, key: 'ms:m' };
    expect(parallelEdge(saved, [across, elsewhere, itself])).toBeNull();
  });

  it('picks a saved line by proximity', () => {
    expect(measureAt([saved], { x: 20, y: -13 }, 5)).toBe('m');
    expect(measureAt([saved], { x: 20, y: 10 }, 5)).toBeNull();
  });
});

describe('normalizeMeasureStyle', () => {
  it('repairs a bad field without losing the good ones', () => {
    const style = normalizeMeasureStyle({ color: 'nope', opacity: 5, focusColor: '#00ff00', helper: false });
    expect(style).toEqual({ ...DEFAULT_MEASURE_STYLE, opacity: 1, focusColor: '#00ff00', helper: false });
    expect(normalizeMeasureStyle(undefined)).toEqual(DEFAULT_MEASURE_STYLE);
    expect(normalizeMeasureStyle({ opacity: 0 }).opacity).toBe(0.15);
  });
});
