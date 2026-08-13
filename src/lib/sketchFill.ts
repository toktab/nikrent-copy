import type { Material, Piece, SketchPath } from '../types';
import { uid } from './ids';
import { planH, planW } from './geometry';
import {
  coverExact,
  coverFace,
  optionsAt,
  panelDepthFor,
  panelHeights,
  placeAt,
} from './formwork';
import { isHorizontal, isOrthogonal, legLength, pathLength, type Point } from './sketch';

/**
 * Fills a drawn layout with formwork.
 *
 * The wall wizard asks for a length and builds one straight run. This takes the
 * line already drawn — which is how a layout is actually set out — and builds
 * every leg of it, including the corners where the legs meet. That is the whole
 * point of drawing first: the geometry is on the screen, so nobody should have
 * to read it back off and retype it a leg at a time.
 *
 * The drawn line IS a concrete face, and the panels stand on the outside of it:
 *
 *        ▓▓▓▓▓▓▓ panels ▓▓▓▓▓▓▓▓▓▓   9 cm, outside
 *        ───────drawn line────────   ← what you drew, the face itself
 *        ░░░░░░░ concrete ░░░░░░░░
 *
 * Which is how the layout arrives: the person setting out chalks the edge of
 * the pour, not a line up the middle of it that nothing can be measured from.
 * A wall is two of those lines, one per face, and each is filled on its own —
 * so the tool never has to guess a thickness, and a wall with one face already
 * built is a normal thing to draw rather than a special case.
 *
 * As with the other generators, geometry the catalog cannot satisfy is reported
 * rather than quietly rounded: an under-count here is a short delivery on site.
 */

/**
 * The face and nothing behind it.
 *
 * Panels, ჩაკერება fillers and corner profiles are what this orders — the
 * things that actually shape the pour. Walers, ties and props are decided on
 * site against the pressure and the pour rate, not read off a plan, so the
 * generator does not guess at them: a guessed tie count on a delivery note is
 * worse than no tie count at all.
 */
export interface SketchFillSpec {
  /** pour height in cm */
  height: number;
  /**
   * Put the panels on the other side than the one worked out from the shape.
   *
   * The side is normally decided by the run itself — see `outwardSide` — so
   * this is only for the cases where a line genuinely has no outside, or where
   * the concrete turns out to be on the far side of what was drawn.
   */
  flip?: boolean;
  /** close the corners with profiles instead of butting the panels */
  includeCorners: boolean;
}

export interface FillPlan {
  pieces: Piece[];
  warnings: string[];
  summary: {
    panels: number;
    fillers: number;
    /** inner corner profiles placed */
    corners: number;
    /** outside corners left open, 20 cm of each face, for the builder to close */
    openCorners: number;
    courses: number;
    /** centreline run of the whole layout, cm */
    runLength: number;
    /** how many times the layout turns */
    turns: number;
  };
}

const EMPTY: FillPlan['summary'] = {
  panels: 0,
  fillers: 0,
  corners: 0,
  openCorners: 0,
  courses: 0,
  runLength: 0,
  turns: 0,
};

// ── Orthogonal offsetting ───────────────────────────────────────────────────

/** Unit direction of a leg. Orthogonal paths only, so it is one of ±x / ±y. */
export function legDir(a: Point, b: Point): Point {
  return isHorizontal(a, b)
    ? { x: b.x >= a.x ? 1 : -1, y: 0 }
    : { x: 0, y: b.y >= a.y ? 1 : -1 };
}

/**
 * The normal to the left of travel.
 *
 * World y increases downward, so a quarter turn anticlockwise on screen is
 * `(x, y) → (y, −x)`. Heading east, left is north; heading south, left is east.
 */
export function leftNormal(d: Point): Point {
  return { x: d.y, y: -d.x };
}

/**
 * Which way the path turns, as seen from the left-hand side.
 *
 * Positive means the left side is on the OUTSIDE of the turn — a convex corner,
 * where the two faces wrap around each other. Negative means the left side is
 * on the inside, a concave corner where they close into each other. Every
 * corner is one on one side and the other on the other, which is exactly why
 * the two sides of a wall need different corner treatments.
 */
