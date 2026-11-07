import type { Material, Piece } from '../types';
import { barRect, drawnOutline, pointsAttr } from '../lib/shapePath';
import { isConnector, isPanelHolder, pieceBounds, planH, planW, type Rect } from '../lib/geometry';
import { isCrocodile, isFrog } from '../lib/clamps';
import { isFullHeadPart, isHalfHeadPart } from '../lib/cornerConnectors';
import { ClampShape, ConnectorGlyph, NutGlyph } from './BoltLayer';
import { isLatch, isNut, LATCH_DEPTH_CM, LATCH_LEN_CM, NUT_CM, WASHER_CM, WASHER_T_CM, WING_HUB_CM, WING_SPAN_CM } from '../lib/bolts';

interface Props {
  material: Material;
  /** rendered size in px; the viewBox stays in the material's cm space */
  width: number;
  height: number;
  /** stroke width in cm (world units) — pass 1/zoom for a constant 1 px outline */
  strokeWidth?: number;
  opacity?: number;
}

/**
 * Draws a material's shape. Used both for the 26 px palette swatch and for the
 * full-size piece on the surface, so a component always looks the same in both.
 */
export function ShapeSvg({ material: m, width, height, strokeWidth = 1, opacity }: Props) {
  return (
    <svg
      className="shape"
      width={width}
      height={height}
      viewBox={`0 0 ${planW(m)} ${planH(m)}`}
      preserveAspectRatio="none"
      style={{ opacity, display: 'block' }}
      aria-hidden="true"
    >
      <ShapeBody material={m} strokeWidth={strokeWidth} />
    </svg>
  );
}

/** The shape itself, in the material's own cm space with its origin top-left. */
function ShapeBody({ material: m, strokeWidth }: { material: Material; strokeWidth: number }) {
  const stroke = 'rgba(0,0,0,.55)';
  // Plan view: a piece occupies w × depth on screen (h is its vertical height).
  const pw = planW(m);
  const ph = planH(m);
  const sw = Math.min(strokeWidth, Math.min(pw, ph) / 4);

  // The connector looks like the mark the drawing puts on a joint, in the
  // catalog as on the plan, so it is recognisably the same thing.
  if (isConnector(m)) {
    return <ConnectorGlyph cx={pw / 2} cy={ph / 2} r={(Math.min(pw, ph) / 2) * 0.92} px={strokeWidth} />;
  }
  // ...the ჩამკეტი fix like the clamp it is...
  if (isLatch(m)) {
    const s = Math.min(pw, ph) / (LATCH_LEN_CM + 2);
    return (
      <g transform={`translate(${pw / 2} ${ph / 2})`}>
        <ClampShape len={LATCH_LEN_CM * s} thick={LATCH_DEPTH_CM * s * 1.3} px={strokeWidth / 2} />
      </g>
    );
  }
  // ...and the ქანჩი + დისკო like the washer, nut and wing piece it puts on a rod end.
  if (isNut(m)) {
    const s = Math.min(pw, ph) / (Math.max(WASHER_CM, WING_SPAN_CM) + 1);
    const long = WASHER_T_CM + NUT_CM + WING_HUB_CM;
    return <NutGlyph x={pw / 2 - (long * s) / 2} y={ph / 2} rot={0} scale={s} px={strokeWidth / 2} />;
  }

  // ...the two 40 სმ heads as their discs...
  if (isHalfHeadPart(m) || isFullHeadPart(m)) {
    return (
      <ConnectorGlyph
        cx={pw / 2}
        cy={ph / 2}
        r={(Math.min(pw, ph) / 2) * 0.82}
        px={strokeWidth}
        label="40"
        head={isHalfHeadPart(m) ? 'half' : 'full'}
      />
    );
  }
  // ...the ნიანგი and ბაყაყი as the clamps they are...
  if (isCrocodile(m)) return <CrocodileShape w={pw} h={ph} px={strokeWidth} />;
  if (isFrog(m)) return <FrogShape w={pw} h={ph} px={strokeWidth} />;

  // ...and the პანელის ბეტონზე სამაგრი as the user drew it.
  if (isPanelHolder(m)) return <PanelHolderShape w={pw} h={ph} px={strokeWidth} />;

  // A waler as the worked-out one is drawn - the orange beam with its two
  // rods - so the one placed by hand and the one worked out look the same
  // (the user, 2026-11-04).
  if (m.category === 'waler') return <WalerShape m={m} strokeWidth={strokeWidth} />;

  // A დგარი as the prop it is - see `PostShape`.
  if (m.category === 'post') return <PostShape m={m} stroke={stroke} strokeWidth={strokeWidth} />;

  // The thin outer-corner angle (leg 0.1 cm) is a sliver to click on: its whole
  // square takes the click - unseen, only a hit area (the user, 2026-11-04).
  if (m.shape === 'L' && m.leg !== undefined && m.leg < 1) {
    return (
      <>
        <rect
          className="thin-corner-box"
          x={0}
          y={0}
          width={pw}
          height={ph}
          fill="rgba(0, 0, 0, 0)"
          stroke="none"
        />
        <polygon points={pointsAttr(drawnOutline(m))} fill={m.color} stroke={stroke} strokeWidth={sw} />
      </>
    );
  }

  return m.shape === 'L' ? (
    <polygon points={pointsAttr(drawnOutline(m))} fill={m.color} stroke={stroke} strokeWidth={sw} />
  ) : m.shape === 'line' ? (
    <LineBar m={m} stroke={stroke} strokeWidth={sw} />
  ) : (
    <rect x={0} y={0} width={pw} height={ph} fill={m.color} stroke={stroke} strokeWidth={sw} />
  );
}

