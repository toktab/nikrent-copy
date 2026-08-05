import { createClient, type SupabaseClient } from '@supabase/supabase-js';

/**
 * The Supabase client, and the one place that reads its configuration.
 *
 * Configuration is optional on purpose. The app still has a working
 * localStorage path, and it keeps working while the backend is being built —
 * a missing `.env.local` degrades to offline-only rather than a white screen.
 * `isConfigured` is what the rest of the app branches on; once the migration
 * is finished and everyone is on accounts, the branch can go.
 */

const url = import.meta.env.VITE_SUPABASE_URL?.trim();
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim();

/** True when both connection values are present and look plausible. */
export const isConfigured = Boolean(url && anonKey && url.startsWith('http'));

/**
 * Guard against the mistake that would leak everything: a `service_role` key
 * pasted where the anon key goes. That key bypasses row-level security, and in
 * a frontend it is readable by anyone who opens devtools. Fail loudly and
 * refuse to connect rather than shipping it.
 */
function assertNotServiceRole(key: string): void {
  try {
    const payload = JSON.parse(atob(key.split('.')[1] ?? ''));
    if (payload?.role === 'service_role') {
      throw new Error(
        'VITE_SUPABASE_ANON_KEY is a service_role key. That key bypasses all ' +
          'row-level security and must never be used in the browser. Replace it ' +
          'with the anon/publishable key from Supabase → Settings → API.',
      );
    }
  } catch (err) {
    // A non-JWT (newer `sb_publishable_…`) key is fine and simply won't parse;
    // only re-throw the deliberate error above.
    if (err instanceof Error && err.message.startsWith('VITE_SUPABASE_ANON_KEY')) throw err;
  }
}

/** Whether the session should outlive closing the browser. */
const REMEMBER_KEY = 'du-formwork-remember';

export function isRemembered(): boolean {
  try {
    return localStorage.getItem(REMEMBER_KEY) !== 'false';
  } catch {
    return true;
  }
}

/**
 * Choose where the session is kept, and move it if the choice changed.
 *
 * Must be called *before* signing in, so the new session is written to the
 * right place from the start.
 */
export function setRemembered(remember: boolean): void {
  try {
    localStorage.setItem(REMEMBER_KEY, remember ? 'true' : 'false');
    // Clear whichever store is no longer in use, so a stale token cannot be
    // picked up later and silently resurrect a session the user ended.
    (remember ? sessionStorage : localStorage).removeItem('du-formwork-auth');
  } catch {
    /* storage unavailable; the default (remember) applies */
  }
}

/**
 * Session storage that follows the remember-me choice.
 *
 * supabase-js takes its storage once, at construction, so the switch has to
 * live inside the adapter rather than in the options — the choice is made
 * later, on the login screen.
 */
const authStorage = {
  getItem: (key: string): string | null => {
    try {
      return (isRemembered() ? localStorage : sessionStorage).getItem(key);
    } catch {
      return null;
    }
  },
  setItem: (key: string, value: string): void => {
    try {
      (isRemembered() ? localStorage : sessionStorage).setItem(key, value);
    } catch {
      /* ignore */
    }
  },
  removeItem: (key: string): void => {
    try {
      localStorage.removeItem(key);
      sessionStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};

function build(): SupabaseClient | null {
  if (!isConfigured) return null;
  assertNotServiceRole(anonKey!);
  return createClient(url!, anonKey!, {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      // Password-reset and invite links arrive as URL fragments and have to be
      // consumed on load, so this stays on.
      detectSessionInUrl: true,
      storageKey: 'du-formwork-auth',
      storage: authStorage,
    },
  });
}

export const supabase = build();

/**
 * The client, or a thrown error if it was never configured. Use in code paths
 * that genuinely cannot proceed offline, so the failure names the cause
 * instead of surfacing as `null is not an object` somewhere downstream.
 */
export function requireSupabase(): SupabaseClient {
  if (!supabase) {
    throw new Error(
      'Supabase is not configured. Copy .env.example to .env.local and fill in ' +
        'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY.',
    );
  }
  return supabase;
}
