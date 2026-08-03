import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { planH, planW } from '../lib/geometry';
import { ShapeSvg } from './ShapeSvg';

interface Props {
  piece: Piece;
  material: Material;
  selected: boolean;
  /** footprint intersects another piece — almost always a mistake */
  overlapping: boolean;
  /** current zoom, only used to keep outlines/strokes 1 px on screen */
  zoom: number;
  onPointerDown: (e: ReactPointerEvent, id: string) => void;
}

/**
 * A placed piece. Positioned in world cm inside the scaled `#world` layer, so
 * left/top/width/height are plain cm numbers — the parent transform does the
 * cm→px conversion. Rotation happens about the piece centre.
 */
export const PieceView = memo(function PieceView({
  piece,
  material,
  selected,
  overlapping,
  zoom,
  onPointerDown,
}: Props) {
  return (
    <div
      className={`piece${selected ? ' selected' : ''}${overlapping ? ' overlap' : ''}`}
      style={{
        left: piece.x,
        top: piece.y,
        width: planW(material),
        height: planH(material),
        transform: `rotate(${piece.rot}deg)`,
      }}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      <ShapeSvg
        material={material}
        width={planW(material)}
        height={planH(material)}
        strokeWidth={1 / zoom}
      />
    </div>
  );
});