/**
 * A პანელის ბეტონზე სამაგრი from above, in its own w × h cm, as the user drew
 * it (2026-11-07): the square tube standing straight out from the panel's
 * face, outlined in orange, with a pin sleeve on a short stem either side of
 * it, halfway along - the two pipes the pins go down through into the
 * concrete. The top edge is the tube's end against the panel - turn it to
 * face the panel it holds.
 */
export const PANEL_HOLDER_COLOR = '#ff7a1a';

/**
 * A ნიანგი from above, in its own w × h cm, its top edge on the back of the
 * face: a long green jaw lying across panel, ჩაკერება and panel, its two ends
 * bent in to grip the frames of the two panels, its teeth along the face -
 * so it reads as touching all three.
 */
export function CrocodileShape({ w, h, px }: { w: number; h: number; px: number }) {
  const sw = Math.max(px, Math.min(w, h) * 0.08);
  const grip = Math.min(w * 0.12, h * 0.9);
  const jaw = h * 0.4;
  const n = 6;
  const step = (w - grip * 2) / n;
  const teeth = Array.from({ length: n }, (_, i) => {
    const x0 = grip + i * step;
    return `${x0},${jaw} ${x0 + step / 2},${sw * 0.6} ${x0 + step},${jaw}`;
  }).join(' ');
  return (
    <g strokeLinejoin="round">
      <rect x={0} y={0} width={w} height={h} fill="rgba(0, 0, 0, 0)" stroke="none" />
      <rect x={0} y={jaw} width={w} height={h - jaw} rx={(h - jaw) / 2.5} fill="#3fae6a" stroke="#155c37" strokeWidth={sw} />
      <polyline points={teeth} fill="#f3f7f0" stroke="#155c37" strokeWidth={sw * 0.7} />
      <rect x={0} y={0} width={grip} height={h} fill="#1f7a4d" stroke="#155c37" strokeWidth={sw} />
      <rect x={w - grip} y={0} width={grip} height={h} fill="#1f7a4d" stroke="#155c37" strokeWidth={sw} />
      <circle cx={w - grip - step * 0.6} cy={jaw + (h - jaw) * 0.45} r={(h - jaw) * 0.18} fill="#ffe14d" stroke="#155c37" strokeWidth={sw * 0.5} />
    </g>
  );
}

/**
 * A ბაყაყი from above, in its own w × h cm, its top edge on the back of the
 * face: a round body over the joint, two legs splayed out to grip the frames
 * of the panels either side, and its eyes on the face.
 */
