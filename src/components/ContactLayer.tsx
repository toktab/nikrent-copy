import { useDeferredValue, useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { pieceContacts, sketchEndContacts } from '../lib/contacts';

/**
 * Touching, at a glance (the user, 2026-11-16): a green line along every joint
 * where two pieces meet with nothing between, a red dashed one where they stop
 * a few cm short; the drawn lines' ends get a green or red ring the same way.
 *
 * Screen pixels over the surface like the ჭანჭიკი marks, so the line stays a
 * readable 2-3 px however far out the drawing is zoomed. Switched off in the
 * view menu (შემოწმება → შეხება).
 */
export function ContactLayer() {
  const on = useEditorStore((s) => s.showContacts);
  const pieces = useDeferredValue(useEditorStore((s) => s.pieces));
  const materials = useEditorStore((s) => s.materials);
  const sketch = useDeferredValue(useEditorStore((s) => s.sketch));
  const showSketch = useEditorStore((s) => s.showSketch);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);

  const joints = useMemo(
    () => (on ? pieceContacts(pieces, new Map(materials.map((m) => [m.id, m]))) : []),
    [on, pieces, materials],
  );
  const ends = useMemo(() => (on && showSketch ? sketchEndContacts(sketch) : []), [on, showSketch, sketch]);

  // Too far out, a joint is shorter than its own stroke: noise, not help.
  if (!on || zoom < 0.25 || (!joints.length && !ends.length)) return null;
  const sx = (x: number) => x * zoom + panX;
  const sy = (y: number) => y * zoom + panY;
  const w = Math.max(2, Math.min(4, zoom * 2.5));

  return (
    <svg className="bolt-layer contact-layer" width={stageW} height={stageH} aria-hidden="true">
      {joints.map((c, i) => {
        const x1 = sx(c.x1);
        const y1 = sy(c.y1);
        const x2 = sx(c.x2);
        const y2 = sy(c.y2);
        if (Math.max(x1, x2) < 0 || Math.min(x1, x2) > stageW || Math.max(y1, y2) < 0 || Math.min(y1, y2) > stageH) {
          return null;
        }
        return (
          <line
            key={i}
            x1={x1}
            y1={y1}
            x2={x2}
            y2={y2}
            className={c.kind === 'touch' ? 'contact-touch' : 'contact-near'}
            strokeWidth={c.kind === 'touch' ? w : w + 1}
          >
            {c.kind === 'near' && <title>{`ღრიჭო ${Math.round(c.gap * 10) / 10} სმ - ერთმანეთს არ ეხება`}</title>}
          </line>
        );
      })}
      {ends.map((e, i) => (
        <circle
          key={`e${i}`}
          cx={sx(e.x)}
          cy={sy(e.y)}
          r={6}
          className={e.kind === 'touch' ? 'contact-end-touch' : 'contact-end-near'}
        />
      ))}
    </svg>
  );
}
