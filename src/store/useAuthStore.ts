import type { Session, User } from '@supabase/supabase-js';
import { create } from 'zustand';
import { isConfigured, setRemembered, supabase } from '../lib/supabase';

/**
 * Session and role, kept deliberately apart from `useEditorStore`.
 *
 * The editor store is persisted to localStorage; a session must never be, so
 * mixing them would be a standing invitation to leak a token into a place it
 * does not belong. Supabase keeps its own token under its own storage key.
 */

export type Role = 'admin' | 'editor' | 'viewer';

export interface Profile {
  id: string;
  email: string;
  full_name: string;
  role: Role;
  /** public URL of the profile picture; empty when none is set */
  avatar_url: string;
}

/**
 * `disabled` is the offline path: no `.env.local`, so the app runs on
 * localStorage exactly as it did before the backend existed. It keeps the
 * editor usable while the data layer is still being moved over.
 */
export type AuthStatus = 'loading' | 'disabled' | 'signed-out' | 'signed-in';

interface AuthState {
  status: AuthStatus;
  session: Session | null;
  user: User | null;
  profile: Profile | null;
  /** set when the account exists but its profile row could not be read */
  profileError: string | null;
  signingIn: boolean;
  error: string | null;
  /**
   * True after arriving via a recovery link. The session is real but exists
   * only to set a new password, so the editor stays closed until it is done.
   */
  recovering: boolean;
  /** confirmation that a recovery email was accepted for sending */
  recoverySent: boolean;

  init: () => () => void;
  loadProfile: () => Promise<void>;
  signIn: (email: string, password: string, remember: boolean) => Promise<void>;
  sendRecovery: (email: string) => Promise<void>;
  completeRecovery: (password: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
  /** Apply a local change to the signed-in user's own profile. */
  patchProfile: (patch: Partial<Profile>) => void;
}

/** Supabase speaks English; the interface does not. */
function translateAuthError(message: string): string {
  const m = message.toLowerCase();
  if (m.includes('invalid login credentials')) return 'არასწორი ელფოსტა ან პაროლი.';
  if (m.includes('email not confirmed')) return 'ელფოსტა არ არის დადასტურებული.';
  if (m.includes('too many requests') || m.includes('rate limit')) {
    return 'ძალიან ბევრი მცდელობა. სცადე ცოტა ხანში.';
  }
  if (m.includes('signups not allowed') || m.includes('signup is disabled')) {
    return 'ახალი ანგარიშის შექმნა გამორთულია. მიმართე ადმინისტრატორს.';
  }
  if (m.includes('failed to fetch') || m.includes('network')) {
    return 'სერვერთან კავშირი ვერ მოხერხდა. შეამოწმე ინტერნეტი.';
  }
  return message;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  status: isConfigured ? 'loading' : 'disabled',
  session: null,
  user: null,
  profile: null,
  profileError: null,
  signingIn: false,
  error: null,
  recovering: false,
  recoverySent: false,

  /**
   * Reads any stored session, then listens for changes. Returns an unsubscribe
   * so React can tear the listener down.
   *
   * The listener only records the session — it deliberately does no async work
   * of its own. supabase-js holds an internal lock while dispatching these
   * events, and awaiting another client call inside the callback can deadlock
   * it, leaving the app stuck on the loading screen. Fetching the profile is
   * therefore left to an effect that watches the user id.
   */
  init: () => {
    if (!supabase) {
      set({ status: 'disabled' });
      return () => {};
    }

    supabase.auth
      .getSession()
      .then(({ data, error }) => {
        if (error) set({ error: translateAuthError(error.message) });
        const session = data?.session ?? null;
        set({
          session,
          user: session?.user ?? null,
          status: session ? 'signed-in' : 'signed-out',
        });
      })
      .catch((err: unknown) => {
        set({
          status: 'signed-out',
          error: translateAuthError(err instanceof Error ? err.message : String(err)),
        });
      });

    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      // A recovery link signs the user in with a session whose only purpose is
      // setting a new password. Flagged so the editor is not handed over until
      // that has actually happened.
      if (event === 'PASSWORD_RECOVERY') set({ recovering: true });
      set({
        session,
        user: session?.user ?? null,
        status: session ? 'signed-in' : 'signed-out',
        // Belongs to the account that just left.
        profile: session ? get().profile : null,
        profileError: null,
      });
    });

