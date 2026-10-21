import { useMemo, type PointerEvent as ReactPointerEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import {
  LATCH_HUB_CM,
  LATCH_WINGS_CM,
  NUT_CM,
  WASHER_CM,
  WASHER_T_CM,
  type Bolt,
  type BoltKind,
  type Rod,
} from '../lib/bolts';
import { markedRodLength, planMarks } from '../lib/boltMarks';
import { BOLT_COLORS as C } from '../lib/boltStyle';

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
  const disc = kind === 'corner' ? C.corner : C.tee;
  return (
    <g className={`bolt-glyph ${kind}`}>
      <circle cx={cx} cy={cy} r={r} fill={disc.fill} stroke={disc.stroke} style={{ strokeWidth: 1.5 * px }} />
      <line
        className="bolt-bar"
        x1={cx - d}
        y1={cy}
        x2={cx + d}
        y2={cy}
        stroke={C.bar}
        strokeLinecap="round"
        style={{ strokeWidth: 2 * px }}
      />
      <line
        className="bolt-slash"
        stroke={C.slash}
        strokeLinecap="round"
        x1={cx - d * 0.6}
        y1={cy - d}
        x2={cx + d * 0.6}
        y2={cy + d}
        style={{ strokeWidth: 1.6 * px }}
      />
    </g>
  );
}

/**
 * A შტირი is drawn as a thin bar - thinner than its catalog 3 cm, so it reads
 * as a rod through the wall and not a board across it - but never so thin it
 * disappears when zoomed out.
 */
const ROD_MIN_PX = 2;
const ROD_CM = 1.6;

/**
 * A ქანჩი + დისკო seen from above, on the face at (`x`, `y`) facing `rot`:
 * the washer, a thin plate across the rod flat against the face, and the nut on
 * it. True size in cm times `scale` (units per cm), but never smaller than a
 * few of `px` (units per screen pixel), so it stays readable zoomed out.
 */
export function NutGlyph({
  x,
  y,
  rot,
  scale,
  px = 1,
}: {
  x: number;
  y: number;
  rot: number;
  scale: number;
  px?: number;
}) {
  const wt = Math.max(WASHER_T_CM * scale, 2 * px);
  const ww = Math.max(WASHER_CM * scale, 9 * px);
  const nut = Math.max(NUT_CM * scale, 4 * px);
  return (
    <g className="nut-glyph" transform={`translate(${x} ${y}) rotate(${rot})`}>
      <rect className="nut-washer" fill={C.washer.fill} stroke={C.washer.stroke} x={0} y={-ww / 2} width={wt} height={ww} rx={wt / 3} style={{ strokeWidth: px }} />
      <rect className="nut-nut" fill={C.nut.fill} stroke={C.nut.stroke} x={wt} y={-nut / 2} width={nut} height={nut} rx={nut / 5} style={{ strokeWidth: px }} />
    </g>
  );
}

/**
 * A ჩამკეტი fix - a wing nut - seen from above, centred on the rod with its
 * wings across it: a rounded hub and two lobes, in the hub's own units.
 */
export function LatchShape({ hub, wings, px = 1 }: { hub: number; wings: number; px?: number }) {
  const lobe = wings / 2 - hub / 2;
  const w = hub * 0.55;
  return (
    <g className="latch-shape" style={{ strokeWidth: px }}>
      <rect className="latch-wing" fill={C.latch.fill} stroke={C.latch.stroke} x={-w / 2} y={-wings / 2} width={w} height={wings} rx={w / 2} />
      <rect className="latch-hub" fill={C.latch.fill} stroke={C.latch.stroke} x={-hub / 2} y={-hub / 2} width={hub} height={hub} rx={hub / 3} />
      <circle className="latch-hole" fill={C.latchHole} r={Math.max(hub * 0.16, lobe * 0.05)} />
    </g>
  );
}

/**
 * A ჩამკეტი fix on the rod end at (`x`, `y`) facing `rot`, just past the nut
 * - see `NutGlyph` for the sizes.
 */
