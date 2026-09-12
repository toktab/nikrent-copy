import { create } from 'zustand';
import { useEditorStore } from '../store/useEditorStore';
import {
  ConflictError,
  PermissionError,
  applyPlan,
  fetchAll,
  measuresSaveUnsupported,
  recheckMeasuresColumn,
  reloadDocument,
} from './repo';
import { captureError } from './errorLog';
import {
  diffSnapshots,
  emptyPlan,
  isEmptyPlan,
  mergePlans,
  type DataSnapshot,
  type SyncPlan,
} from './syncDiff';

/**
 * Pushes editor changes to the server in the background.
 *
 * Write-behind rather than write-through: every store action stays
 * synchronous, and this watches for the result. That keeps dragging a piece as
 * responsive as it was offline, and means the ~40 existing actions did not
 * each have to grow a network call and an error path.
 *
 * The cost is that a failed write is discovered after the fact, so failures
 * have to be visible — hence the status below, and the unsent plan being kept
 * and retried rather than dropped.
 */

export type SyncStatus = 'idle' | 'saving' | 'error' | 'conflict' | 'denied' | 'readonly';

interface SyncState {
  status: SyncStatus;
  error: string | null;
  lastSavedAt: number | null;
  /** drawing another user saved first, blocking ours */
  conflictDocId: string | null;
  /** what the server refused to let this role change */
  deniedWhat: string | null;
  /** unsaved work is waiting to go up */
  pendingChanges: boolean;
  /**
   * Drawings are saving without their measured lines, because the server has
   * no column for them yet. Kept up as a banner, not a passing toast: those
   * lines look saved on this screen and are gone after a reload.
   */
  measuresUnsaved: boolean;
}

export const useSyncStore = create<SyncState>(() => ({
  status: 'idle',
  error: null,
  lastSavedAt: null,
  conflictDocId: null,
  deniedWhat: null,
  pendingChanges: false,
  measuresUnsaved: false,
}));

const DEBOUNCE_MS = 900;

let baseline: DataSnapshot = { materials: [], warehouses: [], documents: [] };
let pending: SyncPlan = emptyPlan();
let timer: ReturnType<typeof setTimeout> | null = null;
let flushing = false;
let canWrite = true;
/** when the server was last asked whether the measures column has arrived */
let lastMeasuresProbe = 0;
const MEASURES_PROBE_MS = 60_000;

function snapshotOf(): DataSnapshot {
  const s = useEditorStore.getState();
  return { materials: s.materials, warehouses: s.warehouses, documents: s.documents };
}

/**
 * Declare what the server already holds.
 *
 * Called by the loader with the *server's* data, never with the store's. If a
 * fresh project seeds the built-in catalog locally, the difference between the
 * empty server and the seeded store is exactly what needs uploading — taking
 * the baseline from the store instead would mark that seed as already saved
 * and it would never be sent.
 */
export function setBaseline(snapshot: DataSnapshot): void {
  baseline = snapshot;
  pending = emptyPlan();
  useSyncStore.setState({ pendingChanges: false, error: null, status: canWrite ? 'idle' : 'readonly' });
}

/** Viewers may read everything and save nothing; don't queue writes that the
 *  server is only going to refuse. */
export function setWritable(writable: boolean): void {
  canWrite = writable;
  useSyncStore.setState({ status: writable ? 'idle' : 'readonly' });
}

function schedule(): void {
  if (timer) clearTimeout(timer);
  timer = setTimeout(() => void flush(), DEBOUNCE_MS);
}

export async function flush(): Promise<void> {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  if (flushing || !canWrite) return;
  if (useSyncStore.getState().status === 'denied') return;
  if (isEmptyPlan(pending)) {
    useSyncStore.setState({ pendingChanges: false });
    return;
  }

  const sending = pending;
  pending = emptyPlan();
  flushing = true;
  useSyncStore.setState({ status: 'saving', error: null });

  try {
    await applyPlan(sending);
    baseline = snapshotOf();
    useSyncStore.setState({
      status: 'idle',
      error: null,
      lastSavedAt: Date.now(),
      conflictDocId: null,
      deniedWhat: null,
      pendingChanges: !isEmptyPlan(pending),
    });
    // The drawing saved, but without its measured lines - the server is one
    // migration behind. Said for as long as it is true, not once.
    if (measuresSaveUnsupported()) {
      useSyncStore.setState({ measuresUnsaved: true });
      // The column may arrive while this tab stays open, when an admin runs
      // 0011. Asked at most once a minute rather than on every save.
      if (Date.now() - lastMeasuresProbe > MEASURES_PROBE_MS) {
        lastMeasuresProbe = Date.now();
        if (await recheckMeasuresColumn()) {
          useSyncStore.setState({ measuresUnsaved: false, pendingChanges: true });
          // Every save made while it was missing went up without its lines,
          // so every drawing goes up once more, with them this time.
          pending = mergePlans(pending, {
            ...emptyPlan(),
            documentsUpsert: useEditorStore.getState().documents,
          });
          schedule();
        }
      }
    }
  } catch (err) {
    // Put the unsent work back at the front of the queue so a transient
    // failure costs a retry rather than the change itself.
    pending = mergePlans(sending, pending);
    useSyncStore.setState({ pendingChanges: true });

    if (err instanceof PermissionError) {
      // Retrying is pointless — the role will be refused every time. Stop, and
      // let the user discard the change rather than watch it fail forever.
      useSyncStore.setState({
        status: 'denied',
        deniedWhat: err.what,
        error: `შენს უფლებას არ აქვს ${err.what}-ის შეცვლა. ცვლილება არ შენახულა.`,
      });
    } else if (err instanceof ConflictError) {
      useSyncStore.setState({
        status: 'conflict',
        conflictDocId: err.documentId,
        error: 'ეს ნახაზი სხვამ შეცვალა. აირჩიე რომელი ვერსია დარჩეს.',
      });
    } else {
      // Neither a conflict nor a permission refusal, so something is actually
      // wrong — and the user only sees "saving failed".
      void captureError(err, 'sync', {
        materials: sending.materialsUpsert.length,
        documents: sending.documentsUpsert.length,
        stock: sending.stockSet.length,
      });
      useSyncStore.setState({
        status: 'error',
        error: err instanceof Error ? err.message : String(err),
      });
    }
  } finally {
    flushing = false;
  }
}

