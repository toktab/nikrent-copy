import { useCallback, useEffect, useRef, useState } from 'react';
import type {
  AlgorithmChoice,
  AlgorithmName,
  LegacyDetectedDoc,
  PageResult,
  WorkerMessage,
} from '../lib/detection/types';
import { isLegacyBritania, legacyBritaniaToV1, schemaPageKeys, schemaToSketchPaths } from '../lib/detectImport';
/* Note: schemaToSketchPaths is used by importJsonFile below */
import { downloadJson, pickFile, readFileAsArrayBuffer, readFileAsText } from '../lib/files';

/* ── Constants ── */

const ALGO_LABELS: Record<AlgorithmName, string> = {
  britania: 'Britania',
  glassworks: 'GlassWorks',
  super: 'SUPER (Adaptive)',
  custom: 'Custom (.ts)',
};

const ALGO_HELP: Record<AlgorithmChoice, string> = {
  auto: 'Auto — each page picks its own algorithm (5-signal probe).',
  britania: 'Britania — raster pipeline: threshold → morphology → contours → filter.',
  glassworks: 'GlassWorks — vector (operator list) + raster fallback.',
  super: 'SUPER — adaptive algorithm with auto thresholds and hatch patterns.',
  custom: 'Custom — upload your own .ts detector algorithm.',
};

/* ── Types ── */

interface PageReport {
  pageNo: number;
  algo: string;
  columns: number;
  walls: number;
  ms: number;
}

/* ── SVG Visualisation of detected elements ── */

function DetectionVisual({ pageKey, result }: { pageKey: string; result: PageResult }) {
  const pageNo = pageKey.replace('page_', '');

  /** Clamp stroke width so it is visible at any scale. */
  const strokeW = (vw: number, vh: number) =>
    Math.max(0.5, Math.min(3, Math.max(vw, vh) * 0.003));

  if (result.drawing_type === 'section') {
    const walls = result.detectedWalls ?? [];
    const cols = result.detectedColumns ?? [];
    const allX = [...walls.map((w) => w.cx), ...cols.map((c) => c.cx)];
    const allY = [...walls.map((w) => w.cy), ...cols.map((c) => c.cy)];
    if (allX.length === 0) return null;
    const minX = Math.min(...allX) - 50;
    const maxX = Math.max(...allX) + 50;
    const minY = Math.min(...allY) - 50;
    const maxY = Math.max(...allY) + 50;
    const vw = Math.max(maxX - minX, 100);
    const vh = Math.max(maxY - minY, 100);
    return (
      <div className="detect-visual-page">
        <div className="detect-visual-label">Page {pageNo} — Section ({cols.length} columns, {walls.length} walls)</div>
        <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} className="detect-visual-svg">
          {walls.map((w, i) => {
            const hw = (w.thicknessCm ?? 20) / 2;
            const hl = (w.lengthCm ?? 100) / 2;
            const isVert = w.rotation === 90;
            return (
              <rect
                key={`w${i}`}
                x={isVert ? w.cx - hw : w.cx - hl}
                y={isVert ? w.cy - hl : w.cy - hw}
                width={isVert ? hw * 2 : hl * 2}
                height={isVert ? hl * 2 : hw * 2}
                fill="rgba(239,168,49,0.25)"
                stroke="#efa831"
                strokeWidth={strokeW(vw, vh)}
              />
            );
          })}
          {cols.map((c, i) => (
            <rect
              key={`c${i}`}
              x={c.cx - (c.widthCm ?? 30) / 2}
              y={c.cy - (c.depthCm ?? 30) / 2}
              width={c.widthCm ?? 30}
              height={c.depthCm ?? 30}
              fill="rgba(112,166,245,0.25)"
              stroke="#70a6f5"
              strokeWidth={strokeW(vw, vh)}
            />
          ))}
        </svg>
      </div>
    );
  }

  // Plan view
  const columns = result.columns ?? [];
  const walls = result.walls ?? [];
  const allX = [...columns.map((c) => c.x0), ...columns.map((c) => c.x1), ...walls.map((w) => w.x0), ...walls.map((w) => w.x1)];
  const allY = [...columns.map((c) => c.y0), ...columns.map((c) => c.y1), ...walls.map((w) => w.y0), ...walls.map((w) => w.y1)];
  if (allX.length === 0) return null;
  const minX = Math.min(...allX) - 20;
  const maxX = Math.max(...allX) + 20;
  const minY = Math.min(...allY) - 20;
  const maxY = Math.max(...allY) + 20;
  const vw = Math.max(maxX - minX, 100);
  const vh = Math.max(maxY - minY, 100);
  return (
    <div className="detect-visual-page">
      <div className="detect-visual-label">Page {pageNo} — Plan ({columns.length} columns, {walls.length} walls)</div>
      <svg viewBox={`${minX} ${minY} ${vw} ${vh}`} className="detect-visual-svg">
        {walls.map((w, i) => (
          <rect
            key={`w${i}`}
            x={w.x0}
            y={w.y0}
            width={w.x1 - w.x0}
            height={w.y1 - w.y0}
            fill="rgba(239,168,49,0.2)"
            stroke="#efa831"
            strokeWidth={strokeW(vw, vh)}
          />
        ))}
        {columns.map((c, i) => (
          <rect
            key={`c${i}`}
            x={c.x0}
            y={c.y0}
            width={c.x1 - c.x0}
            height={c.y1 - c.y0}
            fill="rgba(112,166,245,0.25)"
            stroke="#70a6f5"
            strokeWidth={strokeW(vw, vh)}
          />
        ))}
      </svg>
    </div>
  );
}