export function turnSign(dPrev: Point, dNext: Point): number {
  return dPrev.x * dNext.y - dPrev.y * dNext.x;
}

/**
 * The same run with the junctions that are not corners taken out.
 *
 * A junction is a point somebody put on the drawing, and people put them on for
 * all sorts of reasons: to measure from, to hang the next wall off, to pull one
 * end of a leg without moving the other. None of that bends the wall. Reading
 * every vertex as a corner put a corner profile in the middle of a straight run
 * and cut the run in two either side of it, so a 560 wall came out as two short
 * ones with an odd strip each.
 *
 * A corner is where the run actually changes direction, which is a question
 * about the shape and is answered here, once, before anything is planned.
 * Coincident points go the same way: a leg of zero length is not a turn either.
 */
export function cornersOnly(path: SketchPath): SketchPath {
  const pts = path.points;
  const n = pts.length;
  if (n < 3) return path;
  const closed = !!path.closed && n > 2;

  const same = (a: Point, b: Point) => Math.abs(a.x - b.x) < 0.01 && Math.abs(a.y - b.y) < 0.01;
  const kept: Point[] = [];
  for (let i = 0; i < n; i++) {
    const here = pts[i];
    const last = kept[kept.length - 1];
    if (last && same(last, here)) continue;
    // The ends of an open run are where it stops, not turns, and both stay.
    if (!closed && (i === 0 || i === n - 1)) {
      kept.push(here);
      continue;
    }
    const before = pts[(i - 1 + n) % n];
    const after = pts[(i + 1) % n];
    if (same(before, here) || same(here, after)) continue;
    const into = legDir(before, here);
    const outOf = legDir(here, after);
    if (into.x === outOf.x && into.y === outOf.y) continue;
    kept.push(here);
  }
  // A closed run's first point can also be a straight-through, and it is the
  // one the loop above cannot see both sides of until the end.
  if (closed && kept.length > 2 && same(kept[0], kept[kept.length - 1])) kept.pop();
  return kept.length >= 2 ? { ...path, points: kept } : path;
}

/**
 * The side of a run the panels stand on.
 *
 * Formwork stands on the OUTSIDE of the pour, always, so this is never a
 * preference. Half of the answer is in the shape and half is in what the line
 * is FOR, and the two have to be taken together.
 *
 * The shape gives which side of the line the run encloses. The shoelace sum
 * answers that: reversing a run flips the sum AND flips left from right, so the
 * two cancel and the same physical side comes out however it was drawn.
 * Positive is clockwise on screen — y counts downward here — and a clockwise
 * run holds its ground on the right, so its enclosed side is the right.
 *
 * What the line is for gives the rest. An outer perimeter has the concrete
 * inside it, so the panels go on the far side; an inner one — a room, a shaft,
 * the void a wall's second face bounds — has the concrete outside it, so the
 * panels stand in the hole. Nothing in the coordinates distinguishes them,
 * which is why `perimeter` is asked for at the pen and kept on the path.
 *
 * A straight line encloses nothing; it falls back to the left of travel, and
 * `flip` is there for when that guesses wrong.
 */
export function outwardSide(path: SketchPath): 1 | -1 {
  const pts = path.points;
  let twiceArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  const outsideTheLoop: 1 | -1 = twiceArea < 0 ? -1 : 1;
  return path.perimeter === 'inner'
    ? ((outsideTheLoop * -1) as 1 | -1)
    : outsideTheLoop;
}

/** One vertex of the offset line: where the two offset legs cross. */
function offsetVertex(p: Point, dPrev: Point, dNext: Point, dist: number): Point {
  const nPrev = leftNormal(dPrev);
  const nNext = leftNormal(dNext);
  const prevAcross = dPrev.y === 0;
  const nextAcross = dNext.y === 0;
  // Parallel legs never cross, so there is nothing to intersect — which is the
  // case at the free end of an open path, and for a doubled-back leg.
  if (prevAcross === nextAcross) {
    return { x: p.x + dist * nPrev.x, y: p.y + dist * nPrev.y };
  }
  // A horizontal leg's offset line fixes y; a vertical one fixes x. Take one
  // from each and the crossing point is read off directly.
  return prevAcross
    ? { x: p.x + dist * nNext.x, y: p.y + dist * nPrev.y }
    : { x: p.x + dist * nPrev.x, y: p.y + dist * nNext.y };
}

