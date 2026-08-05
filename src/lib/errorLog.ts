import { supabase } from './supabase';

/**
 * Records crashes so they reach whoever can fix them.
 *
 * Several places in the app swallow a failure deliberately, to keep one broken
 * thing from taking the editor down. That is right for the user and useless for
 * debugging: without this, a crash is known only to the person it happened to.
 *
 * Reporting must never itself break anything, so every path here is wrapped and
 * failures are dropped. An error while reporting an error is not worth a second
 * error.
 */

export type ErrorSource = 'render' | 'window' | 'promise' | 'sync' | 'manual';

/** Long stacks are mostly framework frames; the top is where the fault is. */
const MAX_STACK = 4000;

/**
 * Crashes often repeat every frame — a broken render loop can fire hundreds of
 * times a second. Reporting each one would flood the table and the connection.
 */
const seen = new Map<string, number>();
const REPEAT_WINDOW_MS = 60_000;

function isDuplicate(key: string): boolean {
  const now = Date.now();
  const last = seen.get(key);
  if (last !== undefined && now - last < REPEAT_WINDOW_MS) return true;
  seen.set(key, now);
  // Bound the map; this is a long-lived tab.
  if (seen.size > 50) {
    for (const [k, t] of seen) if (now - t > REPEAT_WINDOW_MS) seen.delete(k);
  }
  return false;
}

export async function captureError(
  error: unknown,
  source: ErrorSource = 'manual',
  context: Record<string, unknown> = {},
): Promise<void> {
  const message = error instanceof Error ? error.message : String(error);
  const stack = error instanceof Error ? (error.stack ?? '') : '';

  // Always leave a trace locally, whether or not the server is reachable.
  console.error(`[${source}]`, error);

  if (!supabase || !message) return;
  if (isDuplicate(`${source}:${message}`)) return;

  try {
    // Signed-out crashes are still worth having, but `created_by` has to be
    // null rather than a guess.
    const { data } = await supabase.auth.getSession();
    const userId = data.session?.user?.id ?? null;

    await supabase.from('error_log').insert({
      message: message.slice(0, 2000),
      stack: stack.slice(0, MAX_STACK),
      source,
      context,
      user_agent: navigator.userAgent.slice(0, 500),
      url: window.location.href.slice(0, 500),
      created_by: userId,
    });
  } catch {
    /* reporting must never cascade */
  }
}

/**
 * Catch what React's error boundary cannot: errors thrown outside render, and
 * rejected promises nobody awaited. Returns a teardown.
 */
export function installGlobalErrorHandlers(): () => void {
  const onError = (event: ErrorEvent) => {
    void captureError(event.error ?? event.message, 'window', {
      line: event.lineno,
      column: event.colno,
      file: event.filename,
    });
  };

  const onRejection = (event: PromiseRejectionEvent) => {
    void captureError(event.reason, 'promise');
  };

  window.addEventListener('error', onError);
  window.addEventListener('unhandledrejection', onRejection);

  return () => {
    window.removeEventListener('error', onError);
    window.removeEventListener('unhandledrejection', onRejection);
  };
}
