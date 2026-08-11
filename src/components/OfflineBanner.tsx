import { useSyncStore } from '../lib/syncEngine';
import { isConfigured } from '../lib/supabase';
import { useOnline } from '../lib/useOnline';
import { Icon } from './Icon';

/** hh:mm, because the useful part of "when did this last save" is the clock. */
function clock(at: number): string {
  return new Date(at).toLocaleTimeString('ka-GE', { hour: '2-digit', minute: '2-digit' });
}

/**
 * Losing the network is not an error, and saying "saving failed" for it sends
 * people looking for a bug that isn't there. It is a normal thing that happens
 * on a building site, the work is safe, and it will go up by itself — so the
 * banner is neutral grey, states where the changes are, and shows the clock
 * time of the last successful save so nobody has to guess how much is at risk.
 */
export function OfflineBanner() {
  const online = useOnline();
  const pending = useSyncStore((s) => s.pendingChanges);
  const lastSavedAt = useSyncStore((s) => s.lastSavedAt);

  if (online || !isConfigured) return null;

  return (
    <div className="offline-banner" role="status">
      <Icon name="offline" size={15} />
      <div className="offline-text">
        <b>ოფლაინ ხარ</b>
        <span>
          {pending
            ? 'ცვლილებები ინახება ამ კომპიუტერზე და აიტვირთება კავშირის აღდგენისას.'
            : 'ყველაფერი შენახულია. რედაქტირება შეგიძლია - აიტვირთება კავშირის აღდგენისას.'}
        </span>
      </div>
      {lastSavedAt && <span className="offline-when">ბოლო შენახვა - {clock(lastSavedAt)}</span>}
    </div>
  );
}
