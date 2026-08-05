import { useEffect, useRef, useState } from 'react';
import { initialsFor } from '../lib/presence';
import { removeAvatar, updateDisplayName, uploadAvatar, validateAvatar } from '../lib/profile';
import { useAuthStore, type Role } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';
import { t } from '../i18n';
import { Icon } from './Icon';

const ROLE_LABEL: Record<Role, string> = {
  admin: t('role.admin'),
  editor: t('role.editor'),
  viewer: t('role.viewer'),
};

const ROLE_HINT: Record<Role, string> = {
  admin: t('role.adminCan'),
  editor: t('role.editorCan'),
  viewer: t('role.viewerCan'),
};

/**
 * The account menu: picture, name, role, password and the way out.
 *
 * A single avatar button rather than a row of controls — the header is already
 * dense, and everything here is occasional.
 */
export function ProfileMenu() {
  const status = useAuthStore((s) => s.status);
  const profile = useAuthStore((s) => s.profile);
  const patchProfile = useAuthStore((s) => s.patchProfile);
  const signOut = useAuthStore((s) => s.signOut);
  const openDialog = useEditorStore((s) => s.openDialog);
  const setToast = useEditorStore((s) => s.setToast);

  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const fileInput = useRef<HTMLInputElement>(null);
  const root = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (profile) setName(profile.full_name);
  }, [profile]);

  // Close on an outside click or Escape, like every other menu on the platform.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (status !== 'signed-in' || !profile) return null;

  const displayName = profile.full_name.trim() || profile.email;

  async function onPickFile(file: File) {
    if (!profile) return;
    const problem = validateAvatar(file);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const url = await uploadAvatar(profile.id, file);
      patchProfile({ avatar_url: url });
      setToast('პროფილის სურათი განახლდა');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onRemove() {
    if (!profile) return;
    setBusy(true);
    setError(null);
    try {
      await removeAvatar(profile.id, profile.avatar_url);
      patchProfile({ avatar_url: '' });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  async function onSaveName() {
    if (!profile || name.trim() === profile.full_name) return;
    setBusy(true);
    setError(null);
    try {
      await updateDisplayName(profile.id, name);
      patchProfile({ full_name: name.trim() });
      setToast('სახელი განახლდა');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="profile-menu" ref={root}>
      <button
        className="avatar-button"
        onClick={() => setOpen((v) => !v)}
        title={`${displayName} — ${ROLE_LABEL[profile.role]}`}
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {profile.avatar_url ? (
          <img src={profile.avatar_url} alt="" className="avatar-img" />
        ) : (
          <span className="avatar-fallback">{initialsFor(displayName)}</span>
        )}
      </button>

      {open && (
        <div className="profile-panel" role="menu">
          <div className="profile-head">
            <div className="profile-avatar-large">
              {profile.avatar_url ? (
                <img src={profile.avatar_url} alt="" />
              ) : (
                <span>{initialsFor(displayName)}</span>
              )}
            </div>
            <div className="profile-id">
              <b>{displayName}</b>
              {/* displayName falls back to the email, so only show it twice
                  when there is a real name to distinguish it from. */}
              {displayName !== profile.email && <span>{profile.email}</span>}
              <span className={`user-role role-${profile.role}`}>
                {ROLE_LABEL[profile.role]}
              </span>
              <span className="profile-role-hint">{ROLE_HINT[profile.role]}</span>
            </div>
          </div>

          {error && (
            <p className="login-error" role="alert">
              {error}
            </p>
          )}

          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            hidden
            onChange={(e) => {
              const file = e.target.files?.[0];
              // Reset so re-picking the same file fires change again.
              e.target.value = '';
              if (file) void onPickFile(file);
            }}
          />

          <div className="profile-row">
            <button className="btn small" disabled={busy} onClick={() => fileInput.current?.click()}>
              {profile.avatar_url ? 'სურათის შეცვლა' : 'სურათის ატვირთვა'}
            </button>
            {profile.avatar_url && (
              <button className="btn small danger" disabled={busy} onClick={() => void onRemove()}>
                წაშლა
              </button>
            )}
          </div>

          <label className="field">
            <span>საჩვენებელი სახელი</span>
            <input
              type="text"
              value={name}
              disabled={busy}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void onSaveName()}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void onSaveName();
              }}
            />
          </label>
          <p className="field-hint">ეს სახელი უჩანთ კოლეგებს ნახაზზე მუშაობისას.</p>

          <div className="profile-actions">
            {profile.role === 'admin' && (
              <>
                <button
                  className="btn full"
                  onClick={() => {
                    setOpen(false);
                    openDialog({ kind: 'users' });
                  }}
                ><Icon name="users" /> გუნდის მართვა
                </button>
                <button
                  className="btn full"
                  onClick={() => {
                    setOpen(false);
                    openDialog({ kind: 'errors' });
                  }}
                  title="რა იშლება პროგრამაში — ავტომატურად აღრიცხული"
                ><Icon name="warning" /> შეცდომების ჟურნალი
                </button>
              </>
            )}
            <button
              className="btn full"
              onClick={() => {
                setOpen(false);
                openDialog({ kind: 'password' });
              }}
            ><Icon name="key" /> პაროლის შეცვლა
            </button>
            <button className="btn full danger" onClick={() => void signOut()}>
              გამოსვლა
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
