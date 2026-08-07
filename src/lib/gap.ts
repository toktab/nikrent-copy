import type { Category, Material } from '../types';
import type { Rect } from './geometry';

/**
 * What forms the concrete face.
 *
 * Only these can leave a hole the concrete would pour through, so only these
 * can be a side of a gap. Walers, tie rods, posts and accessories are backing
 * and hardware — they cross the face rather than make it, and measuring the
 * clear air between a panel and the waler behind it was producing readings
 * like "9.7 cm, use a 10 cm filler" for a distance that is not a hole at all.
 */
export const FACE_CATEGORIES: ReadonlySet<Category> = new Set<Category>([
  'panel',
  'filler',
  'corner',
]);

/** True when a component makes up the face, rather than holding it together. */
export function isFace(m: Material | undefined): boolean {
  return !!m && FACE_CATEGORIES.has(m.category);
}

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
  /**
   * Extent along the axis the view looks down, so pieces that merely overlap
   * on screen are not mistaken for neighbours. In plan a panel on the ground
   * and one on the next lift share a footprint exactly, and without this the
   * clear air between two courses reads as a gap to be filled.
   */
  span?: [number, number];
  /**
   * The direction the formwork face runs, when only one direction is a run.
   *
   * In plan a panel is a long thin footprint — 90 × 9 — and the two things
   * either side of it mean completely different things. Along its length is
   * the next panel in the run, and the space between them is a hole. Across
   * its thickness is the opposite face of the same wall, and the space between
   * them is the concrete. Measuring the second and offering a filler for it is
   * how you get "26.7 სმ, cut to size" for a 27 cm wall.
   */
  faceAxis?: 'u' | 'v';
  /**
   * This piece turns the face rather than running along it — a corner profile.
   *
   * It is a neighbour but never a vantage point. `faceAxis` keeps the check
   * from measuring across a wall instead of along it, and it works out which
   * way a face runs from the footprint: 90 × 9 runs across, 9 × 90 runs down.
   * A corner profile is SQUARE in plan — 24 × 24, 20 × 20 — so that reasoning
   * has nothing to bite on, and whichever way it guesses is half wrong, because
   * a corner genuinely faces both ways. Looking out from one, one direction
   * runs along a face and the other goes through the pour to the far side: a
   * filled 20 cm wall reported a 20 cm hole at every corner.
   *
   * So a corner is measured TO and never FROM. Nothing is lost by that. A run
   * that stops short of its corner is still found from the last panel in it,
   * with the corner as the thing it fails to reach.
   */
  turnsFace?: boolean;
}

export interface Gap {
  /** clear distance in cm */
  size: number;
  /** which way the gap is measured — 'u' is across the surface, 'v' is down */
  axis: 'u' | 'v';
  /**
   * The opening itself, in surface coordinates.
   *
   * Not a midpoint and not a centreline: the actual rectangle of air between
   * the two pieces, clipped to the length of edge they genuinely share. Two
   * panels offset from each other only face along part of their edges, and the
   * hole is that part — which is also, usefully, the shape of the thing that
   * has to close it.
   */
  x: number;
  y: number;
  w: number;
  h: number;
  /** height of the piece on the far side, so a fill can be matched to the run */
  againstHeight?: number;
  /** a catalog component that closes it, if there is one */
  fill?: string;
}

/**
 * Which way a face piece runs, and whether it can be measured from at all.
 *
 * This is read off the component's own thickness, never guessed from the shape
 * of the footprint. The footprint tells you the two dimensions but not which of
 * them is the thickness, and "the long one is the run" is wrong for every face
 * component narrower than the system is thick: a 5 cm ჩაკერება lying in a
 * horizontal run is 5 wide and 9 deep, so the guess turns it on its side and
 * measures up and down — through the pour — reporting the wall thickness as a
 * hole. A corner is the same failure at its limit, square in plan and pointing
 * both ways at once.
 *
 * `depth` is exactly the answer: whichever side of the footprint measures the
 * component's thickness is the side the concrete is on, and the other one is
 * the run.
 */