export function FrogShape({ w, h, px }: { w: number; h: number; px: number }) {
  const sw = Math.max(px, Math.min(w, h) * 0.07);
  const cx = w / 2;
  const foot = Math.min(w, h) * 0.16;
  return (
    <g strokeLinecap="round" strokeLinejoin="round">
      <rect x={0} y={0} width={w} height={h} fill="rgba(0, 0, 0, 0)" stroke="none" />
      <polyline points={`${cx - w * 0.16},${h * 0.7} ${w * 0.16},${h * 0.92} ${foot},${foot}`} fill="none" stroke="#3d6b12" strokeWidth={sw * 1.6} />
      <polyline points={`${cx + w * 0.16},${h * 0.7} ${w * 0.84},${h * 0.92} ${w - foot},${foot}`} fill="none" stroke="#3d6b12" strokeWidth={sw * 1.6} />
      <circle cx={foot} cy={foot} r={foot} fill="#8bc34a" stroke="#3d6b12" strokeWidth={sw} />
      <circle cx={w - foot} cy={foot} r={foot} fill="#8bc34a" stroke="#3d6b12" strokeWidth={sw} />
      <ellipse cx={cx} cy={h * 0.58} rx={w * 0.2} ry={h * 0.4} fill="#8bc34a" stroke="#3d6b12" strokeWidth={sw} />
      <circle cx={cx - w * 0.08} cy={h * 0.3} r={h * 0.15} fill="#ffffff" stroke="#3d6b12" strokeWidth={sw * 0.6} />
      <circle cx={cx + w * 0.08} cy={h * 0.3} r={h * 0.15} fill="#ffffff" stroke="#3d6b12" strokeWidth={sw * 0.6} />
      <circle cx={cx - w * 0.08} cy={h * 0.28} r={h * 0.06} fill="#1b1b1b" stroke="none" />
      <circle cx={cx + w * 0.08} cy={h * 0.28} r={h * 0.06} fill="#1b1b1b" stroke="none" />
    </g>
  );
}

export function PanelHolderShape({ w, h, px }: { w: number; h: number; px: number }) {
  // A drawn line about a third of a centimetre, as on his sketch; never
  // thinner than a screen pixel.
  const sw = Math.max(px, Math.min(w, h) * 0.06);
  const tubeL = w / 3;
  const tubeR = (w * 2) / 3;
  const r = Math.min(w, h) * 0.12;
  const mid = h / 2;
  return (
    <g fill="none" stroke={PANEL_HOLDER_COLOR} strokeWidth={sw}>
      {/* the whole square takes the click, as the outline alone is thin */}
      <rect x={0} y={0} width={w} height={h} fill="rgba(0, 0, 0, 0)" stroke="none" />
      <rect x={tubeL} y={sw / 2} width={tubeR - tubeL} height={h - sw} />
      <line x1={r * 2 + sw / 2} y1={mid} x2={tubeL} y2={mid} />
      <line x1={tubeR} y1={mid} x2={w - r * 2 - sw / 2} y2={mid} />
      <circle cx={r + sw / 2} cy={mid} r={r} />
      <circle cx={w - r - sw / 2} cy={mid} r={r} />
    </g>
  );
}

/**
 * The whole-cm box a placed piece is drawn in: its rotated footprint, widened
 * out to the nearest whole cm on every side.
 */
export function placedBox(piece: Piece, m: Material): Rect {
  const b = pieceBounds(piece, m);
  // The trigonometric extent carries 1e-15 of noise; it must not cost a cm.
  const x0 = Math.floor(b.x + 1e-6);
  const y0 = Math.floor(b.y + 1e-6);
  const x1 = Math.ceil(b.x + b.w - 1e-6);
  const y1 = Math.ceil(b.y + b.h - 1e-6);
  return { x: x0, y: y0, w: Math.max(1, x1 - x0), h: Math.max(1, y1 - y0) };
}

/**
 * A placed piece's shape, drawn exactly where it lies.
 *
 * The browser rounds the box of an <svg> - and the background of any box - to
 * whole CSS pixels before the surface's zoom is applied. On a surface drawn at
 * 1 cm = 1 px that rounding is up to half a centimetre, and at 800 % it is four
 * screen pixels: a panel turned on its side at x 449.5 was painted at 450, a
 * visible step against the panel above it that was actually flush. Positioning
 * each piece with `left`/`top` and a CSS rotate could only ever be as accurate
 * as that rounding.
 *
 * So the box is always whole cm - the piece's footprint widened outwards, which
 * the rounding leaves alone - and the piece is placed and turned INSIDE the
 * SVG, where coordinates are vector and nothing is rounded. Pass `box` from
 * `placedBox` so the caller's element and this drawing agree on it.
 */
