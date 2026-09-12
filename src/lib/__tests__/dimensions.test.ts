import { describe, expect, it } from 'vitest';
import {
  collectDimItems,
  DEFAULT_LENGTH_VISIBILITY,
  fmtLength,
  layoutDimensions,
  lengthKindOf,
  normalizeLengthVisibility,
  normalizePdfVisibility,
  DEFAULT_PDF_VISIBILITY,
  readableAngle,
  shows,
  type DimItem,
  type DimObstacle,
  type DimSource,
  type LengthKind,
  type LengthVisibility,
} from '../dimensions';
import { createSeedMaterials } from '../../data/seedCatalog';

const view = { zoom: 2, panX: 0, panY: 0, stageW: 2000, stageH: 1500 };

const span = (id: string, a: [number, number], b: [number, number], priority = 2): DimItem => ({
  id,
  a: { x: a[0], y: a[1] },
  b: { x: b[0], y: b[1] },
  text: [`${Math.abs(b[0] - a[0]) || Math.abs(b[1] - a[1])} სმ`],
  priority,
});

const byId = (placed: ReturnType<typeof layoutDimensions>) => new Map(placed.map((p) => [p.id, p]));

describe('layoutDimensions', () => {
  it('puts a length at the middle of its span, never at an end', () => {
    const [p] = layoutDimensions([span('a', [0, 100], [200, 100])], view);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeLessThan(200);
    expect(p.tier).toBe(0);
    expect(p.dimLine).toBeUndefined();
  });

  it('sends the second of two overlapping lengths to the other side before stacking', () => {
    // Two parallel lines 5 cm apart (10 px at zoom 2), overlapping, well clear
    // of the top of the screen.
    const placed = byId(
      layoutDimensions([span('long', [0, 110], [120, 110]), span('short', [10, 105], [110, 105])], view),
    );
    const short = placed.get('short')!;
    const long = placed.get('long')!;
    expect(short.tier).toBe(0);
    expect(long.tier).toBe(0);
    expect(short.y).toBeLessThan(210); // above its own line
    expect(long.y).toBeGreaterThan(220); // below its own line
    expect(Math.abs(long.y - short.y)).toBeGreaterThan(short.h);
  });

  it('stacks onto dimension lines only once both sides are taken', () => {
    const placed = layoutDimensions(
      [span('a', [0, 100], [120, 100]), span('b', [0, 100], [120, 100]), span('c', [0, 100], [120, 100])],
      view,
    );
    expect(placed.filter((p) => p.tier === 0)).toHaveLength(2);
    const stepped = placed.find((p) => p.tier > 0)!;
    // Its extension lines start at the true ends of what it measures.
    expect(stepped.ext![0][0].x).toBeCloseTo(0);
    expect(stepped.ext![1][0].x).toBeCloseTo(240);
  });

  it("puts a wall's two faces' lengths on the outside of each face", () => {
    // Faces 10 cm apart (20 px), both 200 long; each sees the other as in the way.
    const top = span('top', [0, 100], [200, 100]);
    const bottom = span('bottom', [0, 110], [200, 110]);
    const obstacles: DimObstacle[] = [
      { a: top.a, b: top.b, owner: 'top' },
      { a: bottom.a, b: bottom.b, owner: 'bottom' },
    ];
    const placed = byId(
      layoutDimensions([{ ...top, owners: ['top'] }, { ...bottom, owners: ['bottom'] }], { ...view, obstacles }),
    );
    expect(placed.get('top')!.y).toBeLessThan(200);
    expect(placed.get('bottom')!.y).toBeGreaterThan(220);
  });

  it('keeps a label off an edge that belongs to something else', () => {
    // A line 4 cm above (8 px): the label cannot sit on it, so it goes below.
    const obstacles: DimObstacle[] = [{ a: { x: 0, y: 96 }, b: { x: 200, y: 96 }, owner: 'other' }];
    const [p] = layoutDimensions([{ ...span('a', [0, 100], [200, 100]), owners: ['a'] }], { ...view, obstacles });
    expect(p.y).toBeGreaterThan(200);
  });

  it('ignores the edges of the very thing it measures, and clears them', () => {
    // A 9 cm deep panel whose label does not fit inside: its own edges are no obstacle.
    const obstacles: DimObstacle[] = [
      { a: { x: 0, y: 95.5 }, b: { x: 200, y: 95.5 }, owner: 'pc:p' },
      { a: { x: 0, y: 104.5 }, b: { x: 200, y: 104.5 }, owner: 'pc:p' },
    ];
    const item: DimItem = {
      ...span('pc:p', [0, 100], [200, 100]),
      inside: { along: 200, across: 9 },
      owners: ['pc:p'],
    };
    const [p] = layoutDimensions([item], { ...view, zoom: 1, obstacles });
    expect(p.tier).toBe(0);
    expect(p.inside).toBe(false);
    // The whole label is above the panel's top edge, not over the panel.
    expect(p.y + p.h / 2).toBeLessThanOrEqual(95.5);
  });

  it('never writes a label off the edge of the screen', () => {
    // 6 px from the top: above would be cut off, so it goes below.
    const [p] = layoutDimensions([span('a', [0, 3], [200, 3])], view);
    expect(p.y - p.h / 2).toBeGreaterThanOrEqual(0);
    expect(p.y).toBeGreaterThan(6);
  });

  it('leaves lengths that do not collide right beside their lines', () => {
    const placed = layoutDimensions(
      [span('a', [0, 0], [100, 0]), span('b', [0, 300], [100, 300]), span('c', [400, 0], [500, 0])],
      view,
    );
    expect(placed.map((p) => p.tier)).toEqual([0, 0, 0]);
  });

  it('never writes a length upside down', () => {
    const backwards = layoutDimensions([span('a', [200, 100], [0, 100])], view)[0];
    expect(backwards.angle).toBeCloseTo(0);
    const up = layoutDimensions([span('v', [100, 300], [100, 100])], view)[0];
    expect(up.angle).toBeGreaterThanOrEqual(-90);
    expect(up.angle).toBeLessThan(90);
    expect(readableAngle({ x: 0, y: 1 })).toBe(-90);
    expect(readableAngle({ x: -1, y: 0 })).toBeCloseTo(0);
  });

  it('comes out the same whatever order the items arrive in', () => {
    const items = [
      span('long', [0, 10], [120, 10]),
      span('short', [10, 5], [110, 5]),
      span('far', [600, 400], [700, 400]),
    ];
    const forward = byId(layoutDimensions(items, view));
    const reverse = byId(layoutDimensions([...items].reverse(), view));
    expect([...reverse.entries()].sort()).toEqual([...forward.entries()].sort());
  });

  it('skips what is off screen and what is too small to label', () => {
    expect(layoutDimensions([span('off', [5000, 5000], [5100, 5000])], view)).toEqual([]);
    expect(layoutDimensions([span('speck', [0, 0], [3, 0])], view)).toEqual([]);
    expect(layoutDimensions([span('speck', [0, 0], [3, 0])], { ...view, force: true })).toHaveLength(1);
  });

  it('uses the inside of a piece when the text fits there', () => {
    const item: DimItem = { ...span('pc', [0, 50], [200, 50]), inside: { along: 200, across: 60 } };
    const [p] = layoutDimensions([item], view);
    expect(p.inside).toBe(true);
    expect(p.x).toBeCloseTo(200);
    expect(p.y).toBeCloseTo(100);
  });
});

