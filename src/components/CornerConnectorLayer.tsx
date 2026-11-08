import { useDeferredValue, useMemo } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { ConnectorGlyph, NutGlyph } from './BoltLayer';
import { cornerConnectorSpots } from '../lib/cornerConnectors';
import { findCornerRods } from '../lib/bolts';

/**
 * The worked-out კუთხის კონექტორი 25 სმ at outside corners, drawn the way the
 * user drew it: a dark red bar from outside the through panel, through the ჩ5,
 * into the run's first panel, with the ქანჩი + დისკო on its outer
 * end - how many go up it is in the menu, not on the plan. A ჩ10 closure takes the half-head შტირი 40 სმ
 * instead, drawn longer and bright red. Screen pixels, over the surface, look
 * only - each kind shown or hidden by itself.
 */
export function CornerConnectorLayer() {
  // Each kind on the drawing (ჭანჭიკები) and switched to show (its eye).
  const on = useKindsOn();
  const ccShown = useEditorStore((s) => s.cornerConnectorsShown) && on.cornerConnectors;
  const halfShown = useEditorStore((s) => s.halfHeadShown) && on.halfHead;
  const innerShown = useEditorStore((s) => s.innerConnectorsShown) && on.innerConnectors;
  const shown = ccShown || halfShown || innerShown;
  const pieces = useDeferredValue(useEditorStore((s) => s.pieces));
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  // A mark can be picked like any piece (the user, 2026-11-07); Delete takes it off.
  const picked = useEditorStore((s) => (s.selectedMark?.kind === 'cc' ? s.selectedMark.key : null));
  const selectMark = useEditorStore((s) => s.selectMark);
  const tool = useEditorStore((s) => s.tool);
  // The discs at the size of their catalog items, as placed ones are drawn,
  // times the inspector's size setting (the user, 2026-11-08).
  const scales = useEditorStore((s) => s.materialScale);
  const discPx = (id: string) => {
    const m = materials.find((mm) => mm.id === id);
    return Math.max(3, ((m ? Math.min(m.w, m.h) : 8) / 2) * 0.82 * (scales[id] ?? 1) * zoom);
  };

  const spots = useMemo(
    () =>
      shown
        ? cornerConnectorSpots(pieces, new Map(materials.map((m) => [m.id, m]))).filter((s) =>
            // A hand-placed one is a piece, drawn as itself.
            !s.placed && (s.inner ? innerShown : s.filler === 10 ? halfShown : ccShown),
          )
        : [],
    [shown, ccShown, halfShown, innerShown, pieces, materials],
  );
  // ...and the whole-head შტირი 40 სმ at inside corner leg ends.
  const fullShown = useEditorStore((s) => s.fullHeadShown) && on.fullHead;
  const full = useMemo(
    () => (fullShown ? findCornerRods(pieces, new Map(materials.map((m) => [m.id, m]))).filter((r) => !r.placed) : []),
    [fullShown, pieces, materials],
  );
  // ...and the ბარაშკა პატარა on the outer end of each inside-corner one.
  const smallShown = useEditorStore((s) => s.smallNutsShown) && on.smallNuts;
  const smallNuts = useMemo(
    () =>
      smallShown
        ? cornerConnectorSpots(pieces, new Map(materials.map((m) => [m.id, m]))).filter((s) => s.inner && !s.placed)
        : [],
    [smallShown, pieces, materials],
  );
  if (!(shown && spots.length) && !full.length && !smallNuts.length) return null;

  return (
    <svg className="bolt-layer corner-connector-layer" width={stageW} height={stageH} aria-hidden="true">
      {spots.map((s) => {
        const a = s.from * zoom;
        const b = s.to * zoom;
        const at = s.at * zoom;
        const line =
          s.dir === 'h'
            ? { x1: a + panX, y1: at + panY, x2: b + panX, y2: at + panY }
            : { x1: at + panX, y1: a + panY, x2: at + panX, y2: b + panY };
        const ox = s.outer.x * zoom + panX;
        const oy = s.outer.y * zoom + panY;
        if (ox < -40 || oy < -40 || ox > stageW + 40 || oy > stageH + 40) return null;
        const fits = s.inner || s.filler === 5;
        return (
          <g
            key={`${s.dir}:${s.at}:${s.outer.x}:${s.outer.y}`}
            className={`cc-mark pickable${fits ? '' : ' wide'}${s.inner ? ' inner' : ''}${picked === `${s.dir}:${s.at}:${s.outer.x}:${s.outer.y}` ? ' picked' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0 || tool !== 'select') return;
              e.stopPropagation();
              selectMark({
                kind: 'cc',
                key: `${s.dir}:${s.at}:${s.outer.x}:${s.outer.y}`,
                targets: s.takeOff,
                info: s.inner ? 'innerConnectors' : fits ? 'cornerConnectors' : 'halfHead',
              });
            }}
          >
            <title>
              {s.inner
                ? `კუთხის კონექტორი 25 სმ × ${s.count} - შიდა კუთხე, პატარა ბარაშკა თითოზე`
                : fits
                ? `კუთხის კონექტორი 25 სმ × ${s.count} - ქანჩი + დისკო თითოზე`
                : `შტირი 40 სმ ნახევარი თავით (წაჭრილი გაიკა) × ${s.count} - გარე კუთხე ჩ10-ით, ქანჩი + დისკო თითოზე`}
            </title>
            {/* A disc, as the user drew it (2026-11-07): 25 for a connector, 40 with
                a cut-open head for the half-head შტირი. Its nut is only counted. */}
            <ConnectorGlyph
              cx={(line.x1 + line.x2) / 2}
              cy={(line.y1 + line.y2) / 2}
              r={discPx(fits ? 'corner-connector' : 'rod-40-half-head')}
              kind={s.inner ? 'corner' : 'tee'}
              label={fits ? '25' : '40'}
              head={fits ? 'none' : 'half'}
            />
          </g>
        );
      })}
      {smallNuts.map((s) => {
        const x = s.outer.x * zoom + panX;
        const y = s.outer.y * zoom + panY;
        if (x < -40 || y < -40 || x > stageW + 40 || y > stageH + 40) return null;
        // Facing out of the corner profile, the way the connector comes out of it.
        const out = s.dir === 'h' ? (s.outer.x <= s.from ? -1 : 1) : s.outer.y <= s.from ? -1 : 1;
        return (
          <g key={`sn:${s.dir}:${s.at}:${s.outer.x}:${s.outer.y}`} className="small-nut-mark">
            <title>{`ბარაშკა პატარა (გილზა + გაიკა) × ${s.count} - შიდა კუთხის კონექტორზე`}</title>
            <NutGlyph
              x={x}
              y={y}
              rot={s.dir === 'h' ? (out < 0 ? 180 : 0) : out < 0 ? 270 : 90}
              scale={zoom * 0.6 * (scales['acc-small-barashka'] ?? 1)}
            />
          </g>
        );
      })}
      {full.map((r) => {
        const key = `fh:${r.dir}:${r.x}:${r.y}`;
        const x = r.x * zoom + panX;
        const y = r.y * zoom + panY;
        if (x < -40 || y < -40 || x > stageW + 40 || y > stageH + 40) return null;
        return (
          <g
            key={key}
            className={`cc-mark pickable${picked === key ? ' picked' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0 || tool !== 'select') return;
              e.stopPropagation();
              // Taken off the way a tie rod is - see `withRodOff`.
              selectMark({ kind: 'cc', key, targets: [{ id: r.a, tag: `rod:${r.b}` }], info: 'fullHead' });
            }}
          >
            <title>{`შტირი 40 სმ მთლიანი თავით (წაჭრის გარეშე) × ${r.count} - შიდა კუთხის ფეხთან, ქანჩი + დისკო თითოზე`}</title>
            <ConnectorGlyph cx={x} cy={y} r={discPx('corner-connector-40')} kind="tee" label="40" head="full" />
          </g>
        );
      })}
    </svg>
  );
}
