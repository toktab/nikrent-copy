import { useDeferredValue, useMemo } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { NutGlyph } from './BoltLayer';
import { cornerConnectorSpots } from '../lib/cornerConnectors';

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

  const spots = useMemo(
    () =>
      shown
        ? cornerConnectorSpots(pieces, new Map(materials.map((m) => [m.id, m]))).filter((s) =>
            s.inner ? innerShown : s.filler === 10 ? halfShown : ccShown,
          )
        : [],
    [shown, ccShown, halfShown, innerShown, pieces, materials],
  );
  if (!shown || !spots.length) return null;
  const thick = Math.max(2.5, 2 * zoom);

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
        // Which way is out of the corner - the way the nut faces. No count on
        // the plan (the user, 2026-11-04): the ჭანჭიკები menu has it.
        const out = s.dir === 'h' ? (s.outer.x <= s.from ? -1 : 1) : s.outer.y <= s.from ? -1 : 1;
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
            <line className="cc-bar" {...line} strokeWidth={thick} />
            {/* The ქანჩი + დისკო drawn the way the catalog's own is, facing out
                of the corner; the inside corner's small ბარაშკა the same, smaller. */}
            <NutGlyph
              x={ox}
              y={oy}
              rot={s.dir === 'h' ? (out < 0 ? 180 : 0) : out < 0 ? 270 : 90}
              scale={zoom * (s.inner ? 0.6 : 1)}
            />
          </g>
        );
      })}
    </svg>
  );
}