describe('fmtLength', () => {
  it('shows whole centimetres plainly and a diagonal to one decimal', () => {
    expect(fmtLength(45)).toBe('45');
    expect(fmtLength(Math.hypot(45, 45))).toBe('63.6');
  });
});

describe('the visibility table', () => {
  it('always, hover, click and never mean what the rows say', () => {
    expect([shows('always', false, false), shows('never', true, true)]).toEqual([true, false]);
    expect([shows('hover', true, false), shows('hover', false, true), shows('hover', false, false)]).toEqual([
      true,
      true,
      false,
    ]);
    expect([shows('click', true, false), shows('click', false, true)]).toEqual([false, true]);
  });

  it('files panels and fillers as wall, corners as corner, the rest as other', () => {
    const materials = createSeedMaterials();
    const kind = (category: string) => lengthKindOf(materials.find((m) => m.category === category)!);
    expect([kind('panel'), kind('filler'), kind('corner'), kind('waler'), kind('rod')]).toEqual([
      'wall',
      'wall',
      'corner',
      'other',
      'other',
    ]);
  });

  it('repairs saved settings cell by cell', () => {
    expect(normalizeLengthVisibility({ wall: 'always', line: 'bogus' })).toEqual({
      ...DEFAULT_LENGTH_VISIBILITY,
      wall: 'always',
    });
    expect(normalizePdfVisibility({ overall: false, wall: 'yes' })).toEqual({
      ...DEFAULT_PDF_VISIBILITY,
      overall: false,
    });
  });
});

