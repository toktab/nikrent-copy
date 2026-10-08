import type { VectorDrawing } from '../detection/pdf';

/**
 * Every straight line a PDF page actually contains.
 *
 * A vector PDF does not need finding: the page's content stream already holds
 * the drafter's own geometry, exact to the point. `getPageDrawings` recovers it
 * (the same extraction the detectors use), and this turns that into one flat
 * list of segments worth tracing over.
 *
 * Two things have to happen to it first, or the tracing tool is unusable:
 *
 * 1. **A wall is rarely one segment.** CAD exporters emit a long edge as a run
 *    of short collinear pieces, split at every hatch, door or dimension that
 *    crosses it. Drawing over "the line" has to land on the whole wall, so
 *    collinear pieces that touch (or nearly touch) are merged back together.
 * 2. **Hairlines and hatching are noise.** Below a couple of points nothing is
 *    a wall; it is a hatch tick, an arrowhead or a rounding artefact.
 *
 * Page points throughout (y-down, top-left origin), which is what the overlay
 * draws in and what the fitter converts to centimetres.
 */

export interface Pt {
  x: number;
  y: number;
}

export interface Seg {
  id: string;
  a: Pt;
  b: Pt;
  /** how many extracted pieces were merged into it - a long wall scores high */
  parts: number;
}

export interface ExtractOptions {
  /** shorter than this is a tick, a hatch dash or a rounding artefact (points) */
  minLengthPt?: number;
  /** two pieces count as the same line within this angle (degrees) */
  angleTolDeg?: number;
  /** ...and this far apart across the line (points) */
  offsetTolPt?: number;
  /** ...and with no more than this much gap along it (points) */
  gapTolPt?: number;
}

const DEFAULTS: Required<ExtractOptions> = {
  minLengthPt: 2,
  angleTolDeg: 1.2,
  offsetTolPt: 0.75,
  gapTolPt: 2.5,
};

export function segLength(s: { a: Pt; b: Pt }): number {
  return Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y);
}

/** Direction in degrees, folded to [0, 180): a line has no front and back. */
export function segAngleDeg(s: { a: Pt; b: Pt }): number {
  const deg = (Math.atan2(s.b.y - s.a.y, s.b.x - s.a.x) * 180) / Math.PI;
  const folded = ((deg % 180) + 180) % 180;
  return folded;
}

/** Smallest angle between two folded directions, in degrees. */
export function angleGap(a: number, b: number): number {
  const d = Math.abs(a - b) % 180;
  return d > 90 ? 180 - d : d;
}

/**
 * The four edges of a rectangle item, and the two endpoints of a line item.
 * Curves are skipped: a formwork layout is built of straight runs, and a
 * flattened Bézier would fill the list with dozens of chords nobody can trace.
 */
export function expandDrawings(drawings: VectorDrawing[]): Array<{ a: Pt; b: Pt }> {
  const out: Array<{ a: Pt; b: Pt }> = [];
  for (const d of drawings) {
    for (const item of d.items) {
      if (item.type === 'l') {
        out.push({ a: item.p1, b: item.p2 });
      } else if (item.type === 're') {
        const { x0, y0, x1, y1 } = item.rect;
        out.push({ a: { x: x0, y: y0 }, b: { x: x1, y: y0 } });
        out.push({ a: { x: x1, y: y0 }, b: { x: x1, y: y1 } });
        out.push({ a: { x: x1, y: y1 }, b: { x: x0, y: y1 } });
        out.push({ a: { x: x0, y: y1 }, b: { x: x0, y: y0 } });
      }
    }
  }
  return out;
}

/** Signed distance from the origin to the line, measured across it. */
function offsetOf(s: { a: Pt; b: Pt }, angle: number): number {
  const rad = (angle * Math.PI) / 180;
  // Normal of the folded direction; both endpoints sit on the same offset.
  return -Math.sin(rad) * s.a.x + Math.cos(rad) * s.a.y;
}

/** Where a point falls along the line's own direction. */
function projectionOf(p: Pt, angle: number): number {
  const rad = (angle * Math.PI) / 180;
  return Math.cos(rad) * p.x + Math.sin(rad) * p.y;
}

/**
 * Lines the page really has, merged and cleaned.
 *
 * Buckets by direction and by offset across the line, so only pieces that
 * could possibly be collinear are ever compared - a drawing with twenty
 * thousand segments would be minutes of work at O(n²), and this is the loop a
 * user waits on after choosing a file.
 */
