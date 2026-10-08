import type { FitPath } from './fit';

/**
 * How a traced drawing gets from its own tab into the editor.
 *
 * The tracing workspace is a separate page on purpose - the whole screen is
 * the architect's PDF, with nothing of the editor around it - and a separate
 * page means a separate tab. `sessionStorage`, which the detection page uses,
 * is per-tab and would not survive the trip, so this goes through
 * `localStorage`: the editor picks it up on its next load, and a tab that is
 * already open hears the `storage` event and takes it immediately.
 *
 * It is taken exactly once. Leaving it behind would re-import the same walls
 * every time the editor is opened.
 */

export const TRACE_IMPORT_KEY = 'kubi-trace-import';

export interface TraceImport {
  /** the traced runs, in world centimetres */
  paths: FitPath[];
  /** the PDF they came off, for the message the editor shows */
  fileName: string;
  pageNumber: number;
  /** epoch ms, so a stale hand-off can be ignored */
  createdAt: number;
}

/** Anything with the three localStorage methods - a real one, or a test's. */
export interface Storage2 {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

function storageOf(given?: Storage2): Storage2 | null {
  if (given) return given;
  try {
    return window.localStorage;
  } catch {
    return null; // a browser with site data switched off
  }
}

export function putTraceImport(data: TraceImport, storage?: Storage2): boolean {
  const store = storageOf(storage);
  if (!store) return false;
  try {
    store.setItem(TRACE_IMPORT_KEY, JSON.stringify(data));
    return true;
  } catch {
    return false;
  }
}

/**
 * The waiting hand-off, removed as it is read. Null when there is none, when
 * it is unreadable, or when it holds no line worth importing.
 */
export function takeTraceImport(storage?: Storage2): TraceImport | null {
  const store = storageOf(storage);
  if (!store) return null;
  let raw: string | null = null;
  try {
    raw = store.getItem(TRACE_IMPORT_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  try {
    store.removeItem(TRACE_IMPORT_KEY);
  } catch {
    /* read it anyway; the worst case is one repeat */
  }
  try {
    const data = JSON.parse(raw) as TraceImport;
    const paths = Array.isArray(data?.paths)
      ? data.paths.filter(
          (p) =>
            p &&
            Array.isArray(p.points) &&
            p.points.length >= 2 &&
            p.points.every((pt) => Number.isFinite(pt?.x) && Number.isFinite(pt?.y)),
        )
      : [];
    if (!paths.length) return null;
    return {
      paths,
      fileName: String(data.fileName ?? ''),
      pageNumber: Number(data.pageNumber) || 1,
      createdAt: Number(data.createdAt) || Date.now(),
    };
  } catch {
    return null;
  }
}