describe('the two faces of a wall share one length', () => {
  const materials = createSeedMaterials();
  const line = (id: string, y: number, from = 100, to = 800) => ({
    id,
    points: [{ x: from, y }, { x: to, y }],
  });
  const source = (sketch: DimSource['sketch'], over: Partial<DimSource> = {}): DimSource => ({
    showLengths: true,
    visibility: { ...DEFAULT_LENGTH_VISIBILITY, line: 'always' },
    pieces: [],
    byId: new Map(materials.map((m) => [m.id, m])),
    showNames: false,
    sketch,
    measures: [],
    selectedIds: new Set(),
    selectedSketchIds: new Set(),
    hoverLeg: null,
    hoverPieceId: null,
    selectedMeasureId: null,
    hoverMeasureId: null,
    ...over,
  });
  const items = (src: DimSource) => collectDimItems(src).filter((i) => i.id.startsWith('sk'));

  it('shows one length for two matching faces, on the outer line', () => {
    // The wall from the screenshot: 700 long, faces 20 apart.
    const found = items(source([line('outer', 200), line('inner', 220)]));
    expect(found).toHaveLength(1);
    expect(found[0].id.startsWith('skw:')).toBe(true);
    expect(found[0].text).toEqual(['700 სმ']);
    expect(found[0].a.y).toBe(200);
  });

  it('keeps both when the lengths differ - they are different measurements', () => {
    const found = items(source([line('outer', 200), line('inner', 220, 110, 790)]));
    expect(found.map((i) => i.id).sort()).toEqual(['sk:inner:0', 'sk:outer:0']);
  });

  it('keeps both when they are too far apart to be one wall', () => {
    expect(items(source([line('a', 200), line('b', 500)]))).toHaveLength(2);
  });

  it('with only one face showing there is nothing to merge', () => {
    const found = items(
      source([line('outer', 200), line('inner', 220)], {
        visibility: { ...DEFAULT_LENGTH_VISIBILITY, line: 'click' },
        selectedSketchIds: new Set(['inner']),
      }),
    );
    expect(found.map((i) => i.id)).toEqual(['sk:inner:0']);
  });

  it('carries the highlight of whichever face is picked', () => {
    const found = items(
      source([line('outer', 200), line('inner', 220)], { selectedSketchIds: new Set(['inner']) }),
    );
    expect(found).toHaveLength(1);
    expect(found[0].accent).toBe(true);
  });
});