/**
 * The whole path shifted sideways by `dist` — positive to the left of travel.
 *
 * At `±thickness / 2` this is the concrete face, which is where the panels
 * stand. The corners are what make it worth a function: an offset corner is not
 * the corner moved sideways, it is where the two offset legs meet, which is
 * further out on the outside of a turn and further in on the inside.
 */
export function offsetPath(path: SketchPath, dist: number): Point[] {
  const pts = path.points;
  const n = pts.length;
  if (n < 2) return pts.map((p) => ({ ...p }));
  const closed = !!path.closed && n > 2;
  const legs = closed ? n : n - 1;

  const dirs: Point[] = [];
  for (let i = 0; i < legs; i++) dirs.push(legDir(pts[i], pts[(i + 1) % n]));

  const out: Point[] = [];
  for (let i = 0; i < n; i++) {
    const prev = closed ? dirs[(i - 1 + legs) % legs] : dirs[i - 1];
    const next = closed ? dirs[i % legs] : dirs[i];
    out.push(offsetVertex(pts[i], prev ?? next, next ?? prev, dist));
  }
  return out;
}

// ── Corner profiles ─────────────────────────────────────────────────────────

/**
 * How much of each face is left standing empty at an outside corner, in cm.
 *
 * An outside corner is not closed by this tool. There is more than one right
 * answer on site — lap one run past the other, run a profile, batten it — and
 * which one it is depends on what the corner has to do and what came off the
 * last job. So the panels stop short and the corner is handed over as a
 * measured hole rather than as a part somebody has to take back off.
 *
 * Twenty, because that is the reach of the inner profile at the corner on the
 * other face of the same wall: set both faces back by the same amount and the
 * same panels serve either side of the pour.
 */
const OUTER_CORNER_GAP = 20;

/**
 * The inner corner profile at one course height, and how much face it covers.
 *
 * The only corner part this places. Nothing in the material record says inner
 * from outer, so the Georgian name decides — it is what the parts are called —
 * and where the name is silent the geometry does: an outer profile has to span
 * the panel as well as the face, so for the same cover it is the wider part and
 * the inner one is the narrower.
 */
function innerCorner(
  materials: Material[],
  height: number,
): { material: Material; reach: number } | null {
  const candidates = materials
    .filter((m) => m.category === 'corner' && m.shape === 'L' && m.h === height)
    .sort((a, b) => planW(b) - planW(a));
  if (!candidates.length) return null;

  const named = candidates.filter((m) => m.name.includes('შიდა'));
  const pool = named.length ? named : candidates;
  const material = pool[pool.length - 1];

  // An inner profile sits in the void with its legs in the panel planes, so
  // the face it covers is simply its leg.
  const reach = planW(material);
  return reach > 0.01 ? { material, reach } : null;
}

/**
 * Which way to turn an L so its solid legs lie in the panel planes.
 *
 * `diag` points from the corner out into open air — the side the panels are
 * on. An L is drawn with its legs on the left and the bottom, notch facing up
 * and right, so it is already correct where the air is down and to the left.
 */
function cornerRot(diag: Point): number {
  if (diag.x < 0) return diag.y > 0 ? 0 : 90;
  return diag.y < 0 ? 180 : 270;
}

// ── The plan ────────────────────────────────────────────────────────────────

