import { angleGap, segAngleDeg, segLength, type Pt, type Seg } from './segments';

/**
 * Which line the user just drew over.
 *
 * The whole point of the tracing workspace is agreement: the program found a
 * line, the person drew along the same line, and only then is it taken as real.
 * So a stroke is not geometry to keep - it is a question asked of the extracted
 * segments, and this answers it.
 *
 * A hand-drawn stroke is never exact. It is a few degrees off, a few points to
 * one side, and usually covers part of the wall rather than all of it. The test
 * is therefore the three things a person means by "that one": it runs the same
 * way, it sits on top of it, and it goes along it rather than crossing it.
 */

export interface MatchOptions {
  /** the stroke may run this far off the line's direction (degrees) */
  maxAngleDeg?: number;
  /** ...and this far to one side of it (points) */
  maxDistancePt?: number;
  /** ...and must lie along it for at least this share of the stroke (0..1) */
  minOverlap?: number;
}

const DEFAULTS: Required<MatchOptions> = {
  maxAngleDeg: 14,
  maxDistancePt: 9,
  minOverlap: 0.4,
};

export interface StrokeMatch {
  seg: Seg;
  /** degrees between the stroke and the line */
  angleDiff: number;
  /** how far the stroke sits off the line, across it (points) */
  distance: number;
  /** share of the stroke that lies along the line, 0..1 */
  overlap: number;
  /** share of the LINE the stroke covered - low means "it is longer than you drew" */
  coverage: number;
  /** lower is better; only meaningful between candidates for one stroke */
  score: number;
}

/** Distance from `p` to the infinite line through a-b. */
function distanceToLine(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return Math.hypot(p.x - a.x, p.y - a.y);
  return Math.abs((p.x - a.x) * dy - (p.y - a.y) * dx) / len;
}

/** Where `p` falls along a-b, as a distance from `a` in points. */
function projectOnto(p: Pt, a: Pt, b: Pt): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return 0;
  return ((p.x - a.x) * dx + (p.y - a.y) * dy) / len;
}

/**
 * The line the stroke means, or null when the stroke agrees with nothing -
 * which is itself an answer: the user drew over something the program cannot
 * see, and the page offers to keep the stroke as a line of its own.
 */
export function matchStroke(
  strokeA: Pt,
  strokeB: Pt,
  segments: Seg[],
  options: MatchOptions = {},
): StrokeMatch | null {
  const opt = { ...DEFAULTS, ...options };
  const strokeLen = Math.hypot(strokeB.x - strokeA.x, strokeB.y - strokeA.y);
  if (strokeLen < 1) return null;
  const strokeAngle = segAngleDeg({ a: strokeA, b: strokeB });

  let best: StrokeMatch | null = null;

  for (const seg of segments) {
    const angleDiff = angleGap(strokeAngle, segAngleDeg(seg));
    if (angleDiff > opt.maxAngleDeg) continue;

    const distance = (distanceToLine(strokeA, seg.a, seg.b) + distanceToLine(strokeB, seg.a, seg.b)) / 2;
    if (distance > opt.maxDistancePt) continue;

    // How much of the stroke lies beside the segment rather than past its end.
    const segLen = segLength(seg);
    const p1 = projectOnto(strokeA, seg.a, seg.b);
    const p2 = projectOnto(strokeB, seg.a, seg.b);
    const from = Math.max(0, Math.min(p1, p2));
    const to = Math.min(segLen, Math.max(p1, p2));
    const shared = Math.max(0, to - from);
    const overlap = shared / strokeLen;
    if (overlap < opt.minOverlap) continue;

    const coverage = segLen > 0 ? shared / segLen : 0;

    /**
     * Distance first, then angle, then how much of the stroke landed on it.
     * Length deliberately does not enter the score beyond the small nudge
     * below: when a short piece lies on top of a long wall, both are equally
     * "the line under the pointer", and taking the long one saves the user
     * tracing the same wall five times.
     */
    const score =
      distance / opt.maxDistancePt +
      angleDiff / opt.maxAngleDeg +
      (1 - overlap) -
      Math.min(0.35, segLen / 1000);

    if (!best || score < best.score) {
      best = { seg, angleDiff, distance, overlap, coverage, score };
    }
  }

  return best;
}

/**
 * The stroke, laid onto the line it matched.
 *
 * What a person draws is never straight and never quite in the right place,
 * but they know exactly how much of the wall they meant. So the stroke's two
 * ends are dropped onto the found line - the result is perfectly straight and
 * exactly where the drawing says, while keeping the length that was drawn.
 *
 * Within `snapEndsPt` of either end of the line, the piece runs to that end
 * instead. That is the difference between a wall that stops a few points short
 * of the corner and one that meets it: nobody can hit the exact end of a line
 * by hand, and a corner that nearly meets is the one defect that makes the
 * traced drawing useless downstream.
 */
export function strokeAlong(
  seg: { a: Pt; b: Pt },
  strokeA: Pt,
  strokeB: Pt,
  snapEndsPt = 14,
): { a: Pt; b: Pt } {
  const dx = seg.b.x - seg.a.x;
  const dy = seg.b.y - seg.a.y;
  const len = Math.hypot(dx, dy);
  if (!len) return { a: { ...seg.a }, b: { ...seg.b } };
  const ux = dx / len;
  const uy = dy / len;

  const at = (p: Pt) => Math.max(0, Math.min(len, projectOnto(p, seg.a, seg.b)));
  let from = Math.min(at(strokeA), at(strokeB));
  let to = Math.max(at(strokeA), at(strokeB));
  if (from <= snapEndsPt) from = 0;
  if (to >= len - snapEndsPt) to = len;
  // A stroke drawn right across one end can collapse; keep it a line.
  if (to - from < 1) {
    from = 0;
    to = len;
  }

  return {
    a: { x: seg.a.x + ux * from, y: seg.a.y + uy * from },
    b: { x: seg.a.x + ux * to, y: seg.a.y + uy * to },
  };
}

/** Do two pieces of the same found line cover the same stretch of it? */
export function piecesOverlap(
  first: { a: Pt; b: Pt },
  second: { a: Pt; b: Pt },
  tolPt = 2,
): boolean {
  const alongFirst = (p: Pt) => projectOnto(p, first.a, first.b);
  const len = Math.hypot(first.b.x - first.a.x, first.b.y - first.a.y);
  const from = Math.min(alongFirst(second.a), alongFirst(second.b));
  const to = Math.max(alongFirst(second.a), alongFirst(second.b));
  return Math.min(len, to) - Math.max(0, from) > tolPt;
}

/**
 * A stroke the program could not match, kept as the user's own line.
 *
 * Scanned drawings have no vector geometry at all, and even a clean PDF hides
 * a wall inside a filled region now and then. Refusing the stroke there would
 * leave the person with nothing to do, so it becomes a line marked as theirs -
 * verified by a person and by nothing else, which the list says plainly.
 */
export function strokeAsSegment(strokeA: Pt, strokeB: Pt, id: string, squareTolDeg = 4): Seg {
  // Straightened onto the square if it was nearly square already: the drawing
  // this becomes is orthogonal, and a hand-drawn line two degrees off would
  // arrive as a wall nothing can be set out from.
  const angle = segAngleDeg({ a: strokeA, b: strokeB });
  let b = { ...strokeB };
  if (angleGap(angle, 0) <= squareTolDeg) b = { x: strokeB.x, y: strokeA.y };
  else if (angleGap(angle, 90) <= squareTolDeg) b = { x: strokeA.x, y: strokeB.y };
  return { id, a: { ...strokeA }, b, parts: 0 };
}
