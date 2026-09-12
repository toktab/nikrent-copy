import type { Category, Material, Piece, SketchPath } from '../types';
import { pieceBounds } from './geometry';
import { isOrthogonal } from './sketch';
import {
  MAX_WALL_CM,
  OUTER_CORNER_GAP,
  cornersOnly,
  legDir,
  leftNormal,
  outwardSide,
  sidesFromNeighbours,
  turnSign,
  type SketchFillSpec,
} from './sketchFill';

/**
 * The architect's ცდომილება: do the pieces standing on a drawn line add up to
 * the line, exactly.
 *
 * His workbook does it by hand - count × width, minus the length he reads off
 * the drawing, and the answer has to be 0. The fill already lays exact runs, so
 * for anything it placed this says 0; what it is for is everything placed,
 * moved or deleted by hand afterwards, which nothing else checks.
 *
 * It reads the drawing the way the fill writes it (docs/FORMWORK.md): the line
 * is the concrete face, the pieces stand outside it, an inside corner is closed
 * by a 20 cm profile, an outside corner is left open on purpose and is reported
 * as the hole it is rather than as an error.
 *
 * It does not ask the fill what it did. It looks at what is standing on the
 * line, so a layout built entirely by hand is checked the same way.
 */

const FACE: ReadonlySet<Category> = new Set<Category>(['panel', 'filler', 'corner']);

/** Half a millimetre survives a rotation; anything more is a real distance. */
const TOL = 0.5;

/** Which way a run is read as facing, for the check alone - only `flip` is used. */
const SIDE_SPEC: SketchFillSpec = { height: 1, includeCorners: true };

export interface FaceCheck {
  /** which leg of the run, counting corners only */
  leg: number;
  /** the drawn leg, cm */
  length: number;
  /** what has to be covered: the leg, less what is left open at outside corners */
  required: number;
  /** what stands on it, cm */
  sum: number;
  /** sum − required, to the millimetre: 0 is right, above is too long, below is short */
  error: number;
  /** bare face at an outside corner - a hole on purpose, cm, one per corner */
  openCorners: number[];
  /** face nothing stands on that is not an outside corner; `at` is cm from the leg's start */
  gaps: Array<{ at: number; cm: number }>;
  /** face with two pieces on it */
  overlaps: Array<{ at: number; cm: number }>;
  /** what stands on it, in order along the leg, grouped: 90 ×3, ჩ10, კუთხე 20 */
  parts: Array<{ label: string; count: number }>;
  ok: boolean;
}

export interface CourseCheck {
  /** underside of the course, cm */
  z: number;
  faces: FaceCheck[];
  ok: boolean;
}

export interface PathCheck {
  /** bottom course first; empty when nothing stands on the line at all */
  courses: CourseCheck[];
  ok: boolean;
  /** a line at an angle is not checked - nothing in the catalog closes one */
  orthogonal: boolean;
}

interface Leg {
  index: number;
  across: boolean;
  /** the face line's coordinate on the other axis */
  at: number;
  lo: number;
  hi: number;
  /** +1 when the leg is drawn from `lo` towards `hi` */
  forward: 1 | -1;
  /** the left normal's sign on the other axis */
  normal: 1 | -1;
  /** the turn at each end; null where the run simply stops */
  turnLo: number | null;
  turnHi: number | null;
}

type EndKind = 'open' | 'inside' | 'outside';

function legsOf(path: SketchPath): Leg[] {
  const pts = path.points;
  const n = pts.length;
  const closed = !!path.closed && n > 2;
  const count = closed ? n : n - 1;
  const dirs = Array.from({ length: count }, (_, j) => legDir(pts[j], pts[(j + 1) % n]));
  const legs: Leg[] = [];
  for (let j = 0; j < count; j++) {
    const a = pts[j];
    const b = pts[(j + 1) % n];
    const d = dirs[j];
    const across = d.x !== 0;
    const start = across ? a.x : a.y;
    const end = across ? b.x : b.y;
    const nrm = leftNormal(d);
    const turnStart = closed || j > 0 ? turnSign(dirs[(j - 1 + count) % count], d) : null;
    const turnEnd = closed || j < count - 1 ? turnSign(d, dirs[(j + 1) % count]) : null;
    const forward: 1 | -1 = end >= start ? 1 : -1;
    legs.push({
      index: j,
      across,
      at: across ? a.y : a.x,
      lo: Math.min(start, end),
      hi: Math.max(start, end),
      forward,
      normal: (across ? nrm.y : nrm.x) > 0 ? 1 : -1,
      turnLo: forward > 0 ? turnStart : turnEnd,
      turnHi: forward > 0 ? turnEnd : turnStart,
    });
  }
  return legs;
}

