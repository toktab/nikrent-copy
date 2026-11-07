import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds, planH, planW } from './geometry';
import { soloPanels } from './walers';

/**
 * დგარები - the props that brace a wall's formwork from outside.
 *
 * They are never placed by the fill (CLAUDE.md: props are decided on site) but
 * the architect puts them on by hand, against the outer face of the panels. In
 * plan a prop is a strut running away from the face: a head plate on the
 * panel, the tube, and a foot plate on the ground.
 *
 * How far it reaches across the plan is its horizontal run, not its length: a
 * prop leans at about 60° to the ground, so its foot lands about half its
 * length out from the face. That is an estimate, not a site measurement.
 */
export function isPost(m: Material): boolean {
  return m.category === 'post';
}

/*
 * დგარი და თავი - the push-pull prop with its head (the user, 2026-11-07):
 * a ჭანჭიკი kind of its own. Two sizes - the small one for a 150 or 90
 * panel, the big one for a 300 - placed by ავტომატურად თავიდან დასმა or by
 * hand, and always stuck to a panel face (`snapPost`).
 *
 * Where the reset puts them: one on the back of every panel with nothing
 * facing it across the wall - the panel a შტირი cannot hold, the same one a
 * ვოლერი goes on - on the bottom course, in the middle of the panel. My
 * reading of "automatic"; the user named the sizes, not the places.
 */

/** The catalog prop for a panel this tall: the big one up a 300, the small one up a 150 / 90. */
export function propMaterial(materials: Material[], panelH: number): Material | undefined {
  const big = panelH >= 250;
  const id = big ? 'post-200' : 'post-100';
  const posts = materials.filter(isPost);
  return (
    materials.find((m) => m.id === id) ??
    [...posts].sort((a, b) => (big ? Math.max(b.w, b.h) - Math.max(a.w, a.h) : Math.max(a.w, a.h) - Math.max(b.w, b.h)))[0]
  );
}

/** One prop on the back of each panel nothing faces, bottom course, mid-panel - see above. */
export function propPieces(
  pieces: Piece[],
  byId: Map<string, Material>,
  materials: Material[],
  sketch: SketchPath[],
  newId: () => string,
): Piece[] {
  const have = pieces.flatMap((p) => {
    const m = byId.get(p.materialId);
    if (!m || !isPost(m)) return [];
    const b = pieceBounds(p, m);
    return [{ x: b.x + b.w / 2, y: b.y + b.h / 2, b }];
  });
  const out: Piece[] = [];
  for (const s of soloPanels(pieces, byId, sketch)) {
    if (Math.round(s.piece.z ?? 0) !== 0) continue;
    const m = propMaterial(materials, s.material.h);
    if (!m) continue;
    const r = s.box;
    // A prop already standing against this panel's back is its prop.
    const touching = have.some(({ b }) =>
      s.across
        ? b.x < r.x + r.w && b.x + b.w > r.x && (s.back > 0 ? Math.abs(b.y - (r.y + r.h)) <= 2 : Math.abs(b.y + b.h - r.y) <= 2)
        : b.y < r.y + r.h && b.y + b.h > r.y && (s.back > 0 ? Math.abs(b.x - (r.x + r.w)) <= 2 : Math.abs(b.x + b.w - r.x) <= 2),
    );
    if (touching) continue;
    const pw = planW(m);
    const ph = planH(m);
    const line = s.across ? (s.back > 0 ? r.y + r.h : r.y) : s.back > 0 ? r.x + r.w : r.x;
    const along = s.across ? r.x + r.w / 2 : r.y + r.h / 2;
    const off = line + (s.back * ph) / 2;
    const cx = s.across ? along : off;
    const cy = s.across ? off : along;
    const rot = s.across ? (s.back > 0 ? 0 : 180) : s.back > 0 ? 270 : 90;
    out.push({ id: newId(), materialId: m.id, x: cx - pw / 2, y: cy - ph / 2, rot, z: 0 });
  }
  return out;
}

/** How far out from the face a prop's foot lands, cm - see above. */
export function postReach(m: Material): number {
  // The same sum as `planH` makes for a post - kept there so geometry needs
  // nothing from here.
  return Math.max(m.depth, Math.round(Math.max(m.w, m.h) / 2));
}

/** Where a prop let go near a face goes: on it, square to it, on the side it was let go. */
export interface PostSpot {
  /** top-left of the un-turned box, world cm, as `Piece.x` / `Piece.y` */
  x: number;
  y: number;
  /** 0: the prop runs +y from its head; 180: -y; 270: +x; 90: -x */
  rot: number;
}

/**
 * The face of a placed panel or ჩაკერება nearest `at`, within `reach`, and the
 * prop stood square on it, head on the face, running out on `at`'s side. Along
 * the face it goes where it was let go, on the move step.
 */
export function snapPost(
  at: { x: number; y: number },
  post: Material,
  pieces: Piece[],
  byId: Map<string, Material>,
  reach: number,
  step: number,
): PostSpot | null {
  const pw = planW(post);
  const ph = planH(post);
  let best: { d: number; spot: PostSpot } | null = null;
  const snap = (v: number) => (step > 0 ? Math.round(v / step) * step : v);

  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m || (m.category !== 'panel' && m.category !== 'filler')) continue;
    if (p.rot % 90 !== 0) continue;
    const b = pieceBounds(p, m);
    const across = b.w >= b.h; // its long faces run along x
    // The two long faces: the ones a prop can stand on.
    const faces = across
      ? [
          { line: b.y, side: -1 as const },
          { line: b.y + b.h, side: 1 as const },
        ]
      : [
          { line: b.x, side: -1 as const },
          { line: b.x + b.w, side: 1 as const },
        ];
    const lo = across ? b.x : b.y;
    const hi = across ? b.x + b.w : b.y + b.h;
    const along = across ? at.x : at.y;
    if (along < lo - 1 || along > hi + 1) continue;
    for (const f of faces) {
      const off = (across ? at.y : at.x) - f.line;
      // Only on the outside of this face, and close to it.
      if (Math.sign(off) !== f.side || Math.abs(off) > reach) continue;
      const d = Math.abs(off);
      if (best && d >= best.d) continue;
      const pos = Math.min(hi - pw / 2, Math.max(lo + pw / 2, snap(along)));
      const cx = across ? pos : f.line + (f.side * ph) / 2;
      const cy = across ? f.line + (f.side * ph) / 2 : pos;
      const rot = across ? (f.side > 0 ? 0 : 180) : f.side > 0 ? 270 : 90;
      best = { d, spot: { x: cx - pw / 2, y: cy - ph / 2, rot } };
    }
  }
  return best?.spot ?? null;
}
