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
import type { Material, Piece, SketchPath } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import {
  computeEdgeSnap,
  findOverlaps,
  pieceBounds,
  planH,
  planW,
  snapValue,
  unionRect,
  WORLD_H,
  WORLD_W,
} from '../lib/geometry';
import {
  allGaps,
  componentThatFits,
  faceBands,
  isFace,
  nearestGap,
  voidKey,
  type Gap,
  type GapRect,
} from '../lib/gap';
import {
  depthRanks,
  hiddenSpan,
  isElevation,
  projectPiece,
  VIEW_HINT,
  type ViewAxis,
} from '../lib/projection';
import {
  closestOnLeg,
  orthogonal,
  segmentAt,
  segments,
  snapToSketch,
  type SegmentHit,
} from '../lib/sketch';
import { createWheelClassifier } from '../lib/wheelInput';
import { PieceView } from './PieceView';
import { ElevationPieceView } from './ElevationPieceView';
import { ShapeSvg } from './ShapeSvg';
import { LabelLayer } from './LabelLayer';
import { Rulers } from './Rulers';
import { EmptyDrawing } from './EmptyDrawing';
import { GapMark } from './GapMark';
import { SketchLayer } from './SketchLayer';

/** What the pointer is currently doing on the stage. */
type Interaction =
  | { type: 'pan'; sx: number; sy: number; px: number; py: number }
  | { type: 'move'; sx: number; sy: number; baseline: Piece[]; moved: boolean }
  | { type: 'marquee'; sx: number; sy: number }
  | {
      type: 'sketch';
      sx: number;
      sy: number;
      hit: SegmentHit;
      baseline: SketchPath;
      /** every selected run as it was, when the whole layout is being slid */
      baselines: SketchPath[] | null;
      moved: boolean;
    }
  | null;

/** A press has to travel this far before it counts as a drag rather than a click. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Hold a drag to one axis while Shift is down.
 *
 * Whichever way it has travelled further wins, and the other component is
 * dropped — so a panel slid along a wall stays on the wall, instead of creeping
 * a centimetre off it on the way. Decided from the running total rather than
 * from the last mouse event, so the axis does not flip about while the hand
 * wobbles; committing to across or down and staying there is the whole point.
 *
 * Read live on every move, so Shift can be taken hold of part-way through a
 * drag and let go of again — which is how it is used: free to get near, then
 * straight to finish.
 */
