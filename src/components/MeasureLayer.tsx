import type { ReactNode } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { fmtLength } from '../lib/dimensions';
import {
  measureContacts,
  parallelEdge,
  type MeasureAnchor,
  type MeasurePreview,
  type RefEdge,
} from '../lib/measure';
import { legLength, type Point } from '../lib/sketch';

/**
 * Measured lines, and the measure tool's guides while it is out.
 *
 * World coordinates, like the drawn layout, with every stroke divided by the
 * zoom so a line stays a hairline at any magnification. Drawn above the pieces:
 * a check dimension is read over the work, not hidden under it. The saved
 * lines' lengths come from the dimension layer, so they stay clear of every
 * other length on the drawing.
 */
interface Props {
  worldW: number;
  worldH: number;
  /** what the tool would do with the next click */
  preview: MeasurePreview | null;
  hoverMeasureId: string | null;
  edges: RefEdge[];
}

/** The light green of a proposal, as opposed to something already decided. */
const SUGGEST = '#9be36b';
const LIVE = '#70a6f5';

export function MeasureLayer({ worldW, worldH, preview, hoverMeasureId, edges }: Props) {
  const measures = useEditorStore((s) => s.measures);
  const measureFirst = useEditorStore((s) => s.measureFirst);
  const selectedMeasureId = useEditorStore((s) => s.selectedMeasureId);
  const style = useEditorStore((s) => s.measureStyle);
  const tool = useEditorStore((s) => s.tool);
  const zoom = useEditorStore((s) => s.zoom);

  const measuring = tool === 'measure' && preview;
  if (!measures.length && !measuring) return null;
  const hair = 1.5 / zoom;
  const dash = `${hair * 4} ${hair * 3}`;

  // Where lines meet, the line being placed included: green where an end rests
  // on another line, orange where one runs through another and carries on.
  const live = measuring && measureFirst ? { a: measureFirst.point, b: preview.point } : null;
  const contacts = measures.length + (live ? 1 : 0) > 1 ? measureContacts(measures, live) : [];

  return (
    <svg
      className="measure-layer"
      style={{ left: 0, top: 0, width: worldW, height: worldH }}
      viewBox={`0 0 ${worldW} ${worldH}`}
      pointerEvents="none"
    >
      {measures.map((m) => {
        const focused = m.id === selectedMeasureId || m.id === hoverMeasureId;
        const off = focused && style.showOffsets ? parallelEdge(m, edges) : null;
        return (
          <g key={m.id}>
            {/* The wall it is measured off, shaded, and how far each end stands
                from it - the fourth picture. */}
            {off && (
              <>
                <line
                  x1={off.edge.a.x}
                  y1={off.edge.a.y}
                  x2={off.edge.b.x}
                  y2={off.edge.b.y}
                  stroke={style.focusColor}
                  // Strong enough to read over the layout line's own dark rim,
                  // which swallowed a fainter tint entirely.
                  strokeOpacity={0.55}
                  strokeWidth={hair * 7}
                  strokeLinecap="round"
                />
                <Offset from={m.a} to={off.footA} cm={off.offA} hair={hair} />
                <Offset from={m.b} to={off.footB} cm={off.offB} hair={hair} />
              </>
            )}
            {focused && (
              <line
                x1={m.a.x}
                y1={m.a.y}
                x2={m.b.x}
                y2={m.b.y}
                stroke={style.focusColor}
                strokeOpacity={0.3}
                strokeWidth={hair * 6}
                strokeLinecap="round"
              />
            )}
            <line
              x1={m.a.x}
              y1={m.a.y}
              x2={m.b.x}
              y2={m.b.y}
              stroke={focused ? style.focusColor : style.color}
              strokeOpacity={focused ? 1 : style.opacity}
              strokeWidth={hair * (focused ? 1.4 : 1.1)}
              strokeDasharray={focused ? undefined : dash}
            />
            <EndTicks a={m.a} b={m.b} hair={hair} color={focused ? style.focusColor : style.color} opacity={focused ? 1 : style.opacity} />
          </g>
        );
      })}

      {contacts.map((c, i) =>
        c.kind === 'touch' ? (
          <circle
            key={`c${i}`}
            className="measure-contact touch"
            cx={c.point.x}
            cy={c.point.y}
            r={hair * 3.5}
            strokeWidth={hair * 1.5}
          />
        ) : (
          <g key={`c${i}`} className="measure-contact cross" strokeWidth={hair * 1.5}>
            <circle cx={c.point.x} cy={c.point.y} r={hair * 4.5} />
            <line
              x1={c.point.x - hair * 2.5}
              y1={c.point.y - hair * 2.5}
              x2={c.point.x + hair * 2.5}
              y2={c.point.y + hair * 2.5}
            />
            <line
              x1={c.point.x - hair * 2.5}
              y1={c.point.y + hair * 2.5}
              x2={c.point.x + hair * 2.5}
              y2={c.point.y - hair * 2.5}
            />
          </g>
        ),
      )}

      {measuring && (
        <Guides
          preview={preview}
          first={measureFirst}
          hair={hair}
          dash={dash}
          focusColor={style.focusColor}
        />
      )}
    </svg>
  );
}

