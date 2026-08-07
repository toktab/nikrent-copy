import { useEditorStore } from '../store/useEditorStore';
import { segments, pathLength } from '../lib/sketch';
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
}

export function SketchLayer({ worldW, worldH, top, preview }: Props) {
  const sketch = useEditorStore((s) => s.sketch);
  const selected = useEditorStore((s) => s.selectedSketchIds);
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
        <PathShape key={path.id} path={path} chosen={chosen.has(path.id)} hair={hair} />
      ))}

      {/* The path in progress: same geometry, drawn as provisional. */}
      {tool === 'pen' && penPoints.length > 0 && (
        <>
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
            <line
              className="sketch-rubber"
              x1={penPoints[penPoints.length - 1].x}
              y1={penPoints[penPoints.length - 1].y}
              x2={preview.x}
              y2={preview.y}
              strokeWidth={hair}
            />
          )}
        </>
      )}
    </svg>
  );
}

function PathShape({
  path,
  chosen,
  hair,
}: {
  path: SketchPath;
  chosen: boolean;
  hair: number;
}) {
  const legs = segments(path);
  const total = Math.round(pathLength(path));
  const first = path.points[0];

  return (
    <g className={`sketch-path${chosen ? ' chosen' : ''}`}>
      {legs.map(([a, b], i) => (
        <line key={i} x1={a.x} y1={a.y} x2={b.x} y2={b.y} strokeWidth={hair} />
      ))}
      {/* Vertices, so a corner reads as a decision rather than a kink. */}
      {path.points.map((p, i) => (
        <circle key={i} className="sketch-vertex" cx={p.x} cy={p.y} r={hair * 2} />
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
