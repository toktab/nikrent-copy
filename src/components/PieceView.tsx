import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { PlacedShapeSvg, placedBox } from './ShapeSvg';
import { ConnectorGlyph, LatchGlyph, markRadiusPx, NutGlyph, RodGlyph } from './BoltLayer';
import { isConnector, planW, type Rect } from '../lib/geometry';
import { isLatch, isNut, isRod, LATCH_FIT, outward, pieceCentre } from '../lib/bolts';

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
  const rod = isRod(material);
  const nut = isNut(material) || isLatch(material);
  const kind = connector ? ' connector' : rod ? ' rod' : nut ? ' nut' : '';
  return (
    <div
      className={`piece${kind}${selected ? ' selected' : ''}${overlapping ? ' overlap' : ''}`}
      data-piece-id={piece.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      {connector ? (
        <ConnectorPieceSvg piece={piece} material={material} box={box} zoom={zoom} atCorner={atCorner} />
      ) : rod || nut ? (
        <FixingPieceSvg piece={piece} material={material} box={box} zoom={zoom} />
      ) : (
        <PlacedShapeSvg piece={piece} material={material} box={box} strokeWidth={1 / zoom} />
      )}
    </div>
  );
});

/**
 * A placed შტირი or ქანჩი + დისკო, drawn the way their marks are: the rod as
 * a thin bar tip to tip, the nut as a washer on the face with the nut on it,
 * facing the way its turn says.
 */
export function FixingPieceSvg({
  piece,
  material,
  box,
  zoom,
}: {
  piece: Piece;
  material: Material;
  box: Rect;
  zoom: number;
}) {
  return (
    <svg
      className="shape"
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <FixingBody piece={piece} material={material} px={1 / zoom} />
    </svg>
  );
}

/**
 * A placed შტირი, ქანჩი + დისკო or ჩამკეტი fix where it lies, in world cm.
 * `px` is one screen pixel - or, on the printed sheet, its stand-in - in cm.
 */
export function FixingBody({ piece, material, px }: { piece: Piece; material: Material; px: number }) {
  const c = pieceCentre(piece, material);
  if (isLatch(material)) {
    // Its box starts past the nut; the glyph is drawn from the face.
    const o = outward(piece.rot);
    const back = planW(material) / 2 + LATCH_FIT.offset;
    return <LatchGlyph x={c.x - o.x * back} y={c.y - o.y * back} rot={piece.rot} scale={1} px={px} />;
  }
  if (isNut(material)) {
    const o = outward(piece.rot);
    const half = planW(material) / 2;
    return <NutGlyph x={c.x - o.x * half} y={c.y - o.y * half} rot={piece.rot} scale={1} px={px} />;
  }
  return (
    <g transform={`translate(${c.x} ${c.y}) rotate(${piece.rot})`}>
      <RodGlyph length={planW(material)} scale={1} px={px} />
    </g>
  );
}

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
