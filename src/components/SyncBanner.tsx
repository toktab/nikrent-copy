import {
  discardAndReload,
  flush,
  resolveConflictKeepMine,
  resolveConflictTakeServer,
  useSyncStore,
} from '../lib/syncEngine';
import { isConfigured } from '../lib/supabase';
import { useEditorStore } from '../store/useEditorStore';
import { Icon } from './Icon';

/**
 * The three sync situations that need a decision, drawn properly.
 *
 * Every one of them names the cause and offers the next action, because a
 * coloured badge on its own is not an answer to "someone else edited this
 * drawing" — the user still has to be told who, and what happens to their own
 * work if they pick either button.
 */
export function SyncBanner() {
  const status = useSyncStore((s) => s.status);
  const error = useSyncStore((s) => s.error);
  const conflictDocId = useSyncStore((s) => s.conflictDocId);
  const conflictName = useEditorStore(
    (s) => s.documents.find((d) => d.id === conflictDocId)?.name ?? '',
  );
  const openDialog = useEditorStore((s) => s.openDialog);

  if (!isConfigured) return null;

  if (status === 'conflict') {
    return (
      <div className="sync-banner conflict" role="alert">
        <Icon name="warning" size={16} />
        <div className="sync-banner-text">
          <b>ნახაზი „{conflictName}“ სხვამ შეცვალა</b>
          <span>
            შენი და სერვერის ვერსია ერთმანეთს არ ემთხვევა. აირჩიე რომელი დარჩეს - მეორე
            დაიკარგება.
          </span>
        </div>
        <div className="sync-banner-actions">
          <button
            className="btn primary small"
            onClick={() => conflictDocId && void resolveConflictKeepMine(conflictDocId)}
            title="შენი ვერსია გადააწერს სერვერზე არსებულს"
          >
            დატოვე ჩემი
          </button>
          <button
            className="btn small"
            onClick={() => conflictDocId && void resolveConflictTakeServer(conflictDocId)}
            title="სერვერის ვერსია ჩაანაცვლებს შენსას - შენი ცვლილებები დაიკარგება"
          >
            აიღე სერვერის
          </button>
        </div>
      </div>
    );
  }

  // A refusal by role is not a failure to retry — it is a change that will
  // never be accepted, so it gets its own wording and its own way out.
  if (status === 'denied') {
    return (
      <div className="sync-banner bad" role="alert">
        <Icon name="lock" size={16} />
        <div className="sync-banner-text">
          <b>ცვლილება არ შენახულა</b>
          <span>{error}</span>
        </div>
        <div className="sync-banner-actions">
          <button
            className="btn small"
            onClick={() => void discardAndReload()}
            title="ცვლილება უქმდება და მონაცემები სერვერიდან თავიდან ჩაიტვირთება"
          >
            ცვლილების გაუქმება
          </button>
        </div>
      </div>
    );
  }

  if (status === 'error') {
    return (
      <div className="sync-banner bad" role="alert">
        <Icon name="warning" size={16} />
        <div className="sync-banner-text">
          <b>შენახვა ვერ მოხერხდა</b>
          {/* Whatever the server actually said, not a guess at it. This used
              to assert "couldn't reach the server" for every failure, which
              sent people to check their wifi while the server was sitting
              there answering clearly — the first real case was a database
              missing a column the app had started writing. The reassurance
              still stands whatever the cause, because the queue is local. */}
          <span>{error || 'უცნობი შეცდომა.'}</span>
          <span className="sync-banner-note">
            ცვლილებები ამ კომპიუტერზეა და არ დაიკარგა.
          </span>
        </div>
        <div className="sync-banner-actions">
          <button className="btn primary small" onClick={() => void flush()}>
            ხელახლა ცდა
          </button>
          <button className="btn small" onClick={() => openDialog({ kind: 'errors' })}>
            დეტალები
          </button>
        </div>
      </div>
    );
  }

  return null;
}
