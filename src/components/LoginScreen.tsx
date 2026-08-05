import { useState, type FormEvent } from 'react';
import { isRemembered } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { t } from '../i18n';
import { Icon } from './Icon';

/**
 * Sign-in screen. There is no "create account" link on purpose — accounts are
 * made by an admin, and public sign-up is switched off on the server, so
 * offering the option here would only produce a confusing failure.
 */
export function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const sendRecovery = useAuthStore((s) => s.sendRecovery);
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);
  const recoverySent = useAuthStore((s) => s.recoverySent);
  const clearError = useAuthStore((s) => s.clearError);

  const [mode, setMode] = useState<'sign-in' | 'forgot'>('sign-in');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(isRemembered);

  const canSignIn = email.trim().length > 0 && password.length > 0 && !signingIn;
  const canRecover = email.trim().length > 0 && !signingIn;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (mode === 'forgot') {
      if (canRecover) void sendRecovery(email);
      return;
    }
    if (canSignIn) void signIn(email, password, remember);
  }

  if (mode === 'forgot' && recoverySent) {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>{t('auth.checkEmail')}</h1>
          <p className="login-sub">
            {t('auth.checkEmailBody')}
          </p>
          <p className="login-hint">
            {t('auth.checkEmailHint')}
          </p>
          <button className="btn full" onClick={() => setMode('sign-in')}>
            {t('auth.backToSignInPage')}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>{t('auth.appName')}</h1>
        <p className="login-sub">
          {mode === 'sign-in'
            ? t('auth.signInHint')
            : t('auth.recoverHint')}
        </p>

        <label className="field">
          <span>{t('auth.email')}</span>
          <input
            type="email"
            value={email}
            autoComplete="username"
            autoFocus
            required
            onChange={(e) => {
              setEmail(e.target.value);
              if (error) clearError();
            }}
          />
        </label>

        {mode === 'sign-in' && (
          <>
            <label className="field">
              <span>{t('auth.password')}</span>
              <input
                type="password"
                value={password}
                autoComplete="current-password"
                required
                onChange={(e) => {
                  setPassword(e.target.value);
                  if (error) clearError();
                }}
              />
            </label>

            <label className="check-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>{t('auth.remember')}</span>
            </label>
          </>
        )}

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button
          className="btn primary full"
          type="submit"
          disabled={mode === 'sign-in' ? !canSignIn : !canRecover}
        >
          {signingIn ? '…' : mode === 'sign-in' ? t('auth.signIn') : t('auth.sendLink')}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'forgot' : 'sign-in');
            clearError();
          }}
        >
          {mode === 'sign-in' ? (
            t('auth.forgot')
          ) : (
            <>
              <Icon name="arrow-left" /> {t('auth.backToSignIn')}
            </>
          )}
        </button>

        {mode === 'sign-in' && (
          <p className="login-hint">
            {t('auth.rememberHint')}
          </p>
        )}
      </form>
    </div>
  );
}
