import { useCallback, useEffect, useState } from 'react';
import { clearErrors, fetchErrors, type ErrorEntry } from '../lib/errorLog';
import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';
import { Icon } from './Icon';

const SOURCE_LABEL: Record<string, string> = {
  render: 'ინტერფეისი',
  window: 'ბრაუზერი',
  promise: 'ფონური ოპერაცია',
  sync: 'სერვერთან სინქრონიზაცია',
  manual: 'აღრიცხული',
};

/** "3 წუთის წინ" reads better than a timestamp for something that just broke. */
function ago(iso: string): string {
  const seconds = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000);
  if (seconds < 60) return 'ახლახან';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes} წუთის წინ`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} საათის წინ`;
  return new Date(iso).toLocaleDateString('ka-GE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/**
 * What has been crashing, for an admin.
 *
 * The app deliberately swallows failures so one broken thing cannot take the
 * editor down with it. That left the reports somewhere only the SQL editor
 * could reach, which in practice means nobody ever looked — a crash log with
 * no reader is barely better than no crash log.
 */
export function ErrorLogDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const openDialog = useEditorStore((s) => s.openDialog);
  const setToast = useEditorStore((s) => s.setToast);

  const [rows, setRows] = useState<ErrorEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<number | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await fetchErrors());
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

  function askClear() {
    if (!rows.length) return;
    // Bounded by the newest entry actually on screen, so a crash that lands
    // while the dialog is open is not thrown away unseen.
    const newest = rows[0].id;
    openDialog({
      kind: 'confirm',
      title: 'ჟურნალის გასუფთავება',
      message: `წაიშალოს ${rows.length} ჩანაწერი? ეს შეუქცევადია.`,
      confirmLabel: 'წაშლა',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await clearErrors(newest);
            setToast('ჟურნალი გასუფთავდა');
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
      title="შეცდომების ჟურნალი"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={() => void refresh()} disabled={loading}>
            <Icon name="reset" /> განახლება
          </button>
          <button className="btn danger" onClick={askClear} disabled={loading || !rows.length}>
            <Icon name="trash" /> გასუფთავება
          </button>
          <button className="btn primary" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      {error && (
        <p className="login-error" role="alert">
          {error}
        </p>
      )}

      {loading ? (
        <p className="field-hint">იტვირთება…</p>
      ) : !rows.length ? (
        <p className="field-hint">
          ჩანაწერი არ არის — პროგრამას გაფრთხილების გარეშე არაფერი შეჰფერხებია.
        </p>
      ) : (
        <ul className="error-list">
          {rows.map((row) => {
            const open = expanded === row.id;
            return (
              <li key={row.id} className="error-row">
                <button
                  className="error-head"
                  aria-expanded={open}
                  onClick={() => setExpanded(open ? null : row.id)}
                >
                  <Icon name={open ? 'chevron-down' : 'chevron-right'} />
                  <span className="error-message">{row.message}</span>
                  <span className="error-source">{SOURCE_LABEL[row.source] ?? row.source}</span>
                  <span className="error-when">{ago(row.created_at)}</span>
                </button>

                {open && (
                  <div className="error-detail">
                    {row.stack && <pre>{row.stack}</pre>}
                    <dl className="error-meta">
                      <dt>დრო</dt>
                      <dd>{new Date(row.created_at).toLocaleString('ka-GE')}</dd>
                      {row.url && (
                        <>
                          <dt>მისამართი</dt>
                          <dd>{row.url}</dd>
                        </>
                      )}
                      {row.user_agent && (
                        <>
                          <dt>ბრაუზერი</dt>
                          <dd>{row.user_agent}</dd>
                        </>
                      )}
                      {Object.keys(row.context ?? {}).length > 0 && (
                        <>
                          <dt>დეტალები</dt>
                          <dd>
                            <code>{JSON.stringify(row.context)}</code>
                          </dd>
                        </>
                      )}
                    </dl>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      <p className="field-hint">
        ჩანაწერს ავტომატურად აკეთებს პროგრამა, როცა რამე იშლება. ერთი და იგივე შეცდომა
        წუთში ერთხელ ჩაიწერება.
      </p>
    </Modal>
  );
}
