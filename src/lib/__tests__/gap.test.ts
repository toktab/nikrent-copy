import { describe, expect, it } from 'vitest';
import { allGaps, componentThatFits, faceBands, nearestGap } from '../gap';
import type { Material } from '../../types';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

/**
 * A rect that lies in one face plane — a panel or a filler. The plane is the
 * strip its own thickness occupies, which is the y-range of a face running
 * across and the x-range of one running down.
 */
const across = (x: number, y: number, w: number, h: number) => ({
  ...rect(x, y, w, h),
  bands: [{ axis: 'u' as const, from: y, to: y + h }],
});
const down = (x: number, y: number, w: number, h: number) => ({
  ...rect(x, y, w, h),
  bands: [{ axis: 'v' as const, from: x, to: x + w }],
});

const mat = (name: string, w: number, category: Material['category'], h = 300): Material =>
  ({ id: name, name, category, w, h, depth: 9, shape: 'rect', color: '#000', stock: {} }) as Material;

describe('nearestGap', () => {
  it('reports the height of the piece across the gap, so a fill can match it', () => {
    const gap = nearestGap(rect(0, 0, 90, 9), [{ ...rect(135, 0, 90, 9), heightCm: 300 }]);
    expect(gap?.size).toBe(45);
    expect(gap?.againstHeight).toBe(300);
  });

  it('measures the clear distance to the panel beside it', () => {
    const moving = rect(0, 0, 90, 300);
    const gap = nearestGap(moving, [rect(100, 0, 90, 300)]);
    expect(gap?.size).toBe(10);
    expect(gap?.axis).toBe('u');
    // the void itself: 10 wide, starting where the moving box ends, and as
    // long as the edge the two actually share
    expect([gap?.x, gap?.y, gap?.w, gap?.h]).toEqual([90, 0, 10, 300]);
  });

  it('measures a gap on the left as readily as one on the right', () => {
    const gap = nearestGap(rect(100, 0, 90, 300), [rect(0, 0, 45, 300)]);
    expect(gap?.size).toBe(55);
    expect([gap?.x, gap?.w]).toEqual([45, 55]);
  });

  it('ignores a piece that shares no edge — it is not in the same run', () => {
    // Far below, so the two never face each other across the gap.
    expect(nearestGap(rect(0, 0, 90, 300), [rect(100, 900, 90, 300)])).toBeNull();
  });

  it('reports the smallest gap when a piece has neighbours on both sides', () => {
    const gap = nearestGap(rect(100, 0, 90, 300), [
      rect(0, 0, 90, 300), // 10 to the left
      rect(200, 0, 90, 300), // 10 to the right
      rect(100, 320, 90, 300), // 20 below
    ]);
    expect(gap?.size).toBe(10);
  });

  it('finds a gap below as well as beside', () => {
    const gap = nearestGap(rect(0, 0, 90, 150), [rect(0, 175, 90, 150)]);
    expect(gap?.size).toBe(25);
    expect(gap?.axis).toBe('v');
    expect([gap?.x, gap?.y, gap?.w, gap?.h]).toEqual([0, 150, 90, 25]);
  });

  it('does not call touching panels a gap', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(90, 0, 90, 300)])).toBeNull();
  });

  // The one that got through the first time: a touching neighbour was discarded
  // as "not a gap", so the panel beyond it won and the drawing reported a 90 cm
  // hole measured straight through the panel in between.
  it('does not measure through the panel next to it', () => {
    const run = [rect(90, 0, 90, 300), rect(180, 0, 90, 300), rect(270, 0, 90, 300)];
    expect(nearestGap(rect(0, 0, 90, 300), run)).toBeNull();
  });

  it('reports the leftover at the end of a butted run', () => {
    const run = [rect(90, 0, 90, 300), rect(180, 0, 90, 300), rect(405, 0, 45, 300)];
    // 270 is the last butted panel; the next thing is 45 cm past its end.
    expect(nearestGap(rect(270, 0, 90, 300), run)?.size).toBe(45);
  });

  it('does not call an overlap a gap', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(80, 0, 90, 300)])).toBeNull();
  });

  it('ignores a neighbour too far away to be a joint', () => {
    expect(nearestGap(rect(0, 0, 90, 300), [rect(900, 0, 90, 300)], 400)).toBeNull();
  });

  // In plan a panel on the ground and one on the next lift have the same
  // footprint, so without the third dimension the clear air between two courses
  // reads as a hole in a wall.
  it('does not measure between two different courses', () => {
    const onGround = { ...rect(0, 0, 90, 9), span: [0, 300] as [number, number] };
    const nextLift = { ...rect(135, 0, 90, 9), span: [300, 600] as [number, number] };
    expect(nearestGap(onGround, [nextLift])).toBeNull();
  });

  // In plan a panel is 90 wide and 9 thick. What sits beyond its length is the
  // next panel in the run; what sits across its thickness is the far side of
  // the same wall, and the distance between them is the concrete.
  it('does not measure across the thickness of a wall', () => {
    const face = across(0, 0, 90, 9);
    const farSide = rect(0, 36, 90, 9);
    expect(nearestGap(face, [farSide])).toBeNull();
  });

  it('still measures along the run to the next piece in the same face', () => {
    expect(nearestGap(across(0, 0, 90, 9), [across(135, 0, 90, 9)])?.size).toBe(45);
  });

  it('measures both ways in an elevation, where above is the next course', () => {
    const silhouette = rect(0, -300, 90, 300);
    expect(nearestGap(silhouette, [rect(0, -620, 90, 300)])?.axis).toBe('v');
  });

  it('still measures between two pieces on the same course', () => {
    const a = { ...rect(0, 0, 90, 9), span: [0, 300] as [number, number] };
    const b = { ...rect(135, 0, 90, 9), span: [0, 300] as [number, number] };
    expect(nearestGap(a, [b])?.size).toBe(45);
  });
});