export function extractSegments(
  drawings: VectorDrawing[],
  options: ExtractOptions = {},
): Seg[] {
  const opt = { ...DEFAULTS, ...options };
  const raw = expandDrawings(drawings).filter((s) => segLength(s) >= opt.minLengthPt);

  // Bucket key: direction and distance across the line, both coarse enough
  // that the pieces of one wall land together.
  const angleStep = Math.max(0.5, opt.angleTolDeg);
  const offsetStep = Math.max(0.5, opt.offsetTolPt * 2);
  const buckets = new Map<string, Array<{ a: Pt; b: Pt; angle: number; offset: number }>>();

  for (const s of raw) {
    const angle = segAngleDeg(s);
    const offset = offsetOf(s, angle);
    const key = `${Math.round(angle / angleStep)}:${Math.round(offset / offsetStep)}`;
    const list = buckets.get(key);
    if (list) list.push({ ...s, angle, offset });
    else buckets.set(key, [{ ...s, angle, offset }]);
  }

  const merged: Seg[] = [];
  let n = 0;

  for (const list of buckets.values()) {
    // Within a bucket every piece is near-collinear, so the merge is a 1-D
    // sweep along the shared direction: sort by where each piece starts, then
    // extend the open run while the next piece touches it.
    const angle = list[0].angle;
    const spans = list
      .map((s) => {
        const p1 = projectionOf(s.a, angle);
        const p2 = projectionOf(s.b, angle);
        return {
          from: Math.min(p1, p2),
          to: Math.max(p1, p2),
          a: p1 <= p2 ? s.a : s.b,
          b: p1 <= p2 ? s.b : s.a,
          angle: s.angle,
          offset: s.offset,
        };
      })
      .sort((p, q) => p.from - q.from);

    let run = spans[0];
    let parts = 1;
    const flush = () => {
      merged.push({ id: `pdf${n++}`, a: run.a, b: run.b, parts });
    };

    for (let i = 1; i < spans.length; i++) {
      const next = spans[i];
      const sameLine =
        angleGap(run.angle, next.angle) <= opt.angleTolDeg &&
        Math.abs(run.offset - next.offset) <= opt.offsetTolPt;
      if (sameLine && next.from <= run.to + opt.gapTolPt) {
        if (next.to > run.to) {
          run = { ...run, to: next.to, b: next.b };
        }
        parts++;
        continue;
      }
      flush();
      run = next;
      parts = 1;
    }
    flush();
  }

  // Longest first: the walls a person wants to trace are at the top, and the
  // matcher prefers them when a short piece sits on top of a long one.
  return merged
    .filter((s) => segLength(s) >= opt.minLengthPt)
    .sort((p, q) => segLength(q) - segLength(p));
}

/**
 * The same segments, moved into another frame.
 *
 * This exists because the extracted geometry and the rendered picture are not
 * always in the same space. `getPageDrawings` reports the content stream's own
 * coordinates, flipped with the viewport's height; on a page the PDF marks as
 * rotated - which architects' sheets very often are, A3 landscape stored as
 * portrait plus `/Rotate 90` - the rendered page is turned a quarter circle
 * and that flip used the wrong side. The result lands nowhere near the drawing
 * the user can see, so every line they try to trace misses.
 *
 * The page itself knows the transform, so the fix is to ask it rather than to
 * re-derive it: see `viewportMapper`.
 */
export function mapSegments(list: Seg[], map: (p: Pt) => Pt): Seg[] {
  return list.map((s) => ({ ...s, a: map(s.a), b: map(s.b) }));
}

/**
 * Takes a point as `getPageDrawings` reports it and returns where it actually
 * sits on the rendered page.
 *
 * `flipHeight` must be the height that extraction used for its y flip (the
 * scale-1 viewport height), because undoing that flip is what gets us back to
 * the content stream's own y-up space; `convert` is the page viewport's own
 * `convertToViewportPoint`, which then applies the rotation, the flip and any
 * crop offset exactly as the renderer did.
 */
export function viewportMapper(
  flipHeight: number,
  convert: (x: number, y: number) => number[],
): (p: Pt) => Pt {
  return (p: Pt) => {
    const [x, y] = convert(p.x, flipHeight - p.y);
    return { x, y };
  };
}

/** Whether a segment is within `tolDeg` of horizontal or vertical. */
export function axisOf(s: { a: Pt; b: Pt }, tolDeg = 3): 'h' | 'v' | 'free' {
  const angle = segAngleDeg(s);
  if (angleGap(angle, 0) <= tolDeg) return 'h';
  if (angleGap(angle, 90) <= tolDeg) return 'v';
  return 'free';
}
