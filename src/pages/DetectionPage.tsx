import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  AlgorithmChoice,
  LegacyDetectedDoc,
  WorkerMessage,
} from '../lib/detection/types';
import { downloadJson, pickFile, readFileAsArrayBuffer } from '../lib/files';
import type { Piece, SketchPath } from '../types';
import '../styles/detection.css';

/* ── Constants ── */

const HISTORY_KEY = 'detect-history';

interface HistoryEntry {
  id: string;
  name: string;
  description: string;
  fileName: string;
  timestamp: number;
  doc: LegacyDetectedDoc;
  pageCount: number;
  totalColumns: number;
  totalWalls: number;
}

function loadHistory(): HistoryEntry[] {
  try {
    const raw = localStorage.getItem(HISTORY_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  try {
    localStorage.setItem(HISTORY_KEY, JSON.stringify(entries));
  } catch { /* quota */ }
}

/** Format a timestamp for the sidebar. */
function fmtTime(ts: number): string {
  const d = new Date(ts);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  const hh = String(d.getHours()).padStart(2, '0');
  const mi = String(d.getMinutes()).padStart(2, '0');
  return `${d.getFullYear()}.${mm}.${dd} ${hh}:${mi}`;
}

/* ── SketchPath (read-only) ── */

function ReadOnlySketchLayer({ sketch, zoom }: { sketch: SketchPath[]; zoom: number }) {
  if (!sketch.length) return null;
  const hair = 1.5 / zoom;
  return (
    <svg className="sketch-layer" style={{ left: 0, top: 0, width: 4000, height: 3000 }} viewBox="0 0 4000 3000" pointerEvents="none">
      {sketch.map((path) => {
        const pts = path.points;
        if (pts.length < 2) return null;
        return (
          <g key={path.id} className="sketch-path">
            {pts.map((p, i) => {
              const next = pts[(i + 1) % pts.length];
              if (i >= pts.length - 1 && !path.closed) return null;
              return (
                <g key={i}>
                  <line className="sketch-under" x1={p.x} y1={p.y} x2={next.x} y2={next.y} strokeWidth={hair * 3.4} />
                  <line x1={p.x} y1={p.y} x2={next.x} y2={next.y} strokeWidth={hair * 1.8} />
                </g>
              );
            })}
            {pts.map((p, i) => (
              <circle key={`v${i}`} className="sketch-vertex" cx={p.x} cy={p.y} r={hair * 2.4} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}

/* ── Canvas ── */

function DetectionCanvas({ doc }: { doc: LegacyDetectedDoc }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [zoom, setZoom] = useState(1);
  const [panX, setPanX] = useState(40);
  const [panY, setPanY] = useState(40);
  const [grabbing, setGrabbing] = useState(false);
  const panning = useRef<{ sx: number; sy: number; px: number; py: number } | null>(null);

  const { pieces, sketch, dimsById } = useMemo(() => {
    const materialByPage: Piece[] = [];
    const sketchByPage: SketchPath[] = [];
    const dimsMap = new Map<string, { w: number; h: number }>();
    let xOff = 0;
    const GAP = 100;
    const MARGIN = 40;

    for (const [key, page] of Object.entries(doc.all_pages)) {
      const isPlan = page.drawing_type === 'plan';
      const pageIdx = Number(key.replace('page_', '')) || 1;

      if (isPlan) {
        const columns = (page as any).columns ?? [];
        const walls = (page as any).walls ?? [];
        const allBoxes = [...columns, ...walls];
        const xs = allBoxes.flatMap((b: any) => [b.x0, b.x1]);
        const ys = allBoxes.flatMap((b: any) => [b.y0, b.y1]);
        const left = xs.length ? Math.min(...xs) - MARGIN : 0;
        const top = ys.length ? Math.min(...ys) - MARGIN : 0;

        for (const col of columns) {
          const id = `det-col-${pageIdx}-${col.id ?? Math.random().toString(36).slice(2)}`;
          const w = Math.max(5, col.x1 - col.x0);
          const h = Math.max(5, col.y1 - col.y0);
          dimsMap.set(id, { w, h });
          materialByPage.push({ id, materialId: id, x: col.x0 - left + xOff, y: col.y0 - top, rot: 0, z: 0 });
        }

        for (const wall of walls) {
          const id = `det-wall-${pageIdx}-${wall.id ?? Math.random().toString(36).slice(2)}`;
          const w = Math.max(3, wall.x1 - wall.x0);
          const h = Math.max(3, wall.y1 - wall.y0);
          dimsMap.set(id, { w, h });
          materialByPage.push({ id, materialId: id, x: wall.x0 - left + xOff, y: wall.y0 - top, rot: 0, z: 0 });
        }

        for (const wall of walls) {
          sketchByPage.push({
            id: `det-sk-${pageIdx}-${wall.id ?? Math.random().toString(36).slice(2)}`,
            points: [
              { x: wall.x0 - left + xOff, y: wall.y0 - top },
              { x: wall.x1 - left + xOff, y: wall.y1 - top },
            ],
          });
        }
        if (xs.length) xOff += Math.max(...xs) - Math.min(...xs) + 2 * MARGIN + GAP;
        else xOff += 800 + GAP;
      } else {
        const columns = (page as any).detectedColumns ?? [];
        const walls = (page as any).detectedWalls ?? [];
        const allCx = [...walls.map((w: any) => w.cx), ...columns.map((c: any) => c.cx)];
        const allCy = [...walls.map((w: any) => w.cy), ...columns.map((c: any) => c.cy)];
        if (allCx.length === 0) { xOff += 800; continue; }
        const baseX = Math.min(...allCx) - MARGIN + xOff;
        const baseY = Math.min(...allCy) - MARGIN;

        for (const col of columns) {
          const id = `det-scol-${pageIdx}-${col.id}`;
          const w = col.widthCm ?? 30;
          const h = col.depthCm ?? 30;
          dimsMap.set(id, { w, h });
          materialByPage.push({ id, materialId: id, x: col.cx - w / 2 - baseX + xOff, y: col.cy - h / 2 - baseY, rot: 0, z: 0 });
        }

        for (const wall of walls) {
          const id = `det-swall-${pageIdx}-${wall.id}`;
          const hw = (wall.thicknessCm ?? 20) / 2;
          const hl = (wall.lengthCm ?? 100) / 2;
          const isVert = wall.rotation === 90;
          const w = isVert ? hw * 2 : hl * 2;
          const h = isVert ? hl * 2 : hw * 2;
          dimsMap.set(id, { w, h });
          materialByPage.push({ id, materialId: id, x: wall.cx - w / 2 - baseX + xOff, y: wall.cy - h / 2 - baseY, rot: 0, z: 0 });
        }
        if (allCx.length) xOff += Math.max(...allCx) - Math.min(...allCx) + 2 * MARGIN + GAP;
        else xOff += 800 + GAP;
      }
    }

    return { pieces: materialByPage, sketch: sketchByPage, dimsById: dimsMap };
  }, [doc]);

  useEffect(() => {
    const el = stageRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
      const newZoom = Math.min(8, Math.max(0.08, zoom * factor));
      const wx = (e.clientX - r.left - panX) / zoom;
      const wy = (e.clientY - r.top - panY) / zoom;
      setZoom(newZoom);
      setPanX(e.clientX - r.left - wx * newZoom);
      setPanY(e.clientY - r.top - wy * newZoom);
    };
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [zoom, panX, panY]);

  const onPointerDown = (e: React.PointerEvent) => {
    if (e.button !== 0) return;
    panning.current = { sx: e.clientX, sy: e.clientY, px: panX, py: panY };
    setGrabbing(true);
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!panning.current) return;
    setPanX(panning.current.px + (e.clientX - panning.current.sx));
    setPanY(panning.current.py + (e.clientY - panning.current.sy));
  };
  const onPointerUp = () => { panning.current = null; setGrabbing(false); };

  const WORLD_W = 4000;
  const WORLD_H = 3000;
  const gridStep = (() => {
    const target = 4.5 / zoom;
    return [5, 10, 20, 50, 100, 200, 500].find((s) => s >= target) ?? 500;
  })();

  return (
    <main
      ref={stageRef}
      className="det-stage"
      style={{ cursor: grabbing ? 'grabbing' : 'grab' }}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
    >
      <div
        className="world"
        style={{ transform: `translate(${panX}px, ${panY}px) scale(${zoom})`, '--z': zoom } as any}
      >
        <div className="grid" style={{ width: WORLD_W, height: WORLD_H, '--gw': `${1 / zoom}px`, '--gf': `${gridStep}px`, '--gm': '100px' } as any} />
        <ReadOnlySketchLayer sketch={sketch} zoom={zoom} />
        {pieces.map((piece) => {
          const dim = dimsById.get(piece.materialId);
          if (!dim) return null;
          return (
            <div key={piece.id} className="piece" style={{ left: piece.x, top: piece.y, width: dim.w, height: dim.h, transform: `rotate(${piece.rot}deg)` }}>
              <svg width={dim.w} height={dim.h} viewBox={`0 0 ${dim.w} ${dim.h}`}>
                <rect width={dim.w} height={dim.h} fill="none" stroke="#e8c840" strokeWidth={2.5 / zoom} />
              </svg>
            </div>
          );
        })}
      </div>
      <div className="det-canvas-hint">
        {zoom > 0 ? `${Math.round(zoom * 100)}%` : '—'} · Read-only · Detected elements
      </div>
    </main>
  );
}

/* ── Single-page Detection Wizard ── */

const ALGO_OPTIONS: { value: AlgorithmChoice; label: string; icon: string; desc: string; color: string }[] = [
  { value: 'auto',       label: 'Auto',        icon: '🤖', desc: 'Best algorithm per page',        color: '#70a6f5' },
  { value: 'britania',   label: 'Britania',     icon: '🏛️', desc: 'Structural columns & walls',      color: '#e8c840' },
  { value: 'glassworks', label: 'GlassWorks',   icon: '🪟', desc: 'Glass façade detection',          color: '#5ad4a8' },
  { value: 'super',      label: 'SUPER',        icon: '🚀', desc: 'Advanced multi-pass detection',   color: '#f0786c' },
];

function DetectionWizard({ onClose, onDone }: { onClose: () => void; onDone: (entry: HistoryEntry) => void }) {
  const [pdfFile, setPdfFile] = useState<File | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [selectedPages, setSelectedPages] = useState<number[]>([]);
  const [algorithm, setAlgorithm] = useState<AlgorithmChoice>('auto');
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState('');
  const [progressPct, setProgressPct] = useState<number | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const workerRef = useRef<Worker | null>(null);
  const jobIdRef = useRef<string | null>(null);
  const [nextNum] = useState(() => loadHistory().length + 1);

  useEffect(() => () => { workerRef.current?.terminate(); }, []);

  const openPdf = useCallback(async (file: File) => {
    setPdfFile(file);
    setBusy(true);
    setProgress('Reading PDF…');
    setName(`Detection ${nextNum}`);
    const id = `det-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    jobIdRef.current = id;
    const buffer = await readFileAsArrayBuffer(file);
    const worker = new Worker(new URL('../lib/detection/detectionWorker.ts', import.meta.url), { type: 'module' });
    workerRef.current = worker;
    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const msg = ev.data;
      if (msg.type === 'pages') {
        const all = Array.from({ length: msg.pageCount }, (_, i) => i + 1);
        setSelectedPages(all);
        setPageCount(msg.pageCount);
        setBusy(false);
        setProgress('');
      }
    };
    worker.onerror = (e) => { setBusy(false); setProgress('Error: ' + e.message); };
    worker.postMessage({ type: 'detect', id, pdf: buffer, fileName: file.name, algorithm: 'auto', drawingType: 'auto', mode: 'auto', scale: 50 });
  }, [nextNum]);

  const runDetection = useCallback(() => {
    const worker = workerRef.current;
    const id = jobIdRef.current;
    if (!worker || !id || !pdfFile) return;
    setBusy(true);
    setProgress('Detecting…');
    setProgressPct(null);
    worker.onmessage = (ev: MessageEvent<WorkerMessage>) => {
      const msg = ev.data;
      if (msg.type === 'page') {
        const r = msg.result;
        const isSection = r.drawing_type === 'section';
        const cols = isSection ? r.detectedColumns.length : r.columns.length;
        const walls = isSection ? r.detectedWalls.length : r.walls.length;
        setProgress(`Page ${msg.pageNo}: ${cols} cols, ${walls} walls`);
        setProgressPct(msg.pageCount > 0 ? Math.round((msg.pageNo / msg.pageCount) * 100) : null);
      }
      if (msg.type === 'done') {
        worker.terminate();
        workerRef.current = null;
        const doc: LegacyDetectedDoc = {
          source: { pdf: pdfFile.name, n_pages: msg.pageCount },
          algorithms: msg.algorithms,
          all_pages: Object.fromEntries(msg.pages.map((r, i) => [`page_${msg.pageNos[i]}`, r])),
        };
        const totalCols = msg.counts.reduce((s, c) => s + c.columns, 0);
        const totalWalls = msg.counts.reduce((s, c) => s + c.walls, 0);
        onDone({
          id: `det-${Date.now()}`,
          name: name || `Detection ${nextNum}`,
          description,
          fileName: pdfFile.name,
          timestamp: Date.now(),
          doc,
          pageCount: msg.pages.length,
          totalColumns: totalCols,
          totalWalls: totalWalls,
        });
        setBusy(false);
        setProgress('');
        setProgressPct(null);
      }
      if (msg.type === 'error') {
        worker.terminate();
        workerRef.current = null;
        setBusy(false);
        setProgress('Error: ' + msg.message);
      }
    };
    worker.postMessage({ type: 'run', id, pages: selectedPages, algorithm });
  }, [pdfFile, selectedPages, algorithm, name, description, nextNum, onDone]);

  const togglePage = (p: number) => setSelectedPages((prev) => prev.includes(p) ? prev.filter((x) => x !== p) : [...prev, p].sort((a, b) => a - b));
  const toggleAllPages = () => {
    if (selectedPages.length === pageCount) setSelectedPages([]);
    else setSelectedPages(Array.from({ length: pageCount }, (_, i) => i + 1));
  };

  const onDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setDragOver(false);
    const f = e.dataTransfer.files?.[0];
    if (f && /\.pdf$/i.test(f.name)) await openPdf(f);
  };

  const hasFile = !!pdfFile;
  const hasPages = selectedPages.length > 0;
  const canDetect = hasFile && hasPages && !busy;
  const selectedAlgo = ALGO_OPTIONS.find((a) => a.value === algorithm) ?? ALGO_OPTIONS[0];

  return (
    <div className="dm-overlay" onClick={onClose}>
      <div className="dm-modal dm-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="dm-close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="dm-header">
          <div className="dm-header-icon">✨</div>
          <div>
            <div className="dm-title">New Detection</div>
            <div className="dm-subtitle">Upload a PDF, pick your algorithm, and choose pages — all in one step.</div>
          </div>
        </div>

        {/* Upload Section */}
        <div className="dm-section">
          {!hasFile ? (
            <div
              className={`dm-drop ${dragOver ? 'over' : ''}`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={onDrop}
            >
              <div className="dm-drop-icon">
                <svg width="56" height="56" viewBox="0 0 56 56" fill="none">
                  <rect x="8" y="4" width="40" height="48" rx="6" stroke="currentColor" strokeWidth="2" strokeDasharray="4 3" fill="none" opacity="0.4" />
                  <path d="M28 20v16M20 28l8-8 8 8" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" opacity="0.7" />
                </svg>
              </div>
              <div className="dm-drop-label">Drop a PDF here</div>
              <div className="dm-drop-sub">or</div>
              <button className="btn primary dm-drop-btn" onClick={() => pickFile('.pdf').then((f) => f && openPdf(f))}>
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1v12M1 7h12" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                Choose PDF
              </button>
            </div>
          ) : (
            <div className="dm-file-loaded">
              <div className="dm-file-icon-wrap">
                <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
                  <rect x="3" y="1" width="22" height="26" rx="4" stroke="var(--ok)" strokeWidth="1.5" fill="none" />
                  <path d="M8 14l4 4 8-8" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <div className="dm-file-info">
                <div className="dm-file-name">{pdfFile.name}</div>
                <div className="dm-file-meta">{pageCount} pages · Ready</div>
              </div>
              <button className="btn ghost small" onClick={() => { setPdfFile(null); setPageCount(0); setSelectedPages([]); }}>Change</button>
            </div>
          )}
        </div>

        {/* Algorithm Cards — always visible */}
        <div className="dm-section">
          <div className="dm-section-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1.2" /><path d="M7 4.5v5M4.5 7h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" /></svg>
            Algorithm
          </div>
          <div className="dm-algo-grid">
            {ALGO_OPTIONS.map((a) => (
              <button
                key={a.value}
                className={`dm-algo-card ${algorithm === a.value ? 'sel' : ''}`}
                style={{ '--algo-color': a.color } as any}
                onClick={() => setAlgorithm(a.value)}
              >
                <div className="dm-algo-icon">{a.icon}</div>
                <div className="dm-algo-label">{a.label}</div>
                <div className="dm-algo-desc">{a.desc}</div>
              </button>
            ))}
          </div>
        </div>

        {/* Pages — always visible, disabled until file loads */}
        <div className="dm-section">
          <div className="dm-section-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="2" y="1" width="10" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" /><path d="M5 5h4M5 7.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" /></svg>
            Pages
            {pageCount > 0 && <span className="dm-section-badge">{selectedPages.length}/{pageCount}</span>}
            {pageCount > 0 && <button className="dm-page-toggle" onClick={toggleAllPages}>{selectedPages.length === pageCount ? 'Deselect all' : 'Select all'}</button>}
          </div>
          {!hasFile ? (
            <div className="dm-pages-placeholder">Upload a PDF to select pages</div>
          ) : (
            <div className="dm-chips">
              {Array.from({ length: pageCount }, (_, i) => i + 1).map((p) => (
                <button key={p} className={`dm-chip ${selectedPages.includes(p) ? 'sel' : ''}`} onClick={() => togglePage(p)}>
                  {p}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Details row — always visible */}
        <div className="dm-columns-2">
          <label className="dm-field">
            <span>Name</span>
            <input type="text" value={name} onChange={(e) => setName(e.target.value)} placeholder={`Detection ${nextNum}`} />
          </label>
          <label className="dm-field">
            <span>Description (optional)</span>
            <input type="text" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="e.g. Ground floor plan" />
          </label>
        </div>

        {/* Progress */}
        {busy && (
          <div className="dm-progress">
            <div className="dm-progress-bar">
              <div className="dm-progress-fill" style={{ width: progressPct ? `${progressPct}%` : '100%' }} />
            </div>
            <div className="dm-progress-text">{progress}</div>
          </div>
        )}

        {/* Action Button */}
        <button className="btn primary full dm-action-btn" onClick={runDetection} disabled={!canDetect}>
          <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8l5-5v3.5h5v3H8V13z" fill="currentColor" /></svg>
          {busy ? 'Detecting…' : 'Start Detection'}
        </button>
      </div>
    </div>
  );
}

/* ── Confirm Dialog ── */

function ConfirmDialog({ title, message, icon, onConfirm, onCancel, danger }: {
  title: string; message: string; icon?: string; onConfirm: () => void; onCancel: () => void; danger?: boolean;
}) {
  return (
    <div className="dm-confirm-overlay" onClick={onCancel}>
      <div className="dm-confirm" onClick={(e) => e.stopPropagation()}>
        <div className="dm-confirm-icon">{icon || '🔍'}</div>
        <div className="dm-confirm-title">{title}</div>
        <div className="dm-confirm-message">{message}</div>
        <div className="dm-confirm-actions">
          <button className="btn" onClick={onCancel}>Cancel</button>
          <button className={`btn ${danger ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {danger ? 'Delete' : 'Open'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ── Detection Info Panel ── */

function DetectionInfoPanel({ entry, onClose, onExport, onImport }: {
  entry: HistoryEntry; onClose: () => void; onExport: () => void; onImport: () => void;
}) {
  return (
    <div className="det-info-panel">
      <div className="det-info-header">
        <div className="det-info-title">{entry.name}</div>
        <button className="det-info-close" onClick={onClose}>✕</button>
      </div>
      {entry.description && <div className="det-info-desc">{entry.description}</div>}
      <div className="det-info-stats">
        <div className="det-info-stat"><div className="det-info-stat-value">{entry.pageCount}</div><div className="det-info-stat-label">Pages</div></div>
        <div className="det-info-stat"><div className="det-info-stat-value">{entry.totalColumns}</div><div className="det-info-stat-label">Columns</div></div>
        <div className="det-info-stat"><div className="det-info-stat-value">{entry.totalWalls}</div><div className="det-info-stat-label">Walls</div></div>
        <div className="det-info-stat"><div className="det-info-stat-value">{entry.totalColumns + entry.totalWalls}</div><div className="det-info-stat-label">Elements</div></div>
      </div>
      <div className="det-info-meta">
        <span>{entry.fileName}</span>
        <span>{fmtTime(entry.timestamp)}</span>
      </div>
      <div className="det-info-actions">
        <button className="det-info-btn" onClick={onExport}>Export JSON</button>
        <button className="det-info-btn primary" onClick={onImport}>Import to Editor</button>
      </div>
    </div>
  );
}

/* ── Editable inline field ── */

function EditableField({ value, placeholder, className, onCommit }: {
  value: string; placeholder?: string; className?: string; onCommit: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  const [editing, setEditing] = useState(false);
  useEffect(() => setDraft(value), [value]);

  if (!editing) {
    return (
      <span className={`${className ?? ''} editable-field`} onClick={(e) => { e.stopPropagation(); setEditing(true); }} title="Click to edit">
        {value || <span className="editable-placeholder">{placeholder ?? '—'}</span>}
      </span>
    );
  }
  return (
    <input
      className={`${className ?? ''} editable-input`}
      value={draft}
      placeholder={placeholder}
      autoFocus
      onClick={(e) => e.stopPropagation()}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={() => { setEditing(false); onCommit(draft); }}
      onKeyDown={(e) => {
        if (e.key === 'Enter') { e.currentTarget.blur(); }
        if (e.key === 'Escape') { setDraft(value); setEditing(false); }
      }}
    />
  );
}

/* ── Main page ── */

export default function DetectionPage() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<HistoryEntry | null>(null);
  const [showInfo, setShowInfo] = useState(false);

  const active = useMemo(() => history.find((h) => h.id === selected) ?? null, [history, selected]);

  const handleNewDetection = useCallback((entry: HistoryEntry) => {
    const updated = [entry, ...history];
    setHistory(updated);
    saveHistory(updated);
    setSelected(entry.id);
    setModalOpen(false);
  }, [history]);

  const deleteEntry = useCallback((id: string) => {
    const updated = history.filter((h) => h.id !== id);
    setHistory(updated);
    saveHistory(updated);
    if (selected === id) setSelected(updated[0]?.id ?? null);
    setConfirmDelete(null);
  }, [history, selected]);

  const updateEntry = useCallback((id: string, patch: Partial<Pick<HistoryEntry, 'name' | 'description'>>) => {
    setHistory((prev) => {
      const updated = prev.map((h) => h.id === id ? { ...h, ...patch } : h);
      saveHistory(updated);
      return updated;
    });
  }, []);

  const exportToFile = useCallback(() => {
    if (!active) return;
    downloadJson(active.doc, `${active.name.replace(/\s+/g, '_')}_detected.json`);
  }, [active]);

  const exportToEditor = useCallback(() => {
    if (!active) return;
    sessionStorage.setItem('detect-import', JSON.stringify(active.doc));
    window.location.href = '/';
  }, [active]);

  const handleItemClick = useCallback((entry: HistoryEntry) => {
    if (entry.id === selected) {
      setShowInfo(true);
      return;
    }
    setConfirmSwitch(entry);
  }, [selected]);

  const confirmSwitchTo = useCallback((entry: HistoryEntry) => {
    setSelected(entry.id);
    setShowInfo(true);
    setConfirmSwitch(null);
  }, []);

  const deleteTarget = useMemo(() => history.find((h) => h.id === confirmDelete) ?? null, [history, confirmDelete]);

  return (
    <div className="det-page">
      {/* Sidebar */}
      <aside className={`det-sidebar ${sidebarOpen ? 'open' : ''}`}>
        <div className="det-sidebar-content">
          <div className="det-sidebar-header">
            <button className="det-sidebar-add" onClick={() => setModalOpen(true)}>
              +
              <span className="det-add-shimmer" />
            </button>
          </div>
          <div className="det-sidebar-list">
            {history.length === 0 && <div className="det-sidebar-empty">No detections yet</div>}
            {history.map((h) => (
              <div key={h.id} className={`det-sidebar-item ${selected === h.id ? 'active' : ''}`} onClick={() => handleItemClick(h)}>
                <div className="det-sidebar-item-top">
                  <EditableField className="det-sidebar-item-name" value={h.name} placeholder="Detection" onCommit={(v) => updateEntry(h.id, { name: v || h.name })} />
                  <button className="det-sidebar-item-delete" onClick={(e) => { e.stopPropagation(); setConfirmDelete(h.id); }} title="Delete">✕</button>
                </div>
                <div className="det-sidebar-item-desc">
                  <EditableField value={h.description} placeholder="No description" onCommit={(v) => updateEntry(h.id, { description: v })} />
                </div>
                <div className="det-sidebar-item-meta">
                  <span className="det-sidebar-item-time">{fmtTime(h.timestamp)}</span>
                  <span className="det-sidebar-item-stats">{h.pageCount}p · {h.totalColumns}C {h.totalWalls}W</span>
                </div>
              </div>
            ))}
          </div>
        </div>
        <button className="det-sidebar-toggle" onClick={() => setSidebarOpen(!sidebarOpen)} title={sidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}>
          <svg width="14" height="14" viewBox="0 0 14 14" fill="none">
            <path d="M9 3L5 7L9 11" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </button>
      </aside>

      {/* Main content */}
      <div className="det-main">
        <div className="det-canvas-wrap">
          <div className="det-actions">
            <button className="det-action-btn" onClick={exportToFile} disabled={!active}>Export</button>
            <button className="det-action-btn primary" onClick={exportToEditor} disabled={!active}>Import</button>
          </div>
          {active && showInfo && (
            <DetectionInfoPanel entry={active} onClose={() => setShowInfo(false)} onExport={exportToFile} onImport={exportToEditor} />
          )}
          {active ? (
            <DetectionCanvas doc={active.doc} />
          ) : (
            <div className="det-empty-state">
              <div className="det-empty-title">No detection selected</div>
              <div className="det-empty-sub">Click + to add a new detection, or select one from the list</div>
            </div>
          )}
        </div>
      </div>

      {/* Wizard Modal */}
      {modalOpen && <DetectionWizard onClose={() => setModalOpen(false)} onDone={handleNewDetection} />}

      {/* Confirm Dialogs */}
      {confirmDelete && deleteTarget && (
        <ConfirmDialog title="Delete Detection" message={`Are you sure you want to delete "${deleteTarget.name}"?`} icon="🗑️" danger onConfirm={() => deleteEntry(confirmDelete)} onCancel={() => setConfirmDelete(null)} />
      )}
      {confirmSwitch && (
        <ConfirmDialog title="Switch Detection" message={`Open "${confirmSwitch.name}"?`} icon="🔍" onConfirm={() => confirmSwitchTo(confirmSwitch)} onCancel={() => setConfirmSwitch(null)} />
      )}
    </div>
  );
}
