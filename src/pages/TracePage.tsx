import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { getPageDrawings, initPdfJs, openPdf, type PdfDocument } from '../lib/detection/pdf';
import {
  extractSegments,
  mapSegments,
  segLength,
  viewportMapper,
  type Pt,
  type Seg,
} from '../lib/trace/segments';
import { matchStroke, piecesOverlap, strokeAlong, strokeAsSegment } from '../lib/trace/match';
import { fitTracedLines, originAt, type FitResult, type TracedLine } from '../lib/trace/fit';
import { putTraceImport } from '../lib/trace/handoff';
import { wallZones } from '../lib/trace/zones';
import { createWheelClassifier } from '../lib/wheelInput';

/**
 * ხაზვა PDF-დან - tracing a drawing instead of guessing at it.
 *
 * The detection page tries to work the whole sheet out on its own, and on a
 * drawing it has not met before it is a coin toss: it finds walls that are
 * dimension lines and misses walls that are hatched. The trouble is not that
 * it is bad at seeing lines - a vector PDF hands over the drafter's exact
 * geometry - it is that NOTHING in the file says which of those thousands of
 * lines is a wall somebody is going to pour concrete against.
 *
 * So this page splits the job the way it actually divides. The program does
 * what it is good at: it reads every line on the page, exactly, and joins the
 * pieces each wall was exported as. The person does what only they can: they
 * draw along the lines that matter. A line is taken only when both agree - the
 * program found it, and the architect pointed at it.
 *
 * Lengths are the other half, and they are handled in `lib/trace/fit.ts`: one
 * traced wall whose true length the architect knows sets the scale for the
 * whole page, and any other wall can then be corrected on its own without the
 * corners coming apart.
 *
 * The view works the way the editor's canvas works - the same wheel
 * classifier, the same space-drag pan, the same Ctrl+Z - because somebody who
 * has spent an hour in the editor should not have to learn a second set of
 * habits for the window next to it.
 */

type Tool = 'trace' | 'select' | 'erase';

interface TracedItem {
  id: string;
  seg: Seg;
  /** 'pdf' - the program found this line too; 'hand' - the user's own stroke */
  source: 'pdf' | 'hand';
  /** the found line it was taken off, so two pieces of one wall can be told apart */
  sourceId?: string;
  lengthCm?: number;
}

/** What undo puts back. */
interface Snapshot {
  traced: TracedItem[];
  calibrationId: string | null;
}

const MIN_ZOOM = 0.2;
const MAX_ZOOM = 8;
/**
 * The sharpest the page bitmap is ever drawn. Zooming past it scales what is
 * already there, which is instant; a re-render at 8× on A3 is 100 megapixels
 * and several seconds of work for detail the screen cannot show anyway.
 */
const MAX_RENDER_SCALE = 3;
/** Re-draw the page this long after the zoom stops changing. */
const RERENDER_DELAY_MS = 260;
/** How near the pointer has to be to pick a traced line, in page points. */
const PICK_PT = 10;
const HISTORY_LIMIT = 60;

const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

