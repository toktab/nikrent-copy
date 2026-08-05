import { useCallback, useEffect, useState } from 'react';
import {
  deleteTemplate,
  instantiate,
  listTemplates,
  missingMaterials,
  saveTemplate,
  type Template,
} from '../lib/templates';
import { isConfigured } from '../lib/supabase';
import { useCanEditDrawings } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';
import { Icon } from './Icon';
import { Modal } from './Modal';

/**
 * Saved assemblies: keep a finished column or wall and drop it into any
 * drawing later, instead of re-running a wizard and re-applying the same
 * corrections every time.
 */
export function TemplatesDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const openDialog = useEditorStore((s) => s.openDialog);
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const insertPieces = useEditorStore((s) => s.insertPieces);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const zoom = useEditorStore((s) => s.zoom);
  const canEdit = useCanEditDrawings();

  const [rows, setRows] = useState<Template[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [name, setName] = useState('');

  const byId = new Map(materials.map((m) => [m.id, m]));
  const selection = pieces.filter((p) => selectedIds.includes(p.id));

  const refresh = useCallback(async () => {
    // Templates are shared company-wide, so they only exist with a server.
    // Without one, say so rather than surfacing a raw configuration error.
    if (!isConfigured) {
      setError('შაბლონები საჭიროებს სერვერთან კავშირს.');
      setLoading(false);
      return;
    }
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
    if (!name.trim() || !selection.length) return;
    setBusy(true);
    setError(null);
    try {
      await saveTemplate(name, selection, byId);
      setName('');
      setToast(`შაბლონი "${name.trim()}" შეინახა`);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function onInsert(template: Template) {
    const missing = missingMaterials(template, byId);
    if (missing.length) {
      // Inserting anyway would drop those pieces silently and quietly
      // under-count the order.
      setError(
        `შაბლონი იყენებს ${missing.length} მასალას, რომელიც კატალოგში აღარ არის — ჩასმა შეუძლებელია.`,
      );
      return;
    }
    // Drop near the top-left of what the user is looking at, like the wizards.
    const atX = Math.round((0 - panX) / zoom + 40);
    const atY = Math.round((0 - panY) / zoom + 40);
    insertPieces(instantiate(template, atX, atY));
    setToast(`ჩაისვა ${template.pieces.length} ელემენტი`);
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

      {loading ? (
        <p className="field-hint">იტვირთება…</p>
      ) : rows.length === 0 ? (
        <p className="field-hint">
          შაბლონი ჯერ არ არის. მონიშნე აწყობილი კოლონა ან კედელი და შეინახე ქვემოთ.
        </p>
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>დასახელება</th>
              <th className="num">ელემენტი</th>
              <th className="num">ზომა (სმ)</th>
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
                  >
                    <Icon name="trash" />
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h4 className="section-title">მონიშნულის შენახვა</h4>
      {selection.length === 0 ? (
        <p className="field-hint">
          ჯერ მონიშნე ელემენტები ზედაპირზე — შაბლონად შეინახება მხოლოდ მონიშნული.
        </p>
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
          <button
            className="btn primary"
            disabled={busy || !name.trim() || !canEdit}
            onClick={() => void onSave()}
          >
            {busy ? '…' : `შენახვა (${selection.length})`}
          </button>
        </div>
      )}
    </Modal>
  );
}
