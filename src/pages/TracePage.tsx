import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { getPageDrawings, initPdfJs, openPdf, type PdfDocument } from '../lib/detection/pdf';
import { extractSegments, segLength, type Pt, type Seg } from '../lib/trace/segments';
import { matchStroke, strokeAsSegment } from '../lib/trace/match';
import { fitTracedLines, originAt, type FitResult, type TracedLine } from '../lib/trace/fit';
import { putTraceImport } from '../lib/trace/handoff';

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
 * program found it, and the architect pointed at it - and that is the whole
 * idea here. Nothing is imported that a person did not personally verify.
 *
 * Lengths are the other half, and they are handled in `lib/trace/fit.ts`: one
 * traced wall whose true length the architect knows sets the scale for the
 * whole page, and any other wall can then be corrected on its own without the
 * corners coming apart.
 */

type Tool = 'trace' | 'select' | 'erase';

interface TracedItem {
  id: string;
  seg: Seg;
  /** 'pdf' - the program found this line too; 'hand' - the user's own stroke */
  source: 'pdf' | 'hand';
  lengthCm?: number;
}

const ZOOMS = [0.5, 0.75, 1, 1.5, 2, 3, 4];
/** How near the pointer has to be to pick a traced line, in page points. */
const PICK_PT = 10;

