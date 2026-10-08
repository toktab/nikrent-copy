import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
// Schema/validation is xlsx-free, so it can be imported statically.
import { SHEET_TEMPLATE_HEADERS, validateRows, type ParseSummary } from '../lib/sheetSchema';
import { categoryLabel } from '../data/categories';
import { Modal } from './Modal';
import { Icon } from './Icon';

/** Bulk-add components from an Excel/CSV file or pasted text, with a preview. */
export function SheetImportDialog() {
  const materials = useEditorStore((s) => s.materials);
  const importMaterials = useEditorStore((s) => s.importMaterials);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  const [summary, setSummary] = useState<ParseSummary | null>(null);
  const [pasted, setPasted] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [source, setSource] = useState<string>('');

  const parse = (rows: Record<string, unknown>[], label: string) => {
    if (!rows.length) {
      setError('მონაცემები ვერ წავიკითხე - ფაილი ან ტექსტი ცარიელია.');
      setSummary(null);
      return;
    }
    const result = validateRows(rows, materials);
    if (result.headersMissing) {
      setError(
        `სათაურების სტრიქონი ვერ ვიპოვე. პირველი სტრიქონი უნდა შეიცავდეს: ${SHEET_TEMPLATE_HEADERS.join(', ')}`,
      );
      setSummary(null);
      return;
    }
    setError(null);
    setSource(label);
    setSummary(result);
  };

  // SheetJS loads on demand; it is only needed once a file or paste arrives.
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    try {
      const { readSheetFile } = await import('../lib/sheetImport');
      parse(await readSheetFile(file), file.name);
    } catch (e) {
      setError(`ფაილის წაკითხვა ვერ მოხერხდა: ${(e as Error).message}`);
      setSummary(null);
    }
  };

  const onParsePaste = async () => {
    try {
      const { readPastedText } = await import('../lib/sheetImport');
      parse(readPastedText(pasted), 'ჩასმული ტექსტი');
    } catch (e) {
      setError(`ტექსტის დამუშავება ვერ მოხერხდა: ${(e as Error).message}`);
      setSummary(null);
    }
  };

  const onTemplate = async () => {
    const { downloadImportTemplate } = await import('../lib/sheetImport');
    downloadImportTemplate();
  };

  const confirm = () => {
    if (!summary) return;
    const drafts = summary.rows.map((r) => r.draft).filter((d): d is NonNullable<typeof d> => !!d);
    importMaterials(drafts);
    closeDialog();
  };

  return (
    <Modal
      wide
      title="კომპონენტების იმპორტი ცხრილიდან"
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={() => void onTemplate()}><Icon name="download" /> ნიმუშის ჩამოტვირთვა
          </button>
          <span className="flex-spacer" />
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button
            className="btn primary"
            onClick={confirm}
            disabled={!summary || summary.okCount === 0}
          >
            {summary ? `დამატება (${summary.okCount})` : 'დამატება'}
          </button>
        </>
      }
    >
      <p className="hint-note">
        სვეტები: <code>{SHEET_TEMPLATE_HEADERS.join(', ')}</code> - <code>shape</code>,{' '}
        <code>color</code> და <code>stock</code> არასავალდებულოა.
      </p>

      <div className="import-sources">
        <label className="btn"><Icon name="folder" /> ფაილის არჩევა (.xlsx / .csv)
          <input
            type="file"
            accept=".xlsx,.xls,.csv,text/csv"
            style={{ display: 'none' }}
            onChange={(e) => {
              void onFile(e.target.files?.[0]);
              e.target.value = '';
            }}
          />
        </label>
        <span className="or">ან ჩასვი ცხრილი:</span>
      </div>

      <textarea
        className="paste-area"
        rows={4}
        placeholder={`name,category,width_cm,height_cm,shape,color,stock\nპანელი 120*300,panel,120,300,rect,,12`}
        value={pasted}
        onChange={(e) => setPasted(e.target.value)}
      />
      <button className="btn small" onClick={() => void onParsePaste()} disabled={!pasted.trim()}>
        ტექსტის დამუშავება
      </button>

      {error && <div className="alert error">{error}</div>}

      {summary && (
        <>
          <div className="import-summary">
            <span className="pill ok">{summary.okCount} ვალიდური</span>
            {summary.errorCount > 0 && (
              <span className="pill bad">{summary.errorCount} შეცდომით</span>
            )}
            <span className="muted">წყარო: {source}</span>
          </div>

          <div className="table-scroll">
            <table className="data-table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>დასახელება</th>
                  <th>კატეგორია</th>
                  <th className="num">ზომა (სმ)</th>
                  <th>ფორმა</th>
                  <th className="num">მარაგი</th>
                  <th>სტატუსი</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((r) => (
                  <tr key={r.row} className={r.draft ? '' : 'bad-row'}>
                    <td className="muted">{r.row}</td>
                    <td>{r.draft?.name ?? String(r.raw.name ?? '-')}</td>
                    <td>{r.draft ? categoryLabel(r.draft.category) : '-'}</td>
                    <td className="num">
                      {r.draft ? `${r.draft.w} × ${r.draft.h}` : '-'}
                    </td>
                    <td>{r.draft?.shape ?? '-'}</td>
                    <td className="num">
                      {r.draft ? Object.values(r.draft.stock).reduce((a, b) => a + b, 0) : '-'}
                    </td>
                    <td className="status-cell">
                      {r.errors.map((m) => (
                        <span key={m} className="msg err">
                          {m}
                        </span>
                      ))}
                      {r.warnings.map((m) => (
                        <span key={m} className="msg warn">
                          {m}
                        </span>
                      ))}
                      {r.draft && r.errors.length === 0 && r.warnings.length === 0 && (
                        <span className="msg ok"><Icon name="check" /></span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </Modal>
  );
}
