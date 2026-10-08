import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { MAX_OPACITY, paperScale, scaleToLength, underlayBox } from '../lib/underlay';

/**
 * The PDF page behind the drawing, and everything needed to place it.
 *
 * Lives inside the world layer, so it pans and zooms with the drawing and is
 * positioned in plain world centimetres - the sheet is part of the surface,
 * not something floating over the screen.
 *
 * The lock is the whole interaction model. Unlocked, the sheet is the thing
 * being worked on: it takes the pointer, drags, has corner handles for size
 * and a bar beside it for the numbers worth changing. Locked, it takes no
 * pointer events at all and every control disappears, so ხაზვა and the rest
 * work straight through it like a pencil through tracing paper.
 *
 * Placing it lives here rather than in the menu because matching a page to a
 * known wall is half a dozen small corrections, and each one through a menu is
 * a menu opened, aimed at and closed again.
 */

const CORNERS = [
  { id: 'tl', left: true, top: true },
  { id: 'tr', left: false, top: true },
  { id: 'bl', left: true, top: false },
  { id: 'br', left: false, top: false },
] as const;

interface Resize {
  corner: (typeof CORNERS)[number];
  clientX: number;
  startW: number;
  startX: number;
  startY: number;
}

interface Pt {
  x: number;
  y: number;
}