describe('collectDimItems', () => {
  const materials = createSeedMaterials();
  const panel = materials.find((m) => m.category === 'panel')!;
  const corner = materials.find((m) => m.category === 'corner')!;
  const waler = materials.find((m) => m.category === 'waler')!;
  const every = (v: LengthVisibility): Record<LengthKind, LengthVisibility> => ({
    wall: v,
    line: v,
    corner: v,
    other: v,
    measure: v,
  });

  const base: DimSource = {
    showLengths: true,
    visibility: every('click'),
    pieces: [
      { id: 'p1', materialId: panel.id, x: 0, y: 0, rot: 0 },
      { id: 'p2', materialId: panel.id, x: 200, y: 0, rot: 90 },
      { id: 'c1', materialId: corner.id, x: 400, y: 0, rot: 0 },
      { id: 'w1', materialId: waler.id, x: 0, y: 600, rot: 0 },
    ],
    byId: new Map(materials.map((m) => [m.id, m])),
    showNames: false,
    sketch: [{ id: 'k', points: [{ x: 0, y: 100 }, { x: 300, y: 100 }, { x: 300, y: 400 }] }],
    measures: [{ id: 'm', a: { x: 0, y: -15 }, b: { x: 45, y: -15 } }],
    selectedIds: new Set(),
    selectedSketchIds: new Set(),
    hoverLeg: null,
    hoverPieceId: null,
    selectedMeasureId: null,
    hoverMeasureId: null,
  };
  const ids = (src: DimSource) => collectDimItems(src).map((i) => i.id).sort();

  it('the master switch off hides everything', () => {
    expect(ids({ ...base, visibility: every('always'), showLengths: false })).toEqual([]);
  });

  it('never hides and always shows, per kind', () => {
    expect(ids({ ...base, visibility: every('never') })).toEqual([]);
    expect(ids({ ...base, visibility: every('always') })).toEqual([
      'ms:m',
      'pc:c1',
      'pc:p1',
      'pc:p2',
      'pc:w1',
      'sk:k:0',
      'sk:k:1',
    ]);
  });

  it('the table from the drawing: walls on hover, lines and corners on click, the rest never', () => {
    const table = { ...base, visibility: { ...DEFAULT_LENGTH_VISIBILITY } };
    // Nothing pointed at or picked: only the measured line, which is always.
    expect(ids(table)).toEqual(['ms:m']);
    expect(ids({ ...table, hoverPieceId: 'p1' })).toEqual(['ms:m', 'pc:p1']);
    // A corner pointed at is not enough - it wants a click.
    expect(ids({ ...table, hoverPieceId: 'c1' })).toEqual(['ms:m']);
    expect(ids({ ...table, selectedIds: new Set(['c1']) })).toEqual(['ms:m', 'pc:c1']);
    // A waler never shows, even picked.
    expect(ids({ ...table, selectedIds: new Set(['w1']) })).toEqual(['ms:m']);
    // A drawn leg hovered is not enough either; a picked run shows its legs and total.
    expect(ids({ ...table, hoverLeg: { pathId: 'k', index: 1 } })).toEqual(['ms:m']);
    expect(ids({ ...table, selectedSketchIds: new Set(['k']) })).toEqual([
      'ms:m',
      'sk:k:0',
      'sk:k:1',
      'skt:k',
    ]);
  });

  it('measures a turned piece along its own width, through its centre', () => {
    const item = collectDimItems({ ...base, selectedIds: new Set(['p2']) }).find(
      (i) => i.id === 'pc:p2',
    )!;
    const cx = 200 + panel.w / 2;
    const cy = 0 + panel.depth / 2;
    expect(item.a.x).toBeCloseTo(cx);
    expect(item.b.x).toBeCloseTo(cx);
    expect(Math.abs(item.b.y - item.a.y)).toBeCloseTo(panel.w);
    expect((item.a.y + item.b.y) / 2).toBeCloseTo(cy);
  });

  it('puts a name on a length only where a length is shown', () => {
    const named = { ...base, showNames: true };
    expect(collectDimItems(named).some((i) => i.id.startsWith('pc:'))).toBe(false);
    const picked = collectDimItems({ ...named, selectedIds: new Set(['p1']) });
    expect(picked.find((i) => i.id === 'pc:p1')!.text[0]).toBe(panel.name);
  });
});
