import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HiddenLineMode, Piece } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { useCanEditDrawings } from '../store/useAuthStore';
import {
  canDragOnGround,
  canDragOnHeight,
  contentBounds3,
  DEFAULT_CAMERA,
  dragOnGround,
  dragOnHeight,
  faceShade,
  fitZoom,
  isFrontFacing,
  piecePrism,
  project,
  type Camera,
  type Vec3,
} from '../lib/iso3d';
import {
  classifyEdge,
  createRaster,
  fillFace,
  pickAt,
  rasterMatches,
  resetRaster,
  type DepthRaster,
  type EdgeRun,
  type Rgb,
  type ScreenPoint,
} from '../lib/raster3d';
import { createWheelClassifier } from '../lib/wheelInput';
import { Icon } from './Icon';

/** Darken/lighten a #rrggbb by a 0..1+ factor. */
function shade(hex: string, factor: number): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor))) : 128;
  return { r: channel(16), g: channel(8), b: channel(0) };
}

const ACCENT = { r: 245, g: 166, b: 35 };
const ACCENT_CSS = '#f5a623';

/** Pull a colour toward the accent so a selected piece reads at a glance. */
function tint(base: Rgb, amount: number): Rgb {
  return {
    r: Math.round(base.r + (ACCENT.r - base.r) * amount),
    g: Math.round(base.g + (ACCENT.g - base.g) * amount),
    b: Math.round(base.b + (ACCENT.b - base.b) * amount),
  };
}

const HIDDEN_LINE_LABEL: Record<HiddenLineMode, string> = {
  hide: 'ფარული ხაზები — დამალული',
  dashed: 'ფარული ხაზები — წყვეტილი',
  show: 'ფარული ხაზები — გამჭვირვალე',
};

/** Which way a drag moves the selection. */
type MoveAxis = 'ground' | 'height';

const AXIS_LABEL: Record<MoveAxis, string> = {
  ground: 'გეგმაზე',
  height: 'სიმაღლეზე',
};

type Gesture =
  | { kind: 'orbit'; x: number; y: number }
  | { kind: 'pan'; x: number; y: number }
  | {
      kind: 'move';
      /** where the drag started, so the delta is always against the origin */
      startX: number;
      startY: number;
      x: number;
      y: number;
      baseline: Piece[];
      axis: MoveAxis;
      /** true once the pointer has travelled far enough to count as a drag */
      moved: boolean;
      /** the piece under the cursor when the gesture began */
      hitId: string;
      /** it was already part of the selection before this press */
      wasSelected: boolean;
    };

/** A press has to travel this far before it stops counting as a click. */
const DRAG_THRESHOLD_PX = 3;

/**
 * Editable 3D view.
 *
 * The 2D surface is a plan, so it can only ever show footprints and it cannot
 * show elevation at all — two pieces on different courses sit exactly on top of
 * each other there. This view extrudes every piece to its real height and lets
 * the selection be picked up and moved, including up and down, which is the
 * only place that last part is possible.
 *
 * Rendering goes through a software depth buffer rather than sorting faces:
 * see `lib/raster3d.ts` for why sorting cannot get formwork right. Picking
 * reads that same buffer, so what gets selected is exactly what is visible.
 */
