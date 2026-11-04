import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { boltKindOf, boltTotals } from '../lib/boltMarks';
import { infoSaveUnsupported } from '../lib/repo';
import { soloPanels, WALER_LOCK_NAME, WALER_ROD_NAME, walerTotals } from '../lib/walers';
import { isConfigured } from '../lib/supabase';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** The four ჭანჭიკი kinds as the ჭანჭიკები menu names them. */
const BOLT_NAMES: Array<['connectors' | 'rods' | 'nuts' | 'latches', string]> = [
  ['connectors', 'კონექტორები'],
  ['rods', 'შტირები'],
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
];

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

  const bom = useMemo(
    () => buildBom(materials, pieces, documents, activeDocId),
    [pieces, materials, documents, activeDocId],
  );
  const bolts = useMemo(
    () => boltTotals(pieces, new Map(materials.map((m) => [m.id, m]))),
    [pieces, materials],
  );
  // ჭანჭიკები come from their own count - placed and worked out alike - so
  // the placed ones are not listed twice.
  const rows = bom.groups.flatMap((g) =>
    g.rows.filter((r) => r.used > 0 && !boltKindOf(r.material)).map((r) => ({ group: g.label, row: r })),
  );
  const boltRows = BOLT_NAMES.filter(([k]) => bolts[k] > 0);
  const walers = useMemo(
    () => walerTotals(soloPanels(pieces, new Map(materials.map((m) => [m.id, m])))),
    [pieces, materials],
  );
  const walerRows: Array<[string, number]> = walers.walers
    ? [
        ['ვოლერი', walers.walers],
        [WALER_ROD_NAME, walers.rods],
        [WALER_LOCK_NAME, walers.locks],
      ]
    : [];
  const kinds = rows.length + boltRows.length + walerRows.length;
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
                <td>{row.used}</td>
              </tr>
            ))}
            {boltRows.map(([k, name]) => (
              <tr key={k}>
                <td>
                  {name}
                  <span className="menu-note"> · ჭანჭიკები</span>
                </td>
                <td>{bolts[k]}</td>
              </tr>
            ))}
            {walerRows.map(([name, n]) => (
              <tr key={name}>
                <td>
                  {name}
                  <span className="menu-note"> · ვოლერები</span>
                </td>
                <td>{n}</td>
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
