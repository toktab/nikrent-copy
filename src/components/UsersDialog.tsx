import { useCallback, useEffect, useState } from 'react';
import {
  createUser,
  deleteUser,
  generatePassword,
  listProfiles,
  resetPassword,
  setRole,
} from '../lib/adminUsers';
import { useAuthStore, type Profile, type Role } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';
import { t } from '../i18n';
import { Modal } from './Modal';

const ROLE_LABEL: Record<Role, string> = {
  admin: t('role.admin'),
  editor: t('role.editor'),
  viewer: t('role.viewer'),
};

const ROLE_HINT: Record<Role, string> = {
  admin: 'ყველაფერი — კატალოგი, მარაგი, მომხმარებლები, ნახაზები',
  editor: 'ნახაზები: შექმნა და რედაქტირება. კატალოგსა და მარაგს ვერ ცვლის',
  viewer: 'ხედავს ყველაფერს, ვერაფერს ცვლის',
};

/** Team management for admins: add staff, change roles, remove accounts. */
export function UsersDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const openDialog = useEditorStore((s) => s.openDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const me = useAuthStore((s) => s.profile);

  const [rows, setRows] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [email, setEmail] = useState('');
  const [fullName, setFullName] = useState('');
  const [role, setNewRole] = useState<Role>('editor');

  /**
   * Shown once, after the account is made. There is no way to read it back
   * later — Supabase stores only a hash — so the admin has to pass it on now.
   */
  const [issued, setIssued] = useState<{
    email: string;
    password: string;
    kind: 'created' | 'reset';
  } | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      setRows(await listProfiles());
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

  async function onCreate() {
    const address = email.trim().toLowerCase();
    if (!address) return;
    setBusy(true);
    setError(null);
    const password = generatePassword();
    try {
      await createUser({ email: address, fullName: fullName.trim(), role, password });
      setIssued({ email: address, password, kind: 'created' });
      setEmail('');
      setFullName('');
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onChangeRole(id: string, next: Role) {
    setBusy(true);
    setError(null);
    try {
      await setRole(id, next);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onReset(profile: Profile) {
    setBusy(true);
    setError(null);
    try {
      const password = await resetPassword(profile.id);
      setIssued({ email: profile.email, password, kind: 'reset' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function askDelete(profile: Profile) {
    openDialog({
      kind: 'confirm',
      title: 'მომხმარებლის წაშლა',
      message: `წავშალო ${profile.email}? ანგარიში სამუდამოდ წაიშლება. მისი ნახაზები რჩება.`,
      confirmLabel: 'წაშლა',
      danger: true,
      onConfirm: () => {
        void (async () => {
          try {
            await deleteUser(profile.id);
            setToast(`${profile.email} წაიშალა`);
            await refresh();
          } catch (err) {
            setError(err instanceof Error ? err.message : String(err));
          }
        })();
      },
    });
  }

  if (issued) {
    return (
      <Modal
        title={issued.kind === 'created' ? 'ანგარიში შეიქმნა' : 'პაროლი განახლდა'}
        onClose={() => setIssued(null)}
        footer={
          <button className="btn primary" onClick={() => setIssued(null)}>
            გასაგებია
          </button>
        }
      >
        <p className="field-hint">
          გადაეცი ეს პაროლი <b>{issued.email}</b>-ს. ის მეორედ აღარ გამოჩნდება — თუ დაიკარგება,
          საჭირო იქნება ახლის გენერაცია.
        </p>
        <div className="temp-password">
          <code>{issued.password}</code>
          <button
            className="btn small"
            onClick={() => {
              void navigator.clipboard?.writeText(issued.password);
              setToast('პაროლი დაკოპირდა');
            }}
          >
            კოპირება
          </button>
        </div>
        <p className="field-hint">
          გადაეცი უსაფრთხო არხით და სთხოვე, პირველივე შესვლისას შეცვალოს.
        </p>
      </Modal>
    );
  }

  return (
    <Modal
      title="მომხმარებლები"
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
      ) : (
        <table className="users-table">
          <thead>
            <tr>
              <th>ელფოსტა</th>
              <th>სახელი</th>
              <th>უფლება</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => {
              const isMe = row.id === me?.id;
              return (
                <tr key={row.id}>
                  <td>
                    {row.email}
                    {isMe && <span className="you-tag">შენ</span>}
                  </td>
                  <td>{row.full_name || '—'}</td>
                  <td>
                    <select
                      value={row.role}
                      disabled={busy || isMe}
                      title={isMe ? 'საკუთარი უფლების შეცვლა შეუძლებელია' : ROLE_HINT[row.role]}
                      onChange={(e) => void onChangeRole(row.id, e.target.value as Role)}
                    >
                      {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
                        <option key={r} value={r}>
                          {ROLE_LABEL[r]}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="row-actions">
                    <button
                      className="btn small"
                      disabled={busy}
                      onClick={() => void onReset(row)}
                      title="ახალი პაროლის გენერაცია — ძველი გაუქმდება"
                    >
                      პაროლი
                    </button>
                    <button
                      className="btn small danger"
                      disabled={busy || isMe}
                      onClick={() => askDelete(row)}
                      title={isMe ? 'საკუთარი ანგარიშის წაშლა შეუძლებელია' : 'ანგარიშის წაშლა'}
                    >
                      წაშლა
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}

      <ul className="role-legend">
        {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
          <li key={r}>
            <span className={`user-role role-${r}`}>{ROLE_LABEL[r]}</span>
            <span>{ROLE_HINT[r]}</span>
          </li>
        ))}
      </ul>

      <h4 className="section-title">ახალი მომხმარებელი</h4>
      <div className="user-add">
        <label className="field">
          <span>ელფოსტა</span>
          <input
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="name@company.ge"
          />
        </label>
        <label className="field">
          <span>სახელი</span>
          <input type="text" value={fullName} onChange={(e) => setFullName(e.target.value)} />
        </label>
        <label className="field">
          <span>უფლება</span>
          <select value={role} onChange={(e) => setNewRole(e.target.value as Role)}>
            {(Object.keys(ROLE_LABEL) as Role[]).map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </label>
        <button className="btn primary" disabled={busy || !email.trim()} onClick={() => void onCreate()}>
          {busy ? '…' : 'დამატება'}
        </button>
      </div>
      <p className="field-hint">
        პაროლი ავტომატურად დაგენერირდება და ერთხელ გამოჩნდება — ელფოსტა არ იგზავნება.
      </p>
    </Modal>
  );
}
