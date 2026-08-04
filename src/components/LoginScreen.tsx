import { useState, type FormEvent } from 'react';
import { useAuthStore } from '../store/useAuthStore';

/**
 * Sign-in screen. There is no "create account" link on purpose — accounts are
 * made by an admin, and public sign-up is switched off on the server, so
 * offering the option here would only produce a confusing failure.
 */
export function LoginScreen() {
  const signIn = useAuthStore((s) => s.signIn);
  const signingIn = useAuthStore((s) => s.signingIn);
  const error = useAuthStore((s) => s.error);
  const clearError = useAuthStore((s) => s.clearError);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');

  const canSubmit = email.trim().length > 0 && password.length > 0 && !signingIn;

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    if (!canSubmit) return;
    void signIn(email, password);
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Du ფორმვორკის რედაქტორი</h1>
        <p className="login-sub">შესასვლელად გამოიყენე სამუშაო ელფოსტა</p>

        <label className="field">
          <span>ელფოსტა</span>
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

        <label className="field">
          <span>პაროლი</span>
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

        {error && (
          <p className="login-error" role="alert">
            {error}
          </p>
        )}

        <button className="btn primary full" type="submit" disabled={!canSubmit}>
          {signingIn ? 'შესვლა…' : 'შესვლა'}
        </button>

        <p className="login-hint">
          პაროლი დაგავიწყდა? მიმართე ადმინისტრატორს — ის განაახლებს პაროლს.
        </p>
      </form>
    </div>
  );
}