    return () => data.subscription.unsubscribe();
  },

  /**
   * The role lives in `profiles`, not in the token, so it is fetched once per
   * sign-in. A missing row means the account can do nothing at all, so it is
   * surfaced rather than silently treated as a viewer.
   */
  loadProfile: async () => {
    const { user } = get();
    if (!supabase || !user) return;

    const { data, error } = await supabase
      .from('profiles')
      // `*` rather than a column list: naming avatar_url would make sign-in
      // fail outright on a database where migration 0004 has not been run yet.
      .select('*')
      .eq('id', user.id)
      .maybeSingle();

    if (error) {
      set({ profile: null, profileError: translateAuthError(error.message) });
      return;
    }
    if (!data) {
      set({
        profile: null,
        profileError: 'ანგარიშს არ აქვს პროფილი. მიმართე ადმინისტრატორს.',
      });
      return;
    }
    // avatar_url is absent before migration 0004; normalise so the UI never
    // has to test for undefined.
    const row = data as Profile;
    set({ profile: { ...row, avatar_url: row.avatar_url ?? '' }, profileError: null });
  },

  signIn: async (email, password, remember) => {
    if (!supabase) return;
    // Set before signing in so the session is written to the storage the user
    // chose, rather than being moved afterwards.
    setRemembered(remember);
    set({ signingIn: true, error: null });
    const { error } = await supabase.auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    // On success `onAuthStateChange` moves the status; only failure is handled.
    if (error) set({ error: translateAuthError(error.message), signingIn: false });
    else set({ signingIn: false });
  },

  /**
   * Send a recovery link.
   *
   * Deliberately a link and not a new password: a password mailed in plain
   * text stays readable in the inbox, in any backup of it, and to anyone who
   * later gains access to the mailbox. The link is single-use and expires.
   *
   * Always reports success, even for an address that has no account —
   * otherwise the form becomes a way to test which staff emails exist.
   */
  sendRecovery: async (email) => {
    if (!supabase) return;
    set({ signingIn: true, error: null });
    const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
      redirectTo: window.location.origin,
    });
    if (error && /rate|limit|too many/i.test(error.message)) {
      set({
        error: 'ელფოსტის გაგზავნის ლიმიტი ამოიწურა. სცადე ერთ საათში ან მიმართე ადმინისტრატორს.',
        signingIn: false,
      });
      return;
    }
    set({ recoverySent: true, signingIn: false });
  },

  completeRecovery: async (password) => {
    if (!supabase) return;
    set({ signingIn: true, error: null });
    const { error } = await supabase.auth.updateUser({ password });
    if (error) {
      set({ error: translateAuthError(error.message), signingIn: false });
      return;
    }
    set({ recovering: false, signingIn: false, error: null });
  },

  signOut: async () => {
    if (!supabase) return;
    await supabase.auth.signOut();
    set({
      session: null,
      user: null,
      profile: null,
      profileError: null,
      status: 'signed-out',
      recovering: false,
      recoverySent: false,
    });
  },

  clearError: () => set({ error: null }),

  patchProfile: (patch) =>
    set((state) => (state.profile ? { profile: { ...state.profile, ...patch } } : {})),
}));

/** Convenience selectors — roles are checked in more than one place. */
export const selectIsAdmin = (s: AuthState): boolean => s.profile?.role === 'admin';
export const selectCanEdit = (s: AuthState): boolean =>
  s.profile?.role === 'admin' || s.profile?.role === 'editor';

/**
 * Shown on every control an editor or viewer cannot use. Saying who *can* do
 * it is the useful part — the reader's next step is to go and ask them.
 */
export const ADMIN_ONLY_TITLE = 'მხოლოდ ადმინისტრატორს შეუძლია კატალოგისა და მარაგის შეცვლა';

/**
 * May the current user change the catalog, prices and stock?
 *
 * The server allows this to admins only, so the controls are disabled for
 * everyone else rather than letting a change be made, queued, and then
 * rejected — which would fail the whole batch it was travelling in.
 *
 * On the offline path there is no server and no roles, so everything is
 * allowed exactly as it was before accounts existed.
 */
export function useCanManageCatalog(): boolean {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.profile?.role);
  return status === 'disabled' || role === 'admin';
}

/** May the current user change drawings? */
export function useCanEditDrawings(): boolean {
  const status = useAuthStore((s) => s.status);
  const role = useAuthStore((s) => s.profile?.role);
  return status === 'disabled' || role === 'admin' || role === 'editor';
}