describe('the void', () => {
  // Two panels offset from each other only face along part of their edges, and
  // the hole is that part — not the full height of either one.
  it('is clipped to the edge the two pieces actually share', () => {
    const gap = nearestGap(rect(0, 0, 90, 300), [rect(135, 200, 90, 300)]);
    expect([gap?.x, gap?.y, gap?.w, gap?.h]).toEqual([90, 200, 45, 100]);
  });
});

describe('allGaps', () => {
  it('counts each opening once, not once from either side', () => {
    const run = [rect(0, 0, 90, 300), rect(135, 0, 90, 300)];
    const found = allGaps(run);
    expect(found).toHaveLength(1);
    expect(found[0].size).toBe(45);
  });

  it('finds every hole in a run and skips the butted joints', () => {
    const run = [
      rect(0, 0, 90, 300),
      rect(90, 0, 90, 300), // butted — no hole
      rect(225, 0, 90, 300), // 45 hole before it
      rect(360, 0, 45, 300), // 45 hole before it
    ];
    expect(allGaps(run).map((g) => g.size).sort()).toEqual([45, 45]);
  });

  it('is silent on a run with no holes at all', () => {
    expect(allGaps([rect(0, 0, 90, 300), rect(90, 0, 90, 300)])).toEqual([]);
  });
});

describe('componentThatFits', () => {
  const catalog = [
    // 150 deliberately first, so "the shorter one happened to come first in the
    // catalog" cannot pass by accident.
    mat('პანელი 45*150', 45, 'panel', 150),
    mat('პანელი 45*300', 45, 'panel', 300),
    mat('პანელი 90*300', 90, 'panel'),
    mat('ჩაკერება 10*300', 10, 'filler'),
    mat('waler 100', 100, 'waler'),
    mat('გარე კუთხე 300', 10, 'corner'),
  ];

  it('matches the height of the run it is closing', () => {
    expect(componentThatFits(45, catalog, 300)).toBe('პანელი 45*300');
    expect(componentThatFits(45, catalog, 150)).toBe('პანელი 45*150');
  });

  it('still answers when the height of the neighbour is unknown', () => {
    expect(componentThatFits(45, catalog)).toBe('პანელი 45*150');
  });

  it('names the panel that closes the gap', () => {
    expect(componentThatFits(45, catalog, 300)).toBe('პანელი 45*300');
  });

  it('names a filler for a small gap', () => {
    expect(componentThatFits(10, catalog)).toBe('ჩაკერება 10*300');
  });

  it('offers nothing when the gap has to be cut on site', () => {
    expect(componentThatFits(37, catalog)).toBeUndefined();
  });

  // The bug this file was reopened for: a 10 cm filler was offered to close a
  // 9.7 cm hole, because the tolerance was symmetric. Steel-framed ply does not
  // compress — a part wider than the gap is a wasted trip to the yard.
  it('never offers a component wider than the gap', () => {
    expect(componentThatFits(9.7, catalog, 300)).toBeUndefined();
    expect(componentThatFits(9.9, catalog, 300)).toBeUndefined();
  });

  it('accepts a hair of arithmetic noise off a drag', () => {
    expect(componentThatFits(9.95, catalog, 300)).toBe('ჩაკერება 10*300');
    expect(componentThatFits(10.1, catalog, 300)).toBe('ჩაკერება 10*300');
  });

  it('takes a component slightly narrower than the gap', () => {
    expect(componentThatFits(10.4, catalog, 300)).toBe('ჩაკერება 10*300');
  });

  // An L cannot close a straight run; it belongs where two faces meet.
  it('does not offer a corner as a fill', () => {
    expect(componentThatFits(10, [mat('გარე კუთხე', 10, 'corner')])).toBeUndefined();
  });

  // A waler is not a face — it never closes a gap in the formwork skin, so it
  // must not be offered as one even though its width would match.
  it('only offers panels and fillers', () => {
    expect(componentThatFits(100, catalog)).toBeUndefined();
  });
});

