import { useState, type FormEvent } from 'react';
import { isRemembered } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';

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
          <h1>შეამოწმე ელფოსტა</h1>
          <p className="login-sub">
            თუ ამ მისამართზე ანგარიში არსებობს, გამოგზავნილია ბმული პაროლის აღსადგენად.
          </p>
          <p className="login-hint">
            წერილი რამდენიმე წუთში არ მოვიდა? შეამოწმე სპამი, ან სთხოვე ადმინისტრატორს ახალი
            პაროლის გენერაცია — ეს ყოველთვის მუშაობს.
          </p>
          <button className="btn full" onClick={() => setMode('sign-in')}>
            შესვლის გვერდზე დაბრუნება
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="login-screen">
      <form className="login-card" onSubmit={onSubmit}>
        <h1>Du ფორმვორკის რედაქტორი</h1>
        <p className="login-sub">
          {mode === 'sign-in'
            ? 'შესასვლელად გამოიყენე სამუშაო ელფოსტა'
            : 'შეიყვანე ელფოსტა და გამოგიგზავნით აღდგენის ბმულს'}
        </p>

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

        {mode === 'sign-in' && (
          <>
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

            <label className="check-row">
              <input
                type="checkbox"
                checked={remember}
                onChange={(e) => setRemember(e.target.checked)}
              />
              <span>დამახსოვრება — ბრაუზერის დახურვის შემდეგაც შესული დავრჩე</span>
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
          {signingIn ? '…' : mode === 'sign-in' ? 'შესვლა' : 'ბმულის გამოგზავნა'}
        </button>

        <button
          type="button"
          className="link-button"
          onClick={() => {
            setMode(mode === 'sign-in' ? 'forgot' : 'sign-in');
            clearError();
          }}
        >
          {mode === 'sign-in' ? 'პაროლი დაგავიწყდა?' : '← შესვლა'}
        </button>

        {mode === 'sign-in' && (
          <p className="login-hint">
            საერთო კომპიუტერზე მოხსენი „დამახსოვრება“ — მაშინ ბრაუზერის დახურვისას სესია
            დასრულდება.
          </p>
        )}
      </form>
    </div>
  );
}
