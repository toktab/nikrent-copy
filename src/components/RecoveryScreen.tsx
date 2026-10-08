import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { t } from '../i18n';

/**
 * Shown after arriving from a recovery link.
 *
 * The link has already signed the user in, so the editor is technically
 * reachable — but handing it over before a new password is set would leave the
 * account still locked out next time. It stays here until the password is
 * changed, or the user signs out.
 */
export function RecoveryScreen() {
  const completeRecovery = useAuthStore((s) => s.completeRecovery);
  const signOut = useAuthStore((s) => s.signOut);
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);

  const [password, setPassword] = useState('');
  const [repeat, setRepeat] = useState('');

  const tooShort = password.length > 0 && password.length < 12;
  const mismatch = repeat.length > 0 && password !== repeat;
  const canSave = password.length >= 12 && password === repeat && !signingIn;

  return (
    <div className="login-screen">
      <form
        className="login-card"
        onSubmit={(e) => {
          e.preventDefault();
          if (canSave) void completeRecovery(password);
        }}
      >
        <h1>{t('recovery.title')}</h1>
        <p className="login-sub">{t('recovery.subtitle')}</p>

        <label className="field">
          <span>{t('recovery.newPassword')}</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>{t('recovery.repeat')}</span>
          <input
            type="password"
            value={repeat}
            autoComplete="new-password"
            onChange={(e) => setRepeat(e.target.value)}
          />
        </label>

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <p className="login-hint">
          {mismatch ? t('recovery.mismatch') : t('recovery.minLength', { n: 12 })}
        </p>

        <button className="btn primary full" type="submit" disabled={!canSave}>
          {signingIn ? '…' : t('recovery.save')}
        </button>
        <button type="button" className="link-button" onClick={() => void signOut()}>
          {t('recovery.cancel')}
        </button>
      </form>
    </div>
  );
}