export function planSketchFill(
  path: SketchPath,
  spec: SketchFillSpec,
  materials: Material[],
): FillPlan {
  const warnings: string[] = [];
  const pieces: Piece[] = [];
  const fail = (message: string): FillPlan => ({
    pieces: [],
    warnings: [message],
    summary: EMPTY,
  });

  // Corners come from the shape. A junction that the run goes straight through
  // is a mark on the drawing, not a bend in the wall — see `cornersOnly`.
  const run = cornersOnly(path);
  const pts = run.points;
  const n = pts.length;
  const closed = !!run.closed && n > 2;
  const legCount = closed ? n : n - 1;

  if (legCount < 1) return fail('ხაზს ორი წერტილი მაინც სჭირდება.');
  /**
   * Everything below reads a leg as lying on an axis — the offset lines, the
   * corner treatment, the way a panel is turned. A run drawn at an angle can be
   * described, and the pen will draw one, but nothing in the catalog closes a
   * junction that is not ninety degrees, so this says no rather than building
   * something that cannot be delivered.
   */
  if (!isOrthogonal(path)) {
    return fail('დახრილი ხაზის შევსება შეუძლებელია - კატალოგში მხოლოდ 90° კუთხეებია.');
  }
  if (!(spec.height > 0)) return fail('სიმაღლე ნულზე მეტი უნდა იყოს.');

  const heights = panelHeights(materials);
  if (!heights.length) return fail('კატალოგში პანელები ვერ მოიძებნა.');

  // ── Vertical: how many panel courses stack up the pour ────────────────────
  const stack = coverExact(spec.height, heights);
  const courses = stack.picks.map((i) => heights[i]);
  if (!courses.length) {
    warnings.push(
      `სიმაღლე ${spec.height} სმ ნებისმიერ პანელზე დაბალია - უმცირესი პანელია ${Math.min(...heights)} სმ.`,
    );
  }
  if (stack.remainder > 0.01) {
    warnings.push(
      `სიმაღლეში დარჩა ${stack.remainder} სმ - საჭიროა ჩაკერება ან სპეციალური ელემენტი.`,
    );
  }

  const courseCount = Math.max(1, courses.length);
  const courseHeight = courses[0] ?? Math.min(...heights);
  const panelDepth = panelDepthFor(optionsAt(materials, 'panel', courseHeight));
  const side: 1 | -1 = spec.flip ? ((outwardSide(run) * -1) as 1 | -1) : outwardSide(run);

  // ── The layout, read once ─────────────────────────────────────────────────
  const dirs: Point[] = [];
  const lengths: number[] = [];
  for (let i = 0; i < legCount; i++) {
    dirs.push(legDir(pts[i], pts[(i + 1) % n]));
    lengths.push(legLength(pts[i], pts[(i + 1) % n]));
  }

  // A corner is indexed by the leg that ends at it. An open run has one fewer
  // corner than it has legs; a closed one turns at every vertex.
  const turnCount = closed ? legCount : legCount - 1;
  const turns: number[] = [];
  for (let j = 0; j < turnCount; j++) {
    turns.push(turnSign(dirs[j], dirs[(j + 1) % legCount]));
  }

  // The face is the line itself, so there is nothing to offset. The corner
  // arithmetic below still moves each run's ENDS along its own leg.
  const line: Point[] = pts.map((p) => ({ ...p }));

  let panelCount = 0;
  let fillerCount = 0;
  let cornerPieces = 0;
  let elevation = 0;

  for (let c = 0; c < courseCount; c++) {
    const courseH = courses[c] ?? courseHeight;
    const panelOptions = optionsAt(materials, 'panel', courseH);
    const fillerOptions = optionsAt(materials, 'filler', courseH);
    const inner = spec.includeCorners ? innerCorner(materials, courseH) : null;

    /**
     * Which way a corner shuts, from where the panels are standing.
     *
     * Outside means the run wraps around the turn and is left open; inside
     * means the two runs close into each other and a profile sits in the
     * notch between them. A vertex that turns through nothing is neither —
     * `cornersOnly` has already taken those out, and this is what stops one
     * that survives (a run doubling back on itself) becoming a phantom corner.
     */
    const straightThrough = (j: number) => turns[j] === 0;
    const outsideCorner = (j: number) => side * turns[j] > 0;
    const insideCorners = turns.some((_, j) => !straightThrough(j) && !outsideCorner(j));

    if (c === 0 && spec.includeCorners && insideCorners && !inner) {
      warnings.push(
        `${courseH} სმ სიმაღლის შიდა კუთხის პროფილი კატალოგში არ არის - კუთხე პანელებით იხურება.`,
      );
    }

    /**
     * Inside corners first, panels after.
     *
     * Not just an order in a list: the profile is a fixed part in a fixed
     * place, so it is the datum the run is measured from, and the runs below
     * lay their panels away from it. Build it the other way round and the
     * leftover strip lands against the profile — at the one corner where the
     * two faces of the wall have to agree — instead of at the open corner
     * where nothing has been decided yet.
     */
    for (let j = 0; j < turnCount; j++) {
      if (straightThrough(j) || outsideCorner(j) || !inner) continue;

      // The diagonal out of the corner into open air: the two outward normals
      // added together. They are perpendicular at a corner, so the sum is one
      // of the four diagonals.
      const a = leftNormal(dirs[j]);
      const b = leftNormal(dirs[(j + 1) % legCount]);
      const diag: Point = { x: side * (a.x + b.x), y: side * (a.y + b.y) };

      const cw = planW(inner.material);
      const ch = planH(inner.material);
      const v = line[(j + 1) % n];

      // It stands in the notch, so it starts at the vertex and reaches out
      // along the diagonal — never back across the line into the pour.
      const rot = (cornerRot(diag) + 180) % 360;
      const { x, y } = placeAt(
        diag.x > 0 ? v.x : v.x - cw,
        diag.y > 0 ? v.y : v.y - ch,
        cw,
        ch,
        rot,
      );
      pieces.push({ id: uid(), materialId: inner.material.id, x, y, rot, z: elevation });
      cornerPieces++;
    }

    // ── The face, leg by leg ────────────────────────────────────────────────
    {
      for (let j = 0; j < legCount; j++) {
        const dir = dirs[j];
        const across = dir.x !== 0;
        const from = line[j];
        const to = line[(j + 1) % n];

        const startCorner = closed ? (j - 1 + legCount) % legCount : j - 1;
        const endCorner = closed ? j : j < legCount - 1 ? j : -1;

        /**
         * How far this run moves at corner `j`, along its own leg, in cm.
         * Negative shortens. `leaving` is true for the run that ends there.
         *
         * Outside the turn it stops 20 cm short and the corner is left to the
         * builder. Inside it, the profile is already standing and the run stops
         * against it, both ends alike. Inside it with no profile the two faces
         * have to close the corner between them, and a face cannot be in two
         * places at once: exactly one of the two runs gives way by a panel
         * thickness and the other holds the line. Move both and they overlap by
         * a panel — which is a panel over-ordered at every corner.
         *
         * An open end is where the face simply stops. Nothing closes it: that
         * is a decision for the person pouring, the same as an outside corner.
         */
        const cornerExtend = (j: number, leaving: boolean): number => {
          if (straightThrough(j)) return 0;
          if (outsideCorner(j)) return -OUTER_CORNER_GAP;
          if (inner) return -inner.reach;
          return leaving ? -panelDepth : 0;
        };

        const startExtend = startCorner >= 0 ? cornerExtend(startCorner, false) : 0;
        const endExtend = endCorner >= 0 ? cornerExtend(endCorner, true) : 0;

        /**
         * The run is measured between the OFFSET ends, never between the drawn
         * ones. A corner moves its offset vertex along the leg as well as
         * sideways — by half the thickness, in opposite directions on the two
         * sides — so the face is longer than the leg it follows on the outside
         * of a turn and shorter on the inside. Sizing it from the drawn length
         * leaves a gap on one face and drives a panel into the corner profile
         * on the other.
         */
        const startAt = across ? from.x - dir.x * startExtend : from.y - dir.y * startExtend;
        const endAt = across ? to.x + dir.x * endExtend : to.y + dir.y * endExtend;
        const runLength = (endAt - startAt) * (across ? dir.x : dir.y);

        if (runLength <= 0.01) {
          warnings.push(
            `${Math.round(lengths[j])} სმ მონაკვეთი კუთხეებისთვის ძალიან მოკლეა - პანელი აღარ ეტევა.`,
          );
          continue;
        }

        const { used, remainder } = coverFace(runLength, panelOptions, fillerOptions);
        if (!used.length) {
          warnings.push(
            `${Math.round(runLength)} სმ სიგრძის მხარე ვერ დაიფარა - ყველაზე ვიწრო პანელია ${
              panelOptions.length ? Math.min(...panelOptions.map((o) => o.w)) : '-'
            } სმ.`,
          );
        } else if (remainder > 0.01) {
          warnings.push(
            `${Math.round(runLength)} სმ მხარეზე დარჩა ${remainder} სმ - ამ ზომის ელემენტი კატალოგში არ არის.`,
          );
        }

        // The panel stands ON the offset line and reaches outward from the
        // concrete, so which side of the line it occupies follows the normal.
        const out = leftNormal(dir);
        const outward = across ? side * out.y : side * out.x;
        const lineAt = across ? from.y : from.x;
        const face = outward > 0 ? lineAt : lineAt - panelDepth;

        const lo = Math.min(startAt, endAt);
        const hi = Math.max(startAt, endAt);

        /**
         * Which end the run is laid from.
         *
         * `coverFace` returns the widest panels first and the odd strip last,
         * so this decides where the strip ends up — and a strip belongs where
         * nothing has been settled yet. An inside corner is a fixed part in a
         * fixed place and holds the run; an open end is only where the drawing
         * stops; an outside corner is a hole somebody is still going to think
         * about. Read off the geometry rather than off the direction of travel,
         * so the same wall drawn backwards still builds the same way.
         */
        const holds = (corner: number) =>
          corner < 0 || straightThrough(corner) ? 1 : outsideCorner(corner) ? 0 : 2;
        const lowHolds = holds(startAt <= endAt ? startCorner : endCorner);
        const highHolds = holds(startAt <= endAt ? endCorner : startCorner);
        const fromLow = lowHolds >= highHolds;

        let offset = 0;
        for (const option of used) {
          const pw = planW(option.material);
          const ph = planH(option.material);
          const rot = across ? 0 : 90;
          const along = fromLow ? lo + offset : hi - offset - pw;
          const { x, y } = placeAt(
            across ? along : face,
            across ? face : along,
            pw,
            ph,
            rot,
          );
          pieces.push({ id: uid(), materialId: option.material.id, x, y, rot, z: elevation });
          if (option.material.category === 'filler') fillerCount++;
          else panelCount++;
          offset += pw;
        }
      }
    }

    elevation += courseH;
  }

  return {
    pieces,
    // Each face of each course reports for itself, so identical legs produce
    // the same sentence repeatedly. Legs with different geometry differ and
    // are kept.
    warnings: [...new Set(warnings)],
    summary: {
      panels: panelCount,
      fillers: fillerCount,
      corners: cornerPieces,
      openCorners: turns.filter((t) => side * t > 0).length,
      courses: courses.length,
      runLength: Math.round(pathLength(path)),
      turns: turnCount,
    },
  };
}