export function straighten(dx: number, dy: number, on: boolean): { dx: number; dy: number } {
  if (!on) return { dx, dy };
  return Math.abs(dx) >= Math.abs(dy) ? { dx, dy: 0 } : { dx: 0, dy };
}

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
  /** Where the pen's next vertex would land, for the rubber-band preview. */
  const [penHover, setPenHover] = useState<{ x: number; y: number } | null>(null);
  /**
   * The part of the layout under the pointer, and where a new junction would go.
   *
   * Held here rather than in the store: it changes on every mouse move, and a
   * layout is not edited by the pointer passing over it.
   */
  const [sketchHover, setSketchHover] = useState<SegmentHit | null>(null);
  const [addAt, setAddAt] = useState<{ x: number; y: number } | null>(null);
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
  const tool = useEditorStore((s) => s.tool);
  const sketch = useEditorStore((s) => s.sketch);
  const penPoints = useEditorStore((s) => s.penPoints);
  const showSketch = useEditorStore((s) => s.showSketch);
  const showGaps = useEditorStore((s) => s.showGaps);
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

  /**
   * Every face piece as the gap check sees it.
   *
   * Only the face. A waler crossing behind a panel, a tie rod through it, a
   * prop holding it up — none of those leave a hole the concrete escapes
   * through, so the clear air between them and a panel is not a gap and must
   * not be offered a filler.
   */
  const faceRects = useMemo(() => {
    const out: Array<GapRect & { id: string }> = [];
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (!isFace(m) || !m) continue;
      const rect = projectPiece(p, m, surfaceView);
      out.push({
        ...rect,
        id: p.id,
        // The real height and the distance away from the camera both ride
        // along: a plan view projects a 90×300 panel to 90×9, so neither the
        // 300 that decides whether a filler fits nor the lift it stands on
        // survives the projection.
        heightCm: m.h,
        span: hiddenSpan(p, m, surfaceView),
        bands: faceBands(rect, m, p.rot, elevation),
      });
    }
    return out;
  }, [pieces, byId, surfaceView, elevation]);

  const withFill = useCallback(
    (g: Gap): Gap => ({ ...g, fill: componentThatFits(g.size, materials, g.againstHeight) }),
    [materials],
  );

  /**
   * The leftover beside whatever is selected.
   *
   * This is the number that decides a formwork run — you butt panels along a
   * wall until they stop fitting, and what is left has to be closed with a
   * filler or cut on site. Derived rather than tracked, so it is there while
   * dragging and still there after letting go.
   */
  const gap = useMemo(() => {
    if (!selectedIds.length) return null;
    const moving = faceRects.filter((r) => selected.has(r.id));
    const movingBox = unionRect(moving);
    if (!movingBox) return null;
    // The union of several courses spans all of them, which would defeat the
    // same-course test — so a multi-piece selection reports a gap only for the
    // range it actually occupies.
    const span: [number, number] = [
      Math.min(...moving.map((r) => r.span![0])),
      Math.max(...moving.map((r) => r.span![1])),
    ];
    // The union's own footprint says nothing about which planes it lies in —
    // several courses of a run stack into a box of any shape — so the selection
    // presents every plane its members do, and is measured against each.
    const found = nearestGap(
      {
        ...movingBox,
        span,
        bands: moving.some((r) => !r.bands)
          ? undefined
          : moving.flatMap((r) => r.bands ?? []),
      },
      faceRects.filter((r) => !selected.has(r.id)),
    );
    return found ? withFill(found) : null;
  }, [faceRects, selected, selectedIds.length, elevation, withFill]);

  /**
   * Every open hole at once — the pre-order check, behind its own toggle.
   *
   * Minus the one beside the selection, which is already drawn in full: left
   * in, it shaded the same void twice and stacked a bare number on top of the
   * part name.
   */
  const everyGap = useMemo(() => {
    if (!showGaps) return [];
    const selectedKey = gap && voidKey(gap);
    return allGaps(faceRects)
      .filter((g) => voidKey(g) !== selectedKey)
      .map(withFill);
  }, [showGaps, faceRects, withFill, gap]);

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
        const raw = { dx: e.clientX - it.sx, dy: e.clientY - it.sy };
        if (!it.moved) {
          if (Math.hypot(raw.dx, raw.dy) < DRAG_THRESHOLD_PX) return;
          // Opened on the first real movement rather than on the press, so
          // clicking around to inspect pieces does not fill the undo history
          // with steps that changed nothing.
          s.beginDrag();
          it.moved = true;
        }
        const { dx, dy } = straighten(raw.dx, raw.dy, e.shiftKey);
        // Screen delta → surface delta is just a division by the zoom.
        s.moveSelectionBy(dx / s.zoom, dy / s.zoom, it.baseline);
        return;
      }
      if (it.type === 'sketch') {
        const raw = { dx: e.clientX - it.sx, dy: e.clientY - it.sy };
        if (!it.moved) {
          if (Math.hypot(raw.dx, raw.dy) < DRAG_THRESHOLD_PX) return;
          s.beginDrag();
          it.moved = true;
        }
        const { dx, dy } = straighten(raw.dx, raw.dy, e.shiftKey);
        if (it.baselines) s.dragSketchAll(dx / s.zoom, dy / s.zoom, it.baselines);
        else s.dragSketch(it.hit, dx / s.zoom, dy / s.zoom, it.baseline);
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

            /**
             * The rubber band catches drawn lines too.
             *
             * It is the only way to take hold of a whole layout at once — and
             * moving the layout, rather than one wall of it, is the thing
             * anybody does after setting a drawing out in the wrong place.
             * Plan only: in an elevation the lines are not what is on screen.
             */
            if (s.showSketch && !isElevation(s.surfaceView)) {
              const caught = s.sketch
                .filter((k) =>
                  k.points.some(
                    (pt) => pt.x >= wx && pt.x <= wx + ww && pt.y >= wy && pt.y <= wy + wh,
                  ),
                )
                .map((k) => k.id);
              s.selectSketchMany(caught);
            }
          }
        }
        setMarquee(null);
      }
      if ((it?.type === 'move' || it?.type === 'sketch') && it.moved) {
        useEditorStore.getState().endDrag();
      }
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

      // While the pen is drawing it owns these keys outright: Backspace has to
      // walk back a vertex rather than delete the selection, and Escape has to
      // abandon the path rather than clear a selection that is not the point.
      if (s.tool === 'pen' && !mod) {
        if (e.key === 'Escape') {
          e.preventDefault();
          if (s.penPoints.length) s.penCancel();
          else s.setTool('select');
          return;
        }
        if (e.key === 'Enter') {
          e.preventDefault();
          s.penFinish();
          return;
        }
        if (e.key === 'Backspace' || e.key === 'Delete') {
          e.preventDefault();
          s.penUndoPoint();
          return;
        }
      }

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
        // A junction is picked out of a run, so deleting means taking it out —
        // not throwing away the wall it was a corner of.
        const part = s.selectedSketchPart;
        if (part?.kind === 'vertex' && !s.selectedIds.length) {
          s.removeSketchVertex(part.pathId, part.index);
        } else {
          s.deleteSelected();
        }
        e.preventDefault();
      }
      if (e.key === 'Escape') {
        s.setSelection([]);
        s.selectSketch(null);
      }
      /**
       * The two tools, each on its own key rather than sharing a toggle.
       *
       * A toggle makes the key mean different things depending on a mode you
       * cannot see from the keyboard, so you press it and find out. One key per
       * tool always lands where it says, which is what makes it usable without
       * looking. `code` first so the physical key works on a Georgian layout.
       */
      if (e.code === 'KeyG' || e.key.toLowerCase() === 'g') s.setTool('pen');
      if (e.code === 'KeyV' || e.key.toLowerCase() === 'v') s.setTool('select');
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

  /** Pointer position in plan world cm. */
  const worldAt = useCallback((clientX: number, clientY: number) => {
    const el = stageRef.current;
    if (!el) return null;
    const s = useEditorStore.getState();
    const r = el.getBoundingClientRect();
    return {
      x: (clientX - r.left - s.panX) / s.zoom,
      y: (clientY - r.top - s.panY) / s.zoom,
    };
  }, []);

  /**
   * Where the next vertex would go: square to the last one, then on the grid.
   *
   * That order matters. Snapping first and squaring after can move the point
   * off the grid again, because squaring replaces one coordinate with the
   * previous vertex's — which is only on the grid if that one was.
   */
  const penTarget = useCallback(
    (clientX: number, clientY: number, free = false) => {
      const at = worldAt(clientX, clientY);
      if (!at) return null;
      const s = useEditorStore.getState();
      /**
       * A layout lands on whole centimetres at worst.
       *
       * With the grid off nothing rounded at all, so the pointer's own position
       * — a screen pixel divided by the zoom — became the wall length, and a leg
       * drawn as 180 was stored as 180.2. Nobody dimensions a wall to a fifth of
       * a millimetre.
       */
      const step = s.snap ? Math.max(s.snapStep, 1) : 1;
      const round = (v: number) => Math.round(v / step) * step;

      /**
       * Meeting the layout beats everything else.
       *
       * Ahead of the grid and ahead of the right-angle lock, both on purpose: a
       * run drawn to join another one is trying to JOIN it, and a wall that
       * lands two centimetres off is not a wall that meets. Landing on a round
       * number matters less than landing on the thing you aimed at.
       */
      if (s.showSketch) {
        const onto = snapToSketch(s.sketch, at, 10 / s.zoom);
        if (onto) return onto.point;
      }

      const last = s.penPoints[s.penPoints.length - 1];
      if (!last) return { x: round(at.x), y: round(at.y) };

      /**
       * A leg that does not have to lie on an axis.
       *
       * Both ends still land on whole centimetres, so the run is dimensioned
       * even though its length is now a diagonal and rarely a round number.
       * Nothing downstream can build it — the generator says so rather than
       * guessing — but a layout has to be able to describe the wall that is
       * actually there before anyone can decide what to do about it.
       */
      if (free || !s.orthoLock) return { x: round(at.x), y: round(at.y) };

      /**
       * Round the LENGTH of the leg, not the coordinate it ends at.
       *
       * The same thing while the run starts on the grid, and the only one of
       * the two that keeps a dimension round once it does not: rounding the
       * coordinate measures the leg from wherever the previous vertex happened
       * to land, so an off-grid start made every leg after it off-grid too. The
       * shared coordinate is carried across untouched, so the leg stays exactly
       * square rather than nearly.
       */
      const squared = orthogonal(last, at);
      const across = squared.y === last.y;
      const length = round(across ? squared.x - last.x : squared.y - last.y);
      return across
        ? { x: last.x + length, y: last.y }
        : { x: last.x, y: last.y + length };
    },
    [worldAt],
  );

  const onStagePointerDown = useCallback((e: ReactPointerEvent) => {
    const s = useEditorStore.getState();

    // ── the pen owns the surface while it is active ──
    if (s.tool === 'pen' && e.button === 0 && !spaceRef.current) {
      e.preventDefault();

      // Nothing drawn yet and the pointer is on a line: put a junction there.
      // Mid-run the click has to mean "next vertex", or a run could not be
      // drawn across one already on the drawing.
      if (!s.penPoints.length) {
        const world = worldAt(e.clientX, e.clientY);
        const over = world && s.showSketch ? segmentAt(s.sketch, world, 7 / s.zoom) : null;
        // On a junction, the run simply starts there — `penTarget` has already
        // snapped the point onto it exactly, so the two are joined and not
        // merely touching.
        if (world && over && over.vertex === undefined) {
          const path = s.sketch.find((k) => k.id === over.pathId);
          const leg = path && segments(path)[over.index];
          if (leg) {
            s.insertSketchVertex(over.pathId, over.index, closestOnLeg(leg[0], leg[1], world));
            setAddAt(null);
            return;
          }
        }
      }

      const at = penTarget(e.clientX, e.clientY, e.altKey);
      if (!at) return;
      // Landing back on the first vertex closes the loop, which is how a room
      // outline gets drawn without a separate command for it.
      const first = s.penPoints[0];
      const closes =
        s.penPoints.length > 2 &&
        first &&
        Math.hypot(at.x - first.x, at.y - first.y) * s.zoom < 10;
      if (closes) s.penFinish(true);
      else s.penAddPoint(at.x, at.y);
      return;
    }

    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      interaction.current = { type: 'pan', sx: e.clientX, sy: e.clientY, px: s.panX, py: s.panY };
      setPanning(true);
      return;
    }
    if (e.button !== 0) return;

    // A drawn line has no area, so it is picked by proximity rather than by
    // being hit. Tolerance is a screen distance turned back into world cm, so
    // it feels the same at every zoom.
    const world = worldAt(e.clientX, e.clientY);
    // Hidden means gone: a line nobody can see must not take the click that
    // was meant for the panel sitting on top of it.
    if (world && s.showSketch && !isElevation(s.surfaceView)) {
      const grab = segmentAt(s.sketch, world, 7 / s.zoom);
      const path = grab && s.sketch.find((k) => k.id === grab.pathId);
      if (grab && path) {
        /**
         * Whether this drag moves the whole layout or one part of it.
         *
         * Grabbing a run that is already part of a bigger selection moves all
         * of them — that is what selecting several was for. Alt does the same
         * for a single run, so a wall can be slid without first selecting it in
         * some other way.
         */
        const many = s.selectedSketchIds.length > 1 && s.selectedSketchIds.includes(path.id);
        const whole = many || e.altKey;
        if (!many) {
          s.selectSketch(path.id, e.shiftKey);
          s.selectSketchPart(
            whole
              ? null
              : {
                  pathId: path.id,
                  kind: grab.vertex !== undefined ? 'vertex' : 'leg',
                  index: grab.vertex ?? grab.index,
                },
          );
        }
        // Selecting and grabbing are the same press: a layout is adjusted by
        // pushing a wall, and asking for a click first would only be ceremony.
        interaction.current = {
          type: 'sketch',
          sx: e.clientX,
          sy: e.clientY,
          hit: grab,
          baseline: path,
          baselines: many
            ? s.sketch.filter((k) => s.selectedSketchIds.includes(k.id))
            : whole
              ? [path]
              : null,
          moved: false,
        };
        return;
      }
    }

    // Empty-surface press: clear the selection and start a rubber band.
    const rect = stageRef.current?.getBoundingClientRect();
    if (!rect) return;
    if (!e.shiftKey) {
      s.setSelection([]);
      s.selectSketch(null);
    }
    interaction.current = {
      type: 'marquee',
      sx: e.clientX - rect.left,
      sy: e.clientY - rect.top,
    };
  }, [penTarget, worldAt]);

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

  const cursor = panning
    ? 'grabbing'
    : spaceDown
      ? 'grab'
      : tool === 'pen'
        ? 'crosshair'
        : 'default';

  return (
    <main
      ref={stageRef}
      className={`stage${tool === 'pen' ? ' drawing' : ''}`}
      style={{ cursor }}
      onPointerDown={onStagePointerDown}
      onPointerMove={(e) => {
        if (interaction.current) return;
        const s = useEditorStore.getState();
        const live = s.showSketch && !isElevation(s.surfaceView);
        const world = live ? worldAt(e.clientX, e.clientY) : null;
        const over = world ? segmentAt(s.sketch, world, 7 / s.zoom) : null;
        setSketchHover(over);

        // On a leg with the pen out, show the junction that a click would add,
        // sitting on the line rather than under the cursor — it is going ON the
        // wall, and it should look like it before it is committed.
        if (tool === 'pen' && world && over && over.vertex === undefined) {
          const path = s.sketch.find((k) => k.id === over.pathId);
          const leg = path && segments(path)[over.index];
          setAddAt(leg ? closestOnLeg(leg[0], leg[1], world) : null);
        } else {
          setAddAt(null);
        }

        if (tool !== 'pen') return;
        setPenHover(penTarget(e.clientX, e.clientY, e.altKey));
      }}
      onPointerLeave={() => {
        setPenHover(null);
        setSketchHover(null);
        setAddAt(null);
      }}
      onDoubleClick={(e) => {
        // Finishing an open run, the way every polyline tool ends one.
        if (tool !== 'pen') return;
        e.preventDefault();
        useEditorStore.getState().penFinish();
      }}
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

        {/* The drawn layout, under everything: the formwork is set out to it. */}
        {!elevation && showSketch && (
          <SketchLayer
            worldW={WORLD_W}
            worldH={WORLD_H}
            top={0}
            preview={tool === 'pen' ? penHover : null}
          hover={sketchHover}
          addAt={addAt}
          />
        )}

        {/* Live drop preview: exactly where the piece will land, snapping included. */}
        {ghost && (
          <div
            className="drop-ghost"
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

      {/* Open gaps, in screen space so the strokes stay one pixel and the text
          stays readable at any zoom. Amber, because an unclosed gap is
          provisional — the drawing is not finished while it is there. */}
      {everyGap.map((g, i) => (
        <GapMark
          key={`all-${i}`}
          gap={g}
          zoom={zoom}
          panX={panX}
          panY={panY}
          detailed={false}
        />
      ))}
      {gap && <GapMark gap={gap} zoom={zoom} panX={panX} panY={panY} />}

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

      {/* A drawn layout is not an empty drawing. Someone who has set the walls
          out has started; putting a "nothing here yet" card over their lines
          would be the app disagreeing with what is plainly on screen. */}
      {pieces.length === 0 && sketch.length === 0 && penPoints.length === 0 && <EmptyDrawing />}

      {elevation && <div className="surface-hint">{VIEW_HINT[surfaceView]}</div>}
    </main>
  );
}
