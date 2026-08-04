import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent as ReactDragEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import type { Material, Piece } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import {
  computeEdgeSnap,
  findOverlaps,
  pieceBounds,
  planH,
  planW,
  snapValue,
  WORLD_H,
  WORLD_W,
} from '../lib/geometry';
import { createWheelClassifier } from '../lib/wheelInput';
import { PieceView } from './PieceView';
import { ShapeSvg } from './ShapeSvg';
import { LabelLayer } from './LabelLayer';
import { Rulers } from './Rulers';

/** What the pointer is currently doing on the stage. */
type Interaction =
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | { type: 'move'; sx: number; sy: number; baseline: Piece[] }
  | { type: 'marquee'; sx: number; sy: number }
  | null;

interface MarqueeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function StageCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>(null);
  const spaceRef = useRef(false);
  const wheelClassifier = useRef(createWheelClassifier());
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [ghost, setGhost] = useState<{ material: Material; x: number; y: number } | null>(null);

  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const guideX = useEditorStore((s) => s.guideX);
  const guideY = useEditorStore((s) => s.guideY);
  const showOverlaps = useEditorStore((s) => s.showOverlaps);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const overlapping = useMemo(
    () => (showOverlaps ? findOverlaps(pieces, byId) : new Set<string>()),
    [showOverlaps, pieces, byId],
  );

  // ── Keep the store's idea of the viewport size in sync ────────────────────
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const publish = () => {
      const r = el.getBoundingClientRect();
      useEditorStore.getState().setStageSize(r.width, r.height);
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Wheel zoom (native listener so preventDefault actually works) ─────────
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    /**
     * Wheel handling that serves a trackpad and a mouse at the same time, with
     * nothing to configure — see `lib/wheelInput.ts` for how the two are told
     * apart. Trackpad two-finger scroll pans, a mouse wheel zooms, a pinch or
     * ⌘/Ctrl+wheel always zooms.
     */
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useEditorStore.getState();
      const r = el.getBoundingClientRect();
      const action = wheelClassifier.current.classify(e, el.clientHeight);

      if (action.kind === 'zoom') {
        s.zoomAt(action.factor, e.clientX - r.left, e.clientY - r.top);
      } else {
        s.setPan(s.panX - action.dx, s.panY - action.dy);
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Touch: two-finger pinch to zoom and drag to pan ──────────────────────
  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;

    let gesture: { dist: number; cx: number; cy: number } | null = null;
    const spread = (t: TouchList) => {
      const dx = t[0].clientX - t[1].clientX;
      const dy = t[0].clientY - t[1].clientY;
      return {
        dist: Math.hypot(dx, dy),
        cx: (t[0].clientX + t[1].clientX) / 2,
        cy: (t[0].clientY + t[1].clientY) / 2,
      };
    };

    const onStart = (e: TouchEvent) => {
      if (e.touches.length === 2) {
        gesture = spread(e.touches);
        // Cancel any single-finger piece drag that started first.
        interaction.current = null;
      }
    };

    const onMove = (e: TouchEvent) => {
      if (e.touches.length !== 2 || !gesture) return;
      e.preventDefault();
      const next = spread(e.touches);
      const rect = el.getBoundingClientRect();
      const store = useEditorStore.getState();

      if (gesture.dist > 0) {
        store.zoomAt(next.dist / gesture.dist, gesture.cx - rect.left, gesture.cy - rect.top);
      }
      // Panning the midpoint moves the view with the fingers.
      const moved = useEditorStore.getState();
      moved.setPan(moved.panX + (next.cx - gesture.cx), moved.panY + (next.cy - gesture.cy));
      gesture = next;
    };

    const onEnd = (e: TouchEvent) => {
      if (e.touches.length < 2) gesture = null;
    };

    el.addEventListener('touchstart', onStart, { passive: true });
    el.addEventListener('touchmove', onMove, { passive: false });
    el.addEventListener('touchend', onEnd);
    el.addEventListener('touchcancel', onEnd);
    return () => {
      el.removeEventListener('touchstart', onStart);
      el.removeEventListener('touchmove', onMove);
      el.removeEventListener('touchend', onEnd);
      el.removeEventListener('touchcancel', onEnd);
    };
  }, []);

  // ── Drag / pan / marquee tracking on the window ──────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const it = interaction.current;
      if (!it) return;
      const s = useEditorStore.getState();

      if (it.type === 'pan') {
        s.setPan(it.px + (e.clientX - it.sx), it.py + (e.clientY - it.sy));
        return;
      }
      if (it.type === 'move') {
        // Screen delta → world delta is just a division by the zoom.
        s.moveSelectionBy(
          (e.clientX - it.sx) / s.zoom,
          (e.clientY - it.sy) / s.zoom,
          it.baseline,
        );
        return;
      }
      // marquee: track the rubber band in stage-relative screen pixels
      const rect = stageRef.current?.getBoundingClientRect();
      if (!rect) return;
      const x1 = e.clientX - rect.left;
      const y1 = e.clientY - rect.top;
      setMarquee({
        x: Math.min(it.sx, x1),
        y: Math.min(it.sy, y1),
        w: Math.abs(x1 - it.sx),
        h: Math.abs(y1 - it.sy),
      });
    };

    const onUp = (e: PointerEvent) => {
      const it = interaction.current;
      if (it?.type === 'marquee') {
        const rect = stageRef.current?.getBoundingClientRect();
        const s = useEditorStore.getState();
        if (rect) {
          const x1 = e.clientX - rect.left;
          const y1 = e.clientY - rect.top;
          const box = {
            x: Math.min(it.sx, x1),
            y: Math.min(it.sy, y1),
            w: Math.abs(x1 - it.sx),
            h: Math.abs(y1 - it.sy),
          };
          // A tiny box is a click, not a drag — leave the selection cleared.
          if (box.w > 3 || box.h > 3) {
            const lookup = new Map(s.materials.map((m) => [m.id, m]));
            // screen box → world cm box
            const wx = (box.x - s.panX) / s.zoom;
            const wy = (box.y - s.panY) / s.zoom;
            const ww = box.w / s.zoom;
            const wh = box.h / s.zoom;
            const hits = s.pieces.filter((p) => {
              const m = lookup.get(p.materialId);
              if (!m) return false;
              const b = pieceBounds(p, m);
              return b.x < wx + ww && b.x + b.w > wx && b.y < wy + wh && b.y + b.h > wy;
            });
            s.setSelection(hits.map((p) => p.id));
          }
        }
        setMarquee(null);
      }
      if (it?.type === 'move') useEditorStore.getState().endDrag();
      interaction.current = null;
      setPanning(false);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, []);

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  useEffect(() => {
    const isTyping = (target: EventTarget | null) => {
      const el = target as HTMLElement | null;
      if (!el) return false;
      return (
        el.tagName === 'INPUT' ||
        el.tagName === 'TEXTAREA' ||
        el.tagName === 'SELECT' ||
        el.isContentEditable
      );
    };

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTyping(e.target)) return;
      const s = useEditorStore.getState();
      if (s.dialog) return; // modals own the keyboard while open

      const mod = e.metaKey || e.ctrlKey;

      if (mod) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'KeyY':
            e.preventDefault();
            s.redo();
            return;
          case 'KeyD':
            e.preventDefault();
            s.duplicateSelected();
            return;
          case 'KeyC':
            e.preventDefault();
            s.copySelection();
            return;
          case 'KeyV':
            e.preventDefault();
            s.pasteClipboard();
            return;
          case 'KeyA':
            e.preventDefault();
            s.selectAll();
            return;
          default:
            return;
        }
      }

      if (e.code === 'Space') {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceDown(true);
        }
        e.preventDefault();
        return;
      }

      // Arrow keys nudge: one grid step, or 1 cm with Shift for fine work.
      const step = e.shiftKey ? 1 : s.snap ? s.snapStep : 1;
      const nudge: Record<string, [number, number]> = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (nudge[e.key]) {
        if (s.selectedIds.length) {
          e.preventDefault();
          s.nudgeSelection(...nudge[e.key]);
        }
        return;
      }

      // e.code so the shortcut still works on a Georgian keyboard layout
      if (e.code === 'KeyR' || e.key.toLowerCase() === 'r') s.rotateSelected();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        s.deleteSelected();
        e.preventDefault();
      }
      if (e.key === 'Escape') s.setSelection([]);
    };

    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') {
        spaceRef.current = false;
        setSpaceDown(false);
      }
    };

    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ── Pointer handlers ──────────────────────────────────────────────────────
  const onPiecePointerDown = useCallback((e: ReactPointerEvent, id: string) => {
    // space / middle-button gestures belong to the pan handler below
    if (e.button !== 0 || spaceRef.current) return;
    e.stopPropagation();
    const s = useEditorStore.getState();

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      s.toggleSelect(id);
      return; // modifier-click adjusts the selection, it does not start a drag
    }
    // Clicking an already-selected piece keeps the group so it can be dragged.
    if (!s.selectedIds.includes(id)) s.select(id);

    s.beginDrag();
    interaction.current = {
      type: 'move',
      sx: e.clientX,
      sy: e.clientY,
      baseline: useEditorStore.getState().pieces,
    };
  }, []);

  const onStagePointerDown = useCallback((e: ReactPointerEvent) => {
    const s = useEditorStore.getState();

    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      interaction.current = { type: 'pan', sx: e.clientX, sy: e.clientY, px: s.panX, py: s.panY };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    // Empty-surface press: clear the selection and start a rubber band.
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!e.shiftKey) s.setSelection([]);
    interaction.current = {
      type: 'marquee',
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
    };
  }, []);

  /**
   * Where a dragged material would land, in world cm.
   *
   * One function serves both the live preview and the actual drop, so the ghost
   * can never disagree with the placed piece. The piece is centred on the
   * cursor using its PLAN size (w × depth) — using `m.h` here put a 300 cm
   * panel 150 cm away from the pointer.
   */
  const dropPosition = useCallback((material: Material, clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return null;
    const s = useEditorStore.getState();
    const r = el.getBoundingClientRect();
    const pw = planW(material);
    const ph = planH(material);

    let x = snapValue((clientX - r.left - s.panX) / s.zoom - pw / 2, s.snapStep, s.snap);
    let y = snapValue((clientY - r.top - s.panY) / s.zoom - ph / 2, s.snapStep, s.snap);
    let guideX: number | null = null;
    let guideY: number | null = null;

    // Butt the new piece against whatever is already there, same as dragging.
    if (s.edgeSnap) {
      const lookup = new Map(s.materials.map((mm) => [mm.id, mm]));
      const targets = s.pieces
        .map((p) => {
          const mm = lookup.get(p.materialId);
          return mm ? pieceBounds(p, mm) : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      const snap = computeEdgeSnap({ x, y, w: pw, h: ph }, targets, 8 / s.zoom);
      x += snap.dx;
      y += snap.dy;
      guideX = snap.guideX;
      guideY = snap.guideY;
    }
    return { x, y, guideX, guideY };
  }, []);

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const s = useEditorStore.getState();
      const material = s.materials.find((m) => m.id === s.draggingMaterialId);
      if (!material) return;
      const at = dropPosition(material, e.clientX, e.clientY);
      if (at) setGhost({ material, x: at.x, y: at.y });
    },
    [dropPosition],
  );

  const onDrop = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      setGhost(null);
      const s = useEditorStore.getState();
      // dataTransfer is authoritative; the store value is the dragover fallback.
      const materialId = e.dataTransfer.getData('text/plain') || s.draggingMaterialId;
      const material = s.materials.find((m) => m.id === materialId);
      if (!material) return;
      const at = dropPosition(material, e.clientX, e.clientY);
      if (at) s.addPiece(material.id, at.x, at.y);
      s.setDraggingMaterial(null);
    },
    [dropPosition],
  );

  const cursor = panning ? 'grabbing' : spaceDown ? 'grab' : 'default';

  return (
    <main
      ref={stageRef}
      className="stage"
      style={{ cursor }}
      onPointerDown={onStagePointerDown}
      onDragOver={onDragOver}
      onDragLeave={(e) => {
        // Only clear when the pointer actually leaves the stage, not when it
        // crosses onto a child piece.
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setGhost(null);
      }}
      onDrop={onDrop}
    >
      <Rulers />

      {/* World layer: 1 cm = 1 px, then translate+scale. --z lets CSS keep
          selection outlines exactly 1–2 screen px at any zoom. */}
      <div
        className="world"
        style={
          {
            transform: `translate(${panX}px, ${panY}px) scale(${zoom})`,
            '--z': zoom,
          } as CSSProperties
        }
      >
        <div className="grid" style={{ width: WORLD_W, height: WORLD_H }} />

        {/* Live drop preview: exactly where the piece will land, snapping included. */}
        {ghost && (
          <div
            className="ghost"
            style={{
              left: ghost.x,
              top: ghost.y,
              width: planW(ghost.material),
              height: planH(ghost.material),
            }}
          >
            <ShapeSvg
              material={ghost.material}
              width={planW(ghost.material)}
              height={planH(ghost.material)}
              strokeWidth={1 / zoom}
            />
          </div>
        )}
        {pieces.map((piece) => {
          const material = byId.get(piece.materialId);
          if (!material) return null;
          return (
            <PieceView
              key={piece.id}
              piece={piece}
              material={material}
              selected={selected.has(piece.id)}
              overlapping={overlapping.has(piece.id)}
              zoom={zoom}
              onPointerDown={onPiecePointerDown}
            />
          );
        })}
      </div>

      <LabelLayer />

      {/* Alignment guides from edge snapping, drawn in screen space. */}
      {guideX !== null && (
        <div className="guide guide-v" style={{ left: guideX * zoom + panX }} />
      )}
      {guideY !== null && (
        <div className="guide guide-h" style={{ top: guideY * zoom + panY }} />
      )}

      {marquee && (
        <div
          className="marquee"
          style={{ left: marquee.x, top: marquee.y, width: marquee.w, height: marquee.h }}
        />
      )}

      {pieces.length === 0 && (
        <div className="drop-hint">
          ზედაპირი ცარიელია — გადმოათრიე მასალა მარცხენა პანელიდან
        </div>
      )}
    </main>
  );
}
