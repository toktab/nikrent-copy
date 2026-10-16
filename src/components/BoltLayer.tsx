import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { openBolts, openRods, ROD_OVERHANG_CM, type Bolt, type BoltKind, type Rod } from '../lib/bolts';

/**
 * A კონექტორი mark on every joint that takes one - see `lib/bolts.ts` for which.
 *
 * Drawn the way the user sketched it: a yellow disc with a bolt across it and a
 * red stroke through, sitting on the joint. Screen space, like the gap marks,
 * so the stroke stays crisp; the disc grows with the zoom until it is about a
 * panel thick, and never shrinks past something a pointer could find.
 *
 * A mark can be taken hold of: pressing on it puts a real კუთხის კონექტორი
 * there and starts dragging it (`onGrab`), so a joint the rule got wrong for
 * this site is moved, not argued with. A joint with a connector already placed
 * on it shows that piece instead of a mark.
 */
export const MIN_R_PX = 5;
export const MAX_R_PX = 14;
export const R_CM = 6;

/** The mark's radius in screen px at a zoom. */
export const markRadiusPx = (zoom: number) => Math.max(MIN_R_PX, Math.min(MAX_R_PX, R_CM * zoom));

/**
 * The mark itself: disc, bolt, red stroke. `px` is one screen pixel in the
 * units it is drawn in, so the strokes stay the same on screen whether it is
 * drawn in screen space here or in world cm as a placed piece.
 */
export function ConnectorGlyph({
  cx,
  cy,
  r,
  px = 1,
  kind = 'tee',
}: {
  cx: number;
  cy: number;
  r: number;
  px?: number;
  kind?: BoltKind;
}) {
  const d = r * 0.7;
  return (
    <g className={`bolt-glyph ${kind}`}>
      <circle cx={cx} cy={cy} r={r} style={{ strokeWidth: 1.5 * px }} />
      <line className="bolt-bar" x1={cx - d} y1={cy} x2={cx + d} y2={cy} style={{ strokeWidth: 2 * px }} />
      <line
        className="bolt-slash"
        x1={cx - d * 0.6}
        y1={cy - d}
        x2={cx + d * 0.6}
        y2={cy + d}
        style={{ strokeWidth: 1.6 * px }}
      />
    </g>
  );
}

/** A შტირი is drawn this thick: its 3 cm, but never thinner than a pointer can find. */
const ROD_MIN_PX = 4;
const ROD_CM = 3;

export function BoltLayer({
  onGrab,
  onGrabRod,
}: {
  onGrab?: (e: ReactPointerEvent, bolt: Bolt) => void;
  onGrabRod?: (e: ReactPointerEvent, rod: Rod) => void;
}) {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const tool = useEditorStore((s) => s.tool);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const bolts = useMemo(() => openBolts(pieces, byId, true), [pieces, byId]);
  // A stacked course has its rods in the same place in plan: one bar each.
  const rods = useMemo(() => {
    const seen = new Set<string>();
    return openRods(pieces, byId, true).filter((r) => {
      const key = `${r.dir}:${Math.round(r.x)}:${Math.round(r.y)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }, [pieces, byId]);
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

  if (spots.length === 0 && rods.length === 0) return null;
  const r = markRadiusPx(zoom);
  // Only the select tool takes hold of things; with the pen or the measure tool
  // out, a press on a mark is a press on the drawing under it.
  const grabbable = !!onGrab && tool === 'select';
  const rodsGrabbable = !!onGrabRod && tool === 'select';
  const thick = Math.max(ROD_MIN_PX, ROD_CM * zoom);

  return (
    <svg className="bolt-layer" width={stageW} height={stageH} aria-hidden="true">
      {/* Rods under the connector marks: a joint can have both. */}
      {rods.map((rod) => {
        const a = (rod.from - ROD_OVERHANG_CM) * zoom;
        const b = (rod.to + ROD_OVERHANG_CM) * zoom;
        const at = rod.at * zoom;
        const box =
          rod.dir === 'v'
            ? { x: at + panX - thick / 2, y: a + panY, w: thick, h: b - a }
            : { x: a + panX, y: at + panY - thick / 2, w: b - a, h: thick };
        if (box.x > stageW || box.y > stageH || box.x + box.w < 0 || box.y + box.h < 0) return null;
        return (
          <rect
            key={`rod:${rod.dir}:${rod.x}:${rod.y}`}
            className={`rod-mark${rodsGrabbable ? ' grabbable' : ''}`}
            x={box.x}
            y={box.y}
            width={box.w}
            height={box.h}
            rx={thick / 2}
            onPointerDown={rodsGrabbable ? (e) => onGrabRod(e, rod) : undefined}
          />
        );
      })}
      {spots.map((b) => {
        const x = b.x * zoom + panX;
        const y = b.y * zoom + panY;
        if (x < -r || y < -r || x > stageW + r || y > stageH + r) return null;
        return (
          <g
            key={`${b.x}:${b.y}`}
            className={`bolt${grabbable ? ' grabbable' : ''}`}
            onPointerDown={grabbable ? (e) => onGrab(e, b) : undefined}
          >
            <ConnectorGlyph cx={x} cy={y} r={r} kind={b.kind} />
          </g>
        );
      })}
    </svg>
  );
}
