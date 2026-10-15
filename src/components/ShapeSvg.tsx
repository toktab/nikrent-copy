import type { Material, Piece } from '../types';
import { barRect, drawnOutline, pointsAttr } from '../lib/shapePath';
import { pieceBounds, planH, planW, type Rect } from '../lib/geometry';

interface Props {
  material: Material;
  /** rendered size in px; the viewBox stays in the material's cm space */
  width: number;
  height: number;
  /** stroke width in cm (world units) — pass 1/zoom for a constant 1 px outline */
  strokeWidth?: number;
  opacity?: number;
}

/**
 * Draws a material's shape. Used both for the 26 px palette swatch and for the
 * full-size piece on the surface, so a component always looks the same in both.
 */
export function ShapeSvg({ material: m, width, height, strokeWidth = 1, opacity }: Props) {
  return (
    <svg
      className="shape"
      width={width}
      height={height}
      viewBox={`0 0 ${planW(m)} ${planH(m)}`}
      preserveAspectRatio="none"
      style={{ opacity, display: 'block' }}
      aria-hidden="true"
    >
      <ShapeBody material={m} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** The shape itself, in the material's own cm space with its origin top-left. */
function ShapeBody({ material: m, strokeWidth }: { material: Material; strokeWidth: number }) {
  const stroke = 'rgba(0,0,0,.55)';
  // Plan view: a piece occupies w × depth on screen (h is its vertical height).
  const pw = planW(m);
  const ph = planH(m);
  const sw = Math.min(strokeWidth, Math.min(pw, ph) / 4);

  return m.shape === 'L' ? (
    <polygon points={pointsAttr(drawnOutline(m))} fill={m.color} stroke={stroke} strokeWidth={sw} />
  ) : m.shape === 'line' ? (
    <LineBar m={m} stroke={stroke} strokeWidth={sw} />
  ) : (
    <rect x={0} y={0} width={pw} height={ph} fill={m.color} stroke={stroke} strokeWidth={sw} />
  );
}

/**
 * The whole-cm box a placed piece is drawn in: its rotated footprint, widened
 * out to the nearest whole cm on every side.
 */
export function placedBox(piece: Piece, m: Material): Rect {
  const b = pieceBounds(piece, m);
  // The trigonometric extent carries 1e-15 of noise; it must not cost a cm.
  const x0 = Math.floor(b.x + 1e-6);
  const y0 = Math.floor(b.y + 1e-6);
  const x1 = Math.ceil(b.x + b.w - 1e-6);
  const y1 = Math.ceil(b.y + b.h - 1e-6);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * A placed piece's shape, drawn exactly where it lies.
 *
 * The browser rounds the box of an <svg> - and the background of any box - to
 * whole CSS pixels before the surface's zoom is applied. On a surface drawn at
 * 1 cm = 1 px that rounding is up to half a centimetre, and at 800 % it is four
 * screen pixels: a panel turned on its side at x 449.5 was painted at 450, a
 * visible step against the panel above it that was actually flush. Positioning
 * each piece with `left`/`top` and a CSS rotate could only ever be as accurate
 * as that rounding.
 *
 * So the box is always whole cm - the piece's footprint widened outwards, which
 * the rounding leaves alone - and the piece is placed and turned INSIDE the
 * SVG, where coordinates are vector and nothing is rounded. Pass `box` from
 * `placedBox` so the caller's element and this drawing agree on it.
 */
export function PlacedShapeSvg({
  piece,
  material: m,
  box,
  strokeWidth = 1,
}: {
  piece: Piece;
  material: Material;
  box: Rect;
  strokeWidth?: number;
}) {
  const pw = planW(m);
  const ph = planH(m);
  return (
    <svg
      className="shape"
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <g
        transform={`translate(${piece.x + pw / 2} ${piece.y + ph / 2}) rotate(${piece.rot}) translate(${-pw / 2} ${-ph / 2})`}
      >
        <ShapeBody material={m} strokeWidth={strokeWidth} />
      </g>
    </svg>
  );
}

function LineBar({ m, stroke, strokeWidth }: { m: Material; stroke: string; strokeWidth: number }) {
  const pw = planW(m);
  const ph = planH(m);
  const bar = barRect(pw, ph);
  return (
    <>
      {/* faint full-box footprint so the drag/hit area stays obvious */}
      <rect x={0} y={0} width={pw} height={ph} fill={m.color} opacity={0.16} />
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        rx={bar.r}
        ry={bar.r}
        fill={m.color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </>
  );
}

export interface FittedBox {
  width: number;
  height: number;
  /** stroke width in cm that renders as ≲1 px on both axes */
  stroke: number;
}

/**
 * Fits a material into a `box` px square, keeping the aspect ratio but never
 * letting the thin side vanish. That floor makes the scale slightly
 * non-uniform, so the stroke is derived from the *most compressed* axis —
 * otherwise a 600 × 12 waler would render as a solid blob.
 */
export function fitBox(material: Material, box: number, min = 6): FittedBox {
  const pw = planW(material);
  const ph = planH(material);
  const ar = pw / ph;
  const width = ar >= 1 ? box : Math.max(min, box * ar);
  const height = ar >= 1 ? Math.max(min, box / ar) : box;
  return { width, height, stroke: Math.min(pw / width, ph / height) };
}

/** Larger scaled preview, used by the inspector and the component form. */
export function PiecePreview({ material, box }: { material: Material; box: number }) {
  const fit = fitBox(material, box);
  return (
    <ShapeSvg
      material={material}
      width={fit.width}
      height={fit.height}
      strokeWidth={fit.stroke}
    />
  );
}

/** Swatch sized like the v1 palette: `size` px on the longer side, aspect kept. */
export function Swatch({ material, size = 26 }: { material: Material; size?: number }) {
  const fit = fitBox(material, size);
  return (
    <span className="swatch" style={{ width: size, height: size }}>
      <ShapeSvg
        material={material}
        width={fit.width}
        height={fit.height}
        strokeWidth={fit.stroke}
      />
    </span>
  );
}
