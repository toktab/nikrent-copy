import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { projectPiece, type ViewAxis } from '../lib/projection';

interface Props {
  piece: Piece;
  material: Material;
  selected: boolean;
  view: ViewAxis;
  /** painter's order — larger sits nearer the viewer */
  rank: number;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
}

/**
 * A placed piece seen from the front or the side.
 *
 * Deliberately a plain rectangle rather than the plan view's outline. An
 * elevation shows a silhouette, and a solid extruded from any footprint —
 * including an L-corner — casts a rectangle, so drawing the notched profile
 * here would be wrong rather than more detailed.
 *
 * Rotation is already accounted for: the projected width is the rotated
 * footprint's extent, so a panel turned side-on correctly appears narrow
 * instead of turning on the screen.
 */
export const ElevationPieceView = memo(function ElevationPieceView({
  piece,
  material,
  selected,
  view,
  rank,
  onPointerDown,
}: Props) {
  const r = projectPiece(piece, material, view);
  // A box's background is rounded to the pixel before the zoom, which made
  // courses that met look stepped; the box is kept on whole cm and the exact
  // rectangle drawn inside it as vector. See `PlacedShapeSvg`.
  const x0 = Math.floor(r.x + 1e-6);
  const y0 = Math.floor(r.y + 1e-6);
  const w = Math.max(1, Math.ceil(r.x + r.w - 1e-6) - x0);
  const h = Math.max(1, Math.ceil(r.y + r.h - 1e-6) - y0);

  return (
    <div
      className={`piece elevation${selected ? ' selected' : ''}`}
      data-piece-id={piece.id}
      style={{ left: x0, top: y0, width: w, height: h, zIndex: rank }}
      title={material.name}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      <svg
        className="shape"
        width={w}
        height={h}
        viewBox={`${x0} ${y0} ${w} ${h}`}
        style={{ display: 'block' }}
        aria-hidden="true"
      >
        <rect
          x={r.x}
          y={r.y}
          width={r.w}
          height={r.h}
          fill={material.color}
          stroke="rgba(10,13,17,.55)"
          vectorEffect="non-scaling-stroke"
          strokeWidth={1}
        />
      </svg>
    </div>
  );
});
