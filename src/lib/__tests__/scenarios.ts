import type { SketchPath } from '../../types';

/**
 * The shapes a real formwork job contains, as data.
 *
 * Nothing here asserts anything. Each entry is a layout somebody would actually
 * chalk on a slab, plus one sentence saying what a correct fill of it looks
 * like — and that sentence is the specification, not a description of the
 * drawing. A separate suite holds `planSketchFillAll(paths, { height: 300,
 * includeCorners: true }, createSeedMaterials())` to it.
 *
 * The rules every `what` below is written against:
 *
 *  - a drawn line is a CONCRETE FACE, never a centreline, and the 9 cm panels
 *    stand on the outside of it;
 *  - an inside (concave) corner takes exactly one 20 cm L profile, standing in
 *    the notch, and the two runs butt up to it;
 *  - an outside (convex) corner takes NO piece at all: both runs stop at least
 *    20 cm short and the hole is reported as an opening;
 *  - a wall is drawn as TWO paths, one per face, and the two faces must come
 *    out with IDENTICAL panels directly opposite each other;
 *  - a vertex the run goes straight through is a mark on the drawing, not a
 *    bend, and must not be treated as a corner.
 *
 * At the 300 cm pour height every `what` assumes, the catalog offers panels of
 * 90 / 75 / 60 / 45 / 30 cm and ჩაკერება fillers of 10 and 5 cm, so any whole
 * multiple of 5 cm from 30 upward closes exactly. Every dimension below is a
 * whole multiple of 5 cm, which is what the pen snaps to.
 *
 * Where a wall is drawn as two faces, the second path is the exact parallel
 * offset of the first by `thickness` — which is what makes the corner legs of
 * the two faces differ by exactly the thickness, the normal case on site.
 */

export interface Scenario {
  /** stable, kebab-case, unique across the catalogue */
  name: string;
  /** one sentence on what a correct fill of `paths` looks like — the spec */
  what: string;
  paths: SketchPath[];
  /** the pour between the two drawn faces, cm, where there is one */
  thickness?: number;
}

/** Terse SketchPath literal. Data only — this file builds nothing else. */
function line(
  id: string,
  points: Array<[number, number]>,
  perimeter?: 'outer' | 'inner',
  closed = false,
): SketchPath {
  return {
    id,
    points: points.map(([x, y]) => ({ x, y })),
    ...(closed ? { closed: true as const } : {}),
    ...(perimeter ? { perimeter } : {}),
  };
}

/**
 * A straight wall of `length`, drawn as its two faces `thickness` apart.
 *
 * The near face lies on y = 0 with the concrete below it, the far face on
 * y = thickness with the concrete above it. Both faces are the same length,
 * because a straight wall has no corner to make one longer than the other.
 */
function straightWall(name: string, length: number, thickness: number): Scenario {
  return {
    name,
    what:
      `Both faces are panelled along the whole ${length} cm with nothing reported open, no ` +
      `warning and no corner piece anywhere; the two faces carry the identical set of panels ` +
      `at the identical positions along the wall, each row standing clear of the ${thickness} cm ` +
      `pour on the far side of its own line.`,
    paths: [
      line(`${name}-near`, [[0, 0], [length, 0]], 'outer'),
      line(`${name}-far`, [[0, thickness], [length, thickness]], 'inner'),
    ],
    thickness,
  };
}

