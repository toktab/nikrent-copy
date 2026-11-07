import { useDeferredValue, useMemo } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { soloPanels, WALER_OFF } from '../lib/walers';

/** How far behind the panel's back the waler stands, and how thick it is drawn, cm. */
const GAP_CM = 2;
const WALER_CM = 8;

/**
 * The worked-out ვოლერები on the plan: an orange beam across the back of
 * every panel with nothing facing it across the wall, with its two
 * ვოლერის შტირი marked through it - how many go up it is in the ჭანჭიკები
 * menu, not on the plan (the user, 2026-11-04). Drawn in screen pixels over the surface, like the other
 * ჭანჭიკი marks. Nothing here is placed, but a beam can be picked like any
 * piece (the user, 2026-11-07), and Delete takes it off that panel.
 */
export function WalerLayer() {
  // On the drawing (ჭანჭიკები) and switched to show (its eye).
  const on = useKindsOn().walers;
  const shown = useEditorStore((s) => s.walersShown) && on;
  const pieces = useDeferredValue(useEditorStore((s) => s.pieces));
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const picked = useEditorStore((s) => (s.selectedMark?.kind === 'waler' ? s.selectedMark.key : null));
  const selectMark = useEditorStore((s) => s.selectMark);
  const tool = useEditorStore((s) => s.tool);

  const solo = useMemo(
    () => (shown ? soloPanels(pieces, new Map(materials.map((m) => [m.id, m])), sketch) : []),
    [shown, pieces, materials, sketch],
  );
  // One beam per place on the plan - a stacked course has its walers in the
  // same place - with the most any course there needs written on it.
  const spots = useMemo(() => {
    const at = new Map<string, (typeof solo)[number] & { total: number; key: string; ids: string[] }>();
    for (const s of solo) {
      const k = `${Math.round(s.box.x)}:${Math.round(s.box.y)}:${Math.round(s.box.w)}`;
      const had = at.get(k);
      if (had) {
        had.total += s.walers;
        had.ids.push(s.piece.id);
      } else at.set(k, { ...s, total: s.walers, key: k, ids: [s.piece.id] });
    }
    return [...at.values()];
  }, [solo]);

  if (!shown || !spots.length) return null;

  return (
    <svg className="bolt-layer waler-layer" width={stageW} height={stageH} aria-hidden="true">
      {spots.map((s) => {
        const b = s.box;
        // The beam, in world cm, behind the panel's back.
        const along0 = (s.across ? b.x : b.y) + 2;
        const along1 = (s.across ? b.x + b.w : b.y + b.h) - 2;
        const backEdge = s.back > 0 ? (s.across ? b.y + b.h : b.x + b.w) : s.across ? b.y : b.x;
        const near = backEdge + s.back * GAP_CM;
        const far = near + s.back * WALER_CM;
        const c0 = Math.min(near, far);
        const c1 = Math.max(near, far);
        const rect = s.across
          ? { x: along0 * zoom + panX, y: c0 * zoom + panY, width: (along1 - along0) * zoom, height: (c1 - c0) * zoom }
          : { x: c0 * zoom + panX, y: along0 * zoom + panY, width: (c1 - c0) * zoom, height: (along1 - along0) * zoom };
        if (rect.x > stageW || rect.y > stageH || rect.x + rect.width < 0 || rect.y + rect.height < 0) return null;
        // The two rods through it, a quarter in from each end.
        const rods = [0.25, 0.75].map((t) => {
          const a = along0 + (along1 - along0) * t;
          const mid = (c0 + c1) / 2;
          return s.across ? { x: a * zoom + panX, y: mid * zoom + panY } : { x: mid * zoom + panX, y: a * zoom + panY };
        });
        return (
          <g
            key={`${b.x}:${b.y}:${b.w}`}
            className={`waler-mark pickable${picked === s.key ? ' picked' : ''}`}
            onPointerDown={(e) => {
              if (e.button !== 0 || tool !== 'select') return;
              e.stopPropagation();
              selectMark({ kind: 'waler', key: s.key, targets: s.ids.map((id) => ({ id, tag: WALER_OFF })) });
            }}
          >
            <title>{`ვოლერი × ${s.total} - პანელს პირისპირ პანელი არ აქვს`}</title>
            <rect className="waler-bar" {...rect} rx={Math.min(rect.width, rect.height) / 3} />
            {rods.map((p, i) => (
              <circle key={i} className="waler-rod" cx={p.x} cy={p.y} r={Math.max(1.5, 1.6 * zoom)} />
            ))}
          </g>
        );
      })}
    </svg>
  );
}
