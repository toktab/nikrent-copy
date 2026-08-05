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
import {
  depthRanks,
  isElevation,
  projectPiece,
  VIEW_HINT,
  type ViewAxis,
} from '../lib/projection';
import { createWheelClassifier } from '../lib/wheelInput';
import { PieceView } from './PieceView';
import { ElevationPieceView } from './ElevationPieceView';
import { ShapeSvg } from './ShapeSvg';
import { LabelLayer } from './LabelLayer';
import { Rulers } from './Rulers';

/** What the pointer is currently doing on the stage. */
type Interaction =
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | { type: 'move'; sx: number; sy: number; baseline: Piece[]; moved: boolean }
  | { type: 'marquee'; sx: number; sy: number }
  | null;

/** A press has to travel this far before it counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Every piece under the cursor, nearest first.
 *
 * Read from the document rather than from geometry so it agrees with what the
 * user can see by construction: the browser has already resolved stacking, and
 * since the pieces hit-test on their painted shape, a piece only appears here
 * where it is actually drawn.
 */
function stackUnder(clientX: number, clientY: number): string[] {
  const ids: string[] = [];
  for (const el of document.elementsFromPoint(clientX, clientY)) {
    const piece = el instanceof Element ? el.closest<HTMLElement>('.piece') : null;
    const id = piece?.dataset.pieceId;
    if (id && !ids.includes(id)) ids.push(id);
  }
  return ids;
}

interface MarqueeBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

/**
 * Middle of the placed work along the axis an elevation looks down, so a piece
 * dropped there lands among the others instead of at the world origin.
 */
function hiddenAxisDefault(pieces: Piece[], materials: Material[], view: ViewAxis): number {
  const byId = new Map(materials.map((m) => [m.id, m]));
  let min = Infinity;
  let max = -Infinity;
  for (const p of pieces) {
    const m = byId.get(p.materialId);
    if (!m) continue;
    const b = pieceBounds(p, m);
    // The front view looks along Y, the side view along X.
    const lo = view === 'front' ? b.y : b.x;
    const hi = lo + (view === 'front' ? b.h : b.w);
    min = Math.min(min, lo);
    max = Math.max(max, hi);
  }
  return Number.isFinite(min) ? (min + max) / 2 : 0;
}