export function UnderlayLayer() {
  const underlay = useEditorStore((s) => s.underlay);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const changeUnderlay = useEditorStore((s) => s.changeUnderlay);

  const drag = useRef<{ x: number; y: number; startX: number; startY: number } | null>(null);
  const resize = useRef<Resize | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  /**
   * Scaling off something known: click the two ends of a wall whose length
   * you know, type the length, and the sheet resizes about the first point.
   * This is how a drawing is actually scaled - the sheet's own width in
   * centimetres is a number nobody knows off the top of their head.
   */
  const [calib, setCalib] = useState<{ a: Pt | null; b: Pt | null } | null>(null);
  const [realCm, setRealCm] = useState('');

  // P shows and hides it, L locks it, arrows nudge it. Tracing is a lot of
  // looking under and over the sheet, and reaching for a menu to do that is
  // what makes a backdrop annoying enough to switch off for good.
  useEffect(() => {
    if (!underlay) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA')) return;
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const key = e.key.toLowerCase();

      if (key === 'p') {
        e.preventDefault();
        changeUnderlay({ visible: !underlay.visible });
        return;
      }
      if (key === 'l') {
        e.preventDefault();
        changeUnderlay({ locked: !underlay.locked });
        return;
      }
      if (e.key === 'Escape' && calib) {
        setCalib(null);
        return;
      }
      if (underlay.locked || !underlay.visible) return;
      const step = e.shiftKey ? 10 : 1;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      const move = nudge[e.key];
      if (move) {
        e.preventDefault();
        changeUnderlay({ x: underlay.x + move[0], y: underlay.y + move[1] });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [underlay, changeUnderlay, calib]);

  if (!underlay || !underlay.visible) return null;
  const box = underlayBox(underlay);
  const ratio = underlay.ptW > 0 ? underlay.ptH / underlay.ptW : 1;
  const scale = paperScale(underlay);
  /** Screen-sized, not world-sized: a handle stays a handle at any zoom. */
  const screen = (px: number) => px / zoom;

  /** Where a pointer is, in world centimetres. */
  const worldAt = (e: ReactPointerEvent | { clientX: number; clientY: number }): Pt => {
    const rect = rootRef.current!.getBoundingClientRect();
    return {
      x: box.x + (e.clientX - rect.left) / zoom,
      y: box.y + (e.clientY - rect.top) / zoom,
    };
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (underlay.locked || e.button !== 0) return;
    e.stopPropagation(); // the stage would otherwise start a rubber band

    if (calib) {
      const p = worldAt(e);
      setCalib(calib.a ? { a: calib.a, b: p } : { a: p, b: null });
      return;
    }
    e.currentTarget.setPointerCapture(e.pointerId);
    drag.current = { x: e.clientX, y: e.clientY, startX: underlay.x, startY: underlay.y };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLImageElement>) => {
    if (calib?.a && !calib.b) {
      setCalib({ a: calib.a, b: worldAt(e) });
      return;
    }
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

  /**
   * Dragging a corner scales the page about the opposite corner, keeping its
   * proportions - a sheet stretched out of shape would put every length on it
   * out by a different amount.
   */
  const startResize =
    (corner: (typeof CORNERS)[number]) => (e: ReactPointerEvent<HTMLDivElement>) => {
      if (e.button !== 0) return;
      e.stopPropagation();
      e.currentTarget.setPointerCapture(e.pointerId);
      resize.current = {
        corner,
        clientX: e.clientX,
        startW: box.w,
        startX: underlay.x,
        startY: underlay.y,
      };
    };

  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const from = resize.current;
    if (!from) return;
    const dx = (e.clientX - from.clientX) / zoom;
    const width = Math.max(20, from.corner.left ? from.startW - dx : from.startW + dx);
    const height = width * ratio;
    const startH = from.startW * ratio;
    changeUnderlay({
      widthCm: width,
      x: from.corner.left ? from.startX + (from.startW - width) : from.startX,
      y: from.corner.top ? from.startY + (startH - height) : from.startY,
    });
  };

  const endResize = () => {
    resize.current = null;
  };

  const applyCalibration = () => {
    if (!calib?.a || !calib.b) return;
    const measured = Math.hypot(calib.b.x - calib.a.x, calib.b.y - calib.a.y);
    const real = Number(String(realCm).replace(',', '.'));
    if (!(measured > 0) || !(real > 0)) return;
    const next = scaleToLength(underlay, measured, real, calib.a);
    changeUnderlay(next);
    setCalib(null);
    setRealCm('');
  };

  const calibLine = calib?.a && calib.b ? { a: calib.a, b: calib.b } : null;
  const ready = Boolean(calib?.a && calib?.b);

  /**
   * The bar follows the sheet's top-left corner, but never off the screen.
   * Scaled to a building the page is usually larger than the view, and a bar
   * pinned to a corner two metres off the top of the window is a control
   * nobody can reach - which is exactly the "open the menu every time"
   * problem it exists to solve. Offsets are inside the sheet, in world cm.
   */
  const RULER_PX = 30;
  const barLeft = Math.max(0, (-panX + RULER_PX) / zoom - box.x);
  const barTop = Math.max(0, (-panY + RULER_PX) / zoom - box.y);

  return (
    <div
      ref={rootRef}
      className={`underlay${underlay.locked ? ' locked' : ' movable'}${calib ? ' calibrating' : ''}`}
      style={{ left: box.x, top: box.y, width: box.w, height: box.h }}
    >
      <img
        className={underlay.invert ? 'inverted' : undefined}
        src={underlay.src}
        alt=""
        draggable={false}
        style={{ opacity: underlay.opacity }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
      />

      {!underlay.locked && (
        <>
          {CORNERS.map((corner) => (
            <div
              key={corner.id}
              className={`underlay-handle ${corner.id}`}
              style={{
                width: screen(12),
                height: screen(12),
                borderWidth: screen(2),
                [corner.left ? 'left' : 'right']: screen(-6),
                [corner.top ? 'top' : 'bottom']: screen(-6),
              }}
              onPointerDown={startResize(corner)}
              onPointerMove={onResizeMove}
              onPointerUp={endResize}
              onPointerCancel={endResize}
            />
          ))}

          {/* The measured span, while it is being taken. */}
          {calibLine && (
            <svg className="underlay-calib" viewBox={`0 0 ${box.w} ${box.h}`}>
              <line
                x1={calibLine.a.x - box.x}
                y1={calibLine.a.y - box.y}
                x2={calibLine.b.x - box.x}
                y2={calibLine.b.y - box.y}
                style={{ strokeWidth: screen(2) }}
              />
              {[calibLine.a, calibLine.b].map((p, i) => (
                <circle key={i} cx={p.x - box.x} cy={p.y - box.y} r={screen(4)} />
              ))}
            </svg>
          )}

          <div
            className="underlay-bar"
            // Inside the sheet's own corner, not above it: brought to the
            // screen the page fills the view, and a bar above its top edge
            // would sit behind the toolbar where nobody can reach it. The
            // translate runs before the scale, so the inset stays 10 screen
            // pixels at any zoom.
            style={{ left: barLeft, top: barTop, transform: `scale(${1 / zoom}) translate(10px, 10px)` }}
            onPointerDown={(e) => e.stopPropagation()}
          >
            {calib ? (
              <>
                <span className="underlay-step">
                  {!calib.a
                    ? '1. დააჭირე ცნობილი კედლის ერთ ბოლოს'
                    : !ready
                      ? '2. დააჭირე მეორე ბოლოს'
                      : '3. რამდენი სანტიმეტრია?'}
                </span>
                {ready && (
                  <>
                    <input
                      autoFocus
                      type="number"
                      min={1}
                      step="any"
                      placeholder="სმ"
                      value={realCm}
                      onChange={(e) => setRealCm(e.target.value)}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') applyCalibration();
                      }}
                    />
                    <button className="btn small primary" onClick={applyCalibration}>
                      მორგება
                    </button>
                  </>
                )}
                <button
                  className="btn small"
                  onClick={() => {
                    setCalib(null);
                    setRealCm('');
                  }}
                >
                  გაუქმება
                </button>
              </>
            ) : (
              <>
                <label>
                  <span>სიგანე</span>
                  <input
                    type="number"
                    min={20}
                    step="any"
                    value={Math.round(underlay.widthCm)}
                    onChange={(e) => changeUnderlay({ widthCm: Number(e.target.value) })}
                  />
                  <small>სმ</small>
                </label>
                {scale && <span className="underlay-scale">≈ 1:{Math.round(scale)}</span>}
                <button className="btn small" onClick={() => setCalib({ a: null, b: null })}>
                  ზომით მორგება
                </button>
                <label className="underlay-bar-fade">
                  <input
                    type="range"
                    min={0.05}
                    max={MAX_OPACITY}
                    step={0.05}
                    value={underlay.opacity}
                    onChange={(e) => changeUnderlay({ opacity: Number(e.target.value) })}
                  />
                  <b>{Math.round(underlay.opacity * 100)}%</b>
                </label>
                <button className="btn small primary" onClick={() => changeUnderlay({ locked: true })}>
                  ჩაკეტვა
                </button>
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}