describe('faceBands', () => {
  const panel = mat('პანელი 90*300', 90, 'panel');
  const filler = mat('ჩაკერება 5*300', 5, 'filler');
  const outer = { ...mat('გარე კუთხე 300', 24, 'corner'), depth: 24, shape: 'L' as const };

  it('puts a panel in the plane its own thickness occupies', () => {
    expect(faceBands(rect(0, 100, 90, 9), panel, 0, false)).toEqual([
      { axis: 'u', from: 100, to: 109 },
    ]);
    expect(faceBands(rect(100, 0, 9, 90), panel, 90, false)).toEqual([
      { axis: 'v', from: 100, to: 109 },
    ]);
  });

  // 5 wide and 9 deep: taller than it is wide, and still lying in a face that
  // runs across. Read off the shape it would be stood on end.
  it('is not fooled by a filler narrower than the system is thick', () => {
    expect(faceBands(rect(0, 100, 5, 9), filler, 0, false)).toEqual([
      { axis: 'u', from: 100, to: 109 },
    ]);
  });

  // The whole reason a corner is a corner: it belongs to both faces it joins,
  // so a run arriving along either can be measured against it.
  it('puts a corner in two planes, one along each leg', () => {
    // drawn with its legs down the left and along the bottom
    expect(faceBands(rect(0, 0, 24, 24), outer, 0, false)).toEqual([
      { axis: 'v', from: 0, to: 9 },
      { axis: 'u', from: 15, to: 24 },
    ]);
    // a half turn puts them on the right and the top
    expect(faceBands(rect(0, 0, 24, 24), outer, 180, false)).toEqual([
      { axis: 'v', from: 15, to: 24 },
      { axis: 'u', from: 0, to: 9 },
    ]);
  });

  it('has nothing to say about an elevation, where both directions are real', () => {
    expect(faceBands(rect(0, 0, 90, 300), panel, 0, true)).toBeUndefined();
  });
});

describe('only pieces in the same face make a hole between them', () => {
  // A 20 cm wall running east, its two faces 20 apart.
  const northFace = across(0, -19, 600, 9);
  const southFace = across(0, 10, 600, 9);

  it('never measures across the pour to the other face', () => {
    expect(nearestGap(northFace, [southFace])).toBeNull();
    expect(allGaps([northFace, southFace])).toHaveLength(0);
  });

  it('measures along the face, where a hole can actually be', () => {
    const a = across(0, -19, 90, 9);
    const b = across(95, -19, 90, 9);
    expect(nearestGap(a, [b, southFace])?.size).toBe(5);
  });

  // Two runs at right angles cross in plan and are never in one plane; what
  // lies between them is the other wall's pour.
  it('says nothing between two runs meeting at a corner', () => {
    const turning = down(636, 10, 9, 200);
    expect(nearestGap(turning, [northFace])).toBeNull();
    expect(allGaps([northFace, turning])).toHaveLength(0);
  });
});

describe('corners', () => {
  /**
   * The corner of a 20 cm wall running east then south, as the fill builds it:
   * an outer profile wrapping the outside and an inner one filling the void,
   * sitting diagonally across the pour from each other.
   */
  const outerCorner = { ...rect(650, -19, 24, 24), bands: [
    { axis: 'u' as const, from: -19, to: -10 },
    { axis: 'v' as const, from: 665, to: 674 },
  ] };
  const innerCorner = { ...rect(625, 10, 20, 20), bands: [
    { axis: 'u' as const, from: 10, to: 19 },
    { axis: 'v' as const, from: 636, to: 645 },
  ] };

  // The reading that would not go away: two profiles at one corner, reported
  // against each other through the concrete between them.
  it('are not measured against each other across the pour', () => {
    expect(nearestGap(outerCorner, [innerCorner])).toBeNull();
    expect(nearestGap(innerCorner, [outerCorner])).toBeNull();
    expect(allGaps([outerCorner, innerCorner])).toHaveLength(0);
  });

  it('are measured against the run that arrives along either of their legs', () => {
    // the north face stopping 12 cm short of the outer profile
    const short = across(500, -19, 138, 9);
    expect(nearestGap(short, [outerCorner])?.size).toBe(12);
  });

  it('say nothing when the run reaches them', () => {
    const reaches = across(500, -19, 150, 9);
    expect(nearestGap(reaches, [outerCorner])).toBeNull();
  });

  // Two corners on one face with the panels between them missing: a real hole,
  // and one that only the corners themselves can report.
  it('report the run that is missing between them', () => {
    const far = { ...rect(400, -19, 24, 24), bands: [
      { axis: 'u' as const, from: -19, to: -10 },
      { axis: 'v' as const, from: 400, to: 409 },
    ] };
    expect(nearestGap(outerCorner, [far])?.size).toBe(226);
  });
});

