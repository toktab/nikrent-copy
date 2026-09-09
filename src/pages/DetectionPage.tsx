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

/* ── Named Prompt type ── */

interface NamedPrompt {
  id: string;
  name: string;
  text: string;
  createdAt: number;
}

/** Default prompts seeded on first load. */
const DEFAULT_PROMPTS: Omit<NamedPrompt, 'createdAt'>[] = [
  {
    id: 'prompt-default-columns',
    name: 'Column Detection',
    text: 'Analyze this structural drawing and identify all columns. For each column, provide its position (x0, y0, x1, y1), approximate dimensions in centimeters, and any labels or identifiers shown on the drawing. Focus only on vertical structural elements (columns, pillars, posts).',
  },
  {
    id: 'prompt-default-walls',
    name: 'Wall Detection',
    text: 'Analyze this structural drawing and identify all walls and wall segments. For each wall, provide its start and end coordinates (x0, y0, x1, y1), thickness in centimeters, and whether it appears to be load-bearing or partition. Include both exterior and interior walls.',
  },
  {
    id: 'prompt-default-full',
    name: 'Full Structural Analysis',
    text: 'Perform a comprehensive structural analysis of this drawing. Identify all structural elements including columns, walls, beams, and openings. For each element, provide precise coordinates, dimensions in centimeters, element type, and any visible labels. Output a structured JSON with arrays for columns and walls, including drawing_type (plan or section) detection.',
  },
  {
    id: 'prompt-default-section',
    name: 'Section View Analysis',
    text: 'This drawing appears to be a section/elevation view. Analyze it to identify all structural elements visible in cross-section. For each element, provide its center position (cx, cy), width and depth/height in centimeters, rotation angle if applicable, and element type (column, wall, beam). Distinguish between elements seen in cross-section versus those seen in elevation.',
  },
];


function loadNamedPrompts(): NamedPrompt[] {
  try {
    const raw = localStorage.getItem('det-ai-named-prompts');
    if (raw) return JSON.parse(raw);
    // First load: seed with defaults
    const seeded = DEFAULT_PROMPTS.map(p => ({ ...p, createdAt: 0 }));
    localStorage.setItem('det-ai-named-prompts', JSON.stringify(seeded));
    return seeded;
  } catch {
    return [];
  }
}

function saveNamedPrompts(prompts: NamedPrompt[]): void {
  try {
    localStorage.setItem('det-ai-named-prompts', JSON.stringify(prompts));
  } catch { /* quota */ }
}

/* ── AI Settings Modal ── */