export function PlacedShapeSvg({
  piece,
  material: m,
  box,
  strokeWidth = 1,
}: {
  piece: Piece;
  material: Material;
  box: Rect;
  strokeWidth?: number;
}) {
  return (
    <svg
      className="shape"
      width={box.w}
      height={box.h}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      style={{ display: 'block' }}
      aria-hidden="true"
    >
      <PlacedShapeBody piece={piece} material={m} strokeWidth={strokeWidth} />
    </svg>
  );
}

/**
 * The shape where it lies, in world cm - for any SVG whose units are world cm,
 * the surface's own and the printed sheet's.
 */
export function PlacedShapeBody({
  piece,
  material: m,
  strokeWidth = 1,
}: {
  piece: Piece;
  material: Material;
  strokeWidth?: number;
}) {
  const pw = planW(m);
  const ph = planH(m);
  return (
    <g
      transform={`translate(${piece.x + pw / 2} ${piece.y + ph / 2}) rotate(${piece.rot}) translate(${-pw / 2} ${-ph / 2})`}
    >
      <ShapeBody material={m} strokeWidth={strokeWidth} />
    </g>
  );
}

/** A ვოლერი from above: an orange beam, its two ვოლერის შტირი through it. */
function WalerShape({ m, strokeWidth }: { m: Material; strokeWidth: number }) {
  const pw = planW(m);
  const ph = planH(m);
  const long = pw >= ph;
  const len = long ? pw : ph;
  const thick = long ? ph : pw;
  const r = Math.min(thick * 0.28, len * 0.08);
  const dots = [0.25, 0.75].map((t) => (long ? { cx: pw * t, cy: ph / 2 } : { cx: pw / 2, cy: ph * t }));
  return (
    <>
      <rect
        x={0}
        y={0}
        width={pw}
        height={ph}
        rx={thick / 3}
        fill="#e2733a"
        fillOpacity={0.85}
        stroke="rgba(0,0,0,.55)"
        strokeWidth={Math.min(strokeWidth, thick / 6)}
      />
      {dots.map((d, i) => (
        <circle key={i} {...d} r={r} fill="#f3e3c3" stroke="rgba(0,0,0,.6)" strokeWidth={Math.min(strokeWidth, r / 3)} />
      ))}
    </>
  );
}

/**
 * A დგარი from above: the head plate on the panel face (the box's top edge,
 * `y = 0`), the tube with its adjusting collar, and the foot plate on the
 * ground with its anchor holes (the far edge). A plain bar the colour of the
 * category was all it used to be, and read as one more waler.
 */
/**
 * დგარი და თავი from above (the user's photo, 2026-11-07): the head - a steel
 * bracket gripping the panel's frame - at the top edge, on the panel; the
 * blue outer tube and the thinner inner one; the turning handle, a loop
 * standing off the tube at the joint; and the foot plate with its two anchor
 * holes on the ground at the far end. The big one is the same, longer.
 */
