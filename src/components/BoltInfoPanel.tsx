import { useEffect, useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { BOLT_INFO, boltInfoCounts, boltInfoOf, type BoltInfoId } from '../lib/boltInfo';
import { ClampShape, ConnectorGlyph, NutGlyph, RodGlyph } from './BoltLayer';
import { CrocodileShape, FrogShape, PanelHolderShape } from './ShapeSvg';

/**
 * The part as it is drawn on the plan, large, at the top of its card (the
 * user, 2026-11-07) - so the disc picked is recognised at once: 25 for a
 * კონექტორი, 40 with a cut head or a whole one.
 */
function BoltPicture({ id }: { id: BoltInfoId }) {
  const disc = (label: string, head: 'none' | 'half' | 'full', kind: 'tee' | 'corner' = 'tee') => (
    <svg width="96" height="96" viewBox="-48 -48 96 96" aria-hidden="true">
      <ConnectorGlyph cx={0} cy={0} r={36} px={2.2} kind={kind} label={label} head={head} />
    </svg>
  );
  switch (id) {
    case 'connectors':
    case 'cornerConnectors':
      return disc('25', 'none');
    case 'innerConnectors':
      return disc('25', 'none', 'corner');
    case 'halfHead':
      return disc('40', 'half');
    case 'fullHead':
    case 'walerRod':
      return disc('40', 'full');
    case 'rods':
      return (
        <svg width="160" height="40" viewBox="-80 -20 160 40" aria-hidden="true">
          <RodGlyph length={150} scale={2} px={1} />
        </svg>
      );
    case 'nuts':
    case 'smallNut':
      return (
        <svg width="96" height="64" viewBox="-20 -32 64 64" aria-hidden="true">
          <NutGlyph x={0} y={0} rot={0} scale={3} px={1} />
        </svg>
      );
    case 'latches':
      return (
        <svg width="96" height="64" viewBox="-24 -16 48 32" aria-hidden="true">
          <ClampShape len={30} thick={10} px={1} />
        </svg>
      );
    case 'holders':
      return (
        <svg width="80" height="80" viewBox="-0.5 -0.5 7 7" aria-hidden="true">
          <PanelHolderShape w={6} h={6} px={0.12} />
        </svg>
      );
    case 'crocodiles':
      return (
        <svg width="180" height="40" viewBox="-0.5 -0.5 25 5" aria-hidden="true">
          <CrocodileShape w={24} h={4} px={0.1} />
        </svg>
      );
    case 'frogs':
      return (
        <svg width="140" height="44" viewBox="-0.5 -0.5 15 5" aria-hidden="true">
          <FrogShape w={14} h={4} px={0.08} />
        </svg>
      );
    default:
      return null;
  }
}

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
      <div className="bolt-info-picture">
        <BoltPicture id={id} />
      </div>
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