function AiSettingsModal({ onClose }: { onClose: () => void }) {
  const [apiKey, setApiKey] = useState(() => localStorage.getItem('det-ai-api-key') ?? '');
  const [prompt, setPrompt] = useState(() => localStorage.getItem('det-ai-prompt') ?? 'Analyze this structural drawing and identify all columns, walls, and their dimensions.');
  const [provider, setProvider] = useState(() => localStorage.getItem('det-ai-provider') ?? 'openai');
  const [model, setModel] = useState(() => localStorage.getItem('det-ai-model') ?? 'gpt-4o');
  const [validating, setValidating] = useState(false);
  const [validResult, setValidResult] = useState<'valid' | 'invalid' | null>(null);
  const [showKey, setShowKey] = useState(false);
  const [namedPrompts, setNamedPrompts] = useState<NamedPrompt[]>(() => loadNamedPrompts());
  const [showPrompts, setShowPrompts] = useState(false);
  const [activePromptId, setActivePromptId] = useState<string | null>(() => localStorage.getItem('det-ai-active-prompt-id'));
  const [showPromptDetail, setShowPromptDetail] = useState<NamedPrompt | null>(null);
  const [newPromptName, setNewPromptName] = useState('');
  const [newPromptText, setNewPromptText] = useState('');
  const [showNewPromptForm, setShowNewPromptForm] = useState(false);
  const [isEditing, setIsEditing] = useState(false);
  const [editName, setEditName] = useState('');
  const [editText, setEditText] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const save = () => {
    localStorage.setItem('det-ai-api-key', apiKey);
    localStorage.setItem('det-ai-prompt', prompt);
    localStorage.setItem('det-ai-provider', provider);
    localStorage.setItem('det-ai-model', model);
    localStorage.setItem('det-ai-validated', validResult === 'valid' ? 'valid' : validResult === 'invalid' ? 'invalid' : '');
    if (activePromptId) {
      localStorage.setItem('det-ai-active-prompt-id', activePromptId);
    }
    onClose();
  };

  const selectPrompt = (p: NamedPrompt) => {
    setPrompt(p.text);
    setActivePromptId(p.id);
    setShowPrompts(false);
    setShowPromptDetail(null);
  };

  const createPrompt = () => {
    if (!newPromptName.trim() || !newPromptText.trim()) return;
    const newPrompt: NamedPrompt = {
      id: `prompt-${Date.now()}`,
      name: newPromptName.trim(),
      text: newPromptText.trim(),
      createdAt: Date.now(),
    };
    const updated = [newPrompt, ...namedPrompts];
    setNamedPrompts(updated);
    saveNamedPrompts(updated);
    setNewPromptName('');
    setNewPromptText('');
    setShowNewPromptForm(false);
    selectPrompt(newPrompt);
  };

  const deletePrompt = (id: string) => {
    const updated = namedPrompts.filter(p => p.id !== id);
    setNamedPrompts(updated);
    saveNamedPrompts(updated);
    if (activePromptId === id) {
      setActivePromptId(null);
      localStorage.removeItem('det-ai-active-prompt-id');
    }
    setShowPromptDetail(null);
  };

  const activatePrompt = (p: NamedPrompt) => {
    setPrompt(p.text);
    setActivePromptId(p.id);
    setShowPromptDetail(null);
  };

  const startEditing = (p: NamedPrompt) => {
    setEditName(p.name);
    setEditText(p.text);
    setIsEditing(true);
  };

  const saveEdit = () => {
    if (!showPromptDetail || !editName.trim() || !editText.trim()) return;
    const updated = namedPrompts.map(p =>
      p.id === showPromptDetail.id
        ? { ...p, name: editName.trim(), text: editText.trim() }
        : p
    );
    setNamedPrompts(updated);
    saveNamedPrompts(updated);
    // Also update showPromptDetail so the view reflects changes
    setShowPromptDetail({ ...showPromptDetail, name: editName.trim(), text: editText.trim() });
    // If this was the active prompt, update the prompt text too
    if (activePromptId === showPromptDetail.id) {
      setPrompt(editText.trim());
    }
    setIsEditing(false);
  };

  const cancelEdit = () => {
    setIsEditing(false);
    setEditName('');
    setEditText('');
  };

  const validateKey = async () => {
    if (!apiKey.trim()) return;
    setValidating(true);
    setValidResult(null);
    try {
      if (provider === 'anthropic') {
        const resp = await fetch('https://api.anthropic.com/v1/messages', {
          method: 'POST',
          headers: { 'x-api-key': apiKey, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
          body: JSON.stringify({ model: 'claude-3-haiku-20240307', max_tokens: 1, messages: [{ role: 'user', content: 'hi' }] }),
        });
        setValidResult(resp.status !== 401 ? 'valid' : 'invalid');
      } else if (provider === 'google') {
        const resp = await fetch(`https://generativelanguage.googleapis.com/v1/models?key=${apiKey}`);
        setValidResult(resp.ok ? 'valid' : 'invalid');
      } else {
        // OpenAI or custom
        const base = provider === 'custom' ? model : 'https://api.openai.com/v1';
        const resp = await fetch(`${base}/models`, {
          headers: { 'Authorization': `Bearer ${apiKey}` },
        });
        setValidResult(resp.ok ? 'valid' : 'invalid');
      }
    } catch {
      setValidResult('invalid');
    } finally {
      setValidating(false);
    }
  };

  return (
    <div className="dm-overlay" onClick={onClose}>
      <div className="dm-modal dm-modal-wide" onClick={(e) => e.stopPropagation()}>
        <button className="dm-close" onClick={onClose}>✕</button>

        {/* Header */}
        <div className="dm-header">
          <div className="dm-header-icon">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none">
              <path d="M14 4l2.5 5.5L22 12l-5.5 2.5L14 20l-2.5-5.5L6 12l5.5-2.5z" fill="var(--accent)" opacity="0.8" />
              <path d="M22 18l1.5 3.5L27 23l-3.5 1.5L22 28l-1.5-3.5L17 23l3.5-1.5z" fill="#f06292" opacity="0.6" />
            </svg>
          </div>
          <div>
            <div className="dm-title">AI Settings</div>
            <div className="dm-subtitle">Configure your AI provider and detection prompt for enhanced analysis.</div>
          </div>
        </div>

        {/* API Key Section */}
        <div className="dm-section">
          <div className="dm-section-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M7 1C4.24 1 2 3.24 2 6c0 1.8 1.1 3.4 2.7 4.2L4 13l2.6-1.3c.13.02.26.03.4.03 2.76 0 5-2.24 5-5S9.76 1 7 1z" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
            API Key
          </div>
          <div className="dm-key-row">
            <div className="dm-key-input-wrap">
              <input
                type={showKey ? 'text' : 'password'}
                className="dm-field-input"
                value={apiKey}
                onChange={(e) => { setApiKey(e.target.value); setValidResult(null); }}
                placeholder="sk-..."
              />
              <button className="dm-key-toggle" onClick={() => setShowKey(!showKey)} title={showKey ? 'Hide' : 'Show'}>
                {showKey ? (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5S1 8 1 8z" stroke="currentColor" strokeWidth="1.2" /><circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" fill="none" /></svg>
                ) : (
                  <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5S1 8 1 8z" stroke="currentColor" strokeWidth="1.2" /><line x1="2" y1="14" x2="14" y2="2" stroke="currentColor" strokeWidth="1.2" /></svg>
                )}
              </button>
            </div>
            <button className="dm-key-validate" onClick={validateKey} disabled={validating || !apiKey.trim()}>
              {validating ? (
                <span className="dm-key-spinner" />
              ) : validResult === 'valid' ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M3 7l3 3 5-5" stroke="var(--ok)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
              ) : validResult === 'invalid' ? (
                <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M4 4l6 6M10 4l-6 6" stroke="var(--bad)" strokeWidth="2" strokeLinecap="round" /></svg>
              ) : (
                'Verify'
              )}
            </button>
          </div>
          {validResult === 'valid' && <div className="dm-key-msg valid">✓ API key is valid</div>}
          {validResult === 'invalid' && <div className="dm-key-msg invalid">✕ Invalid API key or network error</div>}
        </div>

        {/* Provider & Model */}
        <div className="dm-columns-2">
          <div className="dm-section dm-section-compact">
            <div className="dm-section-title">Provider</div>
            <select className="dm-select" value={provider} onChange={(e) => setProvider(e.target.value)}>
              <option value="openai">OpenAI</option>
              <option value="anthropic">Anthropic</option>
              <option value="google">Google AI</option>
              <option value="custom">Custom Endpoint</option>
            </select>
          </div>
          <div className="dm-section dm-section-compact">
            <div className="dm-section-title">Model</div>
            <input className="dm-field-input" value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
          </div>
        </div>          {/* Prompt Section */}
        <div className="dm-section">
          <div className="dm-section-title">
            <svg width="14" height="14" viewBox="0 0 14 14" fill="none"><rect x="1" y="2" width="12" height="10" rx="2" stroke="currentColor" strokeWidth="1.2" fill="none" /><path d="M4 5h6M4 7.5h4" stroke="currentColor" strokeWidth="1" strokeLinecap="round" opacity="0.6" /></svg>
            Detection Prompt
            <button className="dm-page-toggle" onClick={() => setShowPrompts(!showPrompts)}>
              {showPrompts ? 'Close' : 'Prompts'}
            </button>
          </div>

          {/* Current Prompt Display */}
          {!showPrompts && !showPromptDetail && (
            <div className="dm-current-prompt">
              <div className="dm-current-prompt-name">
                {activePromptId ? namedPrompts.find(p => p.id === activePromptId)?.name || 'Custom Prompt' : 'No Prompt Selected'}
                {activePromptId && <span className="dm-active-badge">Active</span>}
              </div>
              <div className="dm-current-prompt-preview">
                {prompt.length > 100 ? prompt.slice(0, 100) + '…' : prompt}
              </div>
              <button className="dm-current-prompt-edit" onClick={() => setShowPrompts(true)}>
                Change Prompt
              </button>
            </div>
          )}

          {/* Prompts List */}
          {showPrompts && !showPromptDetail && (
            <div className="dm-prompts-panel">
              <div className="dm-prompts-header">
                <span className="dm-prompts-title">Saved Prompts</span>
                <button className="dm-prompts-add" onClick={() => setShowNewPromptForm(true)}>+ New</button>
              </div>

              {/* New Prompt Form */}
              {showNewPromptForm && (
                <div className="dm-new-prompt-form">
                  <input
                    className="dm-new-prompt-name"
                    value={newPromptName}
                    onChange={(e) => setNewPromptName(e.target.value)}
                    placeholder="Prompt name..."
                  />
                  <textarea
                    className="dm-new-prompt-text"
                    value={newPromptText}
                    onChange={(e) => setNewPromptText(e.target.value)}
                    placeholder="Enter prompt text..."
                    rows={3}
                  />
                  <div className="dm-new-prompt-actions">
                    <button className="btn small" onClick={() => setShowNewPromptForm(false)}>Cancel</button>
                    <button className="btn small primary" onClick={createPrompt} disabled={!newPromptName.trim() || !newPromptText.trim()}>Save</button>
                  </div>
                </div>
              )}

              {/* Prompts List */}
              <div className="dm-prompts-list">
                {namedPrompts.length === 0 ? (
                  <div className="dm-prompts-empty">No saved prompts yet</div>
                ) : (
                  namedPrompts.map((p) => (
                    <div key={p.id} className={`dm-prompt-item ${activePromptId === p.id ? 'active' : ''}`} onClick={() => setShowPromptDetail(p)}>
                      <div className="dm-prompt-item-name">
                        {p.name}
                        {activePromptId === p.id && <span className="dm-active-badge">Active</span>}
                      </div>
                      <div className="dm-prompt-item-preview">{p.text.length > 60 ? p.text.slice(0, 60) + '…' : p.text}</div>
                    </div>
                  ))
                )}
              </div>
            </div>
          )}

          {/* Prompt Detail */}
          {showPromptDetail && (
            <div className="dm-prompt-detail">
              <button className="dm-prompt-detail-back" onClick={() => { setShowPromptDetail(null); setIsEditing(false); }}>← Back to Prompts</button>
              {!isEditing ? (
                /* View mode */
                <>
                  <div className="dm-prompt-detail-name">
                    {showPromptDetail.name}
                    {activePromptId === showPromptDetail.id && <span className="dm-active-badge">Active</span>}
                  </div>
                  <div className="dm-prompt-detail-text">{showPromptDetail.text}</div>
                  <div className="dm-prompt-detail-actions">
                    <button className="btn small" onClick={() => startEditing(showPromptDetail)}>
                      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" style={{ marginRight: 4 }}><path d="M8.5 1.5l2 2L4 10H2v-2z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                      Edit
                    </button>
                    <button className="btn small danger" onClick={() => deletePrompt(showPromptDetail.id)}>Delete</button>
                    <button className="btn small primary" onClick={() => activatePrompt(showPromptDetail)}>Use This Prompt</button>
                  </div>
                </>
              ) : (
                /* Edit mode */
                <>
                  <div className="dm-prompt-detail-edit-label">Editing Prompt</div>
                  <input
                    className="dm-prompt-detail-edit-name"
                    value={editName}
                    onChange={(e) => setEditName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveEdit(); } }}
                    placeholder="Prompt name..."
                    autoFocus
                  />
                  <textarea
                    className="dm-prompt-detail-edit-text"
                    value={editText}
                    onChange={(e) => setEditText(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Escape') cancelEdit(); }}
                    placeholder="Enter prompt text..."
                    rows={5}
                  />
                  <div className="dm-prompt-detail-actions">
                    <button className="btn small" onClick={cancelEdit}>Cancel</button>
                    <button className="btn small primary" onClick={saveEdit} disabled={!editName.trim() || !editText.trim()}>Save</button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>

        {/* Actions */}
        <div className="dm-modal-actions">
          <button className="btn" onClick={onClose}>Cancel</button>
          <button className="btn primary" onClick={save}>Save Settings</button>
        </div>
      </div>
    </div>
  );
}

/* ── AI provider labels ── */

const PROVIDER_LABELS: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google AI', custom: 'Custom' };

/* ── Main page ── */

export default function DetectionPage() {
  const [history, setHistory] = useState<HistoryEntry[]>(() => loadHistory());
  const [selected, setSelected] = useState<string | null>(null);
  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  const [confirmSwitch, setConfirmSwitch] = useState<HistoryEntry | null>(null);
  const [showInfo, setShowInfo] = useState(false);
  const [aiSettingsOpen, setAiSettingsOpen] = useState(false);
  const [hasApiKey, setHasApiKey] = useState(() => !!localStorage.getItem('det-ai-api-key'));
  const [aiProvider, setAiProvider] = useState(() => localStorage.getItem('det-ai-provider') ?? 'openai');
  const [aiModel, setAiModel] = useState(() => localStorage.getItem('det-ai-model') ?? '');
  const [aiValidStatus, setAiValidStatus] = useState<'valid' | 'unverified' | 'invalid'>(() => {
    const v = localStorage.getItem('det-ai-validated');
    if (v === 'valid') return 'valid';
    if (v === 'invalid') return 'invalid';
    return 'unverified';
  });
  const aiDotClass = hasApiKey ? `det-ai-dot ${aiValidStatus}` : 'det-ai-dot no-key';
  const aiTooltip = hasApiKey
    ? `${PROVIDER_LABELS[aiProvider] ?? aiProvider} · ${aiModel || 'default model'} — ${aiValidStatus}`
    : 'AI Settings — not configured';

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
            <div className="det-sidebar-header-btns">
              <button className={`det-ai-btn ${hasApiKey ? 'configured' : ''}`} onClick={() => setAiSettingsOpen(true)} title={aiTooltip}>
                <svg width="14" height="14" viewBox="0 0 16 16" fill="none">
                  <path d="M8 2l1.5 3.2 3.5.8-2.5 2.5.5 3.5L8 10l-3 2 .5-3.5L3 6l3.5-.8z" fill="currentColor" opacity="0.9" />
                </svg>
                <span className={aiDotClass} />
              </button>
              <button className="det-sidebar-add" onClick={() => setModalOpen(true)}>
                +
                <span className="det-add-shimmer" />
              </button>
            </div>
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
              <div className="det-empty-anim">
                <div className="det-empty-rings">
                  <div className="det-empty-ring r1" />
                  <div className="det-empty-ring r2" />
                  <div className="det-empty-ring r3" />
                </div>
                <div className="det-empty-pdf">
                  <svg width="64" height="80" viewBox="0 0 64 80" fill="none">
                    <rect x="4" y="2" width="56" height="76" rx="8" fill="var(--surface)" stroke="var(--line-strong)" strokeWidth="1.5" />
                    <path d="M40 2v18h18" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
                    <path d="M40 2l18 18" stroke="var(--line-strong)" strokeWidth="1.5" strokeLinejoin="round" fill="none" />
                    <rect x="16" y="36" width="32" height="4" rx="2" fill="var(--accent)" opacity="0.5" />
                    <rect x="16" y="46" width="24" height="4" rx="2" fill="var(--accent)" opacity="0.3" />
                    <rect x="16" y="56" width="28" height="4" rx="2" fill="var(--accent)" opacity="0.2" />
                  </svg>
                </div>
              </div>
              <div className="det-empty-title">No detection selected</div>
              <div className="det-empty-sub">Upload a PDF and run AI-powered detection to extract structural elements</div>
              <button className="det-empty-cta" onClick={() => setModalOpen(true)}>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M8 3v10M3 8h10" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
                Create Detection
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Wizard Modal */}
      {modalOpen && <DetectionWizard onClose={() => setModalOpen(false)} onDone={handleNewDetection} />}

      {/* AI Settings Modal */}
      {aiSettingsOpen && (
        <AiSettingsModal onClose={() => {
          setAiSettingsOpen(false);
          setHasApiKey(!!localStorage.getItem('det-ai-api-key'));
          setAiProvider(localStorage.getItem('det-ai-provider') ?? 'openai');
          setAiModel(localStorage.getItem('det-ai-model') ?? '');
          const v = localStorage.getItem('det-ai-validated');
          setAiValidStatus(v === 'valid' ? 'valid' : v === 'invalid' ? 'invalid' : 'unverified');
        }} />
      )}

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