function PostShape({ m, stroke, strokeWidth }: { m: Material; stroke: string; strokeWidth: number }) {
  const pw = planW(m);
  const ph = planH(m);
  const sw = Math.max(Math.min(strokeWidth, pw / 8), Math.min(pw, ph) * 0.02);
  const steel = '#4a525c';
  // Blue, the user's choice (2026-11-07).
  const blue = '#2f7de1';
  const dark = '#163f78';
  // The თავი is the big light block at the top, so the top reads at once.
  const head = Math.min(12, ph / 5);
  const foot = Math.min(5, ph / 6);
  const tube = pw * 0.34;
  const inner = tube * 0.62;
  const joint = ph * 0.5;
  const cx = pw / 2;
  return (
    <>
      {/* faint footprint, so the drag / hit area stays obvious */}
      <rect x={0} y={0} width={pw} height={ph} fill={blue} opacity={0.08} />
      {/* the inner tube, from the joint to the foot */}
      <rect x={cx - inner / 2} y={joint} width={inner} height={ph - foot - joint} fill={blue} stroke={dark} strokeWidth={sw} />
      {/* the outer tube, from the head to the joint */}
      <rect x={cx - tube / 2} y={head * 0.85} width={tube} height={joint - head * 0.85} rx={tube / 4} fill={blue} stroke={dark} strokeWidth={sw} />
      {/* the turning handle: a loop off the side of the tube, at the joint */}
      <path
        d={`M ${cx + tube / 2} ${joint - 3.2} H ${cx + tube / 2 + pw * 0.28} V ${joint + 3.2} H ${cx + tube / 2}`}
        fill="none"
        stroke={dark}
        strokeWidth={sw * 2.2}
        strokeLinejoin="round"
      />
      <rect x={cx - tube * 0.75} y={joint - 1.4} width={tube * 1.5} height={2.8} rx={0.8} fill={blue} stroke={dark} strokeWidth={sw} />
      {/* the თავი (the user's photo, 2026-11-07): a galvanised, near-white
          clamp body. Its jaw grips the panel's frame along the top edge, the
          screw stands off one side with its T-handle, and the round eye at
          its bottom takes the prop's tube. */}
      <rect x={pw * 0.04} y={0} width={pw * 0.92} height={head * 0.28} rx={0.6} fill="#e9edf1" stroke="#7d8790" strokeWidth={sw} />
      <rect x={pw * 0.18} y={head * 0.22} width={pw * 0.64} height={head * 0.56} rx={1} fill="#f4f6f8" stroke="#7d8790" strokeWidth={sw} />
      <line x1={pw * 0.82} y1={head * 0.45} x2={pw * 1.02} y2={head * 0.45} stroke="#7d8790" strokeWidth={sw * 2} strokeLinecap="round" />
      <line x1={pw * 1.02} y1={head * 0.3} x2={pw * 1.02} y2={head * 0.6} stroke="#7d8790" strokeWidth={sw * 2} strokeLinecap="round" />
      <circle cx={cx} cy={head * 0.85} r={tube * 0.62} fill="#f4f6f8" stroke="#7d8790" strokeWidth={sw} />
      <circle cx={cx} cy={head * 0.85} r={tube * 0.24} fill="#9aa3ac" />
      {/* the foot plate on the ground, with its two anchor holes */}
      <rect x={0} y={ph - foot} width={pw} height={foot} rx={0.8} fill={steel} stroke={stroke} strokeWidth={sw} />
      <circle cx={pw * 0.24} cy={ph - foot / 2} r={Math.min(foot, pw) * 0.16} fill="#15181c" />
      <circle cx={pw * 0.76} cy={ph - foot / 2} r={Math.min(foot, pw) * 0.16} fill="#15181c" />
    </>
  );
}

function LineBar({ m, stroke, strokeWidth }: { m: Material; stroke: string; strokeWidth: number }) {
  const pw = planW(m);
  const ph = planH(m);
  const bar = barRect(pw, ph);
  return (
    <>
      {/* faint full-box footprint so the drag/hit area stays obvious */}
      <rect x={0} y={0} width={pw} height={ph} fill={m.color} opacity={0.16} />
      <rect
        x={bar.x}
        y={bar.y}
        width={bar.w}
        height={bar.h}
        rx={bar.r}
        ry={bar.r}
        fill={m.color}
        stroke={stroke}
        strokeWidth={strokeWidth}
      />
    </>
  );
}

export interface FittedBox {
  width: number;
  height: number;
  /** stroke width in cm that renders as ≲1 px on both axes */
  stroke: number;
}

/**
 * Fits a material into a `box` px square, keeping the aspect ratio but never
 * letting the thin side vanish. That floor makes the scale slightly
 * non-uniform, so the stroke is derived from the *most compressed* axis —
 * otherwise a 600 × 12 waler would render as a solid blob.
 */
export function fitBox(material: Material, box: number, min = 6): FittedBox {
  const pw = planW(material);
  const ph = planH(material);
  const ar = pw / ph;
  const width = ar >= 1 ? box : Math.max(min, box * ar);
  const height = ar >= 1 ? Math.max(min, box / ar) : box;
  return { width, height, stroke: Math.min(pw / width, ph / height) };
}

/** Larger scaled preview, used by the inspector and the component form. */
export function PiecePreview({ material, box }: { material: Material; box: number }) {
  const fit = fitBox(material, box);
  return (
    <ShapeSvg
      material={material}
      width={fit.width}
      height={fit.height}
      strokeWidth={fit.stroke}
    />
  );
}

/** Swatch sized like the v1 palette: `size` px on the longer side, aspect kept. */
export function Swatch({ material, size = 26 }: { material: Material; size?: number }) {
  const fit = fitBox(material, size);
  return (
    <span className="swatch" style={{ width: size, height: size }}>
      <ShapeSvg
        material={material}
        width={fit.width}
        height={fit.height}
        strokeWidth={fit.stroke}
      />
    </span>
  );
}
