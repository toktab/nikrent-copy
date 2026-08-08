import { useEditorStore } from '../store/useEditorStore';
import { isHorizontal, legLength, pathLength, segments, type SegmentHit } from '../lib/sketch';
import type { SketchPath } from '../types';

/**
 * The drawn layout, under the formwork.
 *
 * Reference geometry, so it is deliberately quiet: this is the thing the
 * panels are being set out to, not a thing on the drawing. It sits below the
 * pieces and reads as a drafting underlay rather than as something built.
 *
 * One SVG in world coordinates. Stroke widths are divided by the zoom so a
 * line stays a hairline at any magnification — the same trick the pieces use
 * for their selection outlines.
 */
interface Props {
  worldW: number;
  worldH: number;
  top: number;
  /** where the pen's next vertex would land, for the rubber band */
  preview?: { x: number; y: number } | null;
  /** the leg or junction under the pointer */
  hover?: SegmentHit | null;
  /** where a click would put a new junction, already on the line */
  addAt?: { x: number; y: number } | null;
}

export function SketchLayer({ worldW, worldH, top, preview, hover, addAt }: Props) {
  const sketch = useEditorStore((s) => s.sketch);
  const selected = useEditorStore((s) => s.selectedSketchIds);
  const part = useEditorStore((s) => s.selectedSketchPart);
  const penPoints = useEditorStore((s) => s.penPoints);
  const tool = useEditorStore((s) => s.tool);
  const zoom = useEditorStore((s) => s.zoom);

  if (!sketch.length && !penPoints.length) return null;
  const chosen = new Set(selected);
  const hair = 1.5 / zoom;

  return (
    <svg
      className="sketch-layer"
      style={{ left: 0, top, width: worldW, height: worldH }}
      viewBox={`0 ${top} ${worldW} ${worldH}`}
      // The pen needs the surface underneath to hear the pointer, and a line
      // is picked by proximity in the canvas rather than by hitting it.
      pointerEvents="none"
    >
      {sketch.map((path) => (
        <PathShape
          key={path.id}
          path={path}
          chosen={chosen.has(path.id)}
          hair={hair}
          hover={hover?.pathId === path.id ? hover : null}
          part={part?.pathId === path.id ? part : null}
        />
      ))}

      {/* The junction a click would add, sitting on the line it would go on. */}
      {addAt && (
        <circle className="sketch-add" cx={addAt.x} cy={addAt.y} r={hair * 3.4} strokeWidth={hair} />
      )}

      {/* The path in progress: same geometry, drawn as provisional. */}
      {tool === 'pen' && penPoints.length > 0 && (
        <>
          {/* Each leg already placed, measured. Reading the run back as it is
              drawn is the difference between laying out a plan and guessing. */}
          {segments({ id: 'draft', points: penPoints }).map(([a, b], i) => (
            <LegLabel key={i} a={a} b={b} hair={hair} className="sketch-measure" />
          ))}
          <polyline
            className="sketch-draft"
            points={penPoints.map((p) => `${p.x},${p.y}`).join(' ')}
            strokeWidth={hair * 1.2}
          />
          {penPoints.map((p, i) => (
            <circle key={i} className="sketch-vertex" cx={p.x} cy={p.y} r={hair * 2.6} />
          ))}
          {/* The leg that would be drawn by the next click, already squared
              and snapped, so the constraint is visible before committing. */}
          {preview && (
            <>
              <line
                className="sketch-rubber"
                x1={penPoints[penPoints.length - 1].x}
                y1={penPoints[penPoints.length - 1].y}
                x2={preview.x}
                y2={preview.y}
                strokeWidth={hair}
              />
              {/* The leg you are about to commit, and what the run comes to if
                  you do. Both are decisions being made right now. */}
              <LegLabel
                a={penPoints[penPoints.length - 1]}
                b={preview}
                hair={hair}
                className="sketch-measure live"
                extra={`სულ ${Math.round(
                  pathLength({ id: 'd', points: [...penPoints, preview] }),
                )}`}
              />
            </>
          )}
        </>
      )}
    </svg>
  );
}

/**
 * One leg's length, set just off the line and along it — the same place a
 * dimension goes on a drawing, and clear of the line it describes.
 */
function LegLabel({
  a,
  b,
  hair,
  className,
  extra,
}: {
  a: { x: number; y: number };
  b: { x: number; y: number };
  hair: number;
  className: string;
  extra?: string;
}) {
  const len = Math.round(legLength(a, b));
  if (!len) return null;
  const across = isHorizontal(a, b);
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2;
  return (
    <text
      className={className}
      x={across ? mx : mx + hair * 4}
      y={across ? my - hair * 3 : my}
      fontSize={hair * 8}
      textAnchor={across ? 'middle' : 'start'}
      dominantBaseline={across ? 'auto' : 'middle'}
    >
      {len} სმ{extra ? ` · ${extra}` : ''}
    </text>
  );
}

function PathShape({
  path,
  chosen,
  hair,
  hover,
  part,
}: {
  path: SketchPath;
  chosen: boolean;
  hair: number;
  hover: SegmentHit | null;
  part: { kind: 'leg' | 'vertex'; index: number } | null;
}) {
  const legs = segments(path);
  // What the pointer is over, and what is being worked on, said separately: one
  // is a promise about the next click and the other is a statement about the
  // last one, and a layout being edited needs both at once.
  const hotLeg = hover && hover.vertex === undefined ? hover.index : null;
  const hotVertex = hover?.vertex ?? null;
  const pickedLeg = part?.kind === 'leg' ? part.index : null;
  const pickedVertex = part?.kind === 'vertex' ? part.index : null;
  const total = Math.round(pathLength(path));
  const first = path.points[0];

  return (
    <g className={`sketch-path${chosen ? ' chosen' : ''}`}>
      {/* Drawn twice: a dark rim, then the line on top of it. A single stroke
          disappeared wherever it ran along a grid line, and a layout set out
          on the module runs along one nearly the whole way. */}
      {legs.map(([a, b], i) => (
        <line
          key={`u${i}`}
          className="sketch-under"
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          strokeWidth={hair * 3.4}
        />
      ))}
      {legs.map(([a, b], i) => (
        <line
          key={i}
          className={pickedLeg === i ? 'picked' : hotLeg === i ? 'hot' : undefined}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          strokeWidth={hair * (pickedLeg === i ? 3 : hotLeg === i ? 2.6 : 1.8)}
        />
      ))}
      {/* Every leg measured, but only on the path being worked on. All of them
          at once on a busy layout is not a drawing, it is a wall of numbers. */}
      {chosen &&
        legs.map(([a, b], i) => (
          <LegLabel key={`m${i}`} a={a} b={b} hair={hair} className="sketch-measure" />
        ))}
      {/* Vertices, so a corner reads as a decision rather than a kink. */}
      {path.points.map((p, i) => (
        <circle
          key={i}
          className={`sketch-vertex${
            pickedVertex === i ? ' picked' : hotVertex === i ? ' hot' : ''
          }`}
          cx={p.x}
          cy={p.y}
          r={hair * (pickedVertex === i ? 4.2 : hotVertex === i ? 3.6 : 2.4)}
        />
      ))}
      {/* How much wall this is, which is the first thing anyone wants from a
          layout and would otherwise mean adding up the legs by hand. */}
      {first && (
        <text className="sketch-len" x={first.x} y={first.y - hair * 5} fontSize={hair * 9}>
          {total} სმ
        </text>
      )}
    </g>
  );
}