export const SCENARIOS: Scenario[] = [
  // ── 1. A straight wall, two faces, at every thickness that gets poured ─────

  straightWall('straight-wall-t15', 600, 15),
  straightWall('straight-wall-t20', 600, 20),
  straightWall('straight-wall-t25', 600, 25),
  straightWall('straight-wall-t30', 600, 30),
  straightWall('straight-wall-t40', 600, 40),
  straightWall('straight-wall-t60', 600, 60),

  // ── 2. An L wall, both faces, turning each of the four ways ────────────────
  //
  // Same wall four times over, 20 thick, differing only in which way the pen
  // travelled and which way it turned. The far face of each is the exact
  // parallel offset of the near one, so its corner leg is 20 cm shorter.

  {
    name: 'l-wall-east-then-south',
    what:
      'One 20 cm profile stands in the notch of the concave corner and no piece at all closes ' +
      'the convex one; away from the corner the two faces carry identical panels directly ' +
      'opposite each other, and each of the outer face\'s two legs reports 40 cm open at the ' +
      'convex corner — its own 20 cm set-back plus the 20 cm of extra length it gives up to ' +
      'line up with the inner face — while the inner face reports nothing open.',
    paths: [
      line('l-es-near', [[0, 0], [600, 0], [600, 400]], 'outer'),
      line('l-es-far', [[0, 20], [580, 20], [580, 400]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'l-wall-east-then-north',
    what:
      'The same L mirrored, and the same order: exactly one profile in the concave corner, no ' +
      'piece in the convex one, identical panels opposite each other on the two faces, every ' +
      'piece on the outside of its own line, and 40 cm reported open on each of the outer ' +
      'face\'s two legs at the convex corner — the direction the pen turned changes nothing.',
    paths: [
      line('l-en-near', [[0, 0], [600, 0], [600, -400]], 'outer'),
      line('l-en-far', [[0, -20], [580, -20], [580, -400]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'l-wall-west-then-south',
    what:
      'Drawn right to left, the fill still comes out as one profile in the concave corner, no ' +
      'piece at the convex one with 40 cm reported open on each of the outer face\'s two legs ' +
      'there, and identical panels opposite each other on the two faces — the same formwork on ' +
      'the ground as the eastward L, mirrored.',
    paths: [
      line('l-ws-near', [[600, 0], [0, 0], [0, 400]], 'outer'),
      line('l-ws-far', [[600, 20], [20, 20], [20, 400]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'l-wall-west-then-north',
    what:
      'The fourth turn direction: one profile in the concave corner, nothing in the convex one ' +
      'and 40 cm reported open on each of the outer face\'s two legs there, identical panels ' +
      'opposite each other, and no piece on the concrete side of either line.',
    paths: [
      line('l-wn-near', [[600, 0], [0, 0], [0, -400]], 'outer'),
      line('l-wn-far', [[600, -20], [20, -20], [20, -400]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 3. U and Z walls, both faces, including legs shorter than two reaches ──

  {
    name: 'u-wall',
    what:
      'Three legs and four corners: the two concave corners, which are on the inner face, take ' +
      'one profile each, the two convex corners on the outer face take no piece at all, and all ' +
      'three legs come out with identical panels opposite each other on the two faces — the ' +
      'four outer leg-ends at a convex corner each reporting 45 cm open (a 20 cm set-back plus ' +
      'the 25 cm the outer face gives up to line up) against nothing open on the inner face.',
    paths: [
      line('u-outer', [[0, 0], [0, 300], [400, 300], [400, 0]], 'outer'),
      line('u-inner', [[25, 0], [25, 275], [375, 275], [375, 0]], 'inner'),
    ],
    thickness: 25,
  },
  {
    name: 'u-wall-short-arms',
    what:
      'Neither concave corner gets a profile, because the 20 cm inner arm beside it is too ' +
      'short to hold one: those arms carry no piece at all and their full length is reported ' +
      'open with a warning, the room the inner back made for the profiles that never came is ' +
      'reported open too, and the outer face\'s 40 cm arms keep only the 20 cm outside their ' +
      'single set-back; the long back of the U is still panelled identically on both faces, ' +
      'opposite each other.',
    paths: [
      line('ushort-outer', [[0, 0], [0, 40], [300, 40], [300, 0]], 'outer'),
      line('ushort-inner', [[20, 0], [20, 20], [280, 20], [280, 0]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'z-wall',
    what:
      'One corner is convex and the other concave on each face, and they swap between the two ' +
      'faces, so each face gets exactly one profile and exactly one 20 cm set-back; the three ' +
      'legs come out with identical panels opposite each other and no piece of either face ' +
      'stands in the 20 cm band of concrete between the two lines.',
    paths: [
      line('z-near', [[0, 0], [400, 0], [400, 300], [800, 300]], 'outer'),
      line('z-far', [[0, 20], [380, 20], [380, 320], [800, 320]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'staircase-wall',
    what:
      'Four corners alternating convex and concave, so each face gets exactly two profiles and ' +
      'two open corners and the two faces swap which corner is which; all five legs are ' +
      'panelled identically opposite each other, each of the eight leg-ends at a convex corner ' +
      'reports 45 cm open, and nothing lands in the 25 cm pour.',
    paths: [
      line(
        'stair-near',
        [[0, 0], [300, 0], [300, 200], [600, 200], [600, 400], [900, 400]],
        'outer',
      ),
      line(
        'stair-far',
        [[0, 25], [275, 25], [275, 225], [575, 225], [575, 425], [900, 425]],
        'inner',
      ),
    ],
    thickness: 25,
  },
  {
    name: 'z-wall-short-middle-leg',
    what:
      'The 35 cm middle leg cannot hold both of its corner treatments, so on each face it gets ' +
      'no panel and no profile and its full 35 cm is reported open with a warning; the two long ' +
      'legs are still panelled and still come out identical and opposite each other on the two ' +
      'faces, with nothing overlapping and nothing inside the 15 cm pour.',
    paths: [
      line('zshort-near', [[0, 0], [300, 0], [300, 35], [600, 35]], 'outer'),
      line('zshort-far', [[0, 15], [285, 15], [285, 50], [600, 50]], 'inner'),
    ],
    thickness: 15,
  },

  // ── 4. A closed room: outer perimeter and inner perimeter ──────────────────

  {
    name: 'room-large',
    what:
      'All four corners of the outer perimeter are left open with no corner piece and 40 cm ' +
      'reported open at each of its eight leg-ends, all four corners of the inner perimeter ' +
      'take exactly one profile each and report nothing open, and the outer and inner face of ' +
      'each of the four walls carries identical panels opposite the other; every piece stands ' +
      'clear of the 20 cm concrete ring — the inner ring\'s inside the room, the outer ring\'s ' +
      'outside the building.',
    paths: [
      line('room-l-outer', [[0, 0], [540, 0], [540, 440], [0, 440]], 'outer', true),
      line('room-l-inner', [[20, 20], [520, 20], [520, 420], [20, 420]], 'inner', true),
    ],
    thickness: 20,
  },
  {
    name: 'room-small-100x100',
    what:
      'The void is small enough that each 100 cm inner leg keeps only the 60 cm between its two ' +
      'profiles — four profiles in the corners and one 60 cm span of panel per side, all of it ' +
      'standing inside the room — and the outer face is pulled back to the same 60 cm spans ' +
      'directly opposite them, the length it gives up joining its corner set-backs to make ' +
      '40 cm reported open at each of its eight leg-ends.',
    paths: [
      line('room-s-outer', [[0, 0], [140, 0], [140, 140], [0, 140]], 'outer', true),
      line('room-s-inner', [[20, 20], [120, 20], [120, 120], [20, 120]], 'inner', true),
    ],
    thickness: 20,
  },

  // ── 5. Columns, as one closed path ─────────────────────────────────────────

  {
    name: 'column-square-40x40',
    what:
      'Every corner is an outside corner and each 40 cm face owes 20 cm to each of its two ' +
      'corners, so the plan places no piece at all, counts four open corners, and reports the ' +
      'whole 160 cm perimeter as open face with a warning that the legs are too short — it ' +
      'never invents a corner piece to save the column.',
    paths: [line('col-40', [[0, 0], [40, 0], [40, 40], [0, 40]], 'outer', true)],
  },
  {
    name: 'column-rect-60x25',
    what:
      'Four open corners and no corner piece: each 60 cm face keeps only the 20 cm between its ' +
      'two set-backs and that strip is closed rather than left bare, while each 25 cm face is ' +
      'shorter than its own two set-backs and carries nothing, its full 25 cm reported open ' +
      'with a warning.',
    paths: [line('col-60x25', [[0, 0], [60, 0], [60, 25], [0, 25]], 'outer', true)],
  },

  // ── 6. A wall with only one face drawn ─────────────────────────────────────

  {
    name: 'single-face-straight',
    what:
      'One row of panels along the single line, every piece on the far side of it from the ' +
      'concrete, all 600 cm covered with nothing reported open and no warning; no second face ' +
      'is invented and no piece is matched against one.',
    paths: [line('one-straight', [[0, 0], [600, 0]], 'outer')],
  },
  {
    name: 'single-face-outside-corner',
    what:
      'One convex corner, so no corner piece is placed, both legs stop 20 cm short of the ' +
      'vertex, and those two 20 cm holes are the only openings reported; the rest of both legs ' +
      'is panelled on the outside of the line with no attempt to match a face that was never ' +
      'drawn.',
    paths: [line('one-l-out', [[0, 0], [500, 0], [500, 350]], 'outer')],
  },
  {
    name: 'single-face-inside-corner',
    what:
      'The same L read as the concave face: exactly one 20x20 profile stands in the notch at ' +
      'the vertex with its legs in the two panel planes and never across the line into the ' +
      'pour, both runs butt up against it, nothing is reported open, and every piece sits on ' +
      'the void side of the line.',
    paths: [line('one-l-in', [[0, 0], [500, 0], [500, 350]], 'inner')],
  },

  // ── 7. A T junction: one wall meeting another's side ───────────────────────
  //
  // The concrete face runs continuously around the stub, so the south side of
  // the main wall is two polylines that each turn down one side of it. The
  // north face of the main wall is unbroken, because nothing interrupts it.

  {
    name: 't-junction',
    what:
      'The stub\'s two faces, 20 cm apart, get identical panels directly opposite each other; ' +
      'each of the two reentrant corners where the stub meets the main wall takes exactly one ' +
      'profile; the main wall\'s north face is panelled as one uninterrupted 800 cm run with no ' +
      'corner treatment anywhere along it; and the stub\'s far end simply stops, with no ' +
      'stop-end piece and nothing reported open there.',
    paths: [
      line('t-main-north', [[0, 0], [800, 0]], 'outer'),
      line('t-west', [[0, 20], [300, 20], [300, 400]], 'inner'),
      line('t-east', [[320, 400], [320, 20], [800, 20]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 8. A doorway: two collinear stretches with a gap ───────────────────────

  {
    name: 'wall-with-doorway',
    what:
      'Four runs, one per drawn stretch, each covered end to end with nothing reported open; ' +
      'the two stretches facing each other across the pour on each side of the door carry ' +
      'identical panels at identical positions, absolutely nothing is placed across the 90 cm ' +
      'opening, and no corner piece appears because none of the four stretches turns.',
    paths: [
      line('door-n-west', [[0, 0], [300, 0]], 'outer'),
      line('door-n-east', [[390, 0], [700, 0]], 'outer'),
      line('door-s-west', [[0, 20], [300, 20]], 'inner'),
      line('door-s-east', [[390, 20], [700, 20]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 9. Junction vertices that do not turn, mixed with real corners ─────────

  {
    name: 'straight-through-marks-only',
    what:
      'The marks are not corners: no profile appears at any of them, no turn is counted, and ' +
      'each face comes out as one unbroken 560 cm run — the same panels it would get if the ' +
      'marks had not been drawn — with the two faces identical and opposite each other even ' +
      'though their marks sit in different places.',
    paths: [
      line('marks-near', [[0, 0], [150, 0], [300, 0], [560, 0]], 'outer'),
      line('marks-far', [[0, 20], [200, 20], [560, 20]], 'inner'),
    ],
    thickness: 20,
  },
  {
    name: 'marks-mixed-with-a-real-corner',
    what:
      'Each face turns exactly once and gets exactly one corner treatment — the outer face\'s ' +
      'convex vertex takes no piece and reports 40 cm open on each of its two legs, the inner ' +
      'face\'s concave vertex takes one profile and reports nothing — while every ' +
      'straight-through mark passes without a profile and without splitting its run in two; ' +
      'the two faces still come out with identical panels opposite each other.',
    paths: [
      line('mixed-near', [[0, 0], [200, 0], [500, 0], [500, 300], [500, 450]], 'outer'),
      line('mixed-far', [[0, 20], [250, 20], [480, 20], [480, 150], [480, 450]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 10. Two separate walls with AIR between them ───────────────────────────

  {
    name: 'two-walls-air-between',
    what:
      'Two independent pours, four rows of panels: wall A\'s two faces match each other and ' +
      'wall B\'s two faces match each other, each pair over its own full 500 cm; the two rows ' +
      'that stand facing each other across the 60 cm of air belong to different walls and are ' +
      'not paired, matched, or bridged, and no piece is placed as though the air were concrete.',
    paths: [
      line('air-a-near', [[0, 0], [500, 0]], 'outer'),
      line('air-a-far', [[0, 20], [500, 20]], 'inner'),
      line('air-b-near', [[0, 80], [500, 80]], 'outer'),
      line('air-b-far', [[0, 100], [500, 100]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 11. The extremes of length ─────────────────────────────────────────────

  {
    name: 'very-long-wall-2000',
    what:
      'Both faces are covered along the whole 2000 cm with no shortfall reported — panels for ' +
      'all but the last narrow strip, which one filler closes — and the two faces carry ' +
      'identical panels at identical positions for the full length, with no corner piece and ' +
      'nothing reported open.',
    paths: [
      line('long-near', [[0, 0], [2000, 0]], 'outer'),
      line('long-far', [[0, 25], [2000, 25]], 'inner'),
    ],
    thickness: 25,
  },
  {
    name: 'very-short-wall-35',
    what:
      'One 30 cm panel and one 5 cm filler on each face, the two faces identical and directly ' +
      'opposite each other, no corner piece, nothing reported open and no warning — a 35 cm ' +
      'nib is a wall the catalog can close exactly, not a leg too short to build.',
    paths: [
      line('short-near', [[0, 0], [35, 0]], 'outer'),
      line('short-far', [[0, 20], [35, 20]], 'inner'),
    ],
    thickness: 20,
  },

  // ── 12. Faces whose corner legs differ — normally, and by too much ─────────

  {
    name: 'corner-legs-differ-by-the-thickness',
    what:
      'The normal case: each of the outer face\'s legs is 60 cm longer than the inner face\'s, ' +
      'and that difference is handed to the open convex corner rather than to an extra panel — ' +
      'both faces end up with the same panels at the same positions along the wall, one profile ' +
      'stands in the concave corner, and each of the outer face\'s two legs reports 80 cm open ' +
      'at the convex corner against nothing open on the inner face.',
    paths: [
      line('diff-ok-outer', [[0, 0], [700, 0], [700, 500]], 'outer'),
      line('diff-ok-inner', [[0, 60], [640, 60], [640, 500]], 'inner'),
    ],
    thickness: 60,
  },
  {
    name: 'corner-legs-differ-by-more-than-the-thickness',
    what:
      'A mis-drawn pair: the two horizontal legs agree to within the 30 cm thickness and get ' +
      'identical panels opposite each other, but the vertical legs were drawn 100 cm different ' +
      'in length and must not be dragged together — each is panelled to its own drawn extent, ' +
      'the 100 cm of outer face with no partner opposite it is still covered because it was ' +
      'still drawn, no panel runs past the end of the face it stands on, and nothing is placed ' +
      'inside the pour.',
    paths: [
      line('diff-bad-outer', [[0, 0], [600, 0], [600, 400]], 'outer'),
      line('diff-bad-inner', [[0, 30], [570, 30], [570, 300]], 'inner'),
    ],
    thickness: 30,
  },
];
