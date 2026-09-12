import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { isHorizontal, legLength, pathLength, segments, type SegmentHit } from '../lib/sketch';
import type { Point } from '../lib/sketch';
import { legDir, leftNormal, outwardSide, sidesFromNeighbours } from '../lib/sketchFill';
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

  /**
   * Which way each line's panels will stand, worked out across the whole
   * layout rather than line by line - a line's neighbour knows better than the
   * line does. Resolved with the same function the fill uses, so the ticks
   * below promise exactly what gets built.
   */
  const sides = useMemo(
    () => sidesFromNeighbours(sketch, { height: 1, includeCorners: true }),
    [sketch],
  );

  // The pen's target is drawn even on an empty surface: the first vertex is
  // the one that most needs to land on a square, and with nothing else on the
  // drawing there was nothing to render and so nothing to aim with.
  if (!sketch.length && !penPoints.length && !(tool === 'pen' && preview)) return null;
  const chosen = new Set(selected);
  const hair = 1.5 / zoom;

  // The leg the new junction would land on, for measuring against its ends.
  const hoveredPath = hover ? sketch.find((k) => k.id === hover.pathId) : undefined;
  const hoveredLeg = hoveredPath ? (segments(hoveredPath)[hover!.index] ?? null) : null;

  return (
    <svg
      className="sketch-layer"
      style={{ left: 0, top, width: worldW, height: worldH }}
      viewBox={`0 ${top} ${worldW} ${worldH}`}
      // The pen needs the surface underneath to hear the pointer, and a line
      // is picked by proximity in the canvas rather than by hitting it.
      pointerEvents="none"
    >
      {sketch.map((path, i) => (
        <PathShape
          key={path.id}
          path={path}
          side={sides[i] ?? outwardSide(path)}
          chosen={chosen.has(path.id)}
          hair={hair}
          hover={hover?.pathId === path.id ? hover : null}
          part={part?.pathId === path.id ? part : null}
        />
      ))}

      {/* Where the pen is, which is never quite where the pointer is.
          The vertex lands on a corner of the grid, so the corner it has picked
          is drawn on the corner rather than under the hand — otherwise the only
          way to find out where a click would go is to click. */}
      {tool === 'pen' && preview && <PenTarget at={preview} hair={hair} />}

      {/* The junction a click would add, sitting on the line it would go on,
          and how far it is from the junctions either side of it. Placing one is
          a measurement — "a wall goes off 120 from that corner" — so the two
          numbers have to be there before the click, not after it. */}
      {addAt && <AddMark at={addAt} leg={hoveredLeg} hair={hair} />}

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
              {/* How far the run still is from closing, and whether it is
                  lined up to. */}
              {penPoints.length > 1 && <CloseGuide first={penPoints[0]} at={preview} hair={hair} />}
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
  side,
  chosen,
  hair,
  hover,
  part,
}: {
  path: SketchPath;
  /** which way the panels will stand, as the fill worked it out */
  side: 1 | -1;
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

  /**
   * Which side of the line the formwork will stand on, drawn as short ticks
   * off each leg the way a section arrow is. The one thing about a line that
   * its coordinates do not record is which face of the pour it is, and finding
   * out by filling it and looking is a poor way to ask.
   */
  return (
    <g className={`sketch-path${chosen ? ' chosen' : ''}${path.perimeter === 'inner' ? ' inner' : ''}`}>
      {legs.map(([a, b], i) => {
        const d = legDir(a, b);
        const nrm = leftNormal(d);
        const reach = hair * 5;
        return [0.3, 0.7].map((t) => {
          const x = a.x + (b.x - a.x) * t;
          const y = a.y + (b.y - a.y) * t;
          return (
            <line
              key={`s${i}-${t}`}
              className="sketch-side"
              x1={x}
              y1={y}
              x2={x + side * nrm.x * reach}
              y2={y + side * nrm.y * reach}
              strokeWidth={hair}
            />
          );
        });
      })}
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
      {/* Leg lengths and the run's total are drawn by the dimension layer, which
          puts each at the middle of what it measures and keeps them clear of
          each other. The total used to sit at the run's first corner, where it
          read as the length of the leg beside it. */}
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
    </g>
  );
}

