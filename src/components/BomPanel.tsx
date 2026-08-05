import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom, fmtNum, sizeLabel } from '../lib/bom';
import { Icon } from './Icon';

/** Live bill of materials: what is on the surface, grouped by category. */
export function BomPanel() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const [withSnapshot, setWithSnapshot] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const bom = useMemo(
    () => buildBom(materials, pieces, documents, activeDocId),
    [materials, pieces, documents, activeDocId],
  );

  /**
   * SheetJS, jsPDF and html2canvas together are most of the bundle and are only
   * needed once someone actually exports, so they load on demand.
   */
  const run = async (key: string, task: () => Promise<void>) => {
    setBusy(key);
    setError(null);
    try {
      await task();
    } catch (e) {
      setError(`ექსპორტი ვერ მოხერხდა: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const onExcel = () =>
    run('xlsx', async () => {
      const { exportBomToExcel } = await import('../lib/excelExport');
      exportBomToExcel(bom);
    });

  const onCsv = () =>
    run('csv', async () => {
      const { exportBomToCsv } = await import('../lib/excelExport');
      exportBomToCsv(bom);
    });

  const onPdf = () =>
    run('pdf', async () => {
      const [{ exportBomToPdf }, { renderLayoutSnapshot }] = await Promise.all([
        import('../lib/pdfExport'),
        import('../lib/snapshot'),
      ]);
      const snapshot = withSnapshot ? renderLayoutSnapshot(materials, pieces) : null;
      await exportBomToPdf({ bom, snapshot });
    });

  return (
    <div className="bom">
      <div className="summary-card">
        <div className="sc-item">
          <span>სულ ელემენტი</span>
          <b>{bom.totalPieces}</b>
        </div>
        <div className="sc-item">
          <span>სიგრძე</span>
          <b>{fmtNum(bom.totalLengthM)} მ</b>
        </div>
        <div className="sc-item">
          <span>ფართობი</span>
          <b>{fmtNum(bom.totalAreaM2)} მ²</b>
        </div>
        <div className={`sc-item${bom.shortageCount ? ' warn' : ''}`}>
          <span>დეფიციტი</span>
          <b>{bom.shortageCount}</b>
        </div>
        <div className="sc-item">
          <span>წონა{bom.unweighedRows > 0 ? ' *' : ''}</span>
          <b>{fmtNum(bom.totalWeightKg)} კგ</b>
        </div>
      </div>

      {bom.unweighedRows > 0 && (
        <p className="hint-note" style={{ margin: '0 0 10px' }}>
          * წონის ჯამი არასრულია — {bom.unweighedRows} პოზიციას წონა არ აქვს მითითებული.
        </p>
      )}

      <div className="export-row">
        <button className="btn small" onClick={onExcel} disabled={!!busy || !bom.totalPieces}>
          {busy === 'xlsx' ? '…' : <>
            <Icon name="download" /> Excel
          </>}
        </button>
        <button className="btn small" onClick={onCsv} disabled={!!busy || !bom.totalPieces}>
          {busy === 'csv' ? '…' : <>
            <Icon name="download" /> CSV
          </>}
        </button>
        <button className="btn small" onClick={onPdf} disabled={!!busy || !bom.totalPieces}>
          {busy === 'pdf' ? '…' : <>
            <Icon name="download" /> PDF
          </>}
        </button>
      </div>
      <label className="check-row">
        <input
          type="checkbox"
          checked={withSnapshot}
          onChange={(e) => setWithSnapshot(e.target.checked)}
        />
        PDF-ში ნახაზის სურათიც
      </label>

      {error && <div className="alert error">{error}</div>}
      {bom.orphanPieces > 0 && (
        <div className="alert warn">
          {bom.orphanPieces} ელემენტს კატალოგში შესაბამისი მასალა აღარ აქვს.
        </div>
      )}

      {bom.groups.length === 0 ? (
        <div className="empty">ზედაპირი ცარიელია — უწყისი ცარიელია.</div>
      ) : (
        bom.groups.map((g) => (
          <div key={g.category} className="bom-group">
            <div className="bom-cat">
              <span className="catdot" style={{ background: g.color }} />
              <b>{g.label}</b>
              <span className="pill">{g.pieces}</span>
            </div>
            <table className="bom-table">
              <thead>
                <tr>
                  <th>კომპონენტი</th>
                  <th className="num">რაოდ.</th>
                  <th className="num">მარაგი</th>
                  <th className="num">ნაშთი</th>
                </tr>
              </thead>
              <tbody>
                {g.rows.map((r) => (
                  <tr key={r.material.id} className={r.shortage ? 'short' : ''}>
                    <td>
                      <span className="bom-name">{r.material.name}</span>
                      <span className="bom-size">
                        {sizeLabel(r.material)} სმ
                        {r.lengthM > 0 ? ` · ${fmtNum(r.lengthM)} მ` : ''}
                        {r.weightKg > 0 ? ` · ${fmtNum(r.weightKg)} კგ` : ''}
                      </span>
                    </td>
                    <td className="num">{r.used}</td>
                    <td className="num">{r.stock}</td>
                    <td className="num">
                      {r.remaining}
                      {r.shortage && <span className="warn-badge" title="დეფიციტი"><Icon name="warning" /></span>}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td>
                    ჯამი
                    {g.lengthM > 0 && <span className="bom-size">{fmtNum(g.lengthM)} მ</span>}
                    {g.areaM2 > 0 && <span className="bom-size">{fmtNum(g.areaM2)} მ²</span>}
                    {g.weightKg > 0 && <span className="bom-size">{fmtNum(g.weightKg)} კგ</span>}
                  </td>
                  <td className="num">{g.pieces}</td>
                  <td colSpan={2} />
                </tr>
              </tfoot>
            </table>
          </div>
        ))
      )}
    </div>
  );
}
