import { describe, expect, it } from 'vitest';
import { putTraceImport, takeTraceImport, TRACE_IMPORT_KEY, type Storage2 } from '../handoff';

/** A localStorage stand-in, so the hand-off can be tested without a browser. */
function fakeStorage(seed: Record<string, string> = {}): Storage2 & { data: Record<string, string> } {
  const data = { ...seed };
  return {
    data,
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = v;
    },
    removeItem: (k) => {
      delete data[k];
    },
  };
}

const handed = {
  paths: [{ points: [{ x: 50, y: 50 }, { x: 540, y: 50 }], closed: false }],
  fileName: 'britania.pdf',
  pageNumber: 2,
  createdAt: 1,
};

describe('the hand-off from the tracing tab to the editor', () => {
  it('carries the traced runs across', () => {
    const store = fakeStorage();
    expect(putTraceImport(handed, store)).toBe(true);
    expect(takeTraceImport(store)).toMatchObject({ fileName: 'britania.pdf', pageNumber: 2 });
  });

  // Left behind, it would re-import the same walls on every reload.
  it('is taken exactly once', () => {
    const store = fakeStorage();
    putTraceImport(handed, store);
    expect(takeTraceImport(store)).not.toBeNull();
    expect(takeTraceImport(store)).toBeNull();
    expect(store.data[TRACE_IMPORT_KEY]).toBeUndefined();
  });

  it('is nothing when nothing was sent', () => {
    expect(takeTraceImport(fakeStorage())).toBeNull();
  });

  it('ignores a broken or empty hand-off instead of importing rubbish', () => {
    expect(takeTraceImport(fakeStorage({ [TRACE_IMPORT_KEY]: 'not json' }))).toBeNull();
    expect(takeTraceImport(fakeStorage({ [TRACE_IMPORT_KEY]: '{"paths":[]}' }))).toBeNull();
    const broken = JSON.stringify({ paths: [{ points: [{ x: 1 }, { x: 2, y: null }] }] });
    expect(takeTraceImport(fakeStorage({ [TRACE_IMPORT_KEY]: broken }))).toBeNull();
  });

  it('drops a run with only one point - that is not a line', () => {
    const one = JSON.stringify({ ...handed, paths: [{ points: [{ x: 1, y: 1 }], closed: false }] });
    expect(takeTraceImport(fakeStorage({ [TRACE_IMPORT_KEY]: one }))).toBeNull();
  });

  it('says so when the browser refuses to store anything', () => {
    const refuses: Storage2 = {
      getItem: () => null,
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {},
    };
    expect(putTraceImport(handed, refuses)).toBe(false);
  });
});