export function LatchGlyph({
  x,
  y,
  rot,
  scale,
  px = 1,
}: {
  x: number;
  y: number;
  rot: number;
  scale: number;
  px?: number;
}) {
  const start = Math.max(WASHER_T_CM * scale, 2 * px) + Math.max(NUT_CM * scale, 4 * px);
  const hub = Math.max(LATCH_HUB_CM * scale, 4 * px);
  const wings = Math.max(LATCH_WINGS_CM * scale, 11 * px);
  return (
    <g className="latch-glyph" transform={`translate(${x} ${y}) rotate(${rot}) translate(${start + hub / 2} 0)`}>
      <LatchShape hub={hub} wings={wings} px={px} />
    </g>
  );
}

/** A placed შტირი, from tip to tip along its own x: the same thin bar as the marks. */
export function RodGlyph({ length, scale, px = 1 }: { length: number; scale: number; px?: number }) {
  const t = Math.max(ROD_CM * scale, ROD_MIN_PX * px);
  return (
    <g className="rod-glyph">
      <rect className="rod-hit" fill="none" x={-length / 2} y={-Math.max(t, 10 * px) / 2} width={length} height={Math.max(t, 10 * px)} />
      <rect className="rod-bar" fill={C.rod.fill} stroke={C.rod.stroke} x={-length / 2} y={-t / 2} width={length} height={t} rx={t / 2} />
    </g>
  );
}

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
  // One mark per spot - a stacked course shares its joints and rods in plan.
  // The printed sheet draws from the same list.
  const marks = useMemo(() => planMarks(pieces, byId), [pieces, byId]);
  // A kind switched off in the ჭანჭიკები menu leaves the plan, marks and all.
  const shown = useEditorStore((s) => s.boltsShown);
  const spots = shown.connectors ? marks.connectors : [];
  const rods = shown.rods ? marks.rods : [];
  const ends = shown.nuts ? marks.nuts : [];
  const latchEnds = shown.latches ? marks.latches : [];

  if (spots.length === 0 && rods.length === 0 && ends.length === 0 && latchEnds.length === 0) return null;
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
        // As long as the catalog rod that would go there, so the tips stand
        // out past the nuts the way they do on site.
        const len = markedRodLength(materials, rod);
        const mid = (rod.from + rod.to) / 2;
        const a = (mid - len / 2) * zoom;
        const b = (mid + len / 2) * zoom;
        const at = rod.at * zoom;
        const hit = Math.max(thick, 10);
        const bar = (t: number) =>
          rod.dir === 'v'
            ? { x: at + panX - t / 2, y: a + panY, width: t, height: b - a }
            : { x: a + panX, y: at + panY - t / 2, width: b - a, height: t };
        const box = bar(hit);
        if (box.x > stageW || box.y > stageH || box.x + box.width < 0 || box.y + box.height < 0) return null;
        return (
          <g
            key={`rod:${rod.dir}:${rod.x}:${rod.y}`}
            className={`rod-mark${rodsGrabbable ? ' grabbable' : ''}`}
            onPointerDown={rodsGrabbable ? (e) => onGrabRod(e, rod) : undefined}
          >
            {/* a wider band nobody sees, so a thin rod is still easy to take hold of */}
            <rect className="rod-hit" {...box} />
            <rect className="rod-bar" {...bar(thick)} rx={thick / 2} />
          </g>
        );
      })}
      {/* ქანჩი + დისკო, and the ჩამკეტი fix past it, on every rod end
          nothing of that kind has been placed on. */}
      {ends.map((e) => (
        <NutGlyph
          key={`nut:${e.x}:${e.y}:${e.rot}`}
          x={e.x * zoom + panX}
          y={e.y * zoom + panY}
          rot={e.rot}
          scale={zoom}
        />
      ))}
      {latchEnds.map((e) => (
        <LatchGlyph
          key={`latch:${e.x}:${e.y}:${e.rot}`}
          x={e.x * zoom + panX}
          y={e.y * zoom + panY}
          rot={e.rot}
          scale={zoom}
        />
      ))}
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
