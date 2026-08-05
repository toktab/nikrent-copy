import { useEffect, type ReactNode } from 'react';
import { useAuthStore } from '../store/useAuthStore';
import { LoginScreen } from './LoginScreen';
import { RecoveryScreen } from './RecoveryScreen';

/**
 * Decides whether the editor is reachable.
 *
 * When Supabase is not configured this gets out of the way entirely and the
 * app runs on localStorage as before — that path stays alive until the data
 * migration is finished, so a missing env file degrades to the old behaviour
 * instead of a blank screen.
 */
export function AuthGate({ children }: { children: ReactNode }) {
  const status = useAuthStore((s) => s.status);
  const userId = useAuthStore((s) => s.user?.id ?? null);
  const profile = useAuthStore((s) => s.profile);
  const profileError = useAuthStore((s) => s.profileError);
  const recovering = useAuthStore((s) => s.recovering);
  const init = useAuthStore((s) => s.init);
  const loadProfile = useAuthStore((s) => s.loadProfile);
  const signOut = useAuthStore((s) => s.signOut);

  useEffect(() => init(), [init]);

  // Keyed on the user id rather than called from the auth listener, which
  // would risk deadlocking supabase-js mid-dispatch.
  useEffect(() => {
    if (status === 'signed-in' && userId) void loadProfile();
  }, [status, userId, loadProfile]);

  if (status === 'disabled') return <>{children}</>;

  if (status === 'loading') {
    return (
      <div className="login-screen">
        <p className="login-sub">იტვირთება…</p>
      </div>
    );
  }

  if (status === 'signed-out') return <LoginScreen />;

  // A recovery link produces a valid session, so this has to come before the
  // editor — otherwise the user lands in the app and the password they came
  // here to change is never set.
  if (recovering) return <RecoveryScreen />;

  // Signed in, but the role has not arrived yet. Rendering the editor now
  // would briefly show controls the account may not be allowed to use.
  if (!profile) {
    return (
      <div className="login-screen">
        <div className="login-card">
          {profileError ? (
            <>
              <h1>ანგარიში არ არის სრული</h1>
              <p className="login-error" role="alert">
                {profileError}
              </p>
              <button className="btn full" onClick={() => void signOut()}>
                გამოსვლა
              </button>
            </>
          ) : (
            <p className="login-sub">პროფილი იტვირთება…</p>
          )}
        </div>
      </div>
    );
  }

  return <>{children}</>;
}
