import { useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { isCountedPart } from '../lib/quantities';
import { infoSaveUnsupported } from '../lib/repo';
import { isConfigured } from '../lib/supabase';
import { Icon } from './Icon';
import { Modal } from './Modal';

/**
 * The drawing's own details, from the button beside its name (the user,
 * 2026-11-01): who the job is for, and - folded away - every product the
 * scheme uses with its count, placed pieces and worked-out ჭანჭიკები alike.
 */
export function DrawingInfoDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const doc = useEditorStore((s) => s.documents.find((d) => d.id === s.activeDocId));
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const setDrawingInfo = useEditorStore((s) => s.setDrawingInfo);
  const [productsOpen, setProductsOpen] = useState(true);

  // Every product at the quantity the job really needs (the user,
  // 2026-11-17): one კონექტორი mark up a 300 is 5, one ვოლერი mark 3 - the
  // same list the PDF prints (quantities.ts), so it can never disagree.
  const kindsOn = useKindsOn();
  const bom = useMemo(
    () => buildBom(materials, pieces, documents, activeDocId, kindsOn),
    [pieces, materials, documents, activeDocId, kindsOn],
  );
  // How many marks the plan shows for each, where that is fewer - said beside the real count.
  const marks = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of pieces) n.set(p.materialId, (n.get(p.materialId) ?? 0) + 1);
    return n;
  }, [pieces]);
  const rows = bom.groups.flatMap((g) =>
    g.rows
      .filter((r) => r.used > 0)
      .map((r) => ({ group: isCountedPart(r.material) ? 'ჭანჭიკები' : g.label, row: r })),
  );
  const kinds = rows.length;
  const notSaved = isConfigured && infoSaveUnsupported();

  return (
    <Modal
      title={doc?.name ?? 'ნახაზი'}
      onClose={closeDialog}
      footer={
        <button className="btn primary" onClick={closeDialog}>
          დახურვა
        </button>
      }
    >
      <div className="form-grid">
        <label className="field span2">
          <span>კლიენტის სახელი</span>
          <input
            type="text"
            value={doc?.info?.clientName ?? ''}
            placeholder="მაგ. შპს ..."
            onChange={(e) => setDrawingInfo({ clientName: e.target.value })}
            autoFocus
          />
        </label>
      </div>
      {notSaved && (
        <p className="alert warn" style={{ marginTop: 8 }}>
          კლიენტის სახელი სერვერზე ჯერ არ ინახება - ადმინმა უნდა გაუშვას მიგრაცია 0014.
        </p>
      )}

      <button
        className="drawing-info-toggle"
        onClick={() => setProductsOpen(!productsOpen)}
        aria-expanded={productsOpen}
      >
        <Icon name={productsOpen ? 'chevron-down' : 'chevron-right'} size={14} />
        <b>პროდუქცია</b>
        <span className="menu-note">
          {kinds} სახეობა · {bom.totalPieces} ელემენტი
        </span>
      </button>
      {productsOpen && (
        <table className="drawing-info-table">
          <thead>
            <tr>
              <th>დასახელება</th>
              <th>რაოდ.</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(({ group, row }) => (
              <tr key={row.material.id}>
                <td>
                  {row.material.name}
                  <span className="menu-note"> · {group}</span>
                </td>
                <td>
                  <b>{row.used}</b>
                  {isCountedPart(row.material) && (marks.get(row.material.id) ?? 0) !== row.used && (
                    <span className="menu-note"> (ნახაზზე {marks.get(row.material.id) ?? 0} ნიშანი)</span>
                  )}
                </td>
              </tr>
            ))}
            {!kinds && (
              <tr>
                <td colSpan={2} className="menu-note">
                  ნახაზზე ჯერ არაფერი დგას.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      )}
    </Modal>
  );
}
