import { useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { boltKindOf, boltTotals } from '../lib/boltMarks';
import { infoSaveUnsupported } from '../lib/repo';
import { soloPanels, WALER_LOCK_NAME, WALER_ROD_NAME, walerTotals } from '../lib/walers';
import { findCornerRods } from '../lib/bolts';
import { CORNER_CONNECTOR_NAME, cornerConnectorSpots, cornerConnectorTotals, FULL_HEAD_NAME, HALF_HEAD_NAME, INNER_CONNECTOR_NAME, SMALL_NUT_NAME } from '../lib/cornerConnectors';
import { isConfigured } from '../lib/supabase';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** The four ჭანჭიკი kinds as the ჭანჭიკები menu names them. */
const BOLT_NAMES: Array<['connectors' | 'rods' | 'nuts' | 'latches' | 'holders' | 'crocodiles' | 'frogs' | 'props', string]> = [
  ['crocodiles', 'ნიანგი (ჩამკეტი რეგულირებადი)'],
  ['frogs', 'ბაყაყი (სამაგრი ფიქსი)'],
  ['props', 'დგარი და თავი'],
  ['connectors', 'კონექტორი 25 სმ'],
  ['rods', 'შტირები'],
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
  ['holders', 'პანელის ბეტონზე სამაგრი'],
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
  // Only the ჭანჭიკი kinds the drawing has on.
  const on = useKindsOn();
  const bolts = useMemo(
    () => boltTotals(pieces, new Map(materials.map((m) => [m.id, m])), on),
    [pieces, materials, on],
  );
  // ჭანჭიკები come from their own count - placed and worked out alike - so
  // the placed ones are not listed twice.
  const rows = bom.groups.flatMap((g) =>
    g.rows.filter((r) => r.used > 0 && !boltKindOf(r.material)).map((r) => ({ group: g.label, row: r })),
  );
  const walers = useMemo(
    () => walerTotals(soloPanels(pieces, new Map(materials.map((m) => [m.id, m])))),
    [pieces, materials],
  );
  const cc = useMemo(
    () => cornerConnectorTotals(cornerConnectorSpots(pieces, new Map(materials.map((m) => [m.id, m])))),
    [pieces, materials],
  );
  // The corner connectors are the same კონექტორი 25 სმ - counted in its row.
  const countOf = (k: (typeof BOLT_NAMES)[number][0]) =>
    k === 'connectors'
      ? bolts.connectors + (on.cornerConnectors ? cc.connectors : 0) + (on.innerConnectors ? cc.innerConnectors : 0)
      : bolts[k];
  const boltRows = BOLT_NAMES.filter(([k]) => countOf(k) > 0);
  const walerRows: Array<[string, number]> = [];
  if (on.halfHead && cc.halfHead) walerRows.push([HALF_HEAD_NAME, cc.halfHead]);
  const full = findCornerRods(pieces, new Map(materials.map((m) => [m.id, m]))).reduce((n, r) => n + r.count, 0);
  if (on.fullHead && full) walerRows.push([FULL_HEAD_NAME, full]);
  if (on.innerConnectors && cc.innerConnectors) {
    walerRows.push([SMALL_NUT_NAME, cc.smallNuts]);
  }
  walerRows.push(...(on.walers && walers.walers
    ? [
        ['ვოლერი', walers.walers],
        [WALER_ROD_NAME, walers.rods],
        [WALER_LOCK_NAME, walers.locks],
      ]
    : []) as Array<[string, number]>);
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
                <td>{countOf(k)}</td>
              </tr>
            ))}
            {walerRows.map(([name, n]) => (
              <tr key={name}>
                <td>
                  {name}
                  <span className="menu-note"> · ჭანჭიკები</span>
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
