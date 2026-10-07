import { useEffect, useMemo, useState } from 'react';
import type { DrawingDoc, LayoutFile } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { buildLayoutFile, exportLayoutFile, layoutFileHasContent } from '../lib/catalogFile';
import type { PdfVisibility } from '../lib/dimensions';
import { SHEET_SIZES, type JsonExportOptions } from '../lib/exportOptions';
import { segments } from '../lib/sketch';
import { Icon } from './Icon';
import { Modal } from './Modal';

type Tab = 'pdf' | 'json';

/** 0 = auto: the largest standard scale that still fits the sheet. */
const SCALES = [0, 10, 20, 25, 50, 100, 200];
/** About 56 dpi: enough to judge the sheet, quick enough to redraw on every tick. */
const PREVIEW_PX_PER_MM = 2.2;
const PREVIEW_DELAY_MS = 150;
const JSON_PREVIEW_LINES = 80;

interface Counts {
  pieces: number;
  lines: number;
  measures: number;
}

/**
 * Everything the drawing goes out as, in one window: the PDF sheet and the JSON
 * file, each with a switch for every part of the drawing and a preview of what
 * those switches produce.
 *
 * Both used to be a single menu click that printed whatever the display
 * settings happened to be. What goes on paper for the site and what goes in a
 * file for the next program are different questions, and the answer to each
 * belongs next to the button that acts on it. The choices are remembered.
 */
