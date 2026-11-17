import type { Material, Piece, SketchPath } from '../types';
import { pieceBounds } from './geometry';
import { isFace } from './gap';
import { projectPiece } from './projection';

/**
 * Pieces whose outline sits between whole centimetres, put back on them.
 *
 * A piece is turned about its middle, so its outline moves when its thickness
 * does: a panel turned on its side and placed while panels were 9 cm thick
 * stands half a centimetre off every grid line once they are drawn 10 cm
 * (პარამეტრები, 2026-10-30) - the user saw it as panels that no longer fit the
 * squares (2026-11-04).
 *
 * Each such piece moves by the half centimetre that puts an edge back on a
 * drawn line where one is beside it - its face stays on the line it was set
 * out to - and otherwise the way that rounds its outline onto whole
 * centimetres. A piece placed by eye up to 1.5 cm off the move step's squares
 * (5 cm) goes onto them the same way. Never further: anything set off the
 * squares by more than that was put there on purpose.
 */
export function alignPieces(
  pieces: Piece[],
  byId: Map<string, Material>,
  sketch: SketchPath[],
  step = 5,
): Piece[] {
  // Every axis-parallel leg of the drawing: x of the upright ones, y of the level ones.
  const uprights: Array<{ at: number; lo: number; hi: number }> = [];
  const levels: Array<{ at: number; lo: number; hi: number }> = [];
  for (const path of sketch) {
    const pts = path.points;
    const n = path.closed && pts.length > 2 ? pts.length : pts.length - 1;
    for (let i = 0; i < n; i++) {
      const a = pts[i];
      const b = pts[(i + 1) % pts.length];
      if (Math.abs(a.x - b.x) < 0.01) uprights.push({ at: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
      else if (Math.abs(a.y - b.y) < 0.01) levels.push({ at: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) });
    }
  }

  const off = (v: number, s: number) => Math.abs(v - Math.round(v / s) * s) > 0.01;
  /** The shift, along one axis, that puts the outline [lo, hi] on the squares, or on whole cm. */
  const shift = (lo: number, hi: number, lines: Array<{ at: number; lo: number; hi: number }>, s0: number, s1: number) => {
    if (!off(lo, step) || !off(hi, step)) {
      // One edge on the squares already - the other is the piece's own size.
      if (!off(lo, 1) && !off(hi, 1)) return 0;
    }
    const beside = lines.filter((l) => Math.min(l.hi, s1) - Math.max(l.lo, s0) > 0.5);
    const onLine = (d: number) => beside.some((l) => Math.abs(l.at - (lo + d)) < 0.01 || Math.abs(l.at - (hi + d)) < 0.01);
    const toStep = [Math.round(lo / step) * step - lo, Math.round(hi / step) * step - hi].filter((d) => Math.abs(d) <= 1.5);
    const toCm = [Math.floor(lo) - lo, Math.ceil(lo) - lo];
    for (const d of [...toStep, ...toCm]) if (onLine(d)) return d;
    if (toStep.length) return toStep.reduce((a, b) => (Math.abs(b) < Math.abs(a) ? b : a));
    return off(lo, 1) ? Math.round(lo) - lo : 0;
  };

  return pieces.map((p) => {
    const m = byId.get(p.materialId);
    if (!m || (m.category !== 'panel' && m.category !== 'filler' && m.category !== 'corner')) return p;
    const r = ((p.rot % 90) + 90) % 90;
    if (r > 0.5 && r < 89.5) return p;
    const b = pieceBounds(p, m);
    const dx = shift(b.x, b.x + b.w, uprights, b.y, b.y + b.h);
    const dy = shift(b.y, b.y + b.h, levels, b.x, b.x + b.w);
    if (!dx && !dy) return p;
    return { ...p, x: Math.round((p.x + dx) * 100) / 100, y: Math.round((p.y + dy) * 100) / 100 };
  });
}

/**
 * The corner a moved selection is put on the squares by: the top-left of its
 * formwork - panels, ჩაკერება, corner profiles - and only of everything else
 * when there is none of that.
 *
 * A selection can carry a hidden or small piece standing off the grid - a
 * ჭანჭიკი on the back of a panel, a clamp, a disc - and when it was the one
 * furthest left, the squares were fitted to it and the panel moved off them by
 * the difference (the user, 2026-11-17: an arrow press left a panel half a
 * square off).
 */
export function gridAnchor(
  pieces: Piece[],
  byId: Map<string, Material>,
  view: Parameters<typeof projectPiece>[2],
): { u0: number; v0: number } {
  const corner = (list: Piece[]) => {
    let u0 = Infinity;
    let v0 = Infinity;
    for (const p of list) {
      const m = byId.get(p.materialId);
      if (!m) continue;
      const b = projectPiece(p, m, view);
      u0 = Math.min(u0, b.x);
      v0 = Math.min(v0, b.y);
    }
    return { u0, v0 };
  };
  const faces = pieces.filter((p) => isFace(byId.get(p.materialId)));
  // Rounded to a thousandth: a turned piece's box carries float noise that
  // could tip it into the square before.
  const r = corner(faces.length ? faces : pieces);
  const tidy = (v: number) => (Number.isFinite(v) ? Math.round(v * 1000) / 1000 : v);
  return { u0: tidy(r.u0), v0: tidy(r.v0) };
}
