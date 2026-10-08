import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { describeLegacyData, readLegacyData } from '../lib/migrateLocal';
import { fetchAll } from '../lib/repo';
import { setBaseline, setWritable, startSync } from '../lib/syncEngine';
import { isConfigured } from '../lib/supabase';
import { useAuthStore } from '../store/useAuthStore';
import { useEditorStore } from '../store/useEditorStore';
import type { DataSnapshot } from '../lib/syncDiff';

/**
 * Loads company data from the server before the editor is shown, and offers a
 * one-time import when the server is empty but this browser still holds the
 * work from before the backend existed.
 *
 * The editor is kept off screen until data has arrived. Rendering it early
 * would show the seeded built-in catalog and an empty drawing, which is
 * indistinguishable from "the company has nothing" and invites someone to
 * start redrawing over the top.
 */

type Phase = 'loading' | 'offer-import' | 'ready' | 'error';

export function DataGate({ children }: { children: ReactNode }) {
  const role = useAuthStore((s) => s.profile?.role);
  const hydrate = useEditorStore((s) => s.hydrateFromServer);
  const markLoadedOffline = useEditorStore((s) => s.markLoadedOffline);

  const [phase, setPhase] = useState<Phase>(isConfigured ? 'loading' : 'ready');
  const [error, setError] = useState<string | null>(null);
  const [legacy, setLegacy] = useState<DataSnapshot | null>(null);
  const [server, setServer] = useState<DataSnapshot | null>(null);
  const stopSync = useRef<(() => void) | null>(null);

  // Offline path: nothing to load, and nothing to sync.
  useEffect(() => {
    if (!isConfigured) markLoadedOffline();
  }, [markLoadedOffline]);

  const load = useCallback(async () => {
    setPhase('loading');
    setError(null);
    try {
      const snapshot = await fetchAll();
      setServer(snapshot);
      setBaseline(snapshot);

      // Watching must begin before the store is filled, so the very first
      // change — the hydrate itself — is seen and uploaded.
      stopSync.current?.();
      stopSync.current = startSync();

      const isEmpty = snapshot.materials.length === 0 && snapshot.documents.length === 0;
      const local = isEmpty ? readLegacyData() : null;
      if (local) {
        setLegacy(local);
        setPhase('offer-import');
        return;
      }

      hydrate(snapshot);
      setPhase('ready');
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setPhase('error');
    }
  }, [hydrate]);

  useEffect(() => {
    if (!isConfigured || !role) return;
    setWritable(role !== 'viewer');
    void load();
    return () => {
      stopSync.current?.();
      stopSync.current = null;
    };
  }, [role, load]);

  if (phase === 'ready') return <>{children}</>;

  // The shape of the editor rather than a centred word. A skeleton says "this
  // is loading and here is what is coming"; a blank screen with "loading…" is
  // indistinguishable from an app that has broken, which is what people assume
  // the moment it takes longer than they expected.
  if (phase === 'loading') {
    return (
      <div className="app" aria-busy="true">
        <div className="loading-bar" />
        <div className="loading-shell">
          <div className="loading-rail">
            <div className="skeleton" style={{ height: 32 }} />
            <div className="skeleton" style={{ height: 30 }} />
            <div className="skeleton" style={{ height: 32, marginTop: 6 }} />
            {[72, 90, 64, 82, 70, 88, 60].map((w, i) => (
              <div key={i} className="skeleton" style={{ height: 12, width: `${w}%` }} />
            ))}
          </div>
          <div className="loading-stage">მონაცემები იტვირთება…</div>
        </div>
      </div>
    );
  }

  if (phase === 'error') {
    return (
      <div className="login-screen">
        <div className="login-card">
          <h1>მონაცემები ვერ ჩაიტვირთა</h1>
          <p className="login-error" role="alert">
            {error}
          </p>
          <button className="btn primary full" onClick={() => void load()}>
            ხელახლა ცდა
          </button>
        </div>
      </div>
    );
  }

  const summary = legacy ? describeLegacyData(legacy) : null;

  return (
    <div className="login-screen">
      <div className="login-card wide-card">
        <h1>ამ ბრაუზერში ნაპოვნია ძველი მონაცემები</h1>
        <p className="login-sub">
          სერვერი ცარიელია. გსურს არსებული კატალოგისა და ნახაზების ატვირთვა?
        </p>

        {summary && (
          <ul className="import-summary">
            <li>
              ნახაზი: <b>{summary.drawings}</b> ({summary.pieces} ელემენტი)
            </li>
            <li>
              მასალა: <b>{summary.materials}</b> (მათგან {summary.customMaterials} დამატებული)
            </li>
            <li>
              მარაგში სულ: <b>{summary.stockUnits}</b> ერთეული
            </li>
          </ul>
        )}

        <button
          className="btn primary full"
          onClick={() => {
            if (legacy) hydrate(legacy);
            setPhase('ready');
          }}
        >
          ატვირთე სერვერზე
        </button>
        <button
          className="btn full"
          onClick={() => {
            if (server) hydrate(server);
            setPhase('ready');
          }}
        >
          არა, დაიწყე ცარიელით
        </button>

        <p className="login-hint">
          ლოკალური ასლი არ იშლება - ის ბრაუზერში რჩება სარეზერვოდ.
        </p>
      </div>
    </div>
  );
}
