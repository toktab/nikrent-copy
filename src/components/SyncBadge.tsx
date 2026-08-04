import {
  flush,
  resolveConflictKeepMine,
  resolveConflictTakeServer,
  useSyncStore,
} from '../lib/syncEngine';
import { isConfigured } from '../lib/supabase';
import { useEditorStore } from '../store/useEditorStore';

/**
 * Whether the server has the user's work.
 *
 * With write-behind saving, a failure happens after the user has moved on, so
 * silence would be indistinguishable from success — someone could draw for an
 * hour against a dead connection and lose all of it. This is deliberately
 * always visible rather than a toast that disappears.
 */
export function SyncBadge() {
  const status = useSyncStore((s) => s.status);
  const pending = useSyncStore((s) => s.pendingChanges);
  const error = useSyncStore((s) => s.error);
  const conflictDocId = useSyncStore((s) => s.conflictDocId);
  const conflictName = useEditorStore(
    (s) => s.documents.find((d) => d.id === conflictDocId)?.name ?? '',
  );

  if (!isConfigured) return null;

  if (status === 'conflict') {
    return (
      <div className="sync-conflict" role="alert">
        <span>
          ნახაზი <b>{conflictName}</b> სხვამ შეცვალა.
        </span>
        <button
          className="btn small"
          onClick={() => conflictDocId && void resolveConflictKeepMine(conflictDocId)}
          title="შენი ვერსია გადააწერს სერვერზე არსებულს"
        >
          დატოვე ჩემი
        </button>
        <button
          className="btn small"
          onClick={() => conflictDocId && void resolveConflictTakeServer(conflictDocId)}
          title="სერვერის ვერსია ჩაანაცვლებს შენსას — შენი ცვლილებები დაიკარგება"
        >
          აიღე სერვერის
        </button>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="sync-badge bad" role="alert" title={error ?? ''}>
        <span>⚠ შენახვა ვერ მოხერხდა</span>
        <button className="btn small" onClick={() => void flush()}>
          ხელახლა
        </button>
      </div>
    );
  }

  if (status === 'readonly') {
    return <div className="sync-badge muted">მხოლოდ ნახვა</div>;
  }

  if (status === 'saving') return <div className="sync-badge">ინახება…</div>;
  if (pending) return <div className="sync-badge muted">არ არის შენახული</div>;
  return <div className="sync-badge ok">შენახულია</div>;
}
