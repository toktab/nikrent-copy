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

  return (
    <div
      className={`piece elevation${selected ? ' selected' : ''}`}
      data-piece-id={piece.id}
      style={{
        left: r.x,
        top: r.y,
        width: r.w,
        height: r.h,
        background: material.color,
        zIndex: rank,
      }}
      title={material.name}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    />
  );
});