export function ExportDialog({ tab: initialTab }: { tab: Tab }) {
  const [tab, setTab] = useState<Tab>(initialTab);
  const [busy, setBusy] = useState(false);

  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const sketch = useEditorStore((s) => s.sketch);
  const measures = useEditorStore((s) => s.measures);
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const vis = useEditorStore((s) => s.pdfVisibility);
  const sheet = useEditorStore((s) => s.pdfSheet);
  const json = useEditorStore((s) => s.jsonExport);
  const resetPdfVisibility = useEditorStore((s) => s.resetPdfVisibility);
  const resetJsonExport = useEditorStore((s) => s.resetJsonExport);

  const activeDoc = documents.find((d) => d.id === activeDocId);
  // The live mirrors, not the stored copy, so the export holds exactly what is
  // on screen this instant.
  const doc = useMemo<DrawingDoc | null>(
    () => (activeDoc ? { ...activeDoc, pieces, sketch, measures } : null),
    [activeDoc, pieces, sketch, measures],
  );
  const counts: Counts = { pieces: pieces.length, lines: sketch.length, measures: measures.length };

  const file = useMemo(
    () => (doc ? buildLayoutFile(doc, materials, json) : null),
    [doc, materials, json],
  );

  const bomOn = vis.bomPage && pieces.length > 0;
  const pdfHasContent =
    (vis.pieces && pieces.length > 0) ||
    ((vis.sketchLines || vis.line) && sketch.length > 0) ||
    ((vis.measureLines || vis.measure) && measures.length > 0) ||
    bomOn;
  const jsonHasContent = !!file && layoutFileHasContent(file);

  const onPdf = async () => {
    if (!doc) return;
    setBusy(true);
    try {
      const { exportDrawingToPdf } = await import('../lib/drawingPdf');
      const result = await exportDrawingToPdf({
        doc,
        materials,
        sheet,
        visibility: vis,
        bom: bomOn ? buildBom(materials, pieces, documents, activeDocId) : null,
      });
      if (!result) {
        setToast('PDF-ზე არაფერი დარჩა - ჩართე ერთი ნაწილი მაინც.');
        return;
      }
      if (result.sheet?.rescaled) {
        setToast(`ნახაზი არ ეტეოდა 1:${doc.scale}-ში - დაიბეჭდა 1:${result.sheet.scale} მასშტაბით.`);
      }
      closeDialog();
    } catch (e) {
      setToast(`PDF ვერ შეიქმნა: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const onJson = () => {
    if (!doc) return;
    exportLayoutFile(doc, materials, json);
    closeDialog();
  };

  return (
    <Modal
      title="ექსპორტი"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={tab === 'pdf' ? resetPdfVisibility : resetJsonExport}>
            ნაგულისხმევი
          </button>
          <span className="flex-spacer" />
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          {tab === 'pdf' ? (
            <button
              className="btn primary"
              disabled={!pdfHasContent || busy}
              title={pdfHasContent ? undefined : 'PDF-ზე არაფერი დარჩა - ჩართე ერთი ნაწილი მაინც'}
              onClick={() => void onPdf()}
            >
              <Icon name="print" size={15} /> {busy ? 'იქმნება…' : 'PDF-ის ჩამოტვირთვა'}
            </button>
          ) : (
            <button
              className="btn primary"
              disabled={!jsonHasContent}
              title={jsonHasContent ? undefined : 'ფაილში არაფერი დარჩა - ჩართე ერთი ნაწილი მაინც'}
              onClick={onJson}
            >
              <Icon name="download" size={15} /> JSON-ის ჩამოტვირთვა
            </button>
          )}
        </>
      }
    >
      <div className="vis-top">
        <p className="hint-note" style={{ margin: 0 }}>
          {tab === 'pdf'
            ? 'აირჩიე, რა დაიბეჭდოს. მარჯვნივ - ფურცელი ასე გამოვა.'
            : 'აირჩიე, რა ჩაიწეროს ფაილში. ფაილი „ნახაზის იმპორტით“ ისევ იხსნება.'}
        </p>
        <div className="seg" role="group" aria-label="ფორმატი">
          <button className={tab === 'pdf' ? 'on' : undefined} aria-pressed={tab === 'pdf'} onClick={() => setTab('pdf')}>
            <Icon name="print" size={14} /> PDF
          </button>
          <button className={tab === 'json' ? 'on' : undefined} aria-pressed={tab === 'json'} onClick={() => setTab('json')}>
            <Icon name="download" size={14} /> JSON
          </button>
        </div>
      </div>

      {doc && (tab === 'pdf' ? <PdfPanel doc={doc} counts={counts} /> : <JsonPanel file={file} counts={counts} />)}
    </Modal>
  );
}

interface CheckProps {
  label: string;
  checked: boolean;
  onChange: (on: boolean) => void;
  note?: string;
  count?: number;
  /** why it cannot be switched on here, which is also shown as its tooltip */
  disabledWhy?: string;
}

/** One switch. A disabled one reads as off, because off is what it will do. */
function Check({ label, checked, onChange, note, count, disabledWhy }: CheckProps) {
  const disabled = Boolean(disabledWhy);
  return (
    <label className={`vis-check${disabled ? ' disabled' : ''}`} title={disabledWhy}>
      <input
        type="checkbox"
        checked={checked && !disabled}
        disabled={disabled}
        onChange={(e) => onChange(e.target.checked)}
      />
      <span>
        {label}
        {count !== undefined && <span className="export-count">{count}</span>}
        {note && <small className="export-note">{note}</small>}
      </span>
    </label>
  );
}

function PdfPanel({ doc, counts }: { doc: DrawingDoc; counts: Counts }) {
  const materials = useEditorStore((s) => s.materials);
  const vis = useEditorStore((s) => s.pdfVisibility);
  const sheet = useEditorStore((s) => s.pdfSheet);
  const setPdfVisibility = useEditorStore((s) => s.setPdfVisibility);
  const setPdfSheet = useEditorStore((s) => s.setPdfSheet);
  const setTitleBlock = useEditorStore((s) => s.setTitleBlock);
  const set = (key: keyof PdfVisibility) => (on: boolean) => setPdfVisibility({ [key]: on });

  const [preview, setPreview] = useState<
    { url: string; scale: number; rescaled: boolean } | 'empty' | null
  >(null);

  // Drawn after a short pause, so clicking through several switches redraws once.
  useEffect(() => {
    let live = true;
    const timer = setTimeout(() => {
      void import('../lib/drawingPdf').then(({ renderDrawingSheet }) => {
        if (!live) return;
        const r = renderDrawingSheet({ doc, materials, sheet, visibility: vis, pxPerMm: PREVIEW_PX_PER_MM });
        setPreview(r ? { url: r.dataUrl, scale: r.scale, rescaled: r.rescaled } : 'empty');
      });
    }, PREVIEW_DELAY_MS);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [doc, materials, sheet, vis]);

  const noPieces = counts.pieces === 0 ? 'ნახაზზე ელემენტები არ არის' : undefined;
  const piecesOff = noPieces ?? (vis.pieces ? undefined : 'ჯერ ჩართე ყალიბის ელემენტები');
  const bomOn = vis.bomPage && counts.pieces > 0;

  return (
    <div className="export-grid">
      <div>
        <h4 className="vis-section">ნახაზზე</h4>
        <div className="vis-extra">
          <Check
            label="ყალიბის ელემენტები"
            note="პანელები, ჩაკერება, კუთხეები"
            count={counts.pieces}
            checked={vis.pieces}
            onChange={set('pieces')}
            disabledWhy={noPieces}
          />
          <Check
            label="ხაზვის ხაზები"
            count={counts.lines}
            checked={vis.sketchLines}
            onChange={set('sketchLines')}
            disabledWhy={counts.lines ? undefined : 'ნახაზზე ხაზები არ არის'}
          />
          <Check
            label="გაზომვის ხაზები"
            count={counts.measures}
            checked={vis.measureLines}
            onChange={set('measureLines')}
            disabledWhy={counts.measures ? undefined : 'ნახაზზე ზომის ხაზები არ არის'}
          />
        </div>

        <h4 className="vis-section">ზომები</h4>
        <div className="vis-extra">
          <Check
            label="ხაზვის ხაზების სიგრძეები"
            checked={vis.line}
            onChange={set('line')}
            disabledWhy={counts.lines ? undefined : 'ნახაზზე ხაზები არ არის'}
          />
          <Check
            label="გაზომვის სიგრძეები"
            checked={vis.measure}
            onChange={set('measure')}
            disabledWhy={counts.measures ? undefined : 'ნახაზზე ზომის ხაზები არ არის'}
          />
          <Check label="პანელების და ჩაკერების ზომები" checked={vis.wall} onChange={set('wall')} disabledWhy={piecesOff} />
          <Check label="კუთხეების ზომები" checked={vis.corner} onChange={set('corner')} disabledWhy={piecesOff} />
          <Check
            label="დანარჩენი ელემენტების ზომები"
            note="რიგელები, ჭანჭიკები..."
            checked={vis.other}
            onChange={set('other')}
            disabledWhy={piecesOff}
          />
          <Check
            label="ჯამური ზომები"
            note="სიგანე და სიმაღლე ნახაზის გარეთ"
            checked={vis.overall}
            onChange={set('overall')}
          />
        </div>

        <h4 className="vis-section">ფურცელი</h4>
        <div className="export-sheet-row">
          <div className="seg" role="group" aria-label="ფურცლის ზომა">
            {SHEET_SIZES.map((s) => (
              <button key={s} className={s === sheet ? 'on' : undefined} aria-pressed={s === sheet} onClick={() => setPdfSheet(s)}>
                {s}
              </button>
            ))}
          </div>
          <label className="export-scale">
            <span>მასშტაბი</span>
            <select value={doc.scale} onChange={(e) => setTitleBlock({ scale: Number(e.target.value) })}>
              {SCALES.map((s) => (
                <option key={s} value={s}>
                  {s === 0 ? 'ავტომატური' : `1:${s}`}
                </option>
              ))}
            </select>
          </label>
        </div>
        <div className="vis-extra" style={{ marginTop: 10 }}>
          <Check
            label="შტამპი"
            note="ობიექტი, ნახაზი, მასშტაბი, რევიზია, თარიღი"
            checked={vis.titleBlock}
            onChange={set('titleBlock')}
          />
          <Check
            label="მასალების უწყისი"
            note="ცალკე ფურცლებზე, ნახაზის შემდეგ"
            checked={vis.bomPage}
            onChange={set('bomPage')}
            disabledWhy={noPieces}
          />
        </div>
      </div>

      <div className="export-preview">
        {preview === null ? (
          <div className="export-empty">…</div>
        ) : preview === 'empty' ? (
          <div className="export-empty">
            {bomOn
              ? 'ნახაზის ფურცელზე არაფერი დარჩა - PDF-ში მხოლოდ მასალების უწყისი იქნება.'
              : 'ფურცელზე არაფერი დარჩა - ჩართე ერთი ნაწილი მაინც.'}
          </div>
        ) : (
          <>
            <img src={preview.url} alt="PDF-ის ფურცლის გადახედვა" />
            <small className="export-meta">
              {sheet} · 1:{preview.scale}
              {preview.rescaled ? ` (1:${doc.scale}-ში არ ეტეოდა)` : ''}
              {bomOn ? ' · + მასალების უწყისი' : ''}
            </small>
          </>
        )}
      </div>
    </div>
  );
}

function JsonPanel({ file, counts }: { file: LayoutFile | null; counts: Counts }) {
  const json = useEditorStore((s) => s.jsonExport);
  const setJsonExport = useEditorStore((s) => s.setJsonExport);
  const set = (key: keyof JsonExportOptions) => (on: boolean) => setJsonExport({ [key]: on });

  const text = useMemo(() => (file ? JSON.stringify(file, null, 2) : ''), [file]);
  const lines = text.split('\n');
  const kb = Math.max(0.1, Math.round(new TextEncoder().encode(text).length / 102.4) / 10);
  const legs = (file?.sketch ?? []).reduce((n, path) => n + segments(path).length, 0);

  return (
    <div className="export-grid">
      <div>
        <h4 className="vis-section">ნახაზი</h4>
        <div className="vis-extra">
          <Check
            label="ყალიბის ელემენტები"
            count={counts.pieces}
            checked={json.pieces}
            onChange={set('pieces')}
            disabledWhy={counts.pieces ? undefined : 'ნახაზზე ელემენტები არ არის'}
          />
          <Check
            label="მასალების განმარტებები"
            note="ელემენტების ზომები - სხვა კომპიუტერზე, სხვა კატალოგით გასახსნელად"
            checked={json.materials}
            onChange={set('materials')}
            disabledWhy={
              !counts.pieces ? 'ნახაზზე ელემენტები არ არის' : json.pieces ? undefined : 'ჯერ ჩართე ყალიბის ელემენტები'
            }
          />
          <Check
            label="ხაზვის ხაზები"
            count={counts.lines}
            checked={json.sketch}
            onChange={set('sketch')}
            disabledWhy={counts.lines ? undefined : 'ნახაზზე ხაზები არ არის'}
          />
          <Check
            label="გაზომვის ხაზები"
            count={counts.measures}
            checked={json.measures}
            onChange={set('measures')}
            disabledWhy={counts.measures ? undefined : 'ნახაზზე ზომის ხაზები არ არის'}
          />
        </div>

        <h4 className="vis-section">დამატებით</h4>
        <div className="vis-extra">
          <Check
            label="სიგრძეები"
            note="ხაზის თითო მონაკვეთის და თითო ზომის სიგრძე - სხვა პროგრამებისთვის"
            checked={json.lengths}
            onChange={set('lengths')}
            disabledWhy={json.sketch || json.measures ? undefined : 'ჯერ ჩართე ხაზები ან ზომები'}
          />
          <Check
            label="შტამპის მონაცემები"
            note="ობიექტი, რევიზია, მასშტაბი"
            checked={json.titleBlock}
            onChange={set('titleBlock')}
          />
        </div>

        {json.pieces && counts.pieces > 0 && !json.materials && (
          <p className="hint-note">
            მასალების განმარტებების გარეშე ელემენტები სწორად გაიხსნება მხოლოდ იმავე კატალოგზე.
          </p>
        )}
      </div>

      <div className="export-preview">
        {file && layoutFileHasContent(file) ? (
          <>
            <small className="export-meta">
              {file.pieces.length} ელემენტი · {legs} ხაზის მონაკვეთი · {file.measures?.length ?? 0} ზომა ·{' '}
              {file.materials?.length ?? 0} მასალა · {kb} KB
            </small>
            <pre className="export-json">
              {lines.slice(0, JSON_PREVIEW_LINES).join('\n')}
              {lines.length > JSON_PREVIEW_LINES ? `\n… კიდევ ${lines.length - JSON_PREVIEW_LINES} სტრიქონი` : ''}
            </pre>
          </>
        ) : (
          <div className="export-empty">ფაილში არაფერი დარჩა - ჩართე ელემენტები, ხაზები ან ზომები.</div>
        )}
      </div>
    </div>
  );
}
