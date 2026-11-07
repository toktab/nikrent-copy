import type { Material, Piece, SketchPath } from '../types';
import type { Rect } from './geometry';
import { soloPanels } from './walers';
import { cornerConnectorSpots } from './cornerConnectors';
import { findCornerRods } from './bolts';

/**
 * The worked-out ვოლერები and კუთხის კონექტორები as shapes in world cm - for
 * the printed sheet, which draws in world cm where the screen's layers draw in
 * pixels (WalerLayer, CornerConnectorLayer). Same places, same look.
 */

/** How far behind the panel's back the waler stands, and how thick it is drawn, cm. */
export const WALER_GAP_CM = 2;
export const WALER_DRAWN_CM = 8;

export interface WalerBar {
  rect: Rect;
  /** its two rods, a quarter in from each end */
  rods: Array<{ x: number; y: number }>;
}

/** One beam per place on the plan - a stacked course has its walers in the same place. */
export function walerBars(pieces: Piece[], byId: Map<string, Material>, sketch: SketchPath[] = []): WalerBar[] {
  const seen = new Set<string>();
  const out: WalerBar[] = [];
  for (const s of soloPanels(pieces, byId, sketch)) {
    const b = s.box;
    const k = `${Math.round(b.x)}:${Math.round(b.y)}:${Math.round(b.w)}`;
    if (seen.has(k)) continue;
    seen.add(k);
    const along0 = (s.across ? b.x : b.y) + 2;
    const along1 = (s.across ? b.x + b.w : b.y + b.h) - 2;
    const backEdge = s.back > 0 ? (s.across ? b.y + b.h : b.x + b.w) : s.across ? b.y : b.x;
    const near = backEdge + s.back * WALER_GAP_CM;
    const far = near + s.back * WALER_DRAWN_CM;
    const c0 = Math.min(near, far);
    const c1 = Math.max(near, far);
    const rect = s.across
      ? { x: along0, y: c0, w: along1 - along0, h: c1 - c0 }
      : { x: c0, y: along0, w: c1 - c0, h: along1 - along0 };
    const rods = [0.25, 0.75].map((t) => {
      const a = along0 + (along1 - along0) * t;
      const mid = (c0 + c1) / 2;
      return s.across ? { x: a, y: mid } : { x: mid, y: a };
    });
    out.push({ rect, rods });
  }
  return out;
}

export interface CornerConnectorBar {
  x1: number;
  y1: number;
  x2: number;
  y2: number;
  /** the nut on its outer end, facing out of the corner */
  nut: { x: number; y: number; rot: number };
  kind: 'cornerConnectors' | 'halfHead' | 'innerConnectors' | 'fullHead';
}

export function cornerConnectorBars(pieces: Piece[], byId: Map<string, Material>): CornerConnectorBar[] {
  // The whole-head შტირი 40 სმ at inside corner leg ends, drawn the same way.
  const full = findCornerRods(pieces, byId).map((r): CornerConnectorBar => {
    const line = r.dir === 'v' ? { x1: r.at, y1: r.from, x2: r.at, y2: r.to } : { x1: r.from, y1: r.at, x2: r.to, y2: r.at };
    return { ...line, nut: { x: line.x1, y: line.y1, rot: 0 }, kind: 'fullHead' };
  });
  return full.concat(cornerConnectorSpots(pieces, byId).map((s) => {
    const out = s.dir === 'h' ? (s.outer.x <= s.from ? -1 : 1) : s.outer.y <= s.from ? -1 : 1;
    const line =
      s.dir === 'h' ? { x1: s.from, y1: s.at, x2: s.to, y2: s.at } : { x1: s.at, y1: s.from, x2: s.at, y2: s.to };
    return {
      ...line,
      nut: { x: s.outer.x, y: s.outer.y, rot: s.dir === 'h' ? (out < 0 ? 180 : 0) : out < 0 ? 270 : 90 },
      kind: s.inner ? 'innerConnectors' : s.filler === 5 ? 'cornerConnectors' : 'halfHead',
    };
  }));
}