export function StageCanvas() {
  const stageRef = useRef<HTMLDivElement>(null);
  const interaction = useRef<Interaction>(null);
  const spaceRef = useRef(false);
  const wheelClassifier = useRef(createWheelClassifier());
  const [spaceDown, setSpaceDown] = useState(false);
  const [panning, setPanning] = useState(false);
  const [marquee, setMarquee] = useState<MarqueeBox | null>(null);
  const [ghost, setGhost] = useState<{
    material: Material;
    x: number;
    y: number;
    w: number;
    h: number;
  } | null>(null);

  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const guideX = useEditorStore((s) => s.guideX);
  const guideY = useEditorStore((s) => s.guideY);
  const showOverlaps = useEditorStore((s) => s.showOverlaps);
  const surfaceView = useEditorStore((s) => s.surfaceView);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);
  const elevation = isElevation(surfaceView);
  const overlapping = useMemo(
    // Overlap highlighting is a plan check: two footprints sharing ground is a
    // mistake, but two pieces sharing a column of space at different heights
    // is a wall.
    () => (showOverlaps && !elevation ? findOverlaps(pieces, byId) : new Set<string>()),
    [showOverlaps, elevation, pieces, byId],
  );
  const ranks = useMemo(
    () => depthRanks(pieces, byId, surfaceView),
    [pieces, byId, surfaceView],
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
        const dx = e.clientX - it.sx;
        const dy = e.clientY - it.sy;
        if (!it.moved) {
          if (Math.hypot(dx, dy) < DRAG_THRESHOLD_PX) return;
          // Opened on the first real movement rather than on the press, so
          // clicking around to inspect pieces does not fill the undo history
          // with steps that changed nothing.
          s.beginDrag();
          it.moved = true;
        }
        // Screen delta → surface delta is just a division by the zoom.
        s.moveSelectionBy(dx / s.zoom, dy / s.zoom, it.baseline);
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
            // screen box → surface cm box
            const wx = (box.x - s.panX) / s.zoom;
            const wy = (box.y - s.panY) / s.zoom;
            const ww = box.w / s.zoom;
            const wh = box.h / s.zoom;
            const hits = s.pieces.filter((p) => {
              const m = lookup.get(p.materialId);
              if (!m) return false;
              // Tested against what the view actually shows, so a rubber band
              // in an elevation catches the course it was drawn around.
              const b = projectPiece(p, m, s.surfaceView);
              return b.x < wx + ww && b.x + b.w > wx && b.y < wy + wh && b.y + b.h > wy;
            });
            s.setSelection(hits.map((p) => p.id));
          }
        }
        setMarquee(null);
      }
      if (it?.type === 'move' && it.moved) useEditorStore.getState().endDrag();
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

    /**
     * Alt reaches past whatever is in front.
     *
     * A plain click takes the piece on top, which is the one the user pointed
     * at. But formwork stacks: in an elevation a whole back face hides behind
     * the front one, and in plan a waler crosses the panels under it, so the
     * pieces underneath need a way to be got at. Each Alt press steps one
     * deeper into the stack and wraps around at the bottom.
     */
    let target = id;
    if (e.altKey) {
      const stack = stackUnder(e.clientX, e.clientY);
      if (stack.length > 1) {
        // Step from whatever is selected, so repeated presses walk the stack.
        const from = stack.indexOf(s.selectedIds.length === 1 ? s.selectedIds[0] : id);
        target = stack[(Math.max(0, from) + 1) % stack.length];
      }
    }

    if (e.shiftKey || e.metaKey || e.ctrlKey) {
      s.toggleSelect(target);
      return; // modifier-click adjusts the selection, it does not start a drag
    }
    // Clicking an already-selected piece keeps the group so it can be dragged.
    if (!s.selectedIds.includes(target)) s.select(target);

    interaction.current = {
      type: 'move',
      sx: e.clientX,
      sy: e.clientY,
      baseline: useEditorStore.getState().pieces,
      moved: false,
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
   * Where a dragged material would land, in surface cm plus the world position
   * that surface point means.
   *
   * One function serves both the live preview and the actual drop, so the ghost
   * can never disagree with the placed piece. The piece is centred on the
   * cursor using its size *in the current view* — using `m.h` in plan put a
   * 300 cm panel 150 cm away from the pointer, and using the plan depth in an
   * elevation would do the same thing vertically.
   */
  const dropPosition = useCallback((material: Material, clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return null;
    const s = useEditorStore.getState();
    const r = el.getBoundingClientRect();
    const view = s.surfaceView;

    // Size on the surface: a probe piece at the origin, projected.
    const probe: Piece = { id: '', materialId: material.id, x: 0, y: 0, rot: 0, z: 0 };
    const box = projectPiece(probe, material, view);
    const pw = box.w;
    const ph = box.h;

    let u = snapValue((clientX - r.left - s.panX) / s.zoom - pw / 2, s.snapStep, s.snap);
    let v = snapValue((clientY - r.top - s.panY) / s.zoom - ph / 2, s.snapStep, s.snap);
    let guideX: number | null = null;
    let guideY: number | null = null;

    // Butt the new piece against whatever is already there, same as dragging.
    if (s.edgeSnap) {
      const lookup = new Map(s.materials.map((mm) => [mm.id, mm]));
      const targets = s.pieces
        .map((p) => {
          const mm = lookup.get(p.materialId);
          return mm ? projectPiece(p, mm, view) : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null);
      const snap = computeEdgeSnap({ x: u, y: v, w: pw, h: ph }, targets, 8 / s.zoom);
      u += snap.dx;
      v += snap.dy;
      guideX = snap.guideX;
      guideY = snap.guideY;
    }

    if (view === 'plan') {
      return { u, v, w: pw, h: ph, world: { x: u, y: v, z: 0 }, guideX, guideY };
    }

    /**
     * An elevation says nothing about the axis it looks along, so that one has
     * to be chosen. The middle of what is already placed is the least
     * surprising answer: the piece lands inside the assembly being worked on
     * rather than at the origin, which on a drawing laid out away from 0,0
     * would drop it somewhere off in the distance.
     */
    const hidden = hiddenAxisDefault(s.pieces, s.materials, view);
    // projectPiece puts the TOP edge at -(z + height), so invert that.
    const z = Math.max(0, -v - material.h);
    return view === 'front'
      ? { u, v, w: pw, h: ph, world: { x: u, y: hidden, z }, guideX, guideY }
      : { u, v, w: pw, h: ph, world: { x: hidden, y: u, z }, guideX, guideY };
  }, []);

  const onDragOver = useCallback(
    (e: ReactDragEvent) => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'copy';
      const s = useEditorStore.getState();
      const material = s.materials.find((m) => m.id === s.draggingMaterialId);
      if (!material) return;
      const at = dropPosition(material, e.clientX, e.clientY);
      if (at) setGhost({ material, x: at.u, y: at.v, w: at.w, h: at.h });
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
      if (at) s.addPiece(material.id, at.world.x, at.world.y, at.world.z);
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
        {/* An elevation is drawn above the ground line, at negative surface y,
            so the grid has to reach up there too. */}
        <div
          className="grid"
          style={{
            width: WORLD_W,
            height: WORLD_H,
            top: elevation ? -WORLD_H / 2 : 0,
          }}
        />

        {/* Ground level. In an elevation this is the slab everything stands on,
            and the one line that makes a height readable at a glance. */}
        {elevation && <div className="ground-line" style={{ width: WORLD_W }} />}

        {/* Live drop preview: exactly where the piece will land, snapping included. */}
        {ghost && (
          <div
            className="ghost"
            style={{ left: ghost.x, top: ghost.y, width: ghost.w, height: ghost.h }}
          >
            {!elevation && (
              <ShapeSvg
                material={ghost.material}
                width={ghost.w}
                height={ghost.h}
                strokeWidth={1 / zoom}
              />
            )}
          </div>
        )}
        {pieces.map((piece) => {
          const material = byId.get(piece.materialId);
          if (!material) return null;
          return elevation ? (
            <ElevationPieceView
              key={piece.id}
              piece={piece}
              material={material}
              selected={selected.has(piece.id)}
              view={surfaceView}
              rank={ranks.get(piece.id) ?? 0}
              onPointerDown={onPiecePointerDown}
            />
          ) : (
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

      {/* Labels are measured off the plan footprint, so they would sit in the
          wrong place over an elevation. */}
      {!elevation && <LabelLayer />}

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

      {elevation && <div className="surface-hint">{VIEW_HINT[surfaceView]}</div>}
    </main>
  );
}