/* ── Component ── */

export default function DetectionPage() {
  const [busy, setBusy] = useState(false);
  const [algorithm, setAlgorithm] = useState<AlgorithmChoice>('auto');
  const [progress, setProgress] = useState<string | null>(null);
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const [pageReport, setPageReport] = useState<PageReport[]>([]);
  const [manualScale, setManualScale] = useState<number | null>(null);
  const [done, setDone] = useState<{
    doc: LegacyDetectedDoc;
    fileName: string;
    processedPages: number;
  } | null>(null);
  const [pick, setPick] = useState<{ pageCount: number; fileName: string } | null>(null);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [dragOver, setDragOver] = useState(false);
  const [elapsedSec, setElapsedSec] = useState(0);

  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const elapsedTimerRef = useRef<number | null>(null);
  const runAlgoRef = useRef<AlgorithmChoice>('auto');

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      workerRef.current?.terminate();
      workerRef.current = null;
      if (elapsedTimerRef.current) {
        clearInterval(elapsedTimerRef.current);
        elapsedTimerRef.current = null;
      }
    };
  }, []);

  const stopElapsedTimer = () => {
    if (elapsedTimerRef.current) {
      clearInterval(elapsedTimerRef.current);
      elapsedTimerRef.current = null;
    }
  };

  const startElapsedTimer = () => {
    stopElapsedTimer();
    setElapsedSec(0);
    const start = Date.now();
    elapsedTimerRef.current = setInterval(() => {
      setElapsedSec(Math.floor((Date.now() - start) / 1000));
    }, 500);
  };

  const togglePage = (p: number) => {
    setSelectedPages((prev) =>
      prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b)
    );
  };

  const algoLabel = (a: AlgorithmName) => ALGO_LABELS[a] ?? a;

  /** Run detection on the selected pages */
  const startRun = () => {
    const worker = workerRef.current;
    const id = jobIdRef.current;
    if (!worker || !id || !pick) return;
    if (!selectedPages.length) return;

    setLog([]);
    setPageReport([]);
    setDone(null);
    startElapsedTimer();
    runAlgoRef.current = algorithm;
    setPick(null);
    setProgress('Processing pages…');

    worker.postMessage({
      type: 'run',
      id,
      pages: selectedPages,
      algorithm,
      ...(manualScale && manualScale > 0 ? { scale: manualScale } : {}),
    });
  };

  /** Pick a PDF file and start detection */
  const runPdf = useCallback(async (file?: File) => {
    if (busy && !pick) return;
    const f = file ?? (await pickFile('.pdf,application/pdf'));
    if (!f) return;

    setBusy(true);
    setDone(null);
    setLog([]);
    setProgress('Reading PDF…');

    const id = `det-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobIdRef.current = id;

    let buffer: ArrayBuffer;
    let worker: Worker;
    try {
      buffer = await readFileAsArrayBuffer(f);
      worker = new Worker(
        new URL('../lib/detection/detectionWorker.ts', import.meta.url),
        { type: 'module' }
      );
    } catch (e) {
      setBusy(false);
      setProgress(null);
      alert(`Failed to read file: ${(e as Error).message}`);
      return;
    }
    workerRef.current = worker;

    const stop = () => {
      stopElapsedTimer();
      setProgressPct(null);
      try { worker.terminate(); } finally {
        workerRef.current = null;
        jobIdRef.current = null;
      }
    };

    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const msg = ev.data;
      if (msg.type === 'ready') {
        setProgress('OpenCV ready, counting pages…');
        return;
      }
      if (msg.type === 'pages') {
        const all = Array.from({ length: msg.pageCount }, (_, i) => i + 1);
        setSelectedPages(all);
        setPick({ pageCount: msg.pageCount, fileName: f.name });
        setProgress('Select pages to process…');
        return;
      }
      if (msg.type === 'progress') {
        setProgress(`Page ${msg.pageNo}/${msg.pageCount}…`);
        setProgressPct(msg.pageCount > 0 ? Math.round(((msg.pageNo - 1) / msg.pageCount) * 100) : null);
        return;
      }
      if (msg.type === 'page') {
        const r = msg.result;
        const isSection = r.drawing_type === 'section';
        const cols = isSection ? r.detectedColumns.length : r.columns.length;
        const walls = isSection ? r.detectedWalls.length : r.walls.length;
        setLog((prev) => [
          ...prev,
          `Page ${msg.pageNo}: ${algoLabel(msg.algo)} — ${walls} walls, ${cols} columns (${msg.elapsedMs}ms)`,
        ]);
        setPageReport((prev) => [
          ...prev,
          { pageNo: msg.pageNo, algo: algoLabel(msg.algo), columns: cols, walls, ms: msg.elapsedMs },
        ]);
        setProgressPct(msg.pageCount > 0 ? Math.round((msg.pageNo / msg.pageCount) * 100) : null);
        return;
      }
      if (msg.type === 'error') {
        stop();
        setBusy(false);
        setProgress(null);
        setLog((prev) => [...prev, `Error: ${msg.message}`]);
        return;
      }
      if (msg.type !== 'done') return;

      stop();
      const doc: LegacyDetectedDoc = {
        source: { pdf: f.name, n_pages: msg.pageCount },
        algorithms: msg.algorithms,
        all_pages: Object.fromEntries(msg.pages.map((r, i) => [`page_${msg.pageNos[i]}`, r])),
      };
      setBusy(false);
      setProgress(null);
      setPick(null);
      setSelectedPages([]);
      setDone({ doc, fileName: f.name, processedPages: msg.pages.length });
      setLog((prev) => [
        ...prev,
        `Done: ${msg.pages.length} pages — ${Object.entries(msg.algorithms)
          .map(([k, v]) => `${k}: ${algoLabel(v)}`)
          .join(', ')}`,
      ]);
    };

    worker.onerror = (e) => {
      stop();
      setBusy(false);
      setProgress(null);
      alert(`Detection failed: ${e.message}`);
    };

    worker.postMessage({
      type: 'detect',
      id,
      pdf: buffer,
      fileName: f.name,
      algorithm,
      drawingType: 'auto',
      mode: 'auto',
      scale: 50,
    });
  }, [busy, pick, algorithm, manualScale]);

  /** Import a JSON file (shared helper for import button and drag-drop). */
  const importJsonFile = async (f: File) => {
    try {
      const text = await readFileAsText(f);
      const doc: unknown = JSON.parse(text);
      let schema: Record<string, unknown>;
      if (isLegacyBritania(doc)) {
        schema = legacyBritaniaToV1(doc, f.name);
      } else {
        schema = doc as Record<string, unknown>;
      }
      const paths = schemaToSketchPaths(schema);
      const pages = schemaPageKeys(schema).length;
      alert(`Imported ${paths.length} elements (${pages} pages) from ${f.name}`);
    } catch (e) {
      alert(`Import failed: ${(e as Error).message}`);
    }
  };

  /** Export detection results as JSON */
  const onExport = () => {
    if (!done) return;
    const stem = done.fileName.replace(/\.pdf$/i, '');
    downloadJson(done.doc, `${stem}_detected.json`);
  };

  /** Import a JSON file */
  const onImport = async () => {
    const f = await pickFile('.json,application/json');
    if (f) await importJsonFile(f);
  };

  /** Handle drag and drop */
  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (!f || (busy && !pick)) return;
    if (/\.pdf$/i.test(f.name)) await runPdf(f);
    else if (/\.json$/i.test(f.name)) await importJsonFile(f);
  };

  /** Cancel the current pick */
  const cancelPick = () => {
    workerRef.current?.terminate();
    workerRef.current = null;
    jobIdRef.current = null;
    stopElapsedTimer();
    setBusy(false);
    setPick(null);
    setSelectedPages([]);
    setProgress(null);
    setProgressPct(null);
    setLog([]);
    setDone(null);
  };

  return (
    <div className="detect-page" style={{ height: '100vh' }}>
      {/* Header */}
      <header className="detect-header">
        <div className="detect-header-left">
          <h1 className="detect-title">
            <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
              <path d="M16 13H8"/>
              <path d="M16 17H8"/>
              <path d="M10 9H8"/>
            </svg>
            PDF Auto-Detection
          </h1>
          <span className="detect-subtitle">
            Detect columns &amp; walls from architectural drawings — runs entirely in your browser
          </span>
        </div>
        <div className="detect-header-right">
          <a href="/" className="btn">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M19 12H5"/>
              <polyline points="12 19 5 12 12 5"/>
            </svg>
            Back to Editor
          </a>
          {done && (
            <>
              <button className="btn primary" onClick={onExport}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="7 10 12 15 17 10"/>
                  <line x1="12" y1="15" x2="12" y2="3"/>
                </svg>
                Export JSON
              </button>
              <button className="btn" onClick={onImport}>
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/>
                  <polyline points="17 8 12 3 7 8"/>
                  <line x1="12" y1="3" x2="12" y2="15"/>
                </svg>
                Import JSON
              </button>
            </>
          )}
        </div>
      </header>

      {/* Main content */}
      <div className="detect-body">
        {/* Left panel - Controls */}
        <div className="detect-panel">
          {/* Drop zone / PDF picker */}
          <div
            className={`detect-drop${dragOver ? ' over' : ''}`}
            onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
            onDragLeave={() => setDragOver(false)}
            onDrop={onDrop}
          >
            <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" opacity="0.5">
              <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
              <polyline points="14 2 14 8 20 8"/>
            </svg>
            <span className="detect-drop-title">
              {busy && !pick ? 'Processing…' : 'Drop PDF or click to pick'}
            </span>
            <span className="detect-drop-sub">
              Runs entirely in browser — no server needed
            </span>
          </div>

          {/* Action buttons */}
          <div className="detect-actions">
            <button
              className="btn primary full"
              onClick={() => runPdf()}
              disabled={busy && !pick}
            >
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              {busy && !pick ? 'Processing…' : 'Pick PDF…'}
            </button>
            {done && (
              <>
                <button className="btn full" onClick={onExport}>
                  Export JSON
                </button>
                <button className="btn full" onClick={onImport}>
                  Import JSON
                </button>
              </>
            )}
          </div>

          {/* Page picker - appears after PDF is opened */}
          {pick && (
            <div className="detect-pick">
              <div className="detect-pick-title">
                PDF has {pick.pageCount} pages — select which to process:
              </div>
              <div className="detect-pick-chips">
                {Array.from({ length: pick.pageCount }, (_, i) => i + 1).map((p) => (
                  <button
                    key={p}
                    type="button"
                    className={`detect-page-chip${selectedPages.includes(p) ? ' sel' : ''}`}
                    onClick={() => togglePage(p)}
                  >
                    {p}
                  </button>
                ))}
              </div>

              {/* Algorithm selection */}
              <label className="detect-field">
                <span className="detect-field-label">Algorithm:</span>
                <select
                  value={algorithm}
                  onChange={(e) => setAlgorithm(e.target.value as AlgorithmChoice)}
                  disabled={busy && !pick}
                >
                  <option value="auto">Auto (per-page)</option>
                  <option value="britania">Britania</option>
                  <option value="glassworks">GlassWorks</option>
                  <option value="super">SUPER (Adaptive)</option>
                </select>
                <span className="detect-field-hint">{ALGO_HELP[algorithm]}</span>
              </label>

              {/* Scale override */}
              <label className="detect-field">
                <span className="detect-field-label">Scale (mm/pt):</span>
                <input
                  type="number"
                  min={1}
                  max={500}
                  step={0.1}
                  value={manualScale ?? ''}
                  placeholder="Auto"
                  onChange={(e) => {
                    const v = e.target.value;
                    setManualScale(v === '' || Number.isNaN(Number(v)) ? null : Number(v));
                  }}
                  disabled={busy && !pick}
                />
                <span className="detect-field-hint">
                  Empty = auto-detect. Override if scale is wrong.
                </span>
              </label>

              {/* Start / Cancel buttons */}
              <div className="detect-actions">
                <button
                  className="btn primary full"
                  onClick={startRun}
                  disabled={busy || !selectedPages.length}
                >
                  Start Detection
                </button>
                <button className="btn full" onClick={cancelPick}>
                  Cancel
                </button>
              </div>
            </div>
          )}

          {/* Progress */}
          {progress && (
            <div className="detect-progress">
              <span>{progress}</span>
              {elapsedSec > 0 && <span className="detect-elapsed">{elapsedSec}s</span>}
              {progressPct !== null && (
                <div className="detect-progress-bar">
                  <div className="detect-progress-fill" style={{ width: `${progressPct}%` }} />
                </div>
              )}
            </div>
          )}

          {/* Results summary */}
          {done && (
            <div className="detect-results">
              <div className="detect-results-title">Results</div>
              <div className="detect-results-stats">
                <span>{done.processedPages} pages</span>
                <span>{done.fileName}</span>
              </div>
            </div>
          )}

          {/* Log */}
          {log.length > 0 && (
            <div className="detect-log">
              <div className="detect-log-title">Log</div>
              {log.map((line, i) => (
                <div key={i} className="detect-log-line">{line}</div>
              ))}
            </div>
          )}
        </div>

        {/* Right panel - Visual results + table */}
        <div className="detect-canvas">
          {done ? (
            <div className="detect-results-view">
              {/* Visual overlay of detected elements per page */}
              <div className="detect-visual-pages">
                {Object.entries(done.doc.all_pages).map(([key, page]) => (
                  <DetectionVisual key={key} pageKey={key} result={page} />
                ))}
              </div>

              {/* Table summary */}
              {pageReport.length > 0 && (
                <div className="detect-report-table">
                  <div className="detect-report-header">
                    <span>Page</span>
                    <span>Algorithm</span>
                    <span>Columns</span>
                    <span>Walls</span>
                    <span>Time</span>
                  </div>
                  {pageReport.map((r) => (
                    <div key={r.pageNo} className="detect-report-row">
                      <span>{r.pageNo}</span>
                      <span>{r.algo}</span>
                      <span>{r.columns}</span>
                      <span>{r.walls}</span>
                      <span>{r.ms}ms</span>
                    </div>
                  ))}
                  <div className="detect-report-footer">
                    <span>Total</span>
                    <span />
                    <span>{pageReport.reduce((s, r) => s + r.columns, 0)}</span>
                    <span>{pageReport.reduce((s, r) => s + r.walls, 0)}</span>
                    <span>{pageReport.reduce((s, r) => s + r.ms, 0)}ms</span>
                  </div>
                </div>
              )}
            </div>
          ) : pageReport.length > 0 ? (
            <div className="detect-results-view">
              <div className="detect-report-table">
                <div className="detect-report-header">
                  <span>Page</span>
                  <span>Algorithm</span>
                  <span>Columns</span>
                  <span>Walls</span>
                  <span>Time</span>
                </div>
                {pageReport.map((r) => (
                  <div key={r.pageNo} className="detect-report-row">
                    <span>{r.pageNo}</span>
                    <span>{r.algo}</span>
                    <span>{r.columns}</span>
                    <span>{r.walls}</span>
                    <span>{r.ms}ms</span>
                  </div>
                ))}
                <div className="detect-report-footer">
                  <span>Total</span>
                  <span />
                  <span>{pageReport.reduce((s, r) => s + r.columns, 0)}</span>
                  <span>{pageReport.reduce((s, r) => s + r.walls, 0)}</span>
                  <span>{pageReport.reduce((s, r) => s + r.ms, 0)}ms</span>
                </div>
              </div>
            </div>
          ) : (
            <div className="detect-empty">
              <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1" opacity="0.3">
                <path d="M14.5 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V7.5L14.5 2z"/>
                <polyline points="14 2 14 8 20 8"/>
              </svg>
              <p>Drop a PDF or click "Pick PDF" to start detection</p>
              <p className="detect-empty-sub">
                Detected columns (blue) and walls (orange) will be shown as bounding boxes.
                Export the JSON and import it in the main editor.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
