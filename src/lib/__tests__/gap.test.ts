import { describe, expect, it } from 'vitest';
import { allGaps, componentThatFits, faceRun, nearestGap } from '../gap';
import type { Material } from '../../types';

const rect = (x: number, y: number, w: number, h: number) => ({ x, y, w, h });

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
    const face = { ...rect(0, 0, 90, 9), faceAxis: 'u' as const };
    const farSide = rect(0, 36, 90, 9);
    expect(nearestGap(face, [farSide])).toBeNull();
  });

  it('still measures along the run when the face axis is set', () => {
    const face = { ...rect(0, 0, 90, 9), faceAxis: 'u' as const };
    expect(nearestGap(face, [rect(135, 0, 90, 9)])?.size).toBe(45);
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

describe('a corner turns the face', () => {
  /**
   * The corner of a filled 20 cm wall, in plan, looking down on the turn.
   *
   * The inner profile is 20 x 20 and SQUARE, so the footprint says nothing
   * about which way its face runs — and one of the two directions it could be
   * measured in crosses the pour to the opposite face of the wall.
   */
  const innerCorner = { ...rect(625, 10, 20, 20), faceAxis: 'u' as const, turnsFace: true };
  const farFace = { ...rect(665, 0, 9, 180), faceAxis: 'v' as const };
  const runIntoIt = { ...rect(535, 10, 90, 9), faceAxis: 'u' as const };

  it('is never measured from — the 20 cm across the pour is not a hole', () => {
    expect(nearestGap(innerCorner, [farFace, runIntoIt])).toBeNull();
  });

  it('is still measured TO, so a run that stops short of one is found', () => {
    // the same run, backed off 12 cm from the corner it should reach
    const short = { ...rect(523, 10, 90, 9), faceAxis: 'u' as const };
    const gap = nearestGap(short, [innerCorner, farFace]);
    expect(gap?.size).toBe(12);
  });

  it('reports no hole at all in a corner that is properly closed', () => {
    expect(allGaps([innerCorner, farFace, runIntoIt])).toHaveLength(0);
  });

  // What the drawing actually showed: a filled L reporting one 20 cm hole per
  // corner, which is the wall thickness measured straight through the concrete.
  it('does not turn the wall thickness into a gap at every corner', () => {
    const gaps = allGaps([innerCorner, farFace, runIntoIt]);
    expect(gaps.some((g) => Math.abs(g.size - 20) < 0.5)).toBe(false);
  });
});

describe('faceRun', () => {
  const panel = mat('პანელი 90*300', 90, 'panel');
  const filler = mat('ჩაკერება 5*300', 5, 'filler');

  it('reads the run off the thickness, not the shape of the footprint', () => {
    // A 5 cm ჩაკერება lying in a horizontal run is 5 wide and 9 deep — taller
    // than it is wide, and still running across. "The long side is the run"
    // turned it on its side and measured through the wall.
    expect(faceRun({ w: 5, h: 9 }, filler, false)).toEqual({ faceAxis: 'u' });
    expect(faceRun({ w: 9, h: 5 }, filler, false)).toEqual({ faceAxis: 'v' });
  });

  it('agrees with the shape wherever the shape was right', () => {
    expect(faceRun({ w: 90, h: 9 }, panel, false)).toEqual({ faceAxis: 'u' });
    expect(faceRun({ w: 9, h: 90 }, panel, false)).toEqual({ faceAxis: 'v' });
  });

  it('will not be measured from where it faces both ways', () => {
    expect(faceRun({ w: 24, h: 24 }, mat('გარე კუთხე 300', 24, 'corner'), false))
      .toEqual({ turnsFace: true });
    // as deep as it is wide, whatever it is
    expect(faceRun({ w: 9, h: 9 }, mat('ჩაკერება 9*300', 9, 'filler'), false))
      .toEqual({ turnsFace: true });
  });

  it('leaves both directions open in an elevation, where both are real', () => {
    expect(faceRun({ w: 90, h: 300 }, panel, true)).toEqual({});
  });
});

describe('two runs meeting at a corner', () => {
  // A 20 cm wall turning: the horizontal run's outer face and the vertical
  // run's west face cross in plan and are never in the same plane. What lies
  // between them is the other wall's pour.
  const alongTop = { ...rect(0, -19, 600, 9), faceAxis: 'u' as const };
  const downSide = { ...rect(636, 10, 9, 200), faceAxis: 'v' as const };

  it('does not report the wall thickness between them', () => {
    expect(nearestGap(downSide, [alongTop])).toBeNull();
    expect(allGaps([alongTop, downSide])).toHaveLength(0);
  });

  it('still finds a real hole between two panels in the same run', () => {
    const a = { ...rect(0, -19, 90, 9), faceAxis: 'u' as const };
    const b = { ...rect(95, -19, 90, 9), faceAxis: 'u' as const };
    expect(nearestGap(a, [b, downSide])?.size).toBe(5);
  });
});

describe('a corner reporting for itself', () => {
  // Two corner profiles on one face with the panels between them missing. It
  // is one of the most visible mistakes there is, and for a while nothing
  // reported it: the pieces that would have are the ones that are not there.
  const top = { ...rect(636, 5, 24, 24), turnsFace: true };
  const bottom = { ...rect(636, 175, 24, 24), turnsFace: true };

  it('measures the run that is not there', () => {
    expect(nearestGap(top, [bottom])?.size).toBe(146);
    expect(allGaps([top, bottom])).toHaveLength(1);
  });

  it('says nothing about the pour it looks across', () => {
    // the far face of its own wall, one thickness away
    const farFace = { ...rect(665, 10, 9, 180), faceAxis: 'v' as const };
    const corner = { ...rect(625, 10, 20, 20), turnsFace: true };
    expect(nearestGap(corner, [farFace])).toBeNull();
  });

  // The corner has to be allowed to look, so what stops it reporting nonsense
  // is that everything competes for the nearest place on each side — a panel
  // between the two corners wins and takes the side with it.
  it('is vetoed by the run when the run is there', () => {
    const between = { ...rect(636, 29, 9, 146), faceAxis: 'v' as const };
    expect(nearestGap(top, [between, bottom])).toBeNull();
  });

  it('still reports the shortfall when the run nearly reaches', () => {
    const short = { ...rect(636, 29, 9, 140), faceAxis: 'v' as const };
    expect(nearestGap(top, [short, bottom])).toBeNull(); // the panel wins the side
    // ...and the panel itself is what reports it, which is where it belongs
    expect(nearestGap(short, [bottom, top])?.size).toBe(6);
  });
});
