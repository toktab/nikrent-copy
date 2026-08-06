import type { Material } from '../types';
import type { Rect } from './geometry';

/**
 * The leftover between what is placed and what is next to it.
 *
 * This is the number a formwork run is actually decided by. You butt standard
 * panels along a wall until they no longer fit, and what remains has to be
 * closed with a filler or a smaller panel — and if nothing in the catalog
 * matches, with site-cut timber, which is the expensive answer. Until now the
 * app drew the gap and never measured it, so the person planning the job did
 * that arithmetic on paper.
 *
 * Deliberately not tied to dragging: the gap is as worth knowing after you let
 * go as during, so this is a pure function of the placed pieces and whatever is
 * selected.
 */

/**
 * A placed piece as the gap check sees it: its footprint on the surface, plus
 * the height of the real component.
 *
 * The height is not in the rect. A plan view projects a panel to width ×
 * depth — 90 × 9 for a 90×300 panel — so the 300 that decides whether a filler
 * actually closes the hole is nowhere in the geometry, and has to be carried
 * alongside it.
 */
export interface GapRect extends Rect {
  /** the component's real height in cm */
  heightCm?: number;
}

export interface Gap {
  /** clear distance in cm */
  size: number;
  /** midpoint of the gap in surface coordinates, for the label */
  u: number;
  v: number;
  /** which way the gap is measured — 'u' is across the surface, 'v' is down */
  axis: 'u' | 'v';
  /** height of the piece on the far side, so a fill can be matched to the run */
  againstHeight?: number;
  /** a catalog component that closes it, if there is one */
  fill?: string;
}

/** Do two 1-D spans share any length at all? */
function overlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  return Math.min(a1, b1) - Math.max(a0, b0) > 0.01;
}

/**
 * The smallest clear gap between `moving` and any of `targets`.
 *
 * Only neighbours that actually face the moving box count: a panel on the far
 * side of the drawing shares no edge with it, and reporting the distance to it
 * would be a measurement of nothing. So a horizontal gap requires the two boxes
 * to overlap vertically, and vice versa — the same test that decides whether
 * two panels are in the same run.
 */
export function nearestGap(moving: Rect, targets: GapRect[], maxCm = 400): Gap | null {
  let best: Gap | null = null;

  const consider = (
    size: number,
    u: number,
    v: number,
    axis: 'u' | 'v',
    againstHeight?: number,
  ) => {
    // Touching is not a gap, and neither is a whole room away.
    if (size <= 0.05 || size > maxCm) return;
    if (!best || size < best.size) best = { size, u, v, axis, againstHeight };
  };

  const mx1 = moving.x + moving.w;
  const my1 = moving.y + moving.h;

  for (const t of targets) {
    const tx1 = t.x + t.w;
    const ty1 = t.y + t.h;

    if (overlaps(moving.y, my1, t.y, ty1)) {
      const midV = (Math.max(moving.y, t.y) + Math.min(my1, ty1)) / 2;
      if (t.x >= mx1) consider(t.x - mx1, (mx1 + t.x) / 2, midV, 'u', t.heightCm);
      else if (tx1 <= moving.x) {
        consider(moving.x - tx1, (tx1 + moving.x) / 2, midV, 'u', t.heightCm);
      }
    }

    if (overlaps(moving.x, mx1, t.x, tx1)) {
      const midU = (Math.max(moving.x, t.x) + Math.min(mx1, tx1)) / 2;
      if (t.y >= my1) consider(t.y - my1, midU, (my1 + t.y) / 2, 'v', t.heightCm);
      else if (ty1 <= moving.y) {
        consider(moving.y - ty1, midU, (ty1 + moving.y) / 2, 'v', t.heightCm);
      }
    }
  }

  return best;
}

/** Half a centimetre — tighter than anything anyone cuts on site. */
const FIT_TOLERANCE = 0.5;

/**
 * A component that closes this gap.
 *
 * Width is what has to match exactly, but height decides whether the answer is
 * usable at all: this catalog has a 45×150 and a 45×300, and offering the 150
 * to close a hole in a 300-tall wall would send someone to the yard for the
 * wrong panel. So a component the same height as the run it joins wins over a
 * merely narrower one, and only when nothing matches does the narrowest win —
 * which is what puts the 5 cm filler ahead of anything else 5 cm wide.
 */
export function componentThatFits(
  gapCm: number,
  materials: Material[],
  againstHeight?: number,
): string | undefined {
  let best: Material | undefined;
  const sameHeight = (m: Material) =>
    againstHeight !== undefined && Math.abs(m.h - againstHeight) <= FIT_TOLERANCE;

  for (const m of materials) {
    if (m.category !== 'panel' && m.category !== 'filler') continue;
    if (Math.abs(m.w - gapCm) > FIT_TOLERANCE) continue;
    if (!best) {
      best = m;
      continue;
    }
    if (sameHeight(m) && !sameHeight(best)) best = m;
    else if (sameHeight(m) === sameHeight(best) && m.w < best.w) best = m;
  }
  return best?.name;
}
