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
import { isHorizontal, legLength, pathLength, type Point } from './sketch';

/**
 * Fills a drawn layout with formwork.
 *
 * The wall wizard asks for a length and builds one straight run. This takes the
 * line already drawn — which is how a layout is actually set out — and builds
 * every leg of it, including the corners where the legs meet. That is the whole
 * point of drawing first: the geometry is on the screen, so nobody should have
 * to read it back off and retype it a leg at a time.
 *
 * The drawn line is the wall's CENTRELINE. It is the only reading that survives
 * a corner: set out to a face, and the moment the wall turns you have to say
 * which face, and the two answers disagree by the wall thickness.
 *
 *        ─────────────────────────   face
 *        ░░░░░░░ concrete ░░░░░░░░   thickness, half either side
 *        ·······drawn line········   ← what you drew
 *        ░░░░░░░░░░░░░░░░░░░░░░░░░
 *        ─────────────────────────   face
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
  /** concrete thickness in cm, centred on the drawn line */
  thickness: number;
  /** pour height in cm */
  height: number;
  /** close the corners with profiles instead of butting the panels */
  includeCorners: boolean;
  /** close the open ends of the run — off where the pour continues */
  includeStopEnds: boolean;
}

export interface FillPlan {
  pieces: Piece[];
  warnings: string[];
  summary: {
    panels: number;
    fillers: number;
    corners: number;
    stopEnds: number;
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
  stopEnds: 0,
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
  if (!(spec.thickness > 0)) return fail('კედლის სისქე ნულზე მეტი უნდა იყოს.');
  if (!(spec.height > 0)) return fail('სიმაღლე ნულზე მეტი უნდა იყოს.');

  const heights = panelHeights(materials);
  if (!heights.length) return fail('კატალოგში პანელები ვერ მოიძებნა.');

  // ── Vertical: how many panel courses stack up the pour ────────────────────
  const stack = coverExact(spec.height, heights);
  const courses = stack.picks.map((i) => heights[i]);
  if (!courses.length) {
    warnings.push(
      `სიმაღლე ${spec.height} სმ ნებისმიერ პანელზე დაბალია — უმცირესი პანელია ${Math.min(...heights)} სმ.`,
    );
  }
  if (stack.remainder > 0.01) {
    warnings.push(
      `სიმაღლეში დარჩა ${stack.remainder} სმ — საჭიროა ჩაკერება ან სპეციალური ელემენტი.`,
    );
  }

  const courseCount = Math.max(1, courses.length);
  const courseHeight = courses[0] ?? Math.min(...heights);
  const panelDepth = panelDepthFor(optionsAt(materials, 'panel', courseHeight));
  const half = spec.thickness / 2;

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

  const faceLine: Record<number, Point[]> = {
    1: offsetPath(path, half),
    [-1]: offsetPath(path, -half),
  };

  let panelCount = 0;
  let fillerCount = 0;
  let cornerPieces = 0;
  let stopEndCount = 0;
  let elevation = 0;

  for (let c = 0; c < courseCount; c++) {
    const courseH = courses[c] ?? courseHeight;
    const panelOptions = optionsAt(materials, 'panel', courseH);
    const fillerOptions = optionsAt(materials, 'filler', courseH);
    const outer = spec.includeCorners ? pickCorner(materials, courseH, 'outer', panelDepth) : null;
    const inner = spec.includeCorners ? pickCorner(materials, courseH, 'inner', panelDepth) : null;

    if (c === 0 && spec.includeCorners && turnCount > 0 && (!outer || !inner)) {
      warnings.push(
        `${courseH} სმ სიმაღლის ${!outer ? 'გარე' : 'შიდა'} კუთხის პროფილი კატალოგში არ არის — კუთხე პანელებით იხურება.`,
      );
    }

    /** The profile closing corner `j` as seen from `side`, if there is one. */
    const profileAt = (side: 1 | -1, j: number) =>
      side * turns[j] > 0 ? outer : inner;

    // ── The two faces, leg by leg ───────────────────────────────────────────
    for (const side of [1, -1] as const) {
      const line = faceLine[side];

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

        const startExtend =
          startCorner >= 0
            ? startProfile
              ? -startProfile.reach
              : 0
            : spec.includeStopEnds
              ? panelDepth
              : 0;

        const endExtend =
          endCorner >= 0
            ? endProfile
              ? -endProfile.reach
              : side * turns[endCorner] > 0
                ? panelDepth
                : -panelDepth
            : spec.includeStopEnds
              ? panelDepth
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
            `${Math.round(lengths[j])} სმ მონაკვეთი კუთხეებისთვის ძალიან მოკლეა — პანელი აღარ ეტევა.`,
          );
          continue;
        }

        const { used, remainder } = coverFace(runLength, panelOptions, fillerOptions);
        if (!used.length) {
          warnings.push(
            `${Math.round(runLength)} სმ სიგრძის მხარე ვერ დაიფარა — ყველაზე ვიწრო პანელია ${
              panelOptions.length ? Math.min(...panelOptions.map((o) => o.w)) : '—'
            } სმ.`,
          );
        } else if (remainder > 0.01) {
          warnings.push(
            `${Math.round(runLength)} სმ მხარეზე დარჩა ${remainder} სმ — ამ ზომის ელემენტი კატალოგში არ არის.`,
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

    // ── Corner profiles, one pair per corner ────────────────────────────────
    for (let j = 0; j < turnCount; j++) {
      const vertex = (j + 1) % n;
      const convexSide: 1 | -1 = turns[j] > 0 ? 1 : -1;
      const dPrev = dirs[j];
      const dNext = dirs[(j + 1) % legCount];

      // The diagonal out of the corner into open air: the two outward normals
      // added together. They are perpendicular at a corner, so the sum is one
      // of the four diagonals.
      const outwardDiag = (side: 1 | -1): Point => {
        const a = leftNormal(dPrev);
        const b = leftNormal(dNext);
        return { x: side * (a.x + b.x), y: side * (a.y + b.y) };
      };

      if (outer) {
        const cw = planW(outer.material);
        const ch = planH(outer.material);
        const v = faceLine[convexSide][vertex];
        const diag = outwardDiag(convexSide);
        // The profile wraps the outside, so it hangs a panel thickness beyond
        // the face line in both directions and reaches back from there.
        const cornerX = v.x + panelDepth * diag.x;
        const cornerY = v.y + panelDepth * diag.y;
        const { x, y } = placeAt(
          diag.x > 0 ? cornerX - cw : cornerX,
          diag.y > 0 ? cornerY - ch : cornerY,
          cw,
          ch,
          cornerRot(diag),
        );
        pieces.push({
          id: uid(),
          materialId: outer.material.id,
          x,
          y,
          rot: cornerRot(diag),
          z: elevation,
        });
        cornerPieces++;
      }

      if (inner) {
        const concaveSide: 1 | -1 = convexSide === 1 ? -1 : 1;
        const cw = planW(inner.material);
        const ch = planH(inner.material);
        const v = faceLine[concaveSide][vertex];
        const diag = outwardDiag(concaveSide);
        // An inner profile sits IN the void, so it starts at the face line and
        // fills the corner rather than lapping past it.
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
    }

    // ── Stop-ends, closing the open ends of the run ─────────────────────────
    if (spec.includeStopEnds && !closed) {
      const ends: Array<{ at: Point; dir: Point }> = [
        { at: pts[0], dir: { x: -dirs[0].x, y: -dirs[0].y } },
        { at: pts[n - 1], dir: dirs[legCount - 1] },
      ];
      for (const end of ends) {
        // A stop-end runs across the wall, set a panel thickness back from the
        // concrete, between the two long faces that have just lapped past it.
        const across = end.dir.x !== 0;
        const { used } = coverFace(spec.thickness, panelOptions, fillerOptions, true);
        if (!used.length) {
          warnings.push(
            `${spec.thickness} სმ სისქის ბოლო ვერ დაიხურა — ამ ზომის ელემენტი კატალოგში არ არის.`,
          );
          continue;
        }
        const face = across
          ? end.dir.x > 0
            ? end.at.x
            : end.at.x - panelDepth
          : end.dir.y > 0
            ? end.at.y
            : end.at.y - panelDepth;
        const lo = (across ? end.at.y : end.at.x) - half;
        let offset = 0;
        for (const option of used) {
          const pw = planW(option.material);
          const ph = planH(option.material);
          const rot = across ? 90 : 0;
          const { x, y } = placeAt(
            across ? face : lo + offset,
            across ? lo + offset : face,
            pw,
            ph,
            rot,
          );
          pieces.push({ id: uid(), materialId: option.material.id, x, y, rot, z: elevation });
          stopEndCount++;
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
      stopEnds: stopEndCount,
      courses: courses.length,
      runLength: Math.round(pathLength(path)),
      turns: turnCount,
    },
  };
}
