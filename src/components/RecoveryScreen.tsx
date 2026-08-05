import { useState } from 'react';
import { useAuthStore } from '../store/useAuthStore';

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
        <h1>ახალი პაროლის დაყენება</h1>
        <p className="login-sub">აირჩიე ახალი პაროლი — ძველი აღარ იმუშავებს.</p>

        <label className="field">
          <span>ახალი პაროლი</span>
          <input
            type="password"
            value={password}
            autoComplete="new-password"
            autoFocus
            onChange={(e) => setPassword(e.target.value)}
          />
        </label>
        <label className="field">
          <span>გაიმეორე</span>
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
          {tooShort ? 'მინიმუმ 12 სიმბოლო.' : mismatch ? 'პაროლები არ ემთხვევა.' : 'მინიმუმ 12 სიმბოლო.'}
        </p>

        <button className="btn primary full" type="submit" disabled={!canSave}>
          {signingIn ? '…' : 'შენახვა და გაგრძელება'}
        </button>
        <button type="button" className="link-button" onClick={() => void signOut()}>
          გაუქმება და გამოსვლა
        </button>
      </form>
    </div>
  );
}
