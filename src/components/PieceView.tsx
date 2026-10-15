import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { PlacedShapeSvg, placedBox } from './ShapeSvg';

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
 * cm→px conversion.
 *
 * The element is the piece's footprint on whole cm and is never rotated; the
 * shape is placed and turned inside its SVG instead. See `PlacedShapeSvg` for
 * why: a CSS-positioned box is rounded to the pixel before the zoom, which put
 * half-centimetre steps between pieces that were flush.
 */
export const PieceView = memo(function PieceView({
  piece,
  material,
  selected,
  overlapping,
  zoom,
  onPointerDown,
}: Props) {
  const box = placedBox(piece, material);
  return (
    <div
      className={`piece${selected ? ' selected' : ''}${overlapping ? ' overlap' : ''}`}
      data-piece-id={piece.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      <PlacedShapeSvg piece={piece} material={material} box={box} strokeWidth={1 / zoom} />
    </div>
  );
});
