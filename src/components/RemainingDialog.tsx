import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useCanManageCatalog } from '../store/useAuthStore';
import { sizeLabel, fmtNum } from '../lib/bom';
import { DEFAULT_WAREHOUSE, stockIn } from '../lib/inventory';
import { keepWheelOffNumber } from '../lib/numberField';
import { remainingRows, type RemainingRow, type RemainingShow } from '../lib/remaining';
import { CATEGORIES } from '../data/categories';
import { Modal } from './Modal';
import { Icon } from './Icon';

/**
 * ნაშთი: how the open drawing stands against what the company holds.
 *
 * The architect's own sheet - owned, used here, left - opened from the top bar
 * so it is one click from any view. Read-only by default; an admin can switch
 * on editing and type the totals straight into the table, which is where the
 * shortfall is looked at anyway.
 */
export function RemainingDialog() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const warehouses = useEditorStore((s) => s.warehouses);
  const setStock = useEditorStore((s) => s.setStock);
  const setAllStock = useEditorStore((s) => s.setAllStock);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const drawingName = useEditorStore(
    (s) => s.documents.find((d) => d.id === s.activeDocId)?.name ?? '',
  );
  const canManage = useCanManageCatalog();

  const [show, setShow] = useState<RemainingShow>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState(false);
  const [warehouseId, setWarehouseId] = useState(warehouses[0]?.id ?? DEFAULT_WAREHOUSE.id);
  const [bulk, setBulk] = useState('500');
  const [armed, setArmed] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Rows edited since the filter last changed. They stay listed: under "only
   * short", typing 120 into a row short by 4 ends the shortage at "12", and the
   * row - and the field with the cursor in it - would vanish before the 0.
   */
  const [kept, setKept] = useState<ReadonlySet<string>>(() => new Set());

  const remaining = useMemo(
    () => remainingRows(materials, pieces, { show, query, keep: kept }),
    [materials, pieces, show, query, kept],
  );
  const usedKinds = useMemo(
    () => remainingRows(materials, pieces, { show: 'used' }).groups.reduce((n, g) => n + g.rows.length, 0),
    [materials, pieces],
  );

  const admin = canManage && editing;
  const warehouse = warehouses.find((w) => w.id === warehouseId) ?? warehouses[0];
  const bulkValue = Math.max(0, Math.round(Number(bulk) || 0));

  const changeShow = (next: RemainingShow) => {
    setShow(next);
    setKept(new Set());
  };
  const editStock = (id: string, whId: string, quantity: number) => {
    setKept((k) => (k.has(id) ? k : new Set(k).add(id)));
    setStock(id, whId, quantity);
  };

  const onExcel = async () => {
    setError(null);
    try {
      // SheetJS is loaded on demand - see BomPanel for why.
      const { exportRemainingToExcel } = await import('../lib/excelExport');
      // The file carries every component: the filters tidy the screen, a sheet
      // sent on should not silently drop rows.
      exportRemainingToExcel(remainingRows(materials, pieces), drawingName);
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
            <b>{remaining.shortages || '✓'}</b>
            <small>{remaining.shortages ? 'კომპონენტს' : 'ყველაფერი ჰყოფნის'}</small>
          </div>
          <div className="rem-tile">
            <span>წონა</span>
            <b>{fmtNum(remaining.weightKg)}</b>
            <small>
              კგ{remaining.unweighed ? ` · ${remaining.unweighed}-ს წონა არ აქვს` : ''}
            </small>
          </div>
        </div>

        <div className="rem-bar">
          <div className="seg" role="group" aria-label="რა ჩანს">
            {filters.map(([key, label, count]) => (
              <button
                key={key}
                className={show === key ? 'on' : undefined}
                aria-pressed={show === key}
                onClick={() => changeShow(key)}
              >
                {label} <span className="rem-seg-count">{count}</span>
              </button>
            ))}
          </div>
          <input
            className="search"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setKept(new Set());
            }}
            placeholder="ძებნა - მაგ. 90*300"
          />
          <button className="btn small" onClick={() => void onExcel()}>
            <Icon name="download" /> Excel
          </button>
          {canManage && (
            <button
              className={`btn small${editing ? ' engaged' : ''}`}
              aria-pressed={editing}
              onClick={() => {
                setEditing((on) => !on);
                setArmed(false);
                setKept(new Set());
              }}
              title="მარაგის ციფრების რედაქტირება - მხოლოდ ადმინისტრატორი"
            >
              <Icon name={editing ? 'check' : 'lock'} /> {editing ? 'რედაქტირება ჩართულია' : 'ადმინ რეჟიმი'}
            </button>
          )}
        </div>

        {admin && (
          <div className="rem-admin">
            <span className="grow">
              სულ მარაგის ციფრები ცხრილში რედაქტირდება და მაშინვე ინახება
              {warehouses.length > 1 ? '' : '.'}
            </span>
            {warehouses.length > 1 && (
              <select value={warehouse?.id} onChange={(e) => setWarehouseId(e.target.value)}>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>
                    {w.name}
                  </option>
                ))}
              </select>
            )}
            <span className="rem-bulk">
              ყველას:
              <input
                type="number"
                min={0}
                step={1}
                value={bulk}
                onWheel={keepWheelOffNumber}
                onChange={(e) => {
                  setBulk(e.target.value);
                  setArmed(false);
                }}
              />
              {/* Two presses, not a popup: this window stays open, and writing
                  one number over every real count deserves a second look. */}
              <button
                className={`btn small${armed ? ' primary danger' : ''}`}
                onClick={() => {
                  if (!armed) return setArmed(true);
                  setAllStock(warehouse?.id ?? DEFAULT_WAREHOUSE.id, bulkValue);
                  setArmed(false);
                }}
                onBlur={() => setArmed(false)}
              >
                {armed ? `${materials.length} კომპონენტი = ${bulkValue}? დაადასტურე` : 'ჩაწერა'}
              </button>
            </span>
          </div>
        )}

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
                  <th className="num">სულ მარაგი{admin && warehouses.length > 1 ? ` (${warehouse?.name})` : ''}</th>
                  <th className="num">ამ ნახაზში</th>
                  <th className="num">დარჩა</th>
                  <th className="rem-meter-head">დაკავებული</th>
                </tr>
              </thead>
              <tbody>
                {remaining.groups.map((g) => [
                  <tr className="rem-cat" key={g.category}>
                    <td colSpan={5}>
                      <span className="catdot" style={{ background: CATEGORIES[g.category].color }} />
                      {g.label}
                      <span className="rem-cat-count">{g.rows.length}</span>
                    </td>
                  </tr>,
                  ...g.rows.map((r) => (
                    <Row
                      key={r.material.id}
                      row={r}
                      admin={admin}
                      warehouseId={warehouse?.id ?? DEFAULT_WAREHOUSE.id}
                      multi={warehouses.length > 1}
                      onStock={editStock}
                    />
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

function Row({
  row,
  admin,
  warehouseId,
  multi,
  onStock,
}: {
  row: RemainingRow;
  admin: boolean;
  warehouseId: string;
  multi: boolean;
  onStock: (id: string, warehouseId: string, quantity: number) => void;
}) {
  const { material: m, stock, used, left, short } = row;
  // How much of the stock this drawing takes: calm, tight past 80%, over at 100.
  const share = stock > 0 ? used / stock : used > 0 ? Infinity : 0;
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
      <td className="num">
        {admin ? (
          <>
            <input
              className="rem-stock-input"
              type="number"
              min={0}
              step={1}
              value={stockIn(m, warehouseId)}
              onWheel={keepWheelOffNumber}
              onChange={(e) => onStock(m.id, warehouseId, Number(e.target.value))}
            />
            {multi && <span className="rem-size">სულ {stock}</span>}
          </>
        ) : (
          stock
        )}
      </td>
      <td className="num">{used || <span className="rem-dim">-</span>}</td>
      <td className="num">
        <span className={`rem-left${short ? ' short' : used ? '' : ' dim'}`}>
          {short ? `−${-left} აკლია` : left}
        </span>
      </td>
      <td className={`rem-meter ${meter}`}>
        {used > 0 && (
          <i title={stock > 0 ? `${Math.round(share * 100)}% მარაგისა` : 'მარაგში არ არის'}>
            <b style={{ width: `${Math.min(100, share * 100)}%` }} />
          </i>
        )}
      </td>
    </tr>
  );
}
