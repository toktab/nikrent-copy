/**
 * customAlgorithms.ts
 *
 * Persistence for user-uploaded `.ts` detectors, with two tiers:
 *
 *  SERVER — a signed-in user's algorithms live in the `custom_algorithms`
 *           table (row-level security keeps each account to its own rows), so
 *           they follow the user to any device. The list is mirrored into
 *           localStorage after every successful read/write.
 *  LOCAL  — offline, signed-out, or with the backend unconfigured, saves go to
 *           localStorage exactly as before: they survive reloads on this
 *           browser/device and appear in the dialog's saved list.
 *
 * The tier in use is reported alongside every result (`where`), so the UI can
 * say where a save actually landed instead of guessing.
 *
 * The account is authoritative: device-only rows are preserved across an
 * online sync (tagged „მოწყობილობა“ in the dialog), but an offline *edit* or
 * *delete* of an algorithm the account already knows is device-local, and the
 * next successful sync restores the account's version.
 */

import { uid } from './ids';
import { isConfigured, requireSupabase } from './supabase';
import { useAuthStore } from '../store/useAuthStore';

/** One saved user algorithm. */
export interface SavedCustomAlgorithm {
  id: string;
  name: string;
  source: string;
  createdAt: number;
  /**
   * True when this row exists only on this device — saved while offline (or
   * signed out) and still awaiting an account that knows it. Rendered as a
   * small „მოწყობილობა“ tag so the honest origin survives a mixed list.
   */
  local?: boolean;
  /**
   * Internal mirror bookkeeping: true on rows mirrored from the account, so a
   * later merge can tell them from genuinely device-owned rows. Never shown
   * and never sent to the server.
   */
  synced?: boolean;
}

/** Where an algorithm actually lives. The UI shows this verbatim. */
export type StorageWhere = 'server' | 'local';

const KEY = 'du-formwork-custom-algos';
/** localStorage quota guard — a .ts detector is a few KB, this is generous. */
const MAX_SOURCE_CHARS = 2_000_000;

// ── localStorage tier (also the offline cache) ──────────────────────────────

/** All locally-stored algorithms, newest first. Never throws. */
function listLocal(): SavedCustomAlgorithm[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return (parsed as SavedCustomAlgorithm[]).filter(
      (a) => a && typeof a.id === 'string' && typeof a.source === 'string',
    );
  } catch {
    return [];
  }
}

