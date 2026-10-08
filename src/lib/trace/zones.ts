import type { Pt, Seg } from './segments';

/**
 * Where the page is probably showing a wall.
 *
 * Marking every line the PDF contains is honest and nearly useless: a sheet
 * has thousands, most of them dimension lines, grid bubbles and leaders, and a
 * hairline over each one tells a person nothing they can act on.
 *
 * What a wall actually looks like in a drawing is not one line - it is a lot
 * of ink in a small area: two faces close together with hatching between them,
 * or a filled band. Columns are the same. So instead of claiming "this line is
 * a wall", this measures how much line length falls in each small square of
 * the page and shades the crowded parts. It is a hint about where to look,
 * deliberately rough, and it is never used for geometry - tracing a line is
 * still what makes a wall real.
 *
 * Everything here is in PDF page points, like the rest of the tracing code.
 */

export interface Zone {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface ZoneOptions {
  /** side of one measuring square, in points */
  cellPt?: number;
  /**
   * How much line length has to fall in a square before it counts as crowded,
   * as a multiple of the square's side. 1 means "a line crosses it once", so
   * anything above that is more ink than a single plain line.
   */
  densityFactor?: number;
  /**
   * Patches with fewer genuinely crowded squares than this are specks, not
   * walls. Counted before the mask is grown, or growing would promote every
   * speck into a patch.
   */
  minCells?: number;
  /** how far the mask is grown, in squares, to close a band up */
  grow?: number;
}

const DEFAULTS: Required<ZoneOptions> = {
  cellPt: 7,
  densityFactor: 1.9,
  minCells: 5,
  grow: 2,
};

export interface ZoneResult {
  /** the shaded areas, as rows of merged squares */
  rects: Zone[];
  /** how many separate patches were found */
  patches: number;
  cellPt: number;
}

/**
 * Shades the crowded parts of the page.
 *
 * The mask is grown by one square before patches are measured, so the two
 * faces of a wall and the hatching between them read as one band rather than
 * three thin ones, and a line of hatch ticks with gaps does not come out
 * dotted.
 */
export function wallZones(
  segments: Seg[],
  pageW: number,
  pageH: number,
  options: ZoneOptions = {},
): ZoneResult {
  const opt = { ...DEFAULTS, ...options };
  const cell = opt.cellPt;
  const cols = Math.max(1, Math.ceil(pageW / cell));
  const rows = Math.max(1, Math.ceil(pageH / cell));
  if (!segments.length) return { rects: [], patches: 0, cellPt: cell };

  // ── how much ink is in each square ────────────────────────────────────────
  const ink = new Float32Array(cols * rows);
  const step = cell / 2;
  for (const s of segments) {
    const dx = s.b.x - s.a.x;
    const dy = s.b.y - s.a.y;
    const len = Math.hypot(dx, dy);
    if (!len) continue;
    const steps = Math.max(1, Math.ceil(len / step));
    const piece = len / steps;
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      const cx = Math.floor((s.a.x + dx * t) / cell);
      const cy = Math.floor((s.a.y + dy * t) / cell);
      if (cx < 0 || cy < 0 || cx >= cols || cy >= rows) continue;
      ink[cy * cols + cx] += piece;
    }
  }

  // ── crowded, then grown by one square ─────────────────────────────────────
  const threshold = cell * opt.densityFactor;
  const hot = new Uint8Array(cols * rows);
  for (let i = 0; i < ink.length; i++) if (ink[i] >= threshold) hot[i] = 1;

  let grown = hot;
  for (let pass = 0; pass < opt.grow; pass++) {
    const next = new Uint8Array(cols * rows);
    for (let y = 0; y < rows; y++) {
      for (let x = 0; x < cols; x++) {
        if (!grown[y * cols + x]) continue;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = x + dx;
            const ny = y + dy;
            if (nx >= 0 && ny >= 0 && nx < cols && ny < rows) next[ny * cols + nx] = 1;
          }
        }
      }
    }
    grown = next;
  }

  // ── drop the specks ───────────────────────────────────────────────────────
  const seen = new Uint8Array(cols * rows);
  const keep = new Uint8Array(cols * rows);
  let patches = 0;
  const stack: number[] = [];
  for (let start = 0; start < grown.length; start++) {
    if (!grown[start] || seen[start]) continue;
    stack.length = 0;
    stack.push(start);
    seen[start] = 1;
    const patch: number[] = [];
    let crowded = 0;
    while (stack.length) {
      const at = stack.pop()!;
      patch.push(at);
      if (hot[at]) crowded++;
      const x = at % cols;
      const y = (at - x) / cols;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx;
          const ny = y + dy;
          if (nx < 0 || ny < 0 || nx >= cols || ny >= rows) continue;
          const next = ny * cols + nx;
          if (grown[next] && !seen[next]) {
            seen[next] = 1;
            stack.push(next);
          }
        }
      }
    }
    if (crowded >= opt.minCells) {
      patches++;
      for (const at of patch) keep[at] = 1;
    }
  }

  // ── squares into rows of rectangles, so the page draws a band not a mosaic ─
  const rects: Zone[] = [];
  for (let y = 0; y < rows; y++) {
    let runStart = -1;
    for (let x = 0; x <= cols; x++) {
      const on = x < cols && keep[y * cols + x] === 1;
      if (on && runStart === -1) runStart = x;
      if (!on && runStart !== -1) {
        rects.push({
          x: runStart * cell,
          y: y * cell,
          w: (x - runStart) * cell,
          h: cell,
        });
        runStart = -1;
      }
    }
  }

  return { rects, patches, cellPt: cell };
}

/** Is this point inside any shaded area? Used to explain a stroke that missed. */
export function inZone(p: Pt, zones: Zone[]): boolean {
  return zones.some((z) => p.x >= z.x && p.x <= z.x + z.w && p.y >= z.y && p.y <= z.y + z.h);
}