const endKind = (turn: number | null, side: 1 | -1): EndKind =>
  turn === null || turn === 0 ? 'open' : side * turn > 0 ? 'outside' : 'inside';

interface Standing {
  /** the stretch of face it backs, clipped to the leg */
  from: number;
  to: number;
  /** what it counts towards the sum, cm */
  cm: number;
  label: string;
  z: number;
}

/**
 * What one piece does for one leg, standing on the given side, if anything.
 *
 * A piece counts when its box sits flush on the face line, on the panel side,
 * alongside the leg. Laid along the leg it counts its whole width, so one that
 * runs past the end of the leg reads as too long. Anything else touching the
 * face - a corner profile, or the end of the run arriving at an inside corner
 * with no profile, whose 9 cm thickness closes the first 9 cm of this one -
 * counts only the stretch of this leg it actually backs.
 */
function standingOn(leg: Leg, outward: 1 | -1, piece: Piece, m: Material): Standing | null {
  const b = pieceBounds(piece, m);
  const near = leg.across ? b.y : b.x;
  const far = leg.across ? b.y + b.h : b.x + b.w;
  const flush =
    outward > 0
      ? Math.abs(near - leg.at) <= TOL && far > leg.at + TOL
      : Math.abs(far - leg.at) <= TOL && near < leg.at - TOL;
  if (!flush) return null;

  const from = leg.across ? b.x : b.y;
  const to = leg.across ? b.x + b.w : b.y + b.h;
  const clipFrom = Math.max(from, leg.lo);
  const clipTo = Math.min(to, leg.hi);
  if (clipTo - clipFrom <= TOL) return null;

  const along = m.shape !== 'L' && Math.abs(far - near - m.depth) <= TOL;
  const width = round1(to - from);
  const backed = round1(clipTo - clipFrom);
  const label =
    m.shape === 'L'
      ? `კუთხე ${backed}`
      : !along
        ? `${backed} (კუთხეში)`
        : m.category === 'filler'
          ? `ჩ${width}`
          : String(width);
  return { from: clipFrom, to: clipTo, cm: along ? to - from : clipTo - clipFrom, label, z: Math.round(piece.z ?? 0) };
}

const round1 = (v: number) => Math.round(v * 10) / 10;

