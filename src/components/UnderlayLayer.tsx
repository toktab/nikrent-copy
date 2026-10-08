import { useRef, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { underlayBox } from '../lib/underlay';

/**
 * The PDF page behind the drawing.
 *
 * Lives inside the world layer, so it pans and zooms with everything else and
 * is positioned in plain world centimetres - the sheet is part of the drawing
 * surface, not something floating over the screen.
 *
 * While it is unlocked it can be dragged into place and takes the pointer;
 * locked, it stops taking the pointer entirely, which is what lets ხაზვა,
 * selection and every other tool work straight through it as if it were paper
 * under tracing paper. That lock is the whole interaction model: place it
 * once, lock it, forget it is a thing you can touch.
 */
export function UnderlayLayer() {
  const underlay = useEditorStore((s) => s.underlay);
  const zoom = useEditorStore((s) => s.zoom);
  const changeUnderlay = useEditorStore((s) => s.changeUnderlay);
  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);

  if (!underlay || !underlay.visible) return null;
  const box = underlayBox(underlay);

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (underlay.locked || e.button !== 0) return;
    e.stopPropagation(); // the stage would otherwise start a rubber band
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: underlay.x, startY: underlay.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = drag.current;
    if (!from) return;
    // Screen pixels back into world centimetres: the layer is scaled by zoom.
    changeUnderlay({
      x: from.startX + (e.clientX - from.x) / zoom,
      y: from.startY + (e.clientY - from.y) / zoom,
    });
  };

  const endDrag = () => {
    drag.current = null;
  };

  return (
    <div
      className={`underlay${underlay.locked ? ' locked' : ' movable'}`}
      style={{
        left: box.x,
        top: box.y,
        width: box.w,
        height: box.h,
        opacity: underlay.opacity,
      }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerCancel={endDrag}
    >
      <img src={underlay.src} alt="" draggable={false} />
      {!underlay.locked && (
        <span className="underlay-grip" style={{ fontSize: `${12 / zoom}px` }}>
          გადმოათრიე ადგილზე
        </span>
      )}
    </div>
  );
}
