import { useEffect, useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { BOLT_INFO, boltInfoCounts, boltInfoOf, type BoltInfoId } from '../lib/boltInfo';

/**
 * The card a picked ჭანჭიკი gets in the რეკომენდაცია tab (the user,
 * 2026-11-07): what it is, what it is for, how many up a 300 and a 150 / 90,
 * an example, how it gets onto the drawing, and what goes with it - every
 * name of another part a link to that part's card, with a way back.
 */
export function BoltInfoPanel() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const mark = useEditorStore((s) => s.selectedMark);
  const on = useKindsOn();
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // The kind picked: one kind of ჭანჭიკი across the whole selection, or a mark.
  const picked = useMemo((): BoltInfoId | null => {
    if (mark?.info) return mark.info as BoltInfoId;
    if (!selectedIds.length) return null;
    const ids = new Set<BoltInfoId | null>();
    for (const p of pieces) {
      if (!selectedIds.includes(p.id)) continue;
      const m = byId.get(p.materialId);
      ids.add(m ? boltInfoOf(m) : null);
      if (ids.size > 1) return null;
    }
    const [only] = [...ids];
    return only ?? null;
  }, [mark, selectedIds, pieces, byId]);

  // Followed links, newest last; back to the picked one with a new pick.
  const [trail, setTrail] = useState<BoltInfoId[]>([]);
  useEffect(() => setTrail([]), [picked]);

  const counts = useMemo(
    () => (picked ? boltInfoCounts(pieces, byId, on, sketch) : {}),
    [picked, pieces, byId, on, sketch],
  );
  if (!picked) return null;
  const id = trail.length ? trail[trail.length - 1] : picked;
  const info = BOLT_INFO[id];
  const go = (to: BoltInfoId) => setTrail((t) => [...t, to]);
  const link = (to: BoltInfoId) => (
    <button type="button" className="bolt-info-link" onClick={() => go(to)}>
      {BOLT_INFO[to].name}
    </button>
  );
  const count = counts[id];

  return (
    <section className="section bolt-info">
      <h3 className="section-title">ჭანჭიკი - ინფორმაცია</h3>
      {trail.length > 0 && (
        <button type="button" className="bolt-info-back" onClick={() => setTrail((t) => t.slice(0, -1))}>
          ← {BOLT_INFO[trail.length > 1 ? trail[trail.length - 2] : picked].name}
        </button>
      )}
      <h4 className="bolt-info-name">{info.name}</h4>
      {count !== undefined && (
        <p className="bolt-info-count">
          ამ ნახაზზე: <b>{count} ც.</b>
        </p>
      )}
      <dl className="bolt-info-list">
        <dt>რა არის</dt>
        <dd>{info.what}</dd>
        <dt>რისთვის / სად</dt>
        <dd>{info.use}</dd>
        <dt>300-იან პანელზე</dt>
        <dd>{info.per300}</dd>
        <dt>150 / 90-იან პანელზე</dt>
        <dd>{info.per150}</dd>
        <dt>მაგალითი</dt>
        <dd className="bolt-info-example">{info.example}</dd>
        <dt>როგორ ჩნდება ნახაზზე</dt>
        <dd>{info.placing}</dd>
        {info.needs.length > 0 && (
          <>
            <dt>რა სჭირდება</dt>
            <dd>
              <ul>
                {info.needs.map((n) => (
                  <li key={n.id}>
                    {link(n.id)} - {n.note}
                  </li>
                ))}
              </ul>
            </dd>
          </>
        )}
        {info.usedBy.length > 0 && (
          <>
            <dt>რაზე / რასთან ერთად</dt>
            <dd>
              <ul>
                {info.usedBy.map((u) => (
                  <li key={u}>{link(u)}</li>
                ))}
              </ul>
            </dd>
          </>
        )}
      </dl>
    </section>
  );
}