export default function TracePage() {
  const [doc, setDoc] = useState<PdfDocument | null>(null);
  const [fileName, setFileName] = useState('');
  const [pageNumber, setPageNumber] = useState(1);
  const [pageCount, setPageCount] = useState(0);
  const [pageSize, setPageSize] = useState({ w: 0, h: 0 });
  const [zoom, setZoom] = useState(1.5);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const [segments, setSegments] = useState<Seg[]>([]);
  const [showFound, setShowFound] = useState(true);
  const [traced, setTraced] = useState<TracedItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [calibrationId, setCalibrationId] = useState<string | null>(null);
  const [tool, setTool] = useState<Tool>('trace');
  const [snapToGrid, setSnapToGrid] = useState(true);
  const [stroke, setStroke] = useState<{ a: Pt; b: Pt } | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const svgRef = useRef<SVGSVGElement | null>(null);
  const pageRef = useRef<unknown>(null);
  const nextId = useRef(1);

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
      setCalibrationId(null);
      setSelectedId(null);
    } catch (e) {
      setError(`ფაილი ვერ გაიხსნა: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  // ── render the page, and read its lines ───────────────────────────────────
  useEffect(() => {
    let live = true;
    if (!doc) return;
    (async () => {
      setBusy('გვერდი იხატება…');
      try {
        const page = await doc.page(pageNumber);
        if (!live) return;
        pageRef.current = page;
        const base = (page as { getViewport(o: { scale: number }): { width: number; height: number } })
          .getViewport({ scale: 1 });
        setPageSize({ w: base.width, h: base.height });

        const dpr = Math.min(2, window.devicePixelRatio || 1);
        const viewport = (page as { getViewport(o: { scale: number }): unknown }).getViewport({
          scale: zoom * dpr,
        }) as { width: number; height: number };
        const canvas = canvasRef.current;
        if (!canvas) return;
        canvas.width = Math.ceil(viewport.width);
        canvas.height = Math.ceil(viewport.height);
        canvas.style.width = `${base.width * zoom}px`;
        canvas.style.height = `${base.height * zoom}px`;
        const ctx = canvas.getContext('2d');
        if (!ctx) return;
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        await (page as { render(o: unknown): { promise: Promise<void> } }).render({
          canvasContext: ctx,
          viewport,
        }).promise;
        if (!live) return;

        setBusy('ხაზები იკითხება…');
        const drawings = await getPageDrawings(page);
        if (!live) return;
        setSegments(extractSegments(drawings));
      } catch (e) {
        if (live) setError(`გვერდი ვერ დაიხატა: ${(e as Error).message}`);
      } finally {
        if (live) setBusy(null);
      }
    })();
    return () => {
      live = false;
    };
  }, [doc, pageNumber, zoom]);

  // Lines belong to the page they were traced on.
  useEffect(() => {
    setTraced([]);
    setCalibrationId(null);
    setSelectedId(null);
  }, [pageNumber]);

  // ── the scale, from the one line whose length is known ────────────────────
  const calibration = traced.find((t) => t.id === calibrationId && t.lengthCm);
  const cmPerPoint = calibration ? calibration.lengthCm! / segLength(calibration.seg) : null;

  const tracedIds = useMemo(() => new Set(traced.map((t) => t.seg.id)), [traced]);

  // ── pointer work on the overlay ───────────────────────────────────────────
  const pointAt = useCallback((e: React.PointerEvent): Pt => {
    const svg = svgRef.current!;
    const box = svg.getBoundingClientRect();
    return {
      x: ((e.clientX - box.left) / box.width) * pageSize.w,
      y: ((e.clientY - box.top) / box.height) * pageSize.h,
    };
  }, [pageSize.w, pageSize.h]);

  /** The traced line nearest the pointer, for picking and erasing. */
  const pickTraced = (p: Pt): TracedItem | null => {
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
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (!pageSize.w) return;
    const p = pointAt(e);
    if (tool === 'trace') {
      (e.target as Element).setPointerCapture(e.pointerId);
      setStroke({ a: p, b: p });
      return;
    }
    const hit = pickTraced(p);
    if (tool === 'select') setSelectedId(hit?.id ?? null);
    if (tool === 'erase' && hit) {
      setTraced((list) => list.filter((t) => t.id !== hit.id));
      if (calibrationId === hit.id) setCalibrationId(null);
    }
  };

  const onPointerMove = (e: React.PointerEvent) => {
    if (!stroke) return;
    setStroke({ a: stroke.a, b: pointAt(e) });
  };

  const onPointerUp = () => {
    if (!stroke) return;
    const { a, b } = stroke;
    setStroke(null);
    if (Math.hypot(b.x - a.x, b.y - a.y) < 4) return; // a tap, not a stroke

    const hit = matchStroke(a, b, segments);
    if (hit) {
      if (tracedIds.has(hit.seg.id)) {
        setFlash('ეს ხაზი უკვე აღებულია.');
        return;
      }
      const id = `t${nextId.current++}`;
      setTraced((list) => [...list, { id, seg: hit.seg, source: 'pdf' }]);
      setSelectedId(id);
      if (hit.coverage < 0.6) {
        setFlash(`ხაზი ბოლომდე აიღო - ${Math.round(segLength(hit.seg))} pt, შენ დახაზე ნაწილი.`);
      }
      return;
    }

    // Nothing on the page agrees. The stroke is kept as the user's own line,
    // marked as such: a scanned drawing has no vector lines at all, and a wall
    // hidden inside a filled region cannot be found either.
    const id = `t${nextId.current++}`;
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

  // ── view ──────────────────────────────────────────────────────────────────
  const selected = traced.find((t) => t.id === selectedId) ?? null;
  const fitById = useMemo(
    () => new Map((fit?.lines ?? []).map((l) => [l.id, l])),
    [fit],
  );

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
              <button disabled={pageNumber <= 1} onClick={() => setPageNumber((n) => n - 1)}>‹</button>
              <span className="trace-page">{pageNumber} / {pageCount}</span>
              <button disabled={pageNumber >= pageCount} onClick={() => setPageNumber((n) => n + 1)}>›</button>
            </div>
            <div className="seg">
              <button
                disabled={zoom <= ZOOMS[0]}
                onClick={() => setZoom((z) => ZOOMS[Math.max(0, ZOOMS.indexOf(z) - 1)] ?? z)}
              >−</button>
              <span className="trace-page">{Math.round(zoom * 100)}%</span>
              <button
                disabled={zoom >= ZOOMS[ZOOMS.length - 1]}
                onClick={() => setZoom((z) => ZOOMS[Math.min(ZOOMS.length - 1, ZOOMS.indexOf(z) + 1)] ?? z)}
              >+</button>
            </div>
            <label className="trace-check">
              <input type="checkbox" checked={showFound} onChange={(e) => setShowFound(e.target.checked)} />
              ნაპოვნი ხაზები <b>{segments.length}</b>
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
        <div className="trace-sheet">
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
            <div className="trace-stage" style={{ width: pageSize.w * zoom, height: pageSize.h * zoom }}>
              <canvas ref={canvasRef} className="trace-canvas" />
              <svg
                ref={svgRef}
                className={`trace-overlay tool-${tool}`}
                viewBox={`0 0 ${pageSize.w} ${pageSize.h}`}
                preserveAspectRatio="none"
                onPointerDown={onPointerDown}
                onPointerMove={onPointerMove}
                onPointerUp={onPointerUp}
                onPointerCancel={() => setStroke(null)}
              >
                {showFound &&
                  segments.map((s) => (
                    <line
                      key={s.id}
                      className={`found${tracedIds.has(s.id) ? ' taken' : ''}`}
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
            {tool === 'trace' && 'გადაუსვი თითი/მაუსი იმ ხაზზე, რომელიც გინდა. პროგრამა იპოვის შესაბამის ხაზს და მთლიანად აიღებს.'}
            {tool === 'select' && 'დააჭირე აღებულ ხაზს და ჩაწერე მისი ნამდვილი სიგრძე.'}
            {tool === 'erase' && 'დააჭირე აღებულ ხაზს წასაშლელად.'}
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
                      setTraced((list) => list.filter((x) => x.id !== t.id));
                      if (calibrationId === t.id) setCalibrationId(null);
                    }}
                  >
                    ×
                  </button>
                </div>
              );
            })}
          </div>

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

          <button className="btn primary trace-send" disabled={!fit} onClick={sendToEditor}>
            რედაქტორში გაგზავნა
          </button>
          {!cmPerPoint && traced.length > 0 && (
            <p className="trace-hint">ჯერ ერთ ხაზს მაინც ჩაწერე ნამდვილი სიგრძე.</p>
          )}
        </aside>
      </div>
    </div>
  );
}