function saveLocal(
  name: string,
  source: string,
): { ok: true; algo: SavedCustomAlgorithm } | { ok: false; error: string } {
  const existing = listLocal();
  const prev = existing.find((a) => a.name === name);
  const algo: SavedCustomAlgorithm = {
    id: prev?.id ?? `cust-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    name,
    source,
    createdAt: Date.now(),
  };
  const next = [algo, ...existing.filter((a) => a.id !== algo.id)];
  try {
    localStorage.setItem(KEY, JSON.stringify(next));
    return { ok: true, algo };
  } catch {
    return { ok: false, error: 'ბრაუზერის საცავი სავსეა — ვერ შეინახა.' };
  }
}

function deleteLocal(id: string): void {
  try {
    const next = listLocal().filter((a) => a.id !== id);
    if (next.length) localStorage.setItem(KEY, JSON.stringify(next));
    else localStorage.removeItem(KEY);
  } catch {
    /* storage failures on delete are harmless */
  }
}

// ── server tier ─────────────────────────────────────────────────────────────

interface CustomAlgorithmRow {
  id: string;
  user_id: string;
  name: string;
  source: string;
  created_at: string;
}

function rowToAlgo(row: CustomAlgorithmRow): SavedCustomAlgorithm {
  return {
    id: row.id,
    name: row.name,
    source: row.source,
    createdAt: new Date(row.created_at).getTime(),
  };
}

/** Write a list into localStorage as the offline cache. */
function mirrorToLocal(list: SavedCustomAlgorithm[]): void {
  try {
    if (list.length) localStorage.setItem(KEY, JSON.stringify(list));
    else localStorage.removeItem(KEY);
  } catch {
    /* cache writes are best-effort */
  }
}

/**
 * Combine the account's rows with rows that exist only on this device (saved
 * while offline). The device row is preserved — never silently destroyed when
 * the server list arrives — but tagged `local: true` so its origin is honest.
 * A row the server also has (same id, or same name, which is the save key)
 * yields to the server's version.
 */
function mergeDeviceRows(serverItems: SavedCustomAlgorithm[]): SavedCustomAlgorithm[] {
  const serverIds = new Set(serverItems.map((a) => a.id));
  const serverNames = new Set(serverItems.map((a) => a.name));
  // Tag server rows so the mirror can tell them apart from genuinely
  // device-owned ones. Without the tag, a row just deleted on the server
  // would be resurrected as a „device row“ by the very merge that follows
  // the delete (its stale copy is still in localStorage).
  const synced = serverItems.map((a) => ({ ...a, synced: true, local: undefined }));
  // Only genuinely device-owned rows survive the merge: tagged `local: true`
  // or legacy untagged rows from before sync existed. Mirrored rows the server
  // no longer has were deleted on the server and must not come back.
  const deviceOnly = listLocal()
    .filter((a) => a.synced !== true)
    .filter((a) => !serverIds.has(a.id) && !serverNames.has(a.name))
    .map((a) => ({ ...a, local: true }));
  return [...synced, ...deviceOnly];
}

/** Re-fetch the server list and refresh the offline cache from it. */
async function refreshMirror(): Promise<void> {
  try {
    const { data, error } = await requireSupabase()
      .from('custom_algorithms')
      .select('*')
      .order('name');
    if (error) return;
    mirrorToLocal(mergeDeviceRows(((data ?? []) as CustomAlgorithmRow[]).map(rowToAlgo)));
  } catch {
    /* best-effort */
  }
}

/**
 * Which tier is active right now. Server only when the backend is configured,
 * the user is signed in, and the browser reports a network — otherwise local.
 */
function syncMode(): StorageWhere {
  const status = useAuthStore.getState().status;
  const online = typeof navigator === 'undefined' ? true : navigator.onLine;
  return isConfigured && status === 'signed-in' && online ? 'server' : 'local';
}

// ── public API ──────────────────────────────────────────────────────────────

/**
 * All saved algorithms for the current context: the account's rows when
 * syncing, the device's rows otherwise. `where` reports which tier the list
 * came from, so the UI can label it honestly.
 */
export async function listCustomAlgorithms(): Promise<{
  items: SavedCustomAlgorithm[];
  where: StorageWhere;
}> {
  if (syncMode() === 'server') {
    try {
      const { data, error } = await requireSupabase()
        .from('custom_algorithms')
        .select('*')
        .order('name');
      if (error) return { items: listLocal(), where: 'local' };
      const merged = mergeDeviceRows(((data ?? []) as CustomAlgorithmRow[]).map(rowToAlgo));
      mirrorToLocal(merged);
      return { items: merged, where: 'server' };
    } catch {
      return { items: listLocal(), where: 'local' };
    }
  }
  return { items: listLocal(), where: 'local' };
}

/**
 * Save (or overwrite by name) an algorithm. Returns the saved entry, where it
 * landed, or an error on validation / quota / server failure.
 *
 * A failed server save deliberately falls back to the device rather than
 * losing the user's work — the toast then names the local tier.
 */
export async function saveCustomAlgorithm(
  name: string,
  source: string,
): Promise<
  | { ok: true; algo: SavedCustomAlgorithm; where: StorageWhere }
  | { ok: false; error: string }
> {
  const trimmed = name.trim() || 'custom';
  if (!source.trim()) return { ok: false, error: 'ცარიელი კოდის შენახვა არ შეიძლება.' };
  if (source.length > MAX_SOURCE_CHARS) {
    return { ok: false, error: 'ფაილი ძალიან დიდია შესანახად.' };
  }

  if (syncMode() === 'server') {
    const userId = useAuthStore.getState().user?.id;
    const row = { id: uid('ca'), user_id: userId, name: trimmed, source };
    try {
      const { data, error } = await requireSupabase()
        .from('custom_algorithms')
        .upsert(row, { onConflict: 'user_id,name' })
        .select('id, name, source, created_at')
        .single();
      // On a name conflict the server keeps the existing row and its id, so the
      // id returned here — not the freshly generated one — is the handle later
      // deletes must use.
      if (!error && data) {
        await refreshMirror();
        return { ok: true, algo: rowToAlgo(data as CustomAlgorithmRow), where: 'server' };
      }
    } catch {
      /* fall through to the local tier */
    }
  }

  const res = saveLocal(trimmed, source);
  if (res.ok) return { ok: true, algo: res.algo, where: 'local' };
  return { ok: false, error: res.error };
}

/**
 * Delete a saved algorithm. In server mode this also clears the offline cache
 * mirror; a row that only ever existed on this device (saved while offline) is
 * removed locally regardless of the tier.
 */
export async function deleteCustomAlgorithm(id: string): Promise<void> {
  if (syncMode() === 'server') {
    try {
      // .select('id') on a delete returns the removed rows, which is how we
      // tell "deleted on the server" apart from "was never a server row" — a
      // device-only row must still be removed locally.
      const { data, error } = await requireSupabase()
        .from('custom_algorithms')
        .delete()
        .eq('id', id)
        .select('id');
      if (!error && Array.isArray(data) && data.length > 0) {
        await refreshMirror();
        return;
      }
    } catch {
      /* fall through to the local tier */
    }
  }
  deleteLocal(id);
}