export function View3D() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const hiddenLines = useEditorStore((s) => s.hiddenLines);
  const setHiddenLines = useEditorStore((s) => s.setHiddenLines);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const setSelection = useEditorStore((s) => s.setSelection);
  const toggleSelect = useEditorStore((s) => s.toggleSelect);
  const canEdit = useCanEditDrawings();

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wheel = useRef(createWheelClassifier());
  const gesture = useRef<Gesture | null>(null);
  const rasterRef = useRef<DepthRaster | null>(null);
  const blitRef = useRef<HTMLCanvasElement | null>(null);
  /** Piece ids in the order they were stamped into the pick buffer. */
  const pickMap = useRef<string[]>([]);
  const spaceDown = useRef(false);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [centre, setCentre] = useState<Vec3>({ x: 0, y: 0, z: 0 });
  const [axis, setAxis] = useState<MoveAxis>('ground');
  const [blocked, setBlocked] = useState<string | null>(null);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const selectedSet = useMemo(() => new Set(selectedIds), [selectedIds]);

  const fit = useCallback(() => {
    const result = fitZoom(pieces, byId, cam, size.w, size.h);
    if (!result) return;
    setZoom(result.zoom);
    setCentre(result.centre);
    setPan({ x: 0, y: 0 });
  }, [pieces, byId, cam, size.w, size.h]);

  // Frame the model on entry and whenever pieces are added or removed. Not on
  // every change: refitting mid-drag would move the model under the cursor.
  useEffect(() => {
    const result = fitZoom(pieces, byId, DEFAULT_CAMERA, size.w, size.h);
    if (!result) return;
    setZoom(result.zoom);
    setCentre(result.centre);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces.length, size.w, size.h]);

  /** The axis a drag would use right now, Alt flipping it for one gesture. */
  const axisFor = useCallback(
    (altKey: boolean): MoveAxis => {
      if (!altKey) return axis;
      return axis === 'ground' ? 'height' : 'ground';
    },
    [axis],
  );

  // The camera can be pointed somewhere that cannot express the movement being
  // asked for. Say so up front rather than at the moment of a dead drag.
  const axisUnavailable = useMemo(() => {
    if (axis === 'ground' && !canDragOnGround(cam)) {
      return 'გეგმაზე გადასაწევად ხედი დახარე — თითქმის გვერდიდან ვერ გაირჩევა.';
    }
    if (axis === 'height' && !canDragOnHeight(cam)) {
      return 'სიმაღლეზე გადასაწევად ხედი დახარე — ზუსტად ზემოდან სიმაღლე არ ჩანს.';
    }
    return null;
  }, [axis, cam]);

  // A refusal describes one camera angle, so tilting the view or picking the
  // other axis answers it. Without this the complaint outlives the problem.
  useEffect(() => {
    setBlocked(null);
  }, [cam, axis]);

  // ── Viewport size ────────────────────────────────────────────────────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const publish = () => {
      const r = el.getBoundingClientRect();
      setSize({ w: Math.max(1, r.width), h: Math.max(1, r.height) });
    };
    publish();
    const ro = new ResizeObserver(publish);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // ── Wheel: same trackpad/mouse auto-detection as the 2D canvas ──────────
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const action = wheel.current.classify(e, el.clientHeight);
      if (action.kind === 'zoom') {
        setZoom((z) => Math.max(0.02, Math.min(40, z * action.factor)));
      } else {
        setPan((p) => ({ x: p.x - action.dx, y: p.y - action.dy }));
      }
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, []);

  // ── Keyboard ─────────────────────────────────────────────────────────────
  // The 2D canvas owns the app's shortcuts and is unmounted while this view is
  // showing, so the few that make sense in 3D are bound here. Arrow up/down is
  // elevation, which is the one thing the plan view cannot offer.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (target && /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName)) return;
      const s = useEditorStore.getState();

      if (e.code === 'Space' && !spaceDown.current) {
        spaceDown.current = true;
        e.preventDefault();
        return;
      }

      if (e.metaKey || e.ctrlKey) {
        switch (e.code) {
          case 'KeyZ':
            e.preventDefault();
            if (e.shiftKey) s.redo();
            else s.undo();
            return;
          case 'KeyD':
            e.preventDefault();
            s.duplicateSelected();
            return;
          case 'KeyA':
            e.preventDefault();
            s.selectAll();
            return;
          default:
            return;
        }
      }

      if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        if (!s.selectedIds.length) return;
        e.preventDefault();
        const step = e.shiftKey ? 1 : s.snap ? s.snapStep : 1;
        s.nudgeElevation(e.key === 'ArrowUp' ? step : -step);
        return;
      }

      if (e.code === 'KeyR' || e.key.toLowerCase() === 'r') s.rotateSelected();
      if (e.key === 'Delete' || e.key === 'Backspace') {
        e.preventDefault();
        s.deleteSelected();
      }
      if (e.key === 'Escape') s.setSelection([]);
    };
    const onKeyUp = (e: KeyboardEvent) => {
      if (e.code === 'Space') spaceDown.current = false;
    };
    window.addEventListener('keydown', onKeyDown);
    window.addEventListener('keyup', onKeyUp);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('keyup', onKeyUp);
    };
  }, []);

  // ── Pointer: orbit, pan, and moving the selection ───────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const g = gesture.current;
      if (!g) return;

      if (g.kind === 'move') {
        const totalX = e.clientX - g.startX;
        const totalY = e.clientY - g.startY;
        if (!g.moved && Math.hypot(totalX, totalY) < DRAG_THRESHOLD_PX) return;
        if (!g.moved) {
          // Opened here rather than on press, so clicking around to inspect
          // pieces does not fill the undo stack with steps that changed
          // nothing.
          useEditorStore.getState().beginDrag();
          g.moved = true;
        }

        const delta =
          g.axis === 'height'
            ? (() => {
                const dz = dragOnHeight(totalY, cam, zoom);
                return dz === null ? null : { dx: 0, dy: 0, dz };
              })()
            : (() => {
                const ground = dragOnGround(totalX, totalY, cam, zoom);
                return ground === null ? null : { ...ground, dz: 0 };
              })();

        if (!delta) {
          setBlocked(
            g.axis === 'height'
              ? 'ამ კუთხიდან სიმაღლე არ ჩანს — ხედი დახარე.'
              : 'ამ კუთხიდან გეგმა არ ჩანს — ხედი დახარე.',
          );
          return;
        }
        useEditorStore
          .getState()
          .moveSelectionSpatially(delta.dx, delta.dy, delta.dz, g.baseline);
        return;
      }

      const dx = e.clientX - g.x;
      const dy = e.clientY - g.y;
      g.x = e.clientX;
      g.y = e.clientY;

      if (g.kind === 'pan') {
        setPan((p) => ({ x: p.x + dx, y: p.y + dy }));
        return;
      }
      setCam((c) => ({
        azimuth: c.azimuth - dx * 0.008,
        // Clamped to the upper hemisphere: the eye stays above the ground, so
        // the assembly is never seen from underneath.
        elevation: Math.max(0.05, Math.min(Math.PI / 2, c.elevation + dy * 0.006)),
      }));
    };

    const onUp = () => {
      const g = gesture.current;
      gesture.current = null;
      if (!g || g.kind !== 'move') return;

      if (g.moved) {
        useEditorStore.getState().endDrag();
        return;
      }
      // A click, not a drag. Pressing on a piece that was already part of a
      // multi-selection must not shrink it — otherwise a group could never be
      // picked up — so the narrowing happens here, on release.
      if (g.wasSelected) setSelection([g.hitId]);
    };

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    return () => {
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
    };
  }, [cam, zoom, setSelection]);

  const onPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (e.button !== 0 && e.button !== 1) return;
    setBlocked(null);

    if (e.button === 1 || spaceDown.current) {
      gesture.current = { kind: 'pan', x: e.clientX, y: e.clientY };
      return;
    }

    const raster = rasterRef.current;
    const rect = e.currentTarget.getBoundingClientRect();
    const hitIndex = raster ? pickAt(raster, e.clientX - rect.left, e.clientY - rect.top) : -1;
    const hitId = hitIndex >= 0 ? pickMap.current[hitIndex] : undefined;

    if (!hitId) {
      // Empty space: clear the selection and orbit.
      if (!e.shiftKey && selectedIds.length) setSelection([]);
      gesture.current = { kind: 'orbit', x: e.clientX, y: e.clientY };
      return;
    }

    if (e.shiftKey) {
      toggleSelect(hitId);
      gesture.current = { kind: 'orbit', x: e.clientX, y: e.clientY };
      return;
    }

    const wasSelected = selectedSet.has(hitId);
    if (!canEdit) {
      // A viewer may still inspect what a piece is; they just cannot move it.
      setSelection([hitId]);
      gesture.current = { kind: 'orbit', x: e.clientX, y: e.clientY };
      return;
    }
    if (!wasSelected) setSelection([hitId]);

    const state = useEditorStore.getState();
    gesture.current = {
      kind: 'move',
      startX: e.clientX,
      startY: e.clientY,
      x: e.clientX,
      y: e.clientY,
      // The selection the store will have once React flushes the click above.
      baseline: state.pieces,
      axis: axisFor(e.altKey),
      moved: false,
      hitId,
      wasSelected,
    };
  };

  // ── Render ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = Math.round(size.w * dpr);
    canvas.height = Math.round(size.h * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#20252b';
    ctx.fillRect(0, 0, size.w, size.h);

    // world → screen
    const originX = size.w / 2 + pan.x;
    const originY = size.h / 2 + pan.y;
    const toScreen = (p: Vec3): ScreenPoint => {
      const q = project({ x: p.x - centre.x, y: p.y - centre.y, z: p.z - centre.z }, cam);
      return { x: originX + q.x * zoom, y: originY + q.y * zoom, depth: q.depth };
    };

    const bounds = contentBounds3(pieces, byId);
    if (!bounds) {
      pickMap.current = [];
      ctx.fillStyle = '#9aa4b1';
      ctx.font = '14px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('ზედაპირი ცარიელია — 2D-ში განათავსე მასალა', size.w / 2, size.h / 2);
      return;
    }

    // The grid goes down first so the solid model simply covers what it hides.
    drawGround(ctx, bounds, toScreen);

    // Faces at a slightly coarser resolution than the canvas: the crisp vector
    // edges drawn afterwards carry the definition, so this is invisible in
    // practice and keeps orbiting smooth on a large assembly.
    const scale = Math.min(dpr, 1.5);
    let raster = rasterRef.current;
    if (rasterMatches(raster, size.w, size.h, scale)) {
      resetRaster(raster);
    } else {
      raster = createRaster(size.w, size.h, scale);
      rasterRef.current = raster;
    }

    // Every visible face into the depth buffer, plus the edges bounding them.
    const edges: Array<[ScreenPoint, ScreenPoint]> = [];
    const selectedEdges: Array<[ScreenPoint, ScreenPoint]> = [];
    const map: string[] = [];

    for (const piece of pieces) {
      const m = byId.get(piece.materialId);
      if (!m) continue;
      const pickId = map.length;
      map.push(piece.id);
      const chosen = selectedSet.has(piece.id);

      const { vertices, faces } = piecePrism(piece, m);
      const projected = vertices.map(toScreen);
      const stride = vertices.length;
      const seen = new Set<number>();

      for (const face of faces) {
        if (!isFrontFacing(vertices, face, cam)) continue;
        const lit = shade(m.color, faceShade(vertices, face));
        fillFace(raster, face.map((i) => projected[i]), chosen ? tint(lit, 0.4) : lit, pickId);
        for (let i = 0; i < face.length; i++) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          // Interior edges are shared by two visible faces; draw each once.
          const key = Math.min(a, b) * stride + Math.max(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          (chosen ? selectedEdges : edges).push([projected[a], projected[b]]);
        }
      }
    }
    pickMap.current = map;

    // Blit the shaded solid.
    const blit = blitRef.current ?? (blitRef.current = document.createElement('canvas'));
    blit.width = raster.w;
    blit.height = raster.h;
    const blitCtx = blit.getContext('2d');
    if (blitCtx) {
      blitCtx.putImageData(new ImageData(raster.rgba, raster.w, raster.h), 0, 0);
      ctx.imageSmoothingEnabled = true;
      ctx.drawImage(blit, 0, 0, size.w, size.h);
    }

    drawEdges(ctx, raster, edges, hiddenLines, zoom, 'rgba(10,13,17,.5)', 1);
    // Selected outlines last and heavier, so the selection survives being
    // surrounded by other pieces.
    drawEdges(ctx, raster, selectedEdges, hiddenLines, zoom, ACCENT_CSS, 1.8);
    drawHeightMarker(ctx, bounds, toScreen);
  }, [pieces, byId, cam, zoom, pan, centre, size, hiddenLines, selectedSet]);

  const hasPieces = pieces.length > 0;
  const hint = blocked ?? axisUnavailable;

  return (
    <main className="stage view3d" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block', touchAction: 'none' }}
        onPointerDown={onPointerDown}
      />

      <div className="view3d-bar">
        <button className="btn small" onClick={fit} disabled={!hasPieces} title="ჩატევა"><Icon name="fit" /> ცენტრი
        </button>
        <button
          className="btn small"
          onClick={() => setCam(DEFAULT_CAMERA)}
          title="საწყისი კუთხე — ხედი ზემოდან"
        ><Icon name="reset" /> კუთხე
        </button>
        <button
          className="btn small"
          onClick={() => setCam({ azimuth: 0, elevation: Math.PI / 2 })}
          title="ზუსტად ზემოდან — ემთხვევა 2D გეგმას"
        ><Icon name="grid" /> გეგმა
        </button>

        {canEdit && (
          <span className="view3d-axis" role="group" aria-label="გადაწევის მიმართულება">
            {(['ground', 'height'] as MoveAxis[]).map((a) => (
              <button
                key={a}
                className={`btn small${axis === a ? ' active' : ''}`}
                onClick={() => {
                  setAxis(a);
                  setBlocked(null);
                }}
                title={
                  a === 'ground'
                    ? 'თრევა გადაწევს გეგმაზე (Alt — სიმაღლეზე)'
                    : 'თრევა გადაწევს ზემოთ/ქვემოთ (Alt — გეგმაზე)'
                }
              >
                <Icon name={a === 'ground' ? 'array' : 'height'} /> {AXIS_LABEL[a]}
              </button>
            ))}
          </span>
        )}

        <select
          className="view3d-select"
          value={hiddenLines}
          onChange={(e) => setHiddenLines(e.target.value as HiddenLineMode)}
          title="რა მოუვიდეს ხაზებს, რომლებიც სხვა ელემენტის უკან რჩება"
        >
          {(['hide', 'dashed', 'show'] as HiddenLineMode[]).map((mode) => (
            <option key={mode} value={mode}>
              {HIDDEN_LINE_LABEL[mode]}
            </option>
          ))}
        </select>
        <span className={`view3d-hint${hint ? ' warn' : ''}`}>
          {hint ??
            (canEdit
              ? 'დაწკაპუნება — მონიშვნა · თრევა — გადაწევა · ცარიელზე თრევა — ბრუნვა'
              : 'თრევა — ბრუნვა · Space+თრევა — გადაწევა')}
        </span>
      </div>
    </main>
  );
}

