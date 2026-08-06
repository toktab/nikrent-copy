import type { Material, Piece } from '../types';
import { pieceBounds, type Rect } from './geometry';

/**
 * The three orthographic views of the drawing surface.
 *
 * The editor has always worked in plan, which cannot show elevation at all —
 * two pieces on different courses occupy the same footprint there. The two
 * elevations trade the plan's second axis for height, so a stack can be seen
 * and, more to the point, dragged.
 *
 * Both elevations look along the *positive* axis: the front view looks along
 * +Y and the side view along +X. Keeping that rule the same for both is what
 * makes "smaller coordinate is nearer the viewer" true in both, which is the
 * whole of the occlusion order below.
 *
 * Surface coordinates keep the screen convention — x grows right, y grows
 * DOWN — so height, which grows up, comes out negative. Ground level is y = 0
 * in every view, which is why the elevations can share the plan's grid origin
 * and its pan/zoom without any special casing.
 */
export type ViewAxis = 'plan' | 'front' | 'side';

export const VIEW_ORDER: ViewAxis[] = ['plan', 'front', 'side'];

export const VIEW_LABEL: Record<ViewAxis, string> = {
  plan: 'გეგმა',
  front: 'ფასადი',
  side: 'გვერდი',
};

export const VIEW_HINT: Record<ViewAxis, string> = {
  plan: 'ხედი ზემოდან — თრევა გადააადგილებს გეგმაზე',
  front: 'ხედი წინიდან — თრევა გადააადგილებს გვერდით და სიმაღლეზე',
  side: 'ხედი გვერდიდან — თრევა გადააადგილებს სიღრმეში და სიმაღლეზე',
};

/** What each surface axis means, for the rulers and the inspector. */
export const VIEW_AXES: Record<ViewAxis, { across: string; down: string }> = {
  plan: { across: 'X', down: 'Y' },
  front: { across: 'X', down: 'სიმაღლე' },
  side: { across: 'Y', down: 'სიმაღლე' },
};

/** True for the two views where dragging changes elevation. */
export function isElevation(view: ViewAxis): boolean {
  return view !== 'plan';
}

/**
 * The rectangle a piece occupies on the surface, in cm.
 *
 * In plan this is the rotated footprint's bounding box. In an elevation it is
 * the silhouette: a solid extruded from that footprint casts a plain rectangle
 * whatever its outline, so an L-corner is correctly a box from the front.
 */
export function projectPiece(piece: Piece, m: Material, view: ViewAxis): Rect {
  const b = pieceBounds(piece, m);
  if (view === 'plan') return b;

  // The piece stands from its elevation up to elevation + height, and surface
  // y grows downward, so the top edge is the more negative number.
  const top = -((piece.z ?? 0) + m.h);
  return view === 'front'
    ? { x: b.x, y: top, w: b.w, h: m.h }
    : { x: b.y, y: top, w: b.h, h: m.h };
}

/**
 * How far a piece reaches along the axis the view is looking down.
 *
 * The projected rectangle deliberately throws this away — that is what makes a
 * view a view. But two pieces that merely look adjacent on screen may be a
 * whole lift apart: in plan, a panel on the ground and one three metres up
 * occupy the same footprint. Anything reasoning about real neighbours needs
 * this back.
 */
export function hiddenSpan(piece: Piece, m: Material, view: ViewAxis): [number, number] {
  if (view === 'plan') {
    const z = piece.z ?? 0;
    return [z, z + m.h];
  }
  const b = pieceBounds(piece, m);
  return view === 'front' ? [b.y, b.y + b.h] : [b.x, b.x + b.w];
}

/**
 * A movement across the surface, expressed as a movement through the world.
 *
 * This is what makes one drag handler serve all three views: the surface never
 * learns which axes it is showing, it just reports how far the pointer went.
 */
export function unprojectDelta(
  du: number,
  dv: number,
  view: ViewAxis,
): { dx: number; dy: number; dz: number } {
  if (view === 'plan') return { dx: du, dy: dv, dz: 0 };
  // Dragging down the screen must lower the piece, hence the sign.
  if (view === 'front') return { dx: du, dy: 0, dz: -dv };
  return { dx: 0, dy: du, dz: -dv };
}

/**
 * Painter's order for an elevation — larger draws in front.
 *
 * Plan has no depth to speak of (the surface *is* the footprint), so
 * everything there ties and document order stands.
 */
export function viewDepth(piece: Piece, m: Material, view: ViewAxis): number {
  if (view === 'plan') return 0;
  const b = pieceBounds(piece, m);
  return view === 'front' ? -b.y : -b.x;
}

/**
 * Stacking rank per piece id: 0 for the furthest, counting up toward the
 * viewer. Returned as small integers so they can go straight into z-index
 * rather than reordering the DOM on every drag.
 */
export function depthRanks(
  pieces: Piece[],
  byId: Map<string, Material>,
  view: ViewAxis,
): Map<string, number> {
  const ranks = new Map<string, number>();
  if (view === 'plan') return ranks;

  const scored = pieces
    .map((p) => {
      const m = byId.get(p.materialId);
      return m ? { id: p.id, depth: viewDepth(p, m, view) } : null;
    })
    .filter((s): s is { id: string; depth: number } => s !== null)
    .sort((a, b) => a.depth - b.depth);

  scored.forEach((s, i) => ranks.set(s.id, i));
  return ranks;
}

/** Bounding box of everything placed, as seen in this view. */
export function projectedContentBounds(
  pieces: Piece[],
  byId: Map<string, Material>,
  view: ViewAxis,
): Rect | null {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let found = false;

  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    found = true;
    const r = projectPiece(p, m, view);
    minX = Math.min(minX, r.x);
    minY = Math.min(minY, r.y);
    maxX = Math.max(maxX, r.x + r.w);
    maxY = Math.max(maxY, r.y + r.h);
  }

  if (!found) return null;
  return { x: minX, y: minY, w: maxX - minX, h: maxY - minY };
}
