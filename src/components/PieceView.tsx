import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { PlacedShapeSvg, placedBox } from './ShapeSvg';
import { ConnectorGlyph, markRadiusPx } from './BoltLayer';
import { isConnector, type Rect } from '../lib/geometry';
import { pieceCentre } from '../lib/bolts';

interface Props {
  piece: Piece;
  material: Material;
  selected: boolean;
  /** footprint intersects another piece — almost always a mistake */
  overlapping: boolean;
  /** current zoom, only used to keep outlines/strokes 1 px on screen */
  zoom: number;
  /** a კონექტორი touching a კუთხე - drawn orange */
  atCorner?: boolean;
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
  atCorner,
  onPointerDown,
}: Props) {
  const box = placedBox(piece, material);
  const connector = isConnector(material);
  return (
    <div
      className={`piece${connector ? ' connector' : ''}${selected ? ' selected' : ''}${overlapping ? ' overlap' : ''}`}
      data-piece-id={piece.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      {connector ? (
        <ConnectorPieceSvg piece={piece} material={material} box={box} zoom={zoom} atCorner={atCorner} />
      ) : (
        <PlacedShapeSvg piece={piece} material={material} box={box} strokeWidth={1 / zoom} />
      )}
    </div>
  );
});

/**
 * A placed კუთხის კონექტორი, drawn as the mark the drawing puts on a joint by
 * itself and the same size on screen - it is the same thing, placed by hand.
 * In world cm inside the scaled layer, so the screen sizes are divided back.
 */
export function ConnectorPieceSvg({
  piece,
  material,
  box,
  zoom,
  atCorner,
}: {
  piece: Piece;
  material: Material;
  box: Rect;
  zoom: number;
  atCorner?: boolean;
}) {
  const c = pieceCentre(piece, material);
  return (
    <svg
      className="shape"
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <ConnectorGlyph cx={c.x} cy={c.y} r={markRadiusPx(zoom) / zoom} px={1 / zoom} kind={atCorner ? 'corner' : 'tee'} />
    </svg>
  );
}
