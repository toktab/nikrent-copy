import type { Gap } from '../lib/gap';

/**
 * An open gap, marked the way a drawing marks one.
 *
 * Three things at once, because a bare number floating between two panels does
 * not say which two panels it is between:
 *
 *   the void   — the actual rectangle of air, shaded. Not a centreline: this
 *                is the hole, clipped to the length of edge the two pieces
 *                really share, and its shape is the shape of the thing that
 *                has to close it.
 *   the ticks  — a dimension line with a witness tick sitting on each of the
 *                two edges, so the endpoints are exact. Same amber line and
 *                ticks as the height marker in the 3D view, because it is the
 *                same statement and should not be a second language.
 *   the label  — what to order. Centred on the void when it fits, and pushed
 *                clear on a leader when it does not.
 *
 * Drawn in screen space rather than inside the zoomed world layer, so the
 * strokes stay one pixel and the text stays readable at every zoom, exactly
 * like the edge-snap guides.
 */

interface Props {
  gap: Gap;
  zoom: number;
  panX: number;
  panY: number;
  /** Name the part. Off for the bulk "show all" pass, where it would be noise. */
  detailed?: boolean;
}

/**
 * Roughly how wide each label is, so it is only placed inside the void when it
 * genuinely fits there.
 *
 * A constant threshold was not enough: a 124 px void cleared it, and then a
 * 200 px chip sat on top and covered both witness ticks — hiding the exact
 * endpoints it exists to point at. A label bigger than its dimension goes
 * outside on a leader, which is what a drawing does too.
 */
const LABEL_WIDTH_PX = { detailed: 190, compact: 48 };

export function GapMark({ gap, zoom, panX, panY, detailed = true }: Props) {
  const left = gap.x * zoom + panX;
  const top = gap.y * zoom + panY;
  const width = Math.max(gap.w * zoom, 1);
  const height = Math.max(gap.h * zoom, 1);

  // The dimension runs the way the gap is measured; the ticks stand across it.
  const along = gap.axis === 'u' ? width : height;
  const inside = along >= LABEL_WIDTH_PX[detailed ? 'detailed' : 'compact'];

  const cx = left + width / 2;
  const cy = top + height / 2;

  // Pushed clear along the axis the gap is NOT measured in, so the label never
  // covers the two edges it is describing.
  const label = inside
    ? { x: cx, y: cy }
    : gap.axis === 'u'
      ? { x: cx, y: top - 20 }
      : { x: left + width + 20, y: cy };

  // From the edge of the void, not its middle — a leader that starts inside
  // the thing it points at is just a line crossing it out.
  const from = gap.axis === 'u' ? { x: cx, y: top } : { x: left + width, y: cy };

  const size = Math.round(gap.size * 10) / 10;

  return (
    <>
      <div
        className={`gap-void gap-void-${gap.axis}`}
        style={{ left, top, width, height }}
        aria-hidden="true"
      />
      {!inside && (
        <div
          className={`gap-leader gap-leader-${gap.axis}`}
          style={{
            left: Math.min(from.x, label.x),
            top: Math.min(from.y, label.y),
            width: Math.max(Math.abs(label.x - from.x), 1),
            height: Math.max(Math.abs(label.y - from.y), 1),
          }}
          aria-hidden="true"
        />
      )}
      <div
        className={`gap-chip${detailed ? '' : ' compact'}`}
        style={{ left: label.x, top: label.y }}
      >
        <b>
          {size}
          {detailed && gap.againstHeight ? ` × ${Math.round(gap.againstHeight)}` : ''} სმ
        </b>
        {detailed &&
          (gap.fill ? (
            <span className="gap-fill">{gap.fill}</span>
          ) : (
            /* Nothing in the catalog is this wide — or the only candidates are
               wider than the hole, which on site is the same answer. */
            <span className="gap-cut">ზომაზე ჩამოსაჭრელია</span>
          ))}
      </div>
    </>
  );
}
