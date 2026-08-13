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
    corners: number;
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
 * The side of a run that faces away from what it wraps around.
 *
 * Formwork stands on the OUTSIDE of the pour, always, and which side that is
 * belongs to the shape rather than to the person drawing it. Taking it as a
 * setting meant the panels landed inside or outside depending on whether a run
 * happened to be drawn left-to-right, which is not a decision anybody made.
 *
 * The shoelace sum answers it. Reversing a run flips the sum AND flips left
 * from right, so the two cancel and the same physical side comes out either
 * way. Positive is clockwise on screen — y counts downward here — and a
 * clockwise run holds its ground on the right, so its outside is the left.
 *
 * A straight line encloses nothing and has no outside; it falls back to the
 * left of travel, and `flip` is there for when that guesses wrong.
 */
export function outwardSide(path: SketchPath): 1 | -1 {
  const pts = path.points;
  let twiceArea = 0;
  for (let i = 0; i < pts.length; i++) {
    const a = pts[i];
    const b = pts[(i + 1) % pts.length];
    twiceArea += a.x * b.y - b.x * a.y;
  }
  return twiceArea < 0 ? -1 : 1;
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
 * The corner profile for one role, at one course height.
 *
 * Outer and inner corners are different parts and neither is interchangeable
 * with the other: an outer profile wraps the OUTSIDE of the box, so its leg is
 * measured past the panel it laps, while an inner one sits in the void and its
 * leg is the face it covers. Nothing in the material record says which is
 * which, so the Georgian name decides — it is what the parts are called — and
 * where the name is silent the geometry does: an outer profile has to span the
 * panel as well as the face, so for the same cover it is the wider part.
 */
function pickCorner(
  materials: Material[],
  height: number,
  role: 'outer' | 'inner',
  panelDepth: number,
): { material: Material; reach: number } | null {
  const candidates = materials
    .filter((m) => m.category === 'corner' && m.shape === 'L' && m.h === height)
    .sort((a, b) => planW(b) - planW(a));
  if (!candidates.length) return null;

  const named = candidates.filter((m) => m.name.includes(role === 'outer' ? 'გარე' : 'შიდა'));
  const pool = named.length ? named : candidates;
  const material = role === 'outer' ? pool[0] : pool[pool.length - 1];

  // How much of the concrete face the profile itself covers. An outer leg is
  // measured from outside the panel, so it reaches `leg − panel` along the
  // face; using the bare leg would leave a panel-thickness hole beside every
  // corner, which is the bug the column wizard's `inset` exists to avoid.
  const reach = role === 'outer' ? planW(material) - panelDepth : planW(material);
  return reach > 0.01 ? { material, reach } : null;
}

/**
 * Which way to turn an L so its solid legs face the concrete.
 *
 * `diag` points from the corner out into open air. An L is drawn with its legs
 * on the left and the bottom — notch facing up and right — so it is already
 * correct where the air is down and to the left.
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

  const pts = path.points;
  const n = pts.length;
  const closed = !!path.closed && n > 2;
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
  const side: 1 | -1 = spec.flip ? ((outwardSide(path) * -1) as 1 | -1) : outwardSide(path);

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
    const outer = spec.includeCorners ? pickCorner(materials, courseH, 'outer', panelDepth) : null;
    const inner = spec.includeCorners ? pickCorner(materials, courseH, 'inner', panelDepth) : null;

    if (c === 0 && spec.includeCorners && turnCount > 0 && (!outer || !inner)) {
      warnings.push(
        `${courseH} სმ სიმაღლის ${!outer ? 'გარე' : 'შიდა'} კუთხის პროფილი კატალოგში არ არის - კუთხე პანელებით იხურება.`,
      );
    }

    /** The profile closing corner `j` as seen from `side`, if there is one. */
    const profileAt = (side: 1 | -1, j: number) =>
      side * turns[j] > 0 ? outer : inner;

    // ── The two faces, leg by leg ───────────────────────────────────────────
    {
      for (let j = 0; j < legCount; j++) {
        const dir = dirs[j];
        const across = dir.x !== 0;
        const from = line[j];
        const to = line[(j + 1) % n];

        /**
         * How far each end of this face run moves, along the leg, in cm.
         * Positive lengthens.
         *
         * With a profile the run simply stops short of it, both ends alike.
         * Without one the faces have to close the corner between them, and a
         * face cannot be in two places at once: at every corner exactly one of
         * the two runs moves by a panel thickness and the other stays put.
         * Outside the turn the leaving run laps past; inside it, it stops short
         * and the next run closes in front of it. Move both and they overlap by
         * a panel — which is a panel over-ordered at every corner.
         */
        const startCorner = closed ? (j - 1 + legCount) % legCount : j - 1;
        const endCorner = closed ? j : j < legCount - 1 ? j : -1;

        const startProfile = startCorner >= 0 ? profileAt(side, startCorner) : null;
        const endProfile = endCorner >= 0 ? profileAt(side, endCorner) : null;

        /**
         * An open end is where the face stops.
         *
         * It used to run a panel thickness past the pour so a stop-end could
         * sit between the two faces. Nothing closes an end now - that is a
         * decision for the person pouring it - and the 9 cm was also what put
         * every face off the catalog's 5 cm grid, leaving a 4 cm strip at the
         * end of runs that no part in the catalog could close.
         */
        const startExtend = startCorner >= 0 && startProfile ? -startProfile.reach : 0;

        const endExtend =
          endCorner >= 0
            ? endProfile
              ? -endProfile.reach
              : side * turns[endCorner] > 0
                ? panelDepth
                : -panelDepth
            : 0;

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

        let offset = 0;
        for (const option of used) {
          const pw = planW(option.material);
          const ph = planH(option.material);
          const rot = across ? 0 : 90;
          const { x, y } = placeAt(
            across ? lo + offset : face,
            across ? face : lo + offset,
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

    /**
     * Corner profiles, one per corner.
     *
     * There is only one run of panels now, so a corner needs one part, not a
     * matched pair: an outer profile where the panels are on the outside of the
     * turn and wrap around it, an inner one where they close into each other.
     * Which of the two it is falls straight out of the turn direction and the
     * side the panels are standing on.
     */
    for (let j = 0; j < turnCount; j++) {
      const vertex = (j + 1) % n;
      const convex = side * turns[j] > 0;
      const profile = convex ? outer : inner;
      if (!profile) continue;

      // The diagonal out of the corner into open air: the two outward normals
      // added together. They are perpendicular at a corner, so the sum is one
      // of the four diagonals.
      const a = leftNormal(dirs[j]);
      const b = leftNormal(dirs[(j + 1) % legCount]);
      const diag: Point = { x: side * (a.x + b.x), y: side * (a.y + b.y) };

      const cw = planW(profile.material);
      const ch = planH(profile.material);
      const v = line[vertex];

      // An outer profile wraps the outside, so it hangs a panel thickness past
      // the face and reaches back from there. An inner one sits in the corner
      // the panels are closing into, starting at the face itself.
      const rot = convex ? cornerRot(diag) : (cornerRot(diag) + 180) % 360;
      const cornerX = convex ? v.x + panelDepth * diag.x : v.x;
      const cornerY = convex ? v.y + panelDepth * diag.y : v.y;
      const { x, y } = placeAt(
        diag.x > 0 ? cornerX - cw : cornerX,
        diag.y > 0 ? cornerY - ch : cornerY,
        cw,
        ch,
        rot,
      );
      pieces.push({ id: uid(), materialId: profile.material.id, x, y, rot, z: elevation });
      cornerPieces++;
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
    summary.runLength += plan.summary.runLength;
    summary.turns += plan.summary.turns;
    // Courses are how high the pour is, not something to add up: every run in
    // one job stands the same number.
    summary.courses = Math.max(summary.courses, plan.summary.courses);
  }

  return { pieces, warnings: [...new Set(warnings)], summary };
}
