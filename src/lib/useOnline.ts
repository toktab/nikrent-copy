import { useEffect, useState } from 'react';

/**
 * Whether the browser thinks it has a network.
 *
 * `navigator.onLine` is honest about one thing only — the machine has no route
 * at all — and says nothing about whether Supabase is reachable. That is
 * exactly the split the interface wants: this drives the "offline, work is
 * queued" message, while an actual failed request drives "saving failed".
 * Treating a dead server as offline would tell the user to check their wifi
 * when their wifi is fine.
 */
export function useOnline(): boolean {
  const [online, setOnline] = useState(() =>
    typeof navigator === 'undefined' ? true : navigator.onLine,
  );

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  return online;
}