/**
 * Give up on our version of a conflicted drawing and take the server's.
 * Loses local edits to that drawing, which is why it is only ever reached
 * through an explicit choice in the UI.
 */
export async function resolveConflictTakeServer(docId: string): Promise<void> {
  const fresh = await reloadDocument(docId);
  // Through the store, so the sketch and measure mirrors move with the pieces.
  useEditorStore.getState().adoptServerDocument(docId, fresh);

  // Drop the queued write for that drawing; it described the old version.
  pending = {
    ...pending,
    documentsUpsert: pending.documentsUpsert.filter((d) => d.id !== docId),
  };
  baseline = snapshotOf();
  useSyncStore.setState({ status: 'idle', conflictDocId: null, error: null });
}

/**
 * Keep our version and overwrite theirs. `reloadDocument` refreshes the stored
 * version number, so the next save matches the row and is accepted.
 */
export async function resolveConflictKeepMine(docId: string): Promise<void> {
  await reloadDocument(docId);
  const doc = useEditorStore.getState().documents.find((d) => d.id === docId);
  if (doc) pending = mergePlans(pending, { ...emptyPlan(), documentsUpsert: [doc] });
  useSyncStore.setState({ status: 'idle', conflictDocId: null, error: null });
  await flush();
}

/**
 * Throw away everything queued and take the server's data again.
 *
 * The escape hatch when a change cannot ever be saved: the local copy has
 * drifted from the server and the only honest resolution is to say so and
 * reload, rather than leaving the screen showing an edit that does not exist.
 */
export async function discardAndReload(): Promise<void> {
  pending = emptyPlan();
  useSyncStore.setState({ status: 'saving', error: null });
  try {
    const snapshot = await fetchAll();
    useEditorStore.getState().hydrateFromServer(snapshot);
    baseline = snapshot;
    useSyncStore.setState({
      status: 'idle',
      error: null,
      deniedWhat: null,
      conflictDocId: null,
      pendingChanges: false,
    });
  } catch (err) {
    useSyncStore.setState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/** Begin watching the store. Returns an unsubscribe. */
export function startSync(): () => void {
  const unsubscribe = useEditorStore.subscribe((state, previous) => {
    if (!state.dataLoaded) return;

    const unchanged =
      state.materials === previous.materials &&
      state.warehouses === previous.warehouses &&
      state.documents === previous.documents;
    if (unchanged) return;

    const plan = diffSnapshots(baseline, snapshotOf());
    if (isEmptyPlan(plan)) return;

    pending = mergePlans(pending, plan);
    // Diffing always runs against the last confirmed server state, so the
    // baseline only moves on a successful push.
    useSyncStore.setState({ pendingChanges: true });
    schedule();
  });

  // A reload or a closed tab should not take unsaved work with it.
  const onBeforeUnload = (e: BeforeUnloadEvent) => {
    if (useSyncStore.getState().pendingChanges) {
      void flush();
      e.preventDefault();
      e.returnValue = '';
    }
  };
  window.addEventListener('beforeunload', onBeforeUnload);

  // Coming back online retries by itself. Without this the queued work sat
  // there until the user happened to edit something else or pressed the retry
  // button — so the app told them their changes would upload when the
  // connection returned, and then quietly did not.
  const onOnline = () => {
    if (useSyncStore.getState().pendingChanges) void flush();
  };
  window.addEventListener('online', onOnline);

  return () => {
    unsubscribe();
    window.removeEventListener('beforeunload', onBeforeUnload);
    window.removeEventListener('online', onOnline);
    if (timer) clearTimeout(timer);
  };
}