/**
 * The grid corner the pen has hold of.
 *
 * A crosshair rather than a dot, because the two arms say WHICH corner: they
 * run along the two grid lines that cross there, so the mark reads as being on
 * the intersection even when the pointer has drifted a couple of centimetres
 * off it. The whole point of ruling the surface in fives is being able to set
 * out to it, and that needs the pen to show where it has landed.
 */
function PenTarget({ at, hair }: { at: Point; hair: number }) {
  const arm = hair * 10;
  return (
    <g className="pen-target">
      <line x1={at.x - arm} y1={at.y} x2={at.x + arm} y2={at.y} strokeWidth={hair} />
      <line x1={at.x} y1={at.y - arm} x2={at.x} y2={at.y + arm} strokeWidth={hair} />
      <circle cx={at.x} cy={at.y} r={hair * 2.2} strokeWidth={hair} />
    </g>
  );
}

/**
 * A junction about to be placed, with the two distances that decide where.
 *
 * Both ends of the leg get a figure, because "120 from this corner" and "180
 * from that one" are the same placement described from either side and people
 * work from whichever end they measured from on site.
 */
function AddMark({
  at,
  leg,
  hair,
}: {
  at: Point;
  leg: [Point, Point] | null;
  hair: number;
}) {
  const back = leg ? Math.round(legLength(leg[0], at)) : 0;
  const on = leg ? Math.round(legLength(at, leg[1])) : 0;
  return (
    <g>
      <circle className="sketch-add" cx={at.x} cy={at.y} r={hair * 3.4} strokeWidth={hair} />
      {leg && back > 0 && (
        <text
          className="sketch-measure live"
          x={(leg[0].x + at.x) / 2}
          y={(leg[0].y + at.y) / 2 - hair * 3}
          fontSize={hair * 8}
          textAnchor="middle"
        >
          {back} სმ
        </text>
      )}
      {leg && on > 0 && (
        <text
          className="sketch-measure live"
          x={(at.x + leg[1].x) / 2}
          y={(at.y + leg[1].y) / 2 - hair * 3}
          fontSize={hair * 8}
          textAnchor="middle"
        >
          {on} სმ
        </text>
      )}
    </g>
  );
}

/**
 * Where the run has to come back to, and how far off it is.
 *
 * Closing an outline means landing exactly on the point it started from, and by
 * eye that is a guess: the two ends look joined at any zoom where the whole run
 * fits on screen, and are two centimetres apart. So the distance back is always
 * shown, and the moment the pen lines up with the start on either axis a guide
 * is drawn all the way to it — which is the one thing that makes the last two
 * legs land square instead of nearly.
 *
 * The pen also snaps to the start point itself, so being told you are lined up
 * and then missing anyway is not possible.
 */
function CloseGuide({
  first,
  at,
  hair,
}: {
  first: Point;
  at: Point;
  hair: number;
}) {
  const dx = Math.abs(at.x - first.x);
  const dy = Math.abs(at.y - first.y);
  const onAxis = dx < 0.01 || dy < 0.01;
  const away = Math.round(Math.hypot(at.x - first.x, at.y - first.y));
  if (!away) return null;

  return (
    <g>
      {/* Lined up: the guide runs the whole way back, so the remaining leg is
          visibly the only thing left to draw. */}
      {onAxis && (
        <line
          className="sketch-close-guide"
          x1={at.x}
          y1={at.y}
          x2={first.x}
          y2={first.y}
          strokeWidth={hair}
        />
      )}
      <circle
        className={`sketch-close-target${onAxis ? ' aligned' : ''}`}
        cx={first.x}
        cy={first.y}
        r={hair * 4}
        strokeWidth={hair}
      />
      <text
        className={`sketch-measure live${onAxis ? ' aligned' : ''}`}
        x={(at.x + first.x) / 2}
        y={(at.y + first.y) / 2 - hair * 3}
        fontSize={hair * 8}
        textAnchor="middle"
      >
        {onAxis ? `დახურვამდე ${away} სმ` : `${away} სმ`}
      </text>
    </g>
  );
}
