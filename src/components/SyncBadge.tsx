import { useSyncStore } from '../lib/syncEngine';
import { isConfigured } from '../lib/supabase';
import { useOnline } from '../lib/useOnline';
import { Icon } from './Icon';
import { Tooltip } from './Tooltip';

/**
 * Whether the server has the user's work.
 *
 * With write-behind saving, a failure happens after the user has moved on, so
 * silence would be indistinguishable from success — someone could draw for an
 * hour against a dead connection and lose all of it. This is deliberately
 * always visible rather than a toast that disappears.
 *
 * The badge is the glance; it never carries the whole story. Anything the user
 * has to act on — a conflict, a refusal, a failure — gets a banner under the
 * header with the cause and the way out. Cramming those into the header is
 * what used to push the account menu off the right edge.
 */
export function SyncBadge() {
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pendingChanges);
  const error = useSyncStore((s) => s.error);
  const online = useOnline();

  if (!isConfigured) return null;

  // Offline outranks everything: nothing can reach the server, so "failed" and
  // "unsaved" would both be describing the same missing network.
  if (!online) {
    return (
      <Tooltip label="ოფლაინ" reason="ცვლილებები ინახება ლოკალურად" icon="offline">
        <span className="badge">ოფლაინ</span>
      </Tooltip>
    );
  }

  if (status === 'conflict') {
    return <span className="badge conflict">შეიცვალა</span>;
  }
  if (status === 'denied') {
    return (
      <Tooltip label="ცვლილება არ შენახულა" reason={error ?? undefined} icon="lock">
        <span className="badge bad">ვერ შეინახა</span>
      </Tooltip>
    );
  }
  if (status === 'error') {
    return (
      <Tooltip label="შენახვა ვერ მოხერხდა" reason={error ?? undefined} icon="warning">
        <span className="badge bad">ვერ შეინახა</span>
      </Tooltip>
    );
  }
  if (status === 'readonly') {
    return (
      <Tooltip
        label="მხოლოდ ნახვა"
        reason="რედაქტირების უფლება არ გაქვს - მიმართე ადმინისტრატორს"
        icon="lock"
      >
        <span className="badge readonly">
          <Icon name="lock" size={12} /> მხოლოდ ნახვა
        </span>
      </Tooltip>
    );
  }
  if (status === 'saving') {
    return <span className="badge warn">ინახება…</span>;
  }
  if (pending) {
    return (
      <Tooltip label="შეუნახავი ცვლილებები" reason="ავტომატურად აიტვირთება">
        <span className="badge warn">შეუნახავი</span>
      </Tooltip>
    );
  }
  return <span className="badge ok">შენახულია</span>;
}
