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
 *   the label  — what to order. Always clear of the dimension line rather than
 *                across it, and pushed out of the void on a leader when it is
 *                too wide to sit inside.
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

/**
 * Where the label's near edge goes, in screen pixels.
 *
 * Separated out and tested because it has been wrong twice, in the same way
 * both times: the label ended up across the dimension line it was annotating.
 * The CSS anchors the label by the edge this returns — `translate(-50%,-100%)`
 * for a horizontal dimension, `translate(0,-50%)` for a vertical one — so
 * "clear of the line" is exactly "this point is past the line", which is what
 * the tests assert.
 */
export function labelAnchor(
  box: { left: number; top: number; width: number; height: number },
  axis: 'u' | 'v',
  inside: boolean,
): { x: number; y: number } {
  const cx = box.left + box.width / 2;
  const cy = box.top + box.height / 2;
  return axis === 'u'
    ? { x: cx, y: inside ? cy - 6 : box.top - 16 }
    : { x: inside ? cx + 9 : box.left + box.width + 16, y: cy };
}

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

  /**
   * The label always sits clear of the dimension line, on the same side.
   *
   * Sitting it on the line hid the very thing it annotates: a 227 px label
   * across a 308 px dimension leaves two short stubs and no line. So a
   * horizontal dimension is labelled above and a vertical one beside, which is
   * where dimension text goes on any drawing.
   *
   * The anchor is the label's near edge rather than its centre — centring it
   * on a point 20 px past the void still swung half the label back across the
   * line it had just been moved off.
   */
  const label = labelAnchor({ left, top, width, height }, gap.axis, inside);

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
        className={`gap-chip gap-place-${gap.axis}${detailed ? '' : ' compact'}`}
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