/**
 * Outline every piece, testing each stretch of edge against the depth buffer so
 * lines running behind a panel can be dropped or dashed instead of drawn
 * through it.
 */
function drawEdges(
  ctx: CanvasRenderingContext2D,
  raster: DepthRaster,
  edges: Array<[ScreenPoint, ScreenPoint]>,
  mode: HiddenLineMode,
  zoom: number,
  colour: string,
  width: number,
): void {
  if (!edges.length) return;
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = width;

  const stroke = (runs: EdgeRun[]) => {
    ctx.beginPath();
    for (const run of runs) {
      ctx.moveTo(run.from.x, run.from.y);
      ctx.lineTo(run.to.x, run.to.y);
    }
    ctx.stroke();
  };

  // X-ray: no depth test at all, every edge solid.
  if (mode === 'show') {
    ctx.strokeStyle = colour;
    ctx.setLineDash([]);
    stroke(edges.map(([a, b]) => ({ from: a, to: b, visible: true })));
    return;
  }

  // An edge lies exactly on its own face, so the tolerance has to absorb the
  // depth that face gains over a pixel or two — otherwise pieces lose their
  // outlines entirely.
  const tolerance = 0.5 + 3 / Math.max(zoom, 0.02);

  const visible: EdgeRun[] = [];
  const hidden: EdgeRun[] = [];
  for (const [a, b] of edges) {
    for (const run of classifyEdge(raster, a, b, tolerance)) {
      (run.visible ? visible : hidden).push(run);
    }
  }

  if (mode === 'dashed' && hidden.length) {
    ctx.strokeStyle = colour === ACCENT_CSS ? 'rgba(245,166,35,.5)' : 'rgba(190,201,214,.42)';
    ctx.setLineDash([3, 4]);
    stroke(hidden);
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = colour;
  ctx.setLineDash([]);
  stroke(visible);
}

/** A 1 m ground grid under the model, so height has something to sit on. */
function drawGround(
  ctx: CanvasRenderingContext2D,
  bounds: { min: Vec3; max: Vec3 },
  toScreen: (p: Vec3) => { x: number; y: number },
): void {
  const step = 100;
  const pad = 100;
  const x0 = Math.floor((bounds.min.x - pad) / step) * step;
  const x1 = Math.ceil((bounds.max.x + pad) / step) * step;
  const y0 = Math.floor((bounds.min.y - pad) / step) * step;
  const y1 = Math.ceil((bounds.max.y + pad) / step) * step;

  ctx.strokeStyle = 'rgba(154,164,177,.22)';
  ctx.lineWidth = 1;
  ctx.setLineDash([]);
  ctx.beginPath();
  for (let x = x0; x <= x1; x += step) {
    const a = toScreen({ x, y: y0, z: 0 });
    const b = toScreen({ x, y: y1, z: 0 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  for (let y = y0; y <= y1; y += step) {
    const a = toScreen({ x: x0, y, z: 0 });
    const b = toScreen({ x: x1, y, z: 0 });
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
  }
  ctx.stroke();
}

/** Vertical rule at a rear corner, calling out the overall pour height. */
function drawHeightMarker(
  ctx: CanvasRenderingContext2D,
  bounds: { min: Vec3; max: Vec3 },
  toScreen: (p: Vec3) => { x: number; y: number },
): void {
  if (bounds.max.z <= 0) return;
  const at = { x: bounds.min.x - 40, y: bounds.min.y - 40 };
  const base = toScreen({ ...at, z: 0 });
  const top = toScreen({ ...at, z: bounds.max.z });

  ctx.strokeStyle = 'rgba(245,166,35,.85)';
  ctx.lineWidth = 1.5;
  ctx.setLineDash([]);
  ctx.beginPath();
  ctx.moveTo(base.x, base.y);
  ctx.lineTo(top.x, top.y);
  ctx.stroke();

  for (const p of [base, top]) {
    ctx.beginPath();
    ctx.moveTo(p.x - 5, p.y);
    ctx.lineTo(p.x + 5, p.y);
    ctx.stroke();
  }

  ctx.fillStyle = '#f5a623';
  ctx.font = '600 12px -apple-system, "Segoe UI", "Noto Sans Georgian", sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'bottom';
  ctx.fillText(`${Math.round(bounds.max.z)} სმ`, top.x, top.y - 6);
}