export function faceRun(
  rect: { w: number; h: number },
  m: Material,
  elevation: boolean,
): Pick<GapRect, 'faceAxis' | 'turnsFace'> {
  // An elevation shows the silhouette instead: beside is the next panel and
  // above is the next course. Both are real, so neither is excluded.
  if (elevation) return {};
  // A corner turns the face however it is drawn, so it never originates.
  if (m.category === 'corner') return { turnsFace: true };

  const isThickness = (v: number) => Math.abs(v - m.depth) <= 0.5;
  const flat = isThickness(rect.h);
  const upright = isThickness(rect.w);
  if (flat && !upright) return { faceAxis: 'u' };
  if (upright && !flat) return { faceAxis: 'v' };
  // As deep as it is wide: no direction along the face that is not also
  // through the pour, so it is a neighbour and not a vantage point.
  return { turnsFace: true };
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
export function gapsAround(moving: GapRect, targets: GapRect[], maxCm = 400): Gap[] {
  /**
   * The nearest thing on each of the four sides, kept apart.
   *
   * Taking the smallest gap across all neighbours at once looked right and was
   * not. With panels butted at 0, 90, 180 and 270, the one at 0 has a
   * neighbour touching it — no gap — and another 90 cm beyond that. Throw the
   * zero away as "not a gap" and the 90 wins, and the drawing cheerfully
   * reports a 90 cm hole measured straight through the panel in between.
   *
   * A neighbour that touches does not fail to produce a gap. It proves there
   * is none on that side. So the nearest thing on each side wins outright, and
   * only the winner is asked whether it is far enough away to be a hole.
   */
  const sides = new Map<string, { gap: Gap; toCorner: boolean }>();

  const consider = (side: string, size: number, g: Omit<Gap, 'size'>, toCorner: boolean) => {
    // Overlapping counts as touching: either way nothing slides in.
    const clear = Math.max(size, 0);
    const held = sides.get(side);
    if (!held || clear < held.gap.size) sides.set(side, { gap: { ...g, size: clear }, toCorner });
  };

  const mx1 = moving.x + moving.w;
  const my1 = moving.y + moving.h;

  for (const t of targets) {
    /**
     * A hole is between two pieces in the SAME face.
     *
     * Where two walls meet, the run ends and a run at right angles takes over.
     * Those two cross each other's path — a plan view has them overlapping —
     * but they are never in the same plane, and what lies between them is the
     * other wall's pour. Measured without this, the panel at the end of one run
     * looks along itself, past the corner, and reports the thickness of the
     * wall it just met as an opening. A corner profile is exempt because it
     * belongs to both faces at once, which is what lets a run that stops short
     * of its corner still be caught. A corner doing the measuring is exempt
     * too — it has no one plane — but only its findings AGAINST another corner
     * survive, which is what keeps it from reporting the pour it looks across.
     * See the filter at the end.
     */
    if (
      !moving.turnsFace &&
      !t.turnsFace &&
      t.faceAxis !== undefined &&
      t.faceAxis !== moving.faceAxis
    ) {
      continue;
    }

    const tx1 = t.x + t.w;
    const ty1 = t.y + t.h;

    // Same course, or no joint. Two panels a lift apart look adjacent in plan
    // and are not touching anything.
    if (moving.span && t.span && !overlaps(moving.span[0], moving.span[1], t.span[0], t.span[1])) {
      continue;
    }

    if (moving.faceAxis !== 'v' && overlaps(moving.y, my1, t.y, ty1)) {
      // The hole is only as long as the edge the two actually share.
      const v0 = Math.max(moving.y, t.y);
      const v1 = Math.min(my1, ty1);
      const shared = { y: v0, h: v1 - v0, axis: 'u' as const, againstHeight: t.heightCm };
      if (tx1 > moving.x) {
        consider('right', t.x - mx1, { ...shared, x: mx1, w: Math.max(t.x - mx1, 0) }, !!t.turnsFace);
      }
      if (t.x < mx1) {
        consider('left', moving.x - tx1, { ...shared, x: tx1, w: Math.max(moving.x - tx1, 0) }, !!t.turnsFace);
      }
    }

    if (moving.faceAxis !== 'u' && overlaps(moving.x, mx1, t.x, tx1)) {
      const u0 = Math.max(moving.x, t.x);
      const u1 = Math.min(mx1, tx1);
      const shared = { x: u0, w: u1 - u0, axis: 'v' as const, againstHeight: t.heightCm };
      if (ty1 > moving.y) {
        consider('down', t.y - my1, { ...shared, y: my1, h: Math.max(t.y - my1, 0) }, !!t.turnsFace);
      }
      if (t.y < my1) {
        consider('up', moving.y - ty1, { ...shared, y: ty1, h: Math.max(moving.y - ty1, 0) }, !!t.turnsFace);
      }
    }
  }

  return [...sides.values()]
    /**
     * A corner reports only what it finds against another corner.
     *
     * It has to be allowed to look, because two corners with the run between
     * them missing is a real hole and no one else can see it — the panels that
     * would have reported it are the ones that are not there. But a corner also
     * looks straight across the pour at the far face of its own wall, and that
     * is not a hole. Everything competes for the nearest-on-each-side place, so
     * a panel across the pour still wins its side and vetoes it; the side is
     * then dropped here rather than reported.
     */
    .filter((s) => !moving.turnsFace || s.toCorner)
    .map((s) => s.gap)
    .filter((g) => g.size > 0.05 && g.size <= maxCm);
}

/** The single closest opening beside `moving`, or none. */
export function nearestGap(moving: GapRect, targets: GapRect[], maxCm = 400): Gap | null {
  let best: Gap | null = null;
  for (const g of gapsAround(moving, targets, maxCm)) {
    if (!best || g.size < best.size) best = g;
  }
  return best;
}

/**
 * Every open hole in the drawing, each counted once.
 *
 * The same opening is found twice — once from the panel on its left and once
 * from the panel on its right — so they are keyed by the void itself. Rounded
 * to a tenth of a centimetre, because the two passes compute the same
 * rectangle by different subtractions and floating point does not promise they
 * come out bit-identical.
 */
export function allGaps(rects: GapRect[], maxCm = 400): Gap[] {
  const seen = new Set<string>();
  const out: Gap[] = [];
  for (let i = 0; i < rects.length; i++) {
    const others = rects.filter((_, j) => j !== i);
    for (const g of gapsAround(rects[i], others, maxCm)) {
      const key = voidKey(g);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(g);
    }
  }
  return out;
}

/**
 * Identity of an opening, for telling two findings of the same hole apart from
 * two different holes.
 *
 * Rounded to a tenth of a centimetre because the same rectangle is arrived at
 * by different subtractions depending on which side it was found from, and
 * floating point does not promise those come out bit-identical.
 */
export function voidKey(g: Gap): string {
  return [g.x, g.y, g.w, g.h].map((n) => Math.round(n * 10)).join(':');
}

/**
 * Formwork panels are rigid steel-framed ply. A component only closes a gap if
 * it is not wider than the gap — that is physics, not a preference — so the
 * allowance upward is half a millimetre, which is float noise off a drag and
 * nothing else. A 9.9 cm hole does not take a 10 cm filler, and the cost of
 * pretending it does is a trip to the yard for a part that comes straight back.
 *
 * Downward there is room to be generous: half a centimetre short still counts
 * as a fit, because that much disappears into the joint.
 */
const OVERSIZE_ALLOWANCE = 0.05;
const UNDERSIZE_ALLOWANCE = 0.5;

/**
 * A component that closes this gap.
 *
 * Width has to fit and height has to match. Both have bitten:
 *
 * A 10 cm filler was being offered for a 9.7 cm gap, because the first version
 * treated the tolerance as symmetric. It is not — a component wider than the
 * hole does not go in, and telling someone it does sends them to the yard for
 * a part that will come straight back.
 *
 * Height matters because this catalog has both a 45×150 and a 45×300. Closing
 * a hole in a 300-tall wall with the 150 is the same wasted trip, so a
 * component matching the run it joins beats a merely narrower one. Only when
 * nothing matches does the narrowest win, which is what puts the 5 cm filler
 * ahead of anything else 5 cm wide.
 */
export function componentThatFits(
  gapCm: number,
  materials: Material[],
  againstHeight?: number,
): string | undefined {
  let best: Material | undefined;
  const sameHeight = (m: Material) =>
    againstHeight !== undefined && Math.abs(m.h - againstHeight) <= UNDERSIZE_ALLOWANCE;

  for (const m of materials) {
    // A corner is part of the face but cannot close a straight run — it is an
    // L, and it belongs where two faces meet.
    if (m.category !== 'panel' && m.category !== 'filler') continue;
    if (m.w > gapCm + OVERSIZE_ALLOWANCE) continue;
    if (gapCm - m.w > UNDERSIZE_ALLOWANCE) continue;
    if (!best) {
      best = m;
      continue;
    }
    if (sameHeight(m) && !sameHeight(best)) best = m;
    else if (sameHeight(m) === sameHeight(best) && m.w < best.w) best = m;
  }
  return best?.name;
}
