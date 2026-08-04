import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { HiddenLineMode } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import {
  piecePrism,
  contentBounds3,
  DEFAULT_CAMERA,
  faceShade,
  fitZoom,
  isFrontFacing,
  project,
  type Camera,
  type Vec3,
} from '../lib/iso3d';
import {
  classifyEdge,
  createRaster,
  fillFace,
  rasterMatches,
  resetRaster,
  type DepthRaster,
  type EdgeRun,
  type Rgb,
  type ScreenPoint,
} from '../lib/raster3d';
import { createWheelClassifier } from '../lib/wheelInput';

/** Darken/lighten a #rrggbb by a 0..1+ factor. */
function shade(hex: string, factor: number): Rgb {
  const n = Number.parseInt(hex.slice(1), 16);
  const channel = (shift: number) =>
    Number.isFinite(n) ? Math.max(0, Math.min(255, Math.round(((n >> shift) & 255) * factor))) : 128;
  return { r: channel(16), g: channel(8), b: channel(0) };
}

const HIDDEN_LINE_LABEL: Record<HiddenLineMode, string> = {
  hide: 'ფარული ხაზები — დამალული',
  dashed: 'ფარული ხაზები — წყვეტილი',
  show: 'ფარული ხაზები — გამჭვირვალე',
};

/**
 * Read-only 3D visualisation.
 *
 * The 2D surface is a plan view, so it can only ever show footprints. This
 * extrudes every piece to its real height so the formwork can be seen standing
 * up. Deliberately not editable — it exists to check how the assembly looks.
 *
 * Rendering goes through a software depth buffer rather than sorting faces:
 * see `lib/raster3d.ts` for why sorting cannot get formwork right.
 */
export function View3D() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const hiddenLines = useEditorStore((s) => s.hiddenLines);
  const setHiddenLines = useEditorStore((s) => s.setHiddenLines);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wrapRef = useRef<HTMLDivElement>(null);
  const wheel = useRef(createWheelClassifier());
  const drag = useRef<{ x: number; y: number; mode: 'orbit' | 'pan' } | null>(null);
  const rasterRef = useRef<DepthRaster | null>(null);
  const blitRef = useRef<HTMLCanvasElement | null>(null);

  const [size, setSize] = useState({ w: 800, h: 600 });
  const [cam, setCam] = useState<Camera>(DEFAULT_CAMERA);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [centre, setCentre] = useState<Vec3>({ x: 0, y: 0, z: 0 });

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const fit = useCallback(() => {
    const result = fitZoom(pieces, byId, cam, size.w, size.h);
    if (!result) return;
    setZoom(result.zoom);
    setCentre(result.centre);
    setPan({ x: 0, y: 0 });
  }, [pieces, byId, cam, size.w, size.h]);

  // Frame the model on entry and whenever the drawing changes underneath.
  useEffect(() => {
    const result = fitZoom(pieces, byId, DEFAULT_CAMERA, size.w, size.h);
    if (!result) return;
    setZoom(result.zoom);
    setCentre(result.centre);
    setPan({ x: 0, y: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pieces.length, size.w, size.h]);

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

  // ── Orbit / pan by dragging ─────────────────────────────────────────────
  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      const d = drag.current;
      if (!d) return;
      const dx = e.clientX - d.x;
      const dy = e.clientY - d.y;
      drag.current = { ...d, x: e.clientX, y: e.clientY };

      if (d.mode === 'pan') {
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
      drag.current = null;
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
    for (const piece of pieces) {
      const m = byId.get(piece.materialId);
      if (!m) continue;
      const { vertices, faces } = piecePrism(piece, m);
      const projected = vertices.map(toScreen);
      const stride = vertices.length;
      const seen = new Set<number>();

      for (const face of faces) {
        if (!isFrontFacing(vertices, face, cam)) continue;
        fillFace(
          raster,
          face.map((i) => projected[i]),
          shade(m.color, faceShade(vertices, face)),
        );
        for (let i = 0; i < face.length; i++) {
          const a = face[i];
          const b = face[(i + 1) % face.length];
          // Interior edges are shared by two visible faces; draw each once.
          const key = Math.min(a, b) * stride + Math.max(a, b);
          if (seen.has(key)) continue;
          seen.add(key);
          edges.push([projected[a], projected[b]]);
        }
      }
    }

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

    drawEdges(ctx, raster, edges, hiddenLines, zoom);
    drawHeightMarker(ctx, bounds, toScreen);
  }, [pieces, byId, cam, zoom, pan, centre, size, hiddenLines]);

  const hasPieces = pieces.length > 0;

  return (
    <main className="stage view3d" ref={wrapRef}>
      <canvas
        ref={canvasRef}
        style={{ width: size.w, height: size.h, display: 'block', touchAction: 'none' }}
        onPointerDown={(e) => {
          if (e.button !== 0 && e.button !== 1) return;
          drag.current = {
            x: e.clientX,
            y: e.clientY,
            mode: e.button === 1 || e.shiftKey ? 'pan' : 'orbit',
          };
        }}
      />

      <div className="view3d-bar">
        <button className="btn small" onClick={fit} disabled={!hasPieces} title="ჩატევა">
          ⤢ ცენტრი
        </button>
        <button
          className="btn small"
          onClick={() => setCam(DEFAULT_CAMERA)}
          title="საწყისი კუთხე — ხედი ზემოდან"
        >
          ↺ კუთხე
        </button>
        <button
          className="btn small"
          onClick={() => setCam({ azimuth: 0, elevation: Math.PI / 2 })}
          title="ზუსტად ზემოდან — ემთხვევა 2D გეგმას"
        >
          ⌗ გეგმა
        </button>
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
        <span className="view3d-hint">თრევა — ბრუნვა · Shift+თრევა — გადაწევა</span>
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
): void {
  ctx.lineJoin = 'round';
  ctx.lineCap = 'round';
  ctx.lineWidth = 1;

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
    ctx.strokeStyle = 'rgba(10,13,17,.5)';
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
    ctx.strokeStyle = 'rgba(190,201,214,.42)';
    ctx.setLineDash([3, 4]);
    stroke(hidden);
    ctx.setLineDash([]);
  }

  ctx.strokeStyle = 'rgba(10,13,17,.5)';
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
