import { memo, type PointerEvent as ReactPointerEvent } from 'react';
import type { Material, Piece } from '../types';
import { PlacedShapeSvg, placedBox } from './ShapeSvg';
import { ClampGlyph, ConnectorGlyph, NutGlyph, RodGlyph } from './BoltLayer';
import { isConnector, isPanelHolder, planH, planW, type Rect } from '../lib/geometry';
import { useEditorStore } from '../store/useEditorStore';
import { isCrocodile, isFrog } from '../lib/clamps';
import { boltKindOf } from '../lib/boltMarks';
import { isLatch, isNut, isRod, outward, pieceCentre } from '../lib/bolts';

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
  // Drawn larger or smaller by its kind's size setting (ScaleField), about its middle.
  const scale = useEditorStore((s) => s.materialScale[material.id] ?? 1);
  const connector = isConnector(material);
  const rod = isRod(material);
  const nut = isNut(material);
  const latch = isLatch(material);
  // The დამჭერი is always placed by hand, so it carries no hand-placed dot.
  const holder = isPanelHolder(material);
  // ...nor do the ნიანგი and ბაყაყი, which the reset places as often as a hand.
  const clamp = isCrocodile(material) ? ' crocodile' : isFrog(material) ? ' frog' : '';
  const kind = connector ? ' connector' : rod ? ' rod' : nut ? ' nut' : latch ? ' latch' : holder ? ' holder' : clamp;
  // Placed by hand, not by the fill (`Piece.auto`): a dot in its corner, so
  // what the architect set himself reads apart from what was filled in.
  const hand = !kind && !piece.auto ? ' hand' : '';
  return (
    <div
      className={`piece${kind}${hand}${selected ? ' selected' : ''}${overlapping ? ' overlap' : ''}`}
      data-piece-id={piece.id}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h, overflow: scale !== 1 ? 'visible' : undefined }}
      onPointerDown={(e) => onPointerDown(e, piece.id)}
    >
      <div className="piece-scale" style={scale !== 1 ? { transform: `scale(${scale})`, transformOrigin: '50% 50%', width: '100%', height: '100%' } : { width: '100%', height: '100%' }}>
        {connector ? (
          <ConnectorPieceSvg piece={piece} material={material} box={box} zoom={zoom} atCorner={atCorner} />
        ) : rod || nut || latch ? (
          <FixingPieceSvg piece={piece} material={material} box={box} zoom={zoom} />
        ) : (
          <PlacedShapeSvg piece={piece} material={material} box={box} strokeWidth={1 / zoom} red={atCorner && isFrog(material)} />
        )}
      </div>
      {/* A picked ჭანჭიკი gets an × to take it off right there (the user, 2026-11-08). */}
      {selected && boltKindOf(material) && (
        <button
          type="button"
          className="piece-x"
          title="წაშლა"
          aria-label="წაშლა"
          style={{ width: 16 / zoom, height: 16 / zoom, top: -9 / zoom, right: -9 / zoom, fontSize: 12 / zoom, borderWidth: 1 / zoom }}
          onPointerDown={(e) => e.stopPropagation()}
          onClick={(e) => {
            e.stopPropagation();
            useEditorStore.getState().deleteSelected();
          }}
        >
          ×
        </button>
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
    // Its middle is the clamp's, on the joint just in from the face.
    return <ClampGlyph x={c.x} y={c.y} rot={piece.rot} scale={1} px={px} />;
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
      {/* The size of the 40 სმ discs (the user, 2026-11-08): its catalog box,
          not a fixed size on screen. */}
      <ConnectorGlyph
        cx={c.x}
        cy={c.y}
        r={(Math.min(planW(material), planH(material)) / 2) * 0.82}
        px={1 / zoom}
        kind={atCorner ? 'corner' : 'tee'}
      />
    </svg>
  );
}
