import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { collectDimItems, layoutDimensions, type PlacedDim } from '../lib/dimensions';
import { referenceEdges } from '../lib/measure';
import type { Point } from '../lib/sketch';

/**
 * Every length on the drawing: panels, drawn legs, measured lines.
 *
 * A screen-space overlay, like the gap marks: the strokes stay one pixel and
 * the text stays a readable size at any zoom. Which lengths show is the display
 * table (`lengthVisibility`); where each goes is `lib/dimensions.ts`; this only
 * draws it.
 */
interface Props {
  /** the drawn leg under the pointer */
  hoverLeg: { pathId: string; index: number } | null;
  hoverPieceId?: string | null;
  hoverMeasureId?: string | null;
}

/** arrowhead leg length and half-angle */
const ARROW_PX = 6;
const ARROW_RAD = 0.45;

export function DimensionLayer({ hoverLeg, hoverPieceId = null, hoverMeasureId = null }: Props) {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);
  const measures = useEditorStore((s) => s.measures);
  const showSketch = useEditorStore((s) => s.showSketch);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const showLengths = useEditorStore((s) => s.showLengths);
  const visibility = useEditorStore((s) => s.lengthVisibility);
  const showNames = useEditorStore((s) => s.showNames);
  const forceLabels = useEditorStore((s) => s.forceLabels);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectedSketchIds = useEditorStore((s) => s.selectedSketchIds);
  const selectedMeasureId = useEditorStore((s) => s.selectedMeasureId);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const items = useMemo(
    () =>
      collectDimItems({
        showLengths,
        visibility,
        pieces,
        byId,
        showNames,
        // A hidden layout is gone, lengths included.
        sketch: showSketch ? sketch : [],
        measures,
        selectedIds: new Set(selectedIds),
        selectedSketchIds: new Set(selectedSketchIds),
        hoverLeg,
        hoverPieceId,
        selectedMeasureId,
        hoverMeasureId,
      }),
    [
      showLengths,
      visibility,
      pieces,
      byId,
      showNames,
      showSketch,
      sketch,
      measures,
      selectedIds,
      selectedSketchIds,
      hoverLeg,
      hoverPieceId,
      selectedMeasureId,
      hoverMeasureId,
    ],
  );

  /**
   * Every edge on the drawing, so a length can see what is around it: which
   * side has room, and what it must not be written over. A piece's four edges
   * all belong to that piece, so its own label ignores them.
   */
  const obstacles = useMemo(
    () =>
      referenceEdges(showSketch ? sketch : [], pieces, byId, measures).map((e) => ({
        a: e.a,
        b: e.b,
        owner: e.key.startsWith('pc:') ? e.key.slice(0, e.key.lastIndexOf(':')) : e.key,
      })),
    [showSketch, sketch, pieces, byId, measures],
  );

  const placed = useMemo(
    // Genuinely too dense to read: bail out unless the user forces labels on.
    () =>
      zoom < 0.12 && !forceLabels
        ? []
        : layoutDimensions(items, {
            zoom,
            panX,
            panY,
            stageW,
            stageH,
            force: forceLabels,
            obstacles,
          }),
    [items, zoom, panX, panY, stageW, stageH, forceLabels, obstacles],
  );

  const stepped = placed.filter((p) => p.dimLine);

  return (
    <div className="dim-layer">
      {stepped.length > 0 && (
        <svg className="dim-lines" width={stageW} height={stageH}>
          {stepped.map((p) => (
            <DimLines key={p.id} dim={p} />
          ))}
        </svg>
      )}
      {placed.map((p) => (
        <div
          key={p.id}
          className={`dim-label${p.inside ? ' inside' : ''}${p.accent ? ' accent' : ''}`}
          style={{
            left: p.x,
            top: p.y,
            transform: `translate(-50%, -50%) rotate(${p.angle}deg)`,
          }}
        >
          {p.lines.map((line, i) => (
            <span key={i} className={i === 0 && p.lines.length > 1 ? 'nm' : 'dim'}>
              {line}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

/** One stepped-out dimension: two extension lines, the dimension line, two arrowheads. */
function DimLines({ dim }: { dim: PlacedDim }) {
  const [p, q] = dim.dimLine!;
  const len = Math.hypot(q.x - p.x, q.y - p.y) || 1;
  const u = { x: (q.x - p.x) / len, y: (q.y - p.y) / len };

  // Both legs of an arrowhead point back from the tip, into the dimension line.
  const head = (tip: Point, dir: 1 | -1) =>
    [ARROW_RAD, -ARROW_RAD].map((t) => {
      const cos = Math.cos(t);
      const sin = Math.sin(t);
      const bx = dir * (u.x * cos - u.y * sin);
      const by = dir * (u.x * sin + u.y * cos);
      return `${tip.x},${tip.y} ${tip.x + bx * ARROW_PX},${tip.y + by * ARROW_PX}`;
    });

  return (
    <g className={dim.accent ? 'accent' : undefined}>
      {dim.ext!.map(([a, b], i) => (
        <line key={`e${i}`} className="dim-ext" x1={a.x} y1={a.y} x2={b.x} y2={b.y} />
      ))}
      <line x1={p.x} y1={p.y} x2={q.x} y2={q.y} />
      {[...head(p, 1), ...head(q, -1)].map((pts, i) => (
        <polyline key={`h${i}`} points={pts} />
      ))}
    </g>
  );
}