/**
 * Fill several runs at once, as one job.
 *
 * A layout is rarely one unbroken line — a building is a few runs that happen
 * to meet — and filling them one at a time means opening the same dialog with
 * the same thickness and height for each, then adding up the summaries by hand
 * to know what to order.
 *
 * Each run is still planned on its own: they are separate walls, and a corner
 * only exists where one run turns, not where two happen to touch. What is
 * shared is the pour they belong to and the single count that comes out.
 */
export function planSketchFillAll(
  paths: SketchPath[],
  spec: SketchFillSpec,
  materials: Material[],
): FillPlan {
  const pieces: Piece[] = [];
  const warnings: string[] = [];
  const summary = { ...EMPTY };

  for (const path of paths) {
    const plan = planSketchFill(path, spec, materials);
    pieces.push(...plan.pieces);
    warnings.push(...plan.warnings);
    summary.panels += plan.summary.panels;
    summary.fillers += plan.summary.fillers;
    summary.corners += plan.summary.corners;
    summary.openCorners += plan.summary.openCorners;
    summary.runLength += plan.summary.runLength;
    summary.turns += plan.summary.turns;
    // Courses are how high the pour is, not something to add up: every run in
    // one job stands the same number.
    summary.courses = Math.max(summary.courses, plan.summary.courses);
  }

  return { pieces, warnings: [...new Set(warnings)], summary };
}
