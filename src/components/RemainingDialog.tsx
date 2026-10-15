import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useStockView } from '../store/useStockView';
import { sizeLabel, fmtNum } from '../lib/bom';
import { STATUS_LABEL, statusOf } from '../lib/inventory';
import { remainingRows, type RemainingRow, type RemainingShow } from '../lib/remaining';
import { CATEGORIES } from '../data/categories';
import { Modal } from './Modal';
import { Icon } from './Icon';

/**
 * ნაშთი: how the open drawing stands against what the company holds.
 *
 * The architect's own sheet - owned, held by other jobs, used here, left -
 * opened from the top bar so it is one click from any view. Read-only: owned
 * stock is changed in the მარაგი tab, and what the other jobs hold follows
 * from their status, set in the drawings menu.
 */
export function RemainingDialog() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const openDialog = useEditorStore((s) => s.openDialog);
  const activeDoc = useEditorStore((s) => s.documents.find((d) => d.id === s.activeDocId));
  const drawingName = activeDoc?.name ?? '';
  const status = statusOf(activeDoc);
  const view = useStockView();

  const [show, setShow] = useState<RemainingShow>('all');
  const [query, setQuery] = useState('');
  const [error, setError] = useState<string | null>(null);

  const remaining = useMemo(
    () => remainingRows(materials, pieces, { show, query, view }),
    [materials, pieces, show, query, view],
  );
  const usedKinds = useMemo(
    () => remainingRows(materials, pieces, { show: 'used' }).groups.reduce((n, g) => n + g.rows.length, 0),
    [materials, pieces],
  );
  const heldElsewhere = view.reserved.size > 0;

  const onExcel = async () => {
    setError(null);
    try {
      // SheetJS is loaded on demand - see BomPanel for why.
      const { exportRemainingToExcel } = await import('../lib/excelExport');
      // The file carries every component: the filters tidy the screen, a sheet
      // sent on should not silently drop rows.
      exportRemainingToExcel(remainingRows(materials, pieces, { view }), drawingName);
    } catch (e) {
      setError(`ექსპორტი ვერ მოხერხდა: ${(e as Error).message}`);
    }
  };

  /** His whole workbook, not just this table - see `buildArchitectWorkbook`. */
  const onWorkbook = async () => {
    setError(null);
    try {
      const { exportArchitectWorkbook } = await import('../lib/excelExport');
      exportArchitectWorkbook({
        materials,
        pieces,
        sketch: useEditorStore.getState().sketch,
        drawingName,
      });
    } catch (e) {
      setError(`ექსპორტი ვერ მოხერხდა: ${(e as Error).message}`);
    }
  };

  const filters: Array<[RemainingShow, string, number]> = [
    ['all', 'ყველა', materials.length],
    ['used', 'გამოყენებული', usedKinds],
    ['short', 'არ ჰყოფნის', remaining.shortages],
  ];

  return (
    <Modal title={`ნაშთი - ${drawingName}`} onClose={closeDialog} wide>
      <div className="rem">
        <div className="rem-tiles">
          <div className="rem-tile">
            <span>ამ ნახაზში</span>
            <b>{remaining.used}</b>
            <small>ელემენტი · {usedKinds} სახეობა</small>
          </div>
          <div className={`rem-tile ${remaining.shortages ? 'warn' : 'good'}`}>
            <span>არ ჰყოფნის</span>
            <b>{remaining.unlimited ? '∞' : remaining.shortages || '✓'}</b>
            <small>
              {remaining.unlimited
                ? 'მარაგი შეუზღუდავია'
                : remaining.shortages
                  ? 'კომპონენტს'
                  : 'ყველაფერი ჰყოფნის'}
            </small>
          </div>
          <div className="rem-tile">
            <span>წონა</span>
            <b>{fmtNum(remaining.weightKg)}</b>
            <small>
              კგ{remaining.unweighed ? ` · ${remaining.unweighed}-ს წონა არ აქვს` : ''}
            </small>
          </div>
        </div>

        {/* Which yard this sheet is counted against - the one thing about it
            that the numbers themselves do not say. */}
        <div className={`rem-status ${status}`}>
          <span className={`status-dot ${status}`} />
          <span className="grow">
            {status === 'unimportant'
              ? 'უმნიშვნელო ნახაზი - მარაგი შეუზღუდავია, არაფერი აკლია და სხვას არაფერს ართმევს.'
              : status === 'finished'
                ? 'დასრულებული ნახაზი - მისი ელემენტები მარაგში დაბრუნებულია.'
                : heldElsewhere
                  ? 'აქტიური ნახაზი - "დარჩა" აკლებს სხვა აქტიური ნახაზების მიერ დაკავებულსაც.'
                  : 'აქტიური ნახაზი - სხვა აქტიური ნახაზი მარაგს არ იკავებს.'}
          </span>
          {activeDoc && (
            <button
              className="btn small"
              onClick={() => openDialog({ kind: 'project', docId: activeDoc.id })}
              title="ნახაზის დეტალები და სტატუსის შეცვლა"
            >
              სტატუსი: {STATUS_LABEL[status]}
            </button>
          )}
        </div>

        <div className="rem-bar">
          <div className="seg" role="group" aria-label="რა ჩანს">
            {filters.map(([key, label, count]) => (
              <button
                key={key}
                className={show === key ? 'on' : undefined}
                aria-pressed={show === key}
                onClick={() => setShow(key)}
              >
                {label} <span className="rem-seg-count">{count}</span>
              </button>
            ))}
          </div>
          <input
            className="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="ძებნა - მაგ. 90*300"
          />
          <button className="btn small" onClick={() => void onExcel()} title="მხოლოდ ნაშთის ცხრილი">
            <Icon name="download" /> ნაშთი Excel
          </button>
          <button
            className="btn small"
            onClick={() => void onWorkbook()}
            title="არქიტექტორის ფაილი: კონსტრუქცია, ჯამი, ნაშთი, აწყობა, პრინტ - ფორმულებით"
          >
            <Icon name="sheet" /> სრული Excel
          </button>
        </div>

        {error && <div className="alert error">{error}</div>}

        {remaining.groups.length === 0 ? (
          <div className="empty">
            {show === 'short' ? 'ყველაფერი ჰყოფნის ✓' : show === 'used' ? 'ამ ნახაზში ელემენტი არ არის.' : 'ვერაფერი მოიძებნა.'}
          </div>
        ) : (
          <div className="rem-table-wrap">
            <table className="rem-table">
              <thead>
                <tr>
                  <th>კომპონენტი</th>
                  <th className="num">სულ მარაგი</th>
                  <th className="num" title="სხვა აქტიურ ნახაზებში დაკავებული">სხვა ნახაზებში</th>
                  <th className="num">ამ ნახაზში</th>
                  <th className="num">დარჩა</th>
                  <th className="rem-meter-head">დაკავებული</th>
                </tr>
              </thead>
              <tbody>
                {remaining.groups.map((g) => [
                  <tr className="rem-cat" key={g.category}>
                    <td colSpan={6}>
                      <span className="catdot" style={{ background: CATEGORIES[g.category].color }} />
                      {g.label}
                      <span className="rem-cat-count">{g.rows.length}</span>
                    </td>
                  </tr>,
                  ...g.rows.map((r) => (
                    <Row key={r.material.id} row={r} unlimited={remaining.unlimited} />
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}

function Row({ row, unlimited }: { row: RemainingRow; unlimited: boolean }) {
  const { material: m, stock, reserved, used, left, short } = row;
  // How much of what is free for this drawing it takes: calm, tight past 80%,
  // over at 100. An unimportant drawing takes nothing from anyone.
  const free = Math.max(0, stock - reserved);
  const share = free > 0 ? used / free : used > 0 ? Infinity : 0;
  const meter = share > 1 ? 'over' : share >= 0.8 ? 'tight' : 'ok';

  return (
    <tr className={short ? 'short' : undefined}>
      <td>
        <span className="rem-name">{m.name}</span>
        <span className="rem-size">
          {sizeLabel(m)} სმ{m.article ? ` · ${m.article}` : ''}
          {m.weight > 0 ? ` · ${m.weight} კგ` : ''}
        </span>
      </td>
      <td className="num">{stock}</td>
      <td className="num">{reserved || <span className="rem-dim">-</span>}</td>
      <td className="num">{used || <span className="rem-dim">-</span>}</td>
      <td className="num">
        {unlimited ? (
          <span className="rem-left dim">∞</span>
        ) : (
          <span className={`rem-left${short ? ' short' : used ? '' : ' dim'}`}>
            {short ? `−${-left} აკლია` : left}
          </span>
        )}
      </td>
      <td className={`rem-meter ${meter}`}>
        {used > 0 && !unlimited && (
          <i title={free > 0 ? `${Math.round(share * 100)}% თავისუფალი მარაგისა` : 'თავისუფალი მარაგი არ არის'}>
            <b style={{ width: `${Math.min(100, share * 100)}%` }} />
          </i>
        )}
      </td>
    </tr>
  );
}