function checkFace(leg: Leg, side: 1 | -1, standing: Standing[]): FaceCheck {
  const length = leg.hi - leg.lo;
  const loKind = endKind(leg.turnLo, side);
  const hiKind = endKind(leg.turnHi, side);
  const sorted = [...standing].sort((p, q) => p.from - q.from || p.to - q.to);

  const gaps: Array<{ at: number; cm: number }> = [];
  const overlaps: Array<{ at: number; cm: number }> = [];
  const openCorners: number[] = [];
  /** cm from the leg's drawn start, for a stretch starting at `from` */
  const fromStart = (from: number, cm: number) =>
    round1(leg.forward > 0 ? from - leg.lo : leg.hi - (from + cm));

  let required = length;

  if (!sorted.length) {
    // Nothing on it at all. Between two outside corners and no longer than a
    // wall is thick, that is the end of a pour or a nib the corners have eaten,
    // and it is left open on purpose, whole. Anything else is face missing.
    if (loKind === 'outside' && hiKind === 'outside' && length <= MAX_WALL_CM + TOL) {
      if (length > TOL) openCorners.push(round1(length));
      required = 0;
    } else {
      const lo = loKind === 'outside' ? OUTER_CORNER_GAP : 0;
      const hi = hiKind === 'outside' ? OUTER_CORNER_GAP : 0;
      required = Math.max(0, length - lo - hi);
      if (lo) openCorners.push(Math.min(OUTER_CORNER_GAP, round1(length)));
      if (hi && length > OUTER_CORNER_GAP) openCorners.push(OUTER_CORNER_GAP);
      if (required > TOL) gaps.push({ at: fromStart(leg.lo + lo, required), cm: round1(required) });
    }
  } else {
    let reach = sorted[0].to;
    for (const s of sorted.slice(1)) {
      if (s.from > reach + TOL) {
        gaps.push({ at: fromStart(reach, s.from - reach), cm: round1(s.from - reach) });
      } else if (s.from < reach - TOL) {
        const cm = Math.min(reach, s.to) - s.from;
        overlaps.push({ at: fromStart(s.from, cm), cm: round1(cm) });
      }
      reach = Math.max(reach, s.to);
    }

    /**
     * The bare stretch at each end. At an outside corner, whatever is bare is
     * the hole the corner is and comes off what has to be covered: the fill
     * leaves at least 20 cm (more where a face gave length up to line up with
     * the other side of the wall), but a corner closed by hand - panels run on
     * into it, a გარე კუთხე on it - leaves less or nothing, and is built right
     * too. Too long there is a piece reaching past the corner, and that shows
     * in the sum, because a piece along the leg counts its whole width. At an
     * inside corner or the open end of a run the face should be closed right
     * to the end.
     */
    const ends: Array<[EndKind, number, number]> = [
      [loKind, sorted[0].from - leg.lo, leg.lo],
      [hiKind, leg.hi - reach, reach],
    ];
    for (const [kind, bare, from] of ends) {
      if (kind === 'outside') {
        required -= bare;
        if (bare > TOL) openCorners.push(round1(bare));
      } else if (bare > TOL) {
        gaps.push({ at: fromStart(from, bare), cm: round1(bare) });
      }
    }
    required = Math.max(0, required);
  }

  const sum = standing.reduce((total, s) => total + s.cm, 0);
  const error = round1(sum - required);

  // In the order a person walks the leg, so the list reads like the wall does.
  const walk = leg.forward > 0 ? sorted : [...sorted].reverse();
  const parts: Array<{ label: string; count: number }> = [];
  for (const s of walk) {
    const last = parts[parts.length - 1];
    if (last && last.label === s.label) last.count++;
    else parts.push({ label: s.label, count: 1 });
  }

  return {
    leg: leg.index,
    length: round1(length),
    required: round1(required),
    sum: round1(sum),
    error,
    openCorners,
    gaps: gaps.sort((p, q) => p.at - q.at),
    overlaps,
    parts,
    ok: Math.abs(error) <= TOL && !gaps.length && !overlaps.length,
  };
}

/**
 * Check one drawn line against what stands on it, course by course.
 *
 * `allPaths` is the rest of the drawing, which is what decides the side when
 * the pieces themselves do not: normally the side is simply the one the pieces
 * are standing on, so a run filled with `flip` is still checked where it was
 * built.
 */
export function checkPath(
  path: SketchPath,
  allPaths: SketchPath[],
  pieces: Piece[],
  byId: Map<string, Material>,
): PathCheck {
  if (!isOrthogonal(path)) return { courses: [], ok: false, orthogonal: false };
  const run = cornersOnly(path);
  const legs = legsOf(run);
  if (!legs.length) return { courses: [], ok: true, orthogonal: true };

  const faces = pieces.flatMap((piece) => {
    const m = byId.get(piece.materialId);
    // Only square to the drawing: the check reads boxes, and so does the fill.
    const square = Math.abs(((piece.rot % 90) + 90) % 90) < TOL || Math.abs(((piece.rot % 90) + 90) % 90) > 90 - TOL;
    return m && FACE.has(m.category) && square ? [{ piece, m }] : [];
  });

  const standingFor = (side: 1 | -1) =>
    legs.map((leg) =>
      faces.flatMap(({ piece, m }) => {
        const s = standingOn(leg, (side * leg.normal) as 1 | -1, piece, m);
        return s ? [s] : [];
      }),
    );

  const plus = standingFor(1);
  const minus = standingFor(-1);
  const count = (per: Standing[][]) => per.reduce((total, list) => total + list.length, 0);
  let side: 1 | -1;
  if (count(plus) !== count(minus)) {
    side = count(plus) > count(minus) ? 1 : -1;
  } else {
    const index = allPaths.findIndex((p) => p.id === path.id);
    side = index >= 0 ? sidesFromNeighbours(allPaths, SIDE_SPEC)[index] : outwardSide(run);
  }
  const standing = side > 0 ? plus : minus;

  const zs = [...new Set(standing.flat().map((s) => s.z))].sort((a, b) => a - b);
  const courses = zs.map((z): CourseCheck => {
    const checked = legs.map((leg, i) =>
      checkFace(leg, side, standing[i].filter((s) => s.z === z)),
    );
    return { z, faces: checked, ok: checked.every((f) => f.ok) };
  });

  return { courses, ok: courses.every((c) => c.ok), orthogonal: true };
}
