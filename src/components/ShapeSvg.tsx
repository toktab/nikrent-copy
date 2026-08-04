import type { Material } from '../types';
import { barRect, planOutline, pointsAttr } from '../lib/shapePath';
import { planH, planW } from '../lib/geometry';

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
  const stroke = 'rgba(0,0,0,.55)';
  // Plan view: a piece occupies w × depth on screen (h is its vertical height).
  const pw = planW(m);
  const ph = planH(m);
  const sw = Math.min(strokeWidth, Math.min(pw, ph) / 4);

  return (
    <svg
      className="shape"
      width={width}
      height={height}
      viewBox={`0 0 ${pw} ${ph}`}
      preserveAspectRatio="none"
      style={{ opacity, display: 'block' }}
      aria-hidden="true"
    >
      {m.shape === 'L' ? (
        <polygon points={pointsAttr(planOutline(m))} fill={m.color} stroke={stroke} strokeWidth={sw} />
      ) : m.shape === 'line' ? (
        <LineBar m={m} stroke={stroke} strokeWidth={sw} />
      ) : (
        <rect x={0} y={0} width={pw} height={ph} fill={m.color} stroke={stroke} strokeWidth={sw} />
      )}
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
