import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { findBolts } from '../lib/bolts';

/**
 * A ჭანჭიკი mark on every joint that takes one - see `lib/bolts.ts` for which.
 *
 * Drawn the way the user sketched it: a yellow disc with a bolt across it and a
 * red stroke through, sitting on the joint. Screen space, like the gap marks,
 * so the stroke stays crisp; the disc grows with the zoom until it is about a
 * panel thick, and never shrinks past something a pointer could find.
 */
const MIN_R_PX = 5;
const MAX_R_PX = 14;
const R_CM = 6;

export function BoltLayer() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);

  const bolts = useMemo(
    () => findBolts(pieces, new Map(materials.map((m) => [m.id, m]))),
    [pieces, materials],
  );
  // A stacked course shares its joints in plan: one mark is enough to see.
  const spots = useMemo(() => {
    const seen = new Set<string>();
    return bolts.filter((b) => {
      const key = `${Math.round(b.x)}:${Math.round(b.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [bolts]);

  if (spots.length === 0) return null;
  const r = Math.max(MIN_R_PX, Math.min(MAX_R_PX, R_CM * zoom));

  return (
    <svg className="bolt-layer" width={stageW} height={stageH} aria-hidden="true">
      {spots.map((b) => {
        const x = b.x * zoom + panX;
        const y = b.y * zoom + panY;
        if (x < -r || y < -r || x > stageW + r || y > stageH + r) return null;
        const d = r * 0.7;
        return (
          <g key={`${b.x}:${b.y}`} className={`bolt ${b.kind}`}>
            <circle cx={x} cy={y} r={r} />
            <line className="bolt-bar" x1={x - d} y1={y} x2={x + d} y2={y} />
            <line className="bolt-slash" x1={x - d * 0.6} y1={y - d} x2={x + d * 0.6} y2={y + d} />
          </g>
        );
      })}
    </svg>
  );
}