function Guides({
  preview,
  first,
  hair,
  dash,
  focusColor,
}: {
  preview: MeasurePreview;
  first: MeasureAnchor | null;
  hair: number;
  dash: string;
  focusColor: string;
}) {
  const parts: ReactNode[] = [];

  if (!first) {
    // First picture: how far off the edge the click would land, before it lands.
    if (preview.helper) parts.push(<Perpendicular key="h" anchor={preview.helper} hair={hair} color={focusColor} dash={dash} />);
    parts.push(<Cross key="x" at={preview.point} hair={hair} color={focusColor} />);
    return <g>{parts}</g>;
  }

  // Second picture: the decided first end, the proposed second end, and the
  // line as it would be if the click came now.
  if (first.foot) parts.push(<Perpendicular key="f" anchor={first} hair={hair} color={SUGGEST} dash={dash} />);

  const s = preview.suggestion;
  if (s && !preview.onSuggestion) {
    parts.push(
      <g key="s" opacity={0.45}>
        <line
          x1={first.point.x}
          y1={first.point.y}
          x2={s.point.x}
          y2={s.point.y}
          stroke={SUGGEST}
          strokeWidth={hair}
          strokeDasharray={dash}
        />
        <Perpendicular anchor={s} hair={hair} color={SUGGEST} dash={dash} />
        <rect
          x={s.point.x - hair * 2.5}
          y={s.point.y - hair * 2.5}
          width={hair * 5}
          height={hair * 5}
          fill="none"
          stroke={SUGGEST}
          strokeWidth={hair}
        />
      </g>,
    );
  }

  const helper = preview.helper;
  if (helper && helper.foot) {
    parts.push(
      <Perpendicular
        key="c"
        anchor={helper}
        hair={hair}
        color={preview.onSuggestion ? SUGGEST : focusColor}
        dash={dash}
      />,
    );
  }

  const len = legLength(first.point, preview.point);
  parts.push(
    <line
      key="l"
      x1={first.point.x}
      y1={first.point.y}
      x2={preview.point.x}
      y2={preview.point.y}
      stroke={LIVE}
      strokeWidth={hair * 1.3}
    />,
  );
  if (len > 0) {
    parts.push(
      <text
        key="t"
        className="measure-live"
        x={(first.point.x + preview.point.x) / 2}
        y={(first.point.y + preview.point.y) / 2 - hair * 4}
        fontSize={hair * 8}
        textAnchor="middle"
      >
        {fmtLength(len)} სმ
      </text>,
    );
  }
  parts.push(<Cross key="x" at={preview.point} hair={hair} color={LIVE} />);
  return <g>{parts}</g>;
}

/** The dashed perpendicular from an edge to a point held off it, with the distance. */
function Perpendicular({
  anchor,
  hair,
  color,
  dash,
}: {
  anchor: MeasureAnchor;
  hair: number;
  color: string;
  dash: string;
}) {
  if (!anchor.foot || !anchor.offsetCm) return null;
  const { foot, point } = anchor;
  return (
    <g>
      <line
        x1={foot.x}
        y1={foot.y}
        x2={point.x}
        y2={point.y}
        stroke={color}
        strokeWidth={hair * 1.2}
        strokeDasharray={dash}
      />
      <text
        className="measure-offset"
        x={(foot.x + point.x) / 2 + hair * 4}
        y={(foot.y + point.y) / 2}
        fontSize={hair * 8}
        fill={color}
        dominantBaseline="middle"
      >
        {fmtLength(Math.abs(anchor.offsetCm))} სმ
      </text>
    </g>
  );
}

/** A saved line's distance off its wall, dotted, as a drawing marks an offset. */
function Offset({ from, to, cm, hair }: { from: Point; to: Point; cm: number; hair: number }) {
  return (
    <g className="measure-offset-line">
      <line
        x1={from.x}
        y1={from.y}
        x2={to.x}
        y2={to.y}
        strokeWidth={hair * 1.2}
        strokeDasharray={`${hair} ${hair * 2}`}
        strokeLinecap="round"
      />
      <text
        x={(from.x + to.x) / 2 + hair * 4}
        y={(from.y + to.y) / 2}
        fontSize={hair * 8}
        dominantBaseline="middle"
      >
        {fmtLength(cm)}
      </text>
    </g>
  );
}

function Cross({ at, hair, color }: { at: Point; hair: number; color: string }) {
  const r = hair * 4;
  return (
    <g stroke={color} strokeWidth={hair * 1.4} strokeLinecap="round">
      <line x1={at.x - r} y1={at.y - r} x2={at.x + r} y2={at.y + r} />
      <line x1={at.x - r} y1={at.y + r} x2={at.x + r} y2={at.y - r} />
    </g>
  );
}

/** Short ticks square across both ends, so where the line stops is exact. */
function EndTicks({
  a,
  b,
  hair,
  color,
  opacity,
}: {
  a: Point;
  b: Point;
  hair: number;
  color: string;
  opacity: number;
}) {
  const len = legLength(a, b);
  if (!len) return null;
  const nx = (-(b.y - a.y) / len) * hair * 4;
  const ny = ((b.x - a.x) / len) * hair * 4;
  return (
    <g stroke={color} strokeOpacity={opacity} strokeWidth={hair * 1.2}>
      <line x1={a.x - nx} y1={a.y - ny} x2={a.x + nx} y2={a.y + ny} />
      <line x1={b.x - nx} y1={b.y - ny} x2={b.x + nx} y2={b.y + ny} />
    </g>
  );
}
