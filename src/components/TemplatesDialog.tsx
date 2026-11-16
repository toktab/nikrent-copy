import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  deleteTemplate,
  instantiate,
  listTemplates,
  missingMaterials,
  saveTemplate,
  templateCounts,
  templatePricesSaved,
  updateTemplate,
  type Template,
} from '../lib/templates';
import { isConfigured } from '../lib/supabase';
import { keepWheelOffNumber } from '../lib/numberField';
import { useCanEditDrawings } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** "1 250" style ₾ text, or a dash when there is no price. */
export function fmtPrice(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '-';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ')} ₾`;
}

/** A price typed by hand: blank is "no price", anything else a number >= 0. */
export function parsePrice(text: string): number | null | undefined {
  const t = text.trim().replace(',', '.').replace(/\s/g, '');
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) && n >= 0 ? n : undefined;
}

/**
 * შაბლონები: keep a finished column (or anything) and drop it into any
 * drawing later, instead of re-running a wizard and re-applying the same
 * corrections every time.
 *
 * Each template has a price of its own - one of that column, delivered (the
 * user, 2026-11-16). The list says how many times each one is on this
 * drawing, and the export multiplies the two into the კომპლექტის ფასი.
 */
export function TemplatesDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const openDialog = useEditorStore((s) => s.openDialog);
  const pieces = useEditorStore((s) => s.pieces);
  const sketch = useEditorStore((s) => s.sketch);
  const materials = useEditorStore((s) => s.materials);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedSketchIds = useEditorStore((s) => s.selectedSketchIds);
  const insertPieces = useEditorStore((s) => s.insertPieces);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const zoom = useEditorStore((s) => s.zoom);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const canEdit = useCanEditDrawings();

  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');
  const [price, setPrice] = useState('');

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  // With nothing selected, the whole drawing: a finished job is the template
  // most worth keeping for the next building like it.
  const picked = pieces.filter((p) => selectedIds.includes(p.id));
  const pickedLines = sketch.filter((k) => selectedSketchIds.includes(k.id));
  const wholeDrawing = picked.length === 0 && pickedLines.length === 0;
  const selection = wholeDrawing ? pieces : picked;
  const selectionLines = wholeDrawing ? sketch : pickedLines;
  const onDrawing = useMemo(() => templateCounts(pieces), [pieces]);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listTemplates());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function onSave() {
    if (!name.trim() || (!selection.length && !selectionLines.length)) return;
    const p = parsePrice(price);
    if (p === undefined) {
      setError('ფასი უნდა იყოს რიცხვი (ან ცარიელი).');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await saveTemplate(name, selection, byId, { sketch: selectionLines, price: p });
      setName('');
      setPrice('');
      setToast(`შაბლონი "${name.trim()}" შეინახა`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onPrice(t: Template, text: string) {
    const p = parsePrice(text);
    if (p === undefined || p === t.price) return;
    try {
      await updateTemplate(t.id, { price: p });
      setRows((r) => r.map((x) => (x.id === t.id ? { ...x, price: p } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }

  function onInsert(template: Template) {
    const missing = missingMaterials(template, byId);
    if (missing.length) {
      // Inserting anyway would drop those pieces silently and quietly
      // under-count the order.
      setError(
        `შაბლონი იყენებს ${missing.length} მასალას, რომელიც კატალოგში აღარ არის - ჩასმა შეუძლებელია.`,
      );
      return;
    }
    // In the middle of what is on screen, on the 5 cm squares.
    const cx = (stageW / 2 - panX) / zoom - template.width / 2;
    const cy = (stageH / 2 - panY) / zoom - template.height / 2;
    const atX = Math.round(cx / 5) * 5;
    const atY = Math.round(cy / 5) * 5;
    const made = instantiate(template, atX, atY);
    insertPieces(made.pieces, made.sketch);
    setToast(`ჩაისვა "${template.name}" - ${template.pieces.length} ელემენტი`);
    closeDialog();
  }

  function askDelete(template: Template) {
    openDialog({
      kind: 'confirm',
      title: 'შაბლონის წაშლა',
      message: `წავშალო შაბლონი "${template.name}"? უკვე ჩასმული ელემენტები რჩება.`,
      confirmLabel: 'წაშლა',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteTemplate(template.id);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
    });
  }

  const total = rows.reduce((sum, t) => sum + (t.price ?? 0) * (onDrawing.get(t.id) ?? 0), 0);

  return (
    <Modal
      title="შაბლონები"
      wide
      onClose={closeDialog}
      footer={
        <button className="btn" onClick={closeDialog}>
          დახურვა
        </button>
      }
    >
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}
      {!isConfigured && (
        <p className="field-hint">სერვერის გარეშე შაბლონები ამ ბრაუზერში ინახება.</p>
      )}
      {isConfigured && !loading && !templatePricesSaved() && (
        <p className="field-hint">
          ფასი და ხაზები სერვერზე ჯერ არ ინახება - Supabase-ში გაუშვი migration 0015_template_price.sql.
        </p>
      )}

      {loading ? (
        <p className="field-hint">იტვირთება…</p>
      ) : rows.length === 0 ? (
        <p className="field-hint">
          შაბლონი ჯერ არ არის. მონიშნე აწყობილი კოლონა (ელემენტები და, თუ გინდა, ხაზები) და შეინახე
          ქვემოთ.
        </p>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>დასახელება</th>
              <th className="num">ელემენტი</th>
              <th className="num">ზომა (სმ)</th>
              <th className="num">ერთეულის ფასი (₾)</th>
              <th className="num">ნახაზზე</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td className="num">{t.pieces.length}</td>
                <td className="num">
                  {t.width} × {t.height}
                </td>
                <td className="num">
                  <input
                    key={`${t.id}-${t.price}`}
                    className="price-input"
                    type="text"
                    inputMode="decimal"
                    defaultValue={t.price ?? ''}
                    placeholder="-"
                    disabled={!canEdit}
                    onWheel={keepWheelOffNumber}
                    onBlur={(e) => void onPrice(t, e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') (e.target as HTMLInputElement).blur();
                    }}
                    style={{ width: 90, textAlign: 'right' }}
                  />
                </td>
                <td className="num">{onDrawing.get(t.id) ?? 0}</td>
                <td className="row-actions">
                  <button
                    className="btn small primary"
                    disabled={busy || !canEdit}
                    onClick={() => onInsert(t)}
                  >
                    ჩასმა
                  </button>
                  <button
                    className="btn small danger"
                    disabled={busy || !canEdit}
                    onClick={() => askDelete(t)}
                    aria-label="წაშლა"
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
          {total > 0 && (
            <tfoot>
              <tr>
                <td colSpan={4}>კომპლექტის ფასი ამ ნახაზზე (რაოდენობა × ერთეულის ფასი)</td>
                <td className="num" colSpan={2}>
                  <b>{fmtPrice(total)}</b>
                </td>
              </tr>
            </tfoot>
          )}
        </table>
      )}

      <h4 className="section-title">
        {wholeDrawing ? 'მთლიანი ნახაზის შენახვა შაბლონად' : 'მონიშნულის შენახვა შაბლონად'}
      </h4>
      {selection.length === 0 && selectionLines.length === 0 ? (
        <p className="field-hint">ნახაზზე ელემენტი ჯერ არ არის.</p>
      ) : (
        <div className="user-add">
          <label className="field">
            <span>დასახელება</span>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="მაგ. კოლონა 60×60"
            />
          </label>
          <label className="field">
            <span>ერთეულის ფასი (₾)</span>
            <input
              type="text"
              inputMode="decimal"
              value={price}
              onChange={(e) => setPrice(e.target.value)}
              placeholder="არასავალდებულო"
              style={{ width: 120 }}
            />
          </label>
          <button
            className="btn primary"
            disabled={busy || !name.trim() || !canEdit}
            onClick={() => void onSave()}
            title={`${selection.length} ელემენტი${selectionLines.length ? ` + ${selectionLines.length} ხაზი` : ''}`}
          >
            {busy ? '…' : `შენახვა (${selection.length}${selectionLines.length ? ` + ${selectionLines.length} ხაზი` : ''})`}
          </button>
        </div>
      )}
    </Modal>
  );
}