export default function TracePage() {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1.2);
  const [renderScale, setRenderScale] = useState(1.2);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [segments, setSegments] = useState<Seg[]>([]);
  /**
   * The thin line-by-line overlay is off to begin with. A thousand hairlines
   * over a drawing look like a second drawing and tell nobody anything; the
   * shaded areas below are what a person actually steers by. It stays
   * available for checking whether one particular line was found.
   */
  const [showFound, setShowFound] = useState(false);
  const [showZones, setShowZones] = useState(true);
  const [traced, setTraced] = useState<TracedItem[]>([]);
  const [past, setPast] = useState<Snapshot[]>([]);
  const [future, setFuture] = useState<Snapshot[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('trace');
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [stroke, setStroke] = useState<{ a: Pt; b: Pt } | null>(null);
  /**
   * What the stroke in progress will become, shown while the button is still
   * down. Drawing is a question - "this one?" - and the answer belongs on the
   * screen before the user lets go, not after.
   */
  const [preview, setPreview] = useState<{ a: Pt; b: Pt; matched: boolean } | null>(null);
  /** Take the whole wall, or only the stretch that was drawn. */
  const [takeWhole, setTakeWhole] = useState(false);
  const [flash, setFlash] = useState<string | null>(null);
  const [spaceDown, setSpaceDown] = useState(false);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const sheetRef = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<HTMLDivElement | null>(null);
  const pageRef = useRef<unknown>(null);
  /** The render in flight, so a new zoom can call it off - see the effect below. */
  const renderTaskRef = useRef<{ cancel(): void; promise: Promise<void> } | null>(null);
  const nextId = useRef(1);
  const spaceRef = useRef(false);
  const panRef = useRef<{ x: number; y: number } | null>(null);
  const erasingRef = useRef(false);
  const wheelClassifier = useRef(createWheelClassifier());
  /** Where to put the view after a zoom, so the point under the pointer stays put. */
  const anchorRef = useRef<{ px: number; py: number; clientX: number; clientY: number } | null>(null);

  useEffect(() => {
    initPdfJs();
  }, []);

  // A traced drawing is minutes of work; losing it to a stray back button or a
  // closed tab would be the thing people remember about this page.
  useEffect(() => {
    if (!traced.length) return;
    const warn = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = '';
    };
    window.addEventListener('beforeunload', warn);
    return () => window.removeEventListener('beforeunload', warn);
  }, [traced.length]);

  useEffect(() => {
    if (!flash) return;
    const t = setTimeout(() => setFlash(null), 2600);
    return () => clearTimeout(t);
  }, [flash]);

  // ── history ───────────────────────────────────────────────────────────────
  /** Remember where we are, before changing it. Every edit goes through this. */
  const remember = useCallback(() => {
    setPast((list) => [...list, { traced, calibrationId }].slice(-HISTORY_LIMIT));
    setFuture([]);
  }, [traced, calibrationId]);

  const undo = useCallback(() => {
    setPast((list) => {
      if (!list.length) return list;
      const previous = list[list.length - 1];
      setFuture((f) => [{ traced, calibrationId }, ...f].slice(0, HISTORY_LIMIT));
      setTraced(previous.traced);
      setCalibrationId(previous.calibrationId);
      setSelectedId(null);
      return list.slice(0, -1);
    });
  }, [traced, calibrationId]);

  const redo = useCallback(() => {
    setFuture((list) => {
      if (!list.length) return list;
      const next = list[0];
      setPast((p) => [...p, { traced, calibrationId }].slice(-HISTORY_LIMIT));
      setTraced(next.traced);
      setCalibrationId(next.calibrationId);
      setSelectedId(null);
      return list.slice(1);
    });
  }, [traced, calibrationId]);

  // ── the file ──────────────────────────────────────────────────────────────
  const openFile = async (file: File) => {
    setBusy('იხსნება…');
    setError(null);
    try {
      const data = await file.arrayBuffer();
      const opened = await openPdf(data, file.name);
      setDoc((old) => {
        void old?.destroy();
        return opened;
      });
      setFileName(file.name);
      setPageCount(opened.pageCount);
      setPageNumber(1);
      setTraced([]);
      setPast([]);
      setFuture([]);
      setCalibrationId(null);
      setSelectedId(null);
    } catch (e) {
      setError(`ფაილი ვერ გაიხსნა: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // ── the page: its size, its bitmap, and its lines ─────────────────────────
  //
  // Reading the lines is the slow part and has nothing to do with the zoom, so
  // it happens once per page. Re-extracting on every wheel click used to make
  // zooming unusable on a drawing with two thousand lines in it.
  useEffect(() => {
    let live = true;
    if (!doc) return;
    (async () => {
      setBusy('გვერდი იკითხება…');
      try {
        const page = await doc.page(pageNumber);
        if (!live) return;
        pageRef.current = page;
        const base = (page as {
          getViewport(o: { scale: number }): {
            width: number;
            height: number;
            convertToViewportPoint(x: number, y: number): number[];
          };
        }).getViewport({ scale: 1 });
        setPageSize({ w: base.width, h: base.height });

        const drawings = await getPageDrawings(page);
        if (!live) return;
        // Into the frame the page is actually drawn in - see `viewportMapper`.
        // A sheet stored portrait with /Rotate 90 is the common case, and
        // without this every line sits a quarter turn away from its wall.
        const toView = viewportMapper(base.height, (x, y) => base.convertToViewportPoint(x, y));
        setSegments(mapSegments(extractSegments(drawings), toView));
      } catch (e) {
        if (live) setError(`გვერდი ვერ წაიკითხა: ${(e as Error).message}`);
      } finally {
        if (live) setBusy(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [doc, pageNumber]);

  // The bitmap. Separate from the lines above, and from the zoom below: the
  // canvas is simply scaled by CSS while a zoom is in progress, and redrawn
  // once it settles, so zooming stays instant on a heavy sheet.
  useEffect(() => {
    let live = true;
    const page = pageRef.current;
    const canvas = canvasRef.current;
    if (!page || !canvas || !pageSize.w) return;

    /**
     * pdf.js refuses two renders on one canvas, and zooming asks for a fresh
     * one before the last has finished often enough that this is the normal
     * case rather than the exception. So the one in flight is called off, and
     * - this is the part that matters - the new one waits for it to actually
     * unwind before touching the canvas.
     */
    const previous = renderTaskRef.current;
    previous?.cancel();

    (async () => {
      if (previous) {
        try {
          await previous.promise;
        } catch {
          /* cancelled, which is what we asked for */
        }
      }
      if (!live) return;
      try {
        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = (page as { getViewport(o: { scale: number }): unknown }).getViewport({
          scale: renderScale * dpr,
        }) as { width: number; height: number };
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        const task = (page as { render(o: unknown): { cancel(): void; promise: Promise<void> } }).render(
          { canvasContext: ctx, viewport },
        );
        renderTaskRef.current = task;
        await task.promise;
        if (renderTaskRef.current === task) renderTaskRef.current = null;
      } catch (e) {
        if ((e as { name?: string }).name === 'RenderingCancelledException') return;
        if (live) setError(`გვერდი ვერ დაიხატა: ${(e as Error).message}`);
      }
    })();
    return () => {
      live = false;
    };
  }, [pageSize.w, pageSize.h, renderScale]);

  // Catch the bitmap up with the zoom once the wheel stops turning.
  useEffect(() => {
    const wanted = Math.min(MAX_RENDER_SCALE, zoom);
    if (Math.abs(wanted - renderScale) < 0.01) return;
    const t = setTimeout(() => setRenderScale(wanted), RERENDER_DELAY_MS);
    return () => clearTimeout(t);
  }, [zoom, renderScale]);

  // Lines belong to the page they were traced on.
  useEffect(() => {
    setTraced([]);
    setPast([]);
    setFuture([]);
    setCalibrationId(null);
    setSelectedId(null);
  }, [pageNumber]);

  // ── view: zoom round the pointer, pan by dragging ─────────────────────────
  const zoomAround = useCallback((factor: number, clientX: number, clientY: number) => {
    const stage = stageRef.current?.getBoundingClientRect();
    if (!stage) {
      setZoom((z) => clampZoom(z * factor));
      return;
    }
    setZoom((z) => {
      const next = clampZoom(z * factor);
      if (next === z) return z;
      // The page point under the pointer, which must not move on screen.
      anchorRef.current = {
        px: (clientX - stage.left) / z,
        py: (clientY - stage.top) / z,
        clientX,
        clientY,
      };
      return next;
    });
  }, []);

  // Put the view back where the anchor says, before the browser paints.
  useLayoutEffect(() => {
    const anchor = anchorRef.current;
    const sheet = sheetRef.current;
    const stage = stageRef.current;
    if (!anchor || !sheet || !stage) return;
    anchorRef.current = null;
    const box = stage.getBoundingClientRect();
    sheet.scrollLeft += box.left + anchor.px * zoom - anchor.clientX;
    sheet.scrollTop += box.top + anchor.py * zoom - anchor.clientY;
  }, [zoom]);

  /** Fit the whole page in the window - the editor's ჩატევა, for a sheet. */
  const fitPage = useCallback(() => {
    const sheet = sheetRef.current;
    if (!sheet || !pageSize.w) return;
    const pad = 36;
    const next = clampZoom(
      Math.min((sheet.clientWidth - pad) / pageSize.w, (sheet.clientHeight - pad) / pageSize.h),
    );
    anchorRef.current = null;
    setZoom(next);
  }, [pageSize.w, pageSize.h]);

  // Fit a freshly opened page, so it never arrives half off the screen.
  useEffect(() => {
    if (pageSize.w) fitPage();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pageSize.w, pageSize.h]);

  /**
   * The wheel, told apart the way the editor tells it apart: a mouse wheel
   * zooms, a trackpad's two-finger scroll pans, ctrl/⌘ or a pinch always zooms.
   * Same classifier, so a person's habits carry across the two windows.
   */
  useEffect(() => {
    const sheet = sheetRef.current;
    if (!sheet) return;
    const onWheel = (e: WheelEvent) => {
      const action = wheelClassifier.current.classify(e, sheet.clientHeight);
      e.preventDefault();
      if (action.kind === 'zoom') {
        zoomAround(action.factor, e.clientX, e.clientY);
      } else {
        sheet.scrollLeft += action.dx;
        sheet.scrollTop += action.dy;
      }
    };
    sheet.addEventListener('wheel', onWheel, { passive: false });
    return () => sheet.removeEventListener('wheel', onWheel);
  }, [zoomAround]);

  // ── keys ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const typing = (el: EventTarget | null) =>
      el instanceof HTMLElement && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA');

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code === 'Space' && !typing(e.target)) {
        if (!spaceRef.current) {
          spaceRef.current = true;
          setSpaceDown(true);
        }
        e.preventDefault();
        return;
      }
      if (e.ctrlKey || e.metaKey) {
        const key = e.key.toLowerCase();
        if (key === 'z' && !e.shiftKey) {
          e.preventDefault();
          undo();
        } else if ((key === 'z' && e.shiftKey) || key === 'y') {
          e.preventDefault();
          redo();
        }
        return;
      }
      if (typing(e.target)) return;

      if (e.key === 'Delete' || e.key === 'Backspace') {
        if (!selectedId) return;
        e.preventDefault();
        remember();
        setTraced((list) => list.filter((t) => t.id !== selectedId));
        if (calibrationId === selectedId) setCalibrationId(null);
        setSelectedId(null);
        return;
      }
      if (e.key === 'Escape') {
        setStroke(null);
        setSelectedId(null);
        return;
      }
      const key = e.key.toLowerCase();
      if (key === 'g') setTool('trace');
      else if (key === 'v') setTool('select');
      else if (key === 'e') setTool('erase');
      else if (key === 'f' || key === '0') fitPage();
      else if (key === '+' || key === '=') zoomAround(1.2, innerWidth / 2, innerHeight / 2);
      else if (key === '-') zoomAround(1 / 1.2, innerWidth / 2, innerHeight / 2);
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
  }, [undo, redo, remember, selectedId, calibrationId, fitPage, zoomAround]);

  // ── the scale, from the one line whose length is known ────────────────────
  const calibration = traced.find((t) => t.id === calibrationId && t.lengthCm);
  const cmPerPoint = calibration ? calibration.lengthCm! / segLength(calibration.seg) : null;
  /**
   * Where the page is crowded with line work - almost always a wall or a
   * column. Rough on purpose: it says "look here", and the tracing still
   * decides what is real. Recomputed only when the page changes.
   */
  const zones = useMemo(
    () => (pageSize.w ? wallZones(segments, pageSize.w, pageSize.h) : { rects: [], patches: 0, cellPt: 0 }),
    [segments, pageSize.w, pageSize.h],
  );

  /**
   * Found lines that are now fully taken, so the faint blue can get out of the
   * way. A wall traced only in part stays lit: the rest of it is still there to
   * take.
   */
  const takenIds = useMemo(() => {
    const byId = new Map(segments.map((s) => [s.id, s]));
    const done = new Set<string>();
    for (const t of traced) {
      const found = t.sourceId ? byId.get(t.sourceId) : undefined;
      if (found && segLength(t.seg) >= segLength(found) - 2) done.add(found.id);
    }
    return done;
  }, [traced, segments]);

  // ── pointer work on the overlay ───────────────────────────────────────────
  const pointAt = useCallback(
    (e: React.PointerEvent): Pt => {
      const box = svgRef.current!.getBoundingClientRect();
      return {
        x: ((e.clientX - box.left) / box.width) * pageSize.w,
        y: ((e.clientY - box.top) / box.height) * pageSize.h,
      };
    },
    [pageSize.w, pageSize.h],
  );

  /** The traced line nearest the pointer, for picking and erasing. */
  const pickTraced = useCallback(
    (p: Pt): TracedItem | null => {
      let best: { item: TracedItem; d: number } | null = null;
      for (const item of traced) {
        const { a, b } = item.seg;
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len2 = dx * dx + dy * dy || 1;
        const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
        const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
        if (d <= PICK_PT && (!best || d < best.d)) best = { item, d };
      }
      return best?.item ?? null;
    },
    [traced],
  );

  const eraseAt = (p: Pt) => {
    const hit = pickTraced(p);
    if (!hit) return;
    setTraced((list) => list.filter((t) => t.id !== hit.id));
    if (calibrationId === hit.id) setCalibrationId(null);
    if (selectedId === hit.id) setSelectedId(null);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pageSize.w) return;
    // Space or the middle button pans, whatever tool is in hand - exactly as
    // on the editor's canvas.
    if (spaceRef.current || e.button === 1) {
      e.preventDefault();
      (e.target as Element).setPointerCapture(e.pointerId);
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (e.button !== 0) return;

    const p = pointAt(e);
    if (tool === 'trace') {
      (e.target as Element).setPointerCapture(e.pointerId);
      setStroke({ a: p, b: p });
      return;
    }
    if (tool === 'select') {
      setSelectedId(pickTraced(p)?.id ?? null);
      return;
    }
    // erase: one press can wipe a whole run, so the history entry is taken
    // here and the whole swipe undoes as one.
    (e.target as Element).setPointerCapture(e.pointerId);
    remember();
    erasingRef.current = true;
    eraseAt(p);
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (panRef.current) {
      const sheet = sheetRef.current;
      if (sheet) {
        sheet.scrollLeft -= e.clientX - panRef.current.x;
        sheet.scrollTop -= e.clientY - panRef.current.y;
      }
      panRef.current = { x: e.clientX, y: e.clientY };
      return;
    }
    if (erasingRef.current) {
      eraseAt(pointAt(e));
      return;
    }
    if (!stroke) return;
    const b = pointAt(e);
    setStroke({ a: stroke.a, b });
    // Show the line that is about to be taken, straightened onto the page's
    // own geometry, while the button is still down.
    if (Math.hypot(b.x - stroke.a.x, b.y - stroke.a.y) < 4) {
      setPreview(null);
      return;
    }
    const hit = matchStroke(stroke.a, b, segments);
    if (!hit) {
      const own = strokeAsSegment(stroke.a, b, 'preview');
      setPreview({ a: own.a, b: own.b, matched: false });
      return;
    }
    const piece = takeWhole ? { a: hit.seg.a, b: hit.seg.b } : strokeAlong(hit.seg, stroke.a, b);
    setPreview({ ...piece, matched: true });
  };

  const endPointer = () => {
    panRef.current = null;
    erasingRef.current = false;
  };

  const onPointerUp = () => {
    if (panRef.current || erasingRef.current) {
      endPointer();
      return;
    }
    if (!stroke) return;
    const { a, b } = stroke;
    setStroke(null);
    setPreview(null);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return; // a tap, not a stroke

    const hit = matchStroke(a, b, segments);
    if (hit) {
      // As drawn, but straight and on the real line - and running to the
      // wall's corner when the stroke came near it. The whole wall only when
      // that is what was asked for.
      const piece = takeWhole ? { a: hit.seg.a, b: hit.seg.b } : strokeAlong(hit.seg, a, b);
      const already = traced.some(
        (t) => t.sourceId === hit.seg.id && piecesOverlap(t.seg, piece),
      );
      if (already) {
        setFlash('ეს მონაკვეთი უკვე აღებულია.');
        return;
      }
      const id = `t${nextId.current++}`;
      remember();
      setTraced((list) => [
        ...list,
        { id, seg: { id: `s${id}`, a: piece.a, b: piece.b, parts: hit.seg.parts }, source: 'pdf', sourceId: hit.seg.id },
      ]);
      setSelectedId(id);
      return;
    }

    // Nothing on the page agrees. The stroke is kept as the user's own line,
    // marked as such: a scanned drawing has no vector lines at all, and a wall
    // hidden inside a filled region cannot be found either.
    const id = `t${nextId.current++}`;
    remember();
    setTraced((list) => [...list, { id, seg: strokeAsSegment(a, b, `hand${id}`), source: 'hand' }]);
    setSelectedId(id);
    setFlash('პროგრამამ აქ ხაზი ვერ ნახა - შენი ხაზი დაემატა, მონიშნულია როგორც ხელით.');
  };

  // ── lengths ───────────────────────────────────────────────────────────────
  const setLength = (id: string, value: string) => {
    const cm = Number(String(value).replace(',', '.'));
    setTraced((list) =>
      list.map((t) =>
        t.id === id
          ? { ...t, ...(Number.isFinite(cm) && cm > 0 ? { lengthCm: cm } : { lengthCm: undefined }) }
          : t,
      ),
    );
    // The first length anybody types is what the whole page is scaled from.
    if (!calibrationId && Number.isFinite(cm) && cm > 0) setCalibrationId(id);
  };

  const fit: FitResult | null = useMemo(() => {
    if (!cmPerPoint || !traced.length) return null;
    const lines: TracedLine[] = traced.map((t) => ({
      id: t.id,
      a: t.seg.a,
      b: t.seg.b,
      ...(t.lengthCm ? { lengthCm: t.lengthCm } : {}),
    }));
    return fitTracedLines(lines, { cmPerPoint, snapCm: snapToGrid ? 5 : 0 });
  }, [traced, cmPerPoint, snapToGrid]);

  const sendToEditor = () => {
    if (!fit) return;
    const ok = putTraceImport({
      paths: originAt(fit.paths),
      fileName,
      pageNumber,
      createdAt: Date.now(),
    });
    if (!ok) {
      setError('ბრაუზერმა შენახვა არ დაუშვა - ნახაზი ვერ გადაეცა რედაქტორს.');
      return;
    }
    setFlash('გადაეცა რედაქტორს. გახსენი კუბის ფანჯარა - ხაზები იქ არის.');
  };

  const clearAll = () => {
    if (!traced.length) return;
    remember();
    setTraced([]);
    setCalibrationId(null);
    setSelectedId(null);
  };

  // ── view ──────────────────────────────────────────────────────────────────
  const fitById = useMemo(() => new Map((fit?.lines ?? []).map((l) => [l.id, l])), [fit]);
  const overlayTool = spaceDown ? (panRef.current ? 'grabbing' : 'grab') : tool;

  return (
    <div className="trace">
      <header className="trace-bar">
        <div className="trace-bar-left">
          <strong className="trace-brand">ხაზვა PDF-დან</strong>
          <label className="btn small">
            <input
              type="file"
              accept="application/pdf,.pdf"
              hidden
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void openFile(file);
                e.target.value = '';
              }}
            />
            {fileName ? 'სხვა PDF…' : 'PDF-ის გახსნა…'}
          </label>
          {fileName && <span className="trace-file" title={fileName}>{fileName}</span>}
        </div>

        {doc && (
          <div className="trace-bar-mid">
            <div className="seg">
              <button title="დაბრუნება (Ctrl+Z)" disabled={!past.length} onClick={undo}>↶</button>
              <button title="გამეორება (Ctrl+Shift+Z)" disabled={!future.length} onClick={redo}>↷</button>
            </div>
            <div className="seg">
              <button disabled={pageNumber <= 1} onClick={() => setPageNumber((n) => n - 1)}>‹</button>
              <span className="trace-page">{pageNumber} / {pageCount}</span>
              <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber((n) => n + 1)}>›</button>
            </div>
            <div className="seg">
              <button
                title="დაშორება (-)"
                onClick={() => zoomAround(1 / 1.2, window.innerWidth / 2, window.innerHeight / 2)}
              >−</button>
              <span className="trace-page">{Math.round(zoom * 100)}%</span>
              <button
                title="მიახლოება (+)"
                onClick={() => zoomAround(1.2, window.innerWidth / 2, window.innerHeight / 2)}
              >+</button>
              <button title="ჩატევა (F)" onClick={fitPage}>⤢</button>
            </div>
            <label className="trace-check">
              <input type="checkbox" checked={showZones} onChange={(e) => setShowZones(e.target.checked)} />
              შესაძლო კედლები <b>{zones.patches}</b>
            </label>
            <label className="trace-check">
              <input type="checkbox" checked={showFound} onChange={(e) => setShowFound(e.target.checked)} />
              ყველა ხაზი <b>{segments.length}</b>
            </label>
          </div>
        )}

        <div className="trace-bar-right">
          {busy && <span className="trace-busy">{busy}</span>}
          <a className="btn small" href="/" target="_blank" rel="noopener">კუბი</a>
        </div>
      </header>

      {error && <div className="trace-error" role="alert">{error}</div>}
      {flash && <div className="trace-flash">{flash}</div>}

      <div className="trace-body">
        <div className="trace-sheet" ref={sheetRef}>
          {!doc && (
            <div className="trace-empty">
              <h2>გახსენი არქიტექტორის PDF</h2>
              <p>
                პროგრამა წაიკითხავს გვერდის ყველა ხაზს. შემდეგ შენ გადაუსვამ ხაზს იმაზე, რაც
                მნიშვნელოვანია - კედელზე, ღერძზე - და მხოლოდ ის აიღება, რაზეც ორივე თანხმდება.
              </p>
              <label className="btn primary">
                <input
                  type="file"
                  accept="application/pdf,.pdf"
                  hidden
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) void openFile(file);
                    e.target.value = '';
                  }}
                />
                PDF-ის გახსნა…
              </label>
            </div>
          )}

          {doc && (
            <div
              className="trace-stage"
              ref={stageRef}
              style={{ width: pageSize.w * zoom, height: pageSize.h * zoom }}
            >
              <canvas ref={canvasRef} className="trace-canvas" style={{ width: '100%', height: '100%' }} />
              <svg
                ref={svgRef}
                className={`trace-overlay tool-${overlayTool}`}
                viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
                preserveAspectRatio="none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => {
                  endPointer();
                  setStroke(null);
                }}
                onContextMenu={(e) => e.preventDefault()}
              >
                {/* Under everything: the rough "a wall is probably here". */}
                {showZones &&
                  zones.rects.map((z, i) => (
                    <rect key={`z${i}`} className="zone" x={z.x} y={z.y} width={z.w} height={z.h} />
                  ))}

                {showFound &&
                  segments.map((s) => (
                    <line
                      key={s.id}
                      className={`found${takenIds.has(s.id) ? ' taken' : ''}`}
                      x1={s.a.x}
                      y1={s.a.y}
                      x2={s.b.x}
                      y2={s.b.y}
                    />
                  ))}

                {traced.map((t) => (
                  <g key={t.id} className={`traced${t.id === selectedId ? ' on' : ''} src-${t.source}`}>
                    <line x1={t.seg.a.x} y1={t.seg.a.y} x2={t.seg.b.x} y2={t.seg.b.y} />
                    <circle cx={t.seg.a.x} cy={t.seg.a.y} r={2.4} />
                    <circle cx={t.seg.b.x} cy={t.seg.b.y} r={2.4} />
                  </g>
                ))}

                {/* What is about to be taken, and under it the raw stroke. */}
                {preview && (
                  <g className={`preview${preview.matched ? '' : ' own'}`}>
                    <line x1={preview.a.x} y1={preview.a.y} x2={preview.b.x} y2={preview.b.y} />
                    <circle cx={preview.a.x} cy={preview.a.y} r={2.6} />
                    <circle cx={preview.b.x} cy={preview.b.y} r={2.6} />
                  </g>
                )}

                {stroke && (
                  <line
                    className="stroke"
                    x1={stroke.a.x}
                    y1={stroke.a.y}
                    x2={stroke.b.x}
                    y2={stroke.b.y}
                  />
                )}
              </svg>
            </div>
          )}
        </div>

        <aside className="trace-panel">
          <div className="seg trace-tools" role="group" aria-label="ხელსაწყო">
            <button className={tool === 'trace' ? 'on' : undefined} onClick={() => setTool('trace')}>
              ხაზის გადასმა
            </button>
            <button className={tool === 'select' ? 'on' : undefined} onClick={() => setTool('select')}>
              არჩევა
            </button>
            <button className={tool === 'erase' ? 'on' : undefined} onClick={() => setTool('erase')}>
              წაშლა
            </button>
          </div>
          <p className="trace-hint">
            {tool === 'trace' && 'გადაუსვი მაუსი იმ ხაზზე, რომელიც გინდა. პროგრამა იპოვის შესაბამის ხაზს და მთლიანად აიღებს.'}
            {tool === 'select' && 'დააჭირე აღებულ ხაზს და ჩაწერე მისი ნამდვილი სიგრძე. Delete - წაშლა.'}
            {tool === 'erase' && 'გადაუსვი აღებულ ხაზებს - რაც გზაში მოხვდება, წაიშლება. ერთი Ctrl+Z აბრუნებს მთელ გასმას.'}
          </p>
          <p className="trace-keys">
            <b>G</b> გადასმა · <b>V</b> არჩევა · <b>E</b> წაშლა · <b>Space</b> + მაუსი - გადაადგილება ·
            თაგვის ბორბალი - მასშტაბი · <b>F</b> ჩატევა · <b>Ctrl+Z</b> / <b>Ctrl+Shift+Z</b>
          </p>

          <div className="trace-scale">
            {cmPerPoint ? (
              <>
                <b>მასშტაბი</b>
                <span>1 pt = {cmPerPoint.toFixed(3)} სმ</span>
                <small>აღებულია ხაზიდან, რომელსაც პირველად მიეცა სიგრძე.</small>
              </>
            ) : (
              <>
                <b>მასშტაბი ჯერ არ არის</b>
                <small>
                  აიღე ერთი კედელი, რომლის ნამდვილი სიგრძეც იცი, და ჩაწერე. მთელი გვერდი ამაზე
                  დაიანგარიშდება.
                </small>
              </>
            )}
          </div>

          <div className="trace-list">
            {!traced.length && <p className="trace-hint">ჯერ არცერთი ხაზი არ აგიღია.</p>}
            {traced.map((t, i) => {
              const fitted = fitById.get(t.id);
              const measured = cmPerPoint ? segLength(t.seg) * cmPerPoint : null;
              return (
                <div
                  key={t.id}
                  className={`trace-row${t.id === selectedId ? ' on' : ''}`}
                  onClick={() => setSelectedId(t.id)}
                >
                  <span className="trace-num">{i + 1}</span>
                  <div className="trace-row-main">
                    <div className="trace-row-top">
                      <span className={`trace-tag ${t.source}`}>
                        {t.source === 'pdf' ? 'PDF + შენ' : 'ხელით'}
                      </span>
                      {t.id === calibrationId && <span className="trace-tag cal">მასშტაბი</span>}
                      {fitted && fitted.axis === 'free' && <span className="trace-tag warn">დახრილი</span>}
                    </div>
                    <div className="trace-row-len">
                      <input
                        type="number"
                        min={1}
                        step="any"
                        placeholder={measured ? measured.toFixed(0) : 'სიგრძე'}
                        value={t.lengthCm ?? ''}
                        // One undo step per edit, not one per keystroke.
                        onFocus={remember}
                        onChange={(e) => setLength(t.id, e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                      />
                      <span className="trace-unit">სმ</span>
                      {fitted && (
                        <span className="trace-result" title="რა გამოვიდა გასწორების შემდეგ">
                          → {fitted.lengthCm.toFixed(0)}
                        </span>
                      )}
                    </div>
                  </div>
                  <button
                    className="btn icon small"
                    title="წაშლა"
                    onClick={(e) => {
                      e.stopPropagation();
                      remember();
                      setTraced((list) => list.filter((x) => x.id !== t.id));
                      if (calibrationId === t.id) setCalibrationId(null);
                      if (selectedId === t.id) setSelectedId(null);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

          <label className="trace-check">
            <input type="checkbox" checked={takeWhole} onChange={(e) => setTakeWhole(e.target.checked)} />
            მთლიანი ხაზის აღება
            <small className="trace-note">
              {takeWhole ? 'რასაც შეეხები, მთლიანად აიღება.' : 'აიღება ის, რამდენსაც დახაზავ - ბოლოები კუთხეს ეკვრის.'}
            </small>
          </label>
          <label className="trace-check">
            <input type="checkbox" checked={snapToGrid} onChange={(e) => setSnapToGrid(e.target.checked)} />
            5 სმ ბადეზე დაყენება
          </label>

          {fit && (
            <div className="trace-report">
              <div><span>აღებული ხაზი</span><b>{fit.lines.length}</b></div>
              <div><span>ჩაწერილი სიგრძე</span><b>{fit.assigned}</b></div>
              <div><span>ყველაზე დიდი ცდომილება</span><b>{fit.maxErrorCm.toFixed(1)} სმ</b></div>
              <div><span>ყველაზე დიდი წანაცვლება</span><b>{fit.maxMovedCm.toFixed(0)} სმ</b></div>
              {fit.skewed.length > 0 && (
                <p className="trace-hint">
                  {fit.skewed.length} დახრილ ხაზს სიგრძე ვერ დაედო - ნახაზი სწორკუთხაა.
                </p>
              )}
            </div>
          )}

          <div className="trace-actions">
            <button className="btn" disabled={!traced.length} onClick={clearAll}>
              ყველას წაშლა
            </button>
            <button className="btn primary" disabled={!fit} onClick={sendToEditor}>
              რედაქტორში გაგზავნა
            </button>
          </div>
          {!cmPerPoint && traced.length > 0 && (
            <p className="trace-hint">ჯერ ერთ ხაზს მაინც ჩაწერე ნამდვილი სიგრძე.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
