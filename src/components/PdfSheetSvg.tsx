import type { Material, Piece, SketchPath } from '../types';
import { planH, planW, type Rect } from '../lib/geometry';
import { pieceCentre, type Bolt, type Rod, type RodEnd } from '../lib/bolts';
import { boltKindOf } from '../lib/boltMarks';
import { BOLT_COLORS } from '../lib/boltStyle';
import { segments } from '../lib/sketch';
import { ConnectorGlyph, LatchGlyph, LatchShape, NutGlyph, RodGlyph } from './BoltLayer';
import { FixingBody } from './PieceView';
import { PlacedShapeBody, ShapeSvg } from './ShapeSvg';

/**
 * The printed sheet's linework, as one SVG in paper millimetres.
 *
 * Everything is drawn with the very components the screen draws with - the
 * piece shapes, the კონექტორი disc, the შტირი bar, the ქანჩი + დისკო and the
 * ჩამკეტი fix - so the paper cannot drift from the screen: a panel, a corner
 * and the rod through them meet on the sheet exactly where they meet on the
 * plan. `drawingPdf` turns this into pixels and writes the text over it with
 * the page's Georgian font, which an SVG drawn as an image cannot reach.
 *
 * No stylesheet comes along into an SVG drawn as an image, so every colour is
 * an attribute (see `lib/boltStyle.ts`); the little <style> below only fixes
 * what the screen's stylesheet does with screen pixels.
 */

/** What the drawing area holds, worked out by `drawingPdf`. */
export interface SheetDrawing {
  /** where the drawing sits on the paper, mm */
  frame: Rect;
  /** the world rectangle (cm) that frame shows - same aspect, true scale */
  world: Rect;
  /** cm of world per mm of paper: scale / 10 */
  cmPerMm: number;
  sketch: SketchPath[];
  /** the pieces to draw, in drawing order; ჭანჭიკი pieces already filtered by kind */
  pieces: Array<{ piece: Piece; material: Material }>;
  /** placed კონექტორები touching a კუთხე - drawn orange */
  atCorners: Set<string>;
  connectors: Bolt[];
  rods: Array<{ rod: Rod; length: number }>;
  nuts: RodEnd[];
  latches: RodEnd[];
}

export type LegendIcon =
  /** `mmPerCm`: one scale for every material in the key, so their sizes compare */
  | { type: 'material'; material: Material; mmPerCm: number }
  | { type: 'connector'; kind: 'tee' | 'corner' }
  | { type: 'rod' }
  | { type: 'nut' }
  | { type: 'latch' }
  | { type: 'sketch' }
  | { type: 'measure' }
  | { type: 'overall' };

export interface PlacedIcon {
  icon: LegendIcon;
  /** the box it is drawn in, mm */
  box: Rect;
}

/** A stroke this wide on paper reads as a crisp outline at any scale, mm. */
const OUTLINE_MM = 0.15;
/**
 * The paper stand-in for one screen pixel, mm. The glyphs keep their parts at
 * least a few "pixels" big so they stay readable zoomed out; on paper that
 * floor is this.
 */
const PX_MM = 0.22;
/**
 * A კონექტორი disc on paper: about a fifth of a panel's thickness across, the
 * way it reads on screen close up - a small mark on the joint, not a coin
 * over it (the user's call, 2026-10-21). Kept between these on paper so it
 * neither vanishes at 1:100 nor swells at 1:10, mm.
 */
export const CONNECTOR_R_CM = 1.8;
const CONNECTOR_MIN_MM = 0.75;
const CONNECTOR_MAX_MM = 1.3;
/** Its strokes, as a share of its radius - the screen mark's proportions. */
const CONNECTOR_PX_SHARE = 0.12;
/** Spacing of the ჩაკერება hatch, mm. */
const HATCH_MM = 0.9;

const isFiller = (m: Material) => m.category === 'filler';

export function SheetSvg({
  paper,
  pixels,
  drawing,
  icons,
}: {
  paper: { w: number; h: number };
  /** the size it is drawn at - its own size, so no browser draws it small and stretches it */
  pixels: { w: number; h: number };
  drawing: SheetDrawing | null;
  icons: PlacedIcon[];
}) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width={pixels.w}
      height={pixels.h}
      viewBox={`0 0 ${paper.w} ${paper.h}`}
    >
      <style>{`.rod-bar{vector-effect:none}`}</style>
      <defs>
        {/* ჩაკერება hatched across, in paper mm whatever the scale: on paper a
            5 cm filler beside a panel of nearly the same tan is otherwise easy
            to miss, and the hatch is the drafting mark for "packing". */}
        <pattern id="filler-hatch" patternUnits="userSpaceOnUse" width={HATCH_MM} height={HATCH_MM} patternTransform="rotate(45)">
          <line x1={0} y1={0} x2={0} y2={HATCH_MM} stroke="#7a5a1c" strokeWidth={0.12} />
        </pattern>
      </defs>
      {drawing && <Drawing d={drawing} />}
      {icons.map((ic, i) => (
        <Icon key={i} {...ic} />
      ))}
    </svg>
  );
}

function Drawing({ d }: { d: SheetDrawing }) {
  const k = d.cmPerMm;
  const px = PX_MM * k;
  const r = Math.max(CONNECTOR_MIN_MM * k, Math.min(CONNECTOR_MAX_MM * k, CONNECTOR_R_CM));
  const rPx = r * CONNECTOR_PX_SHARE;
  const rodStroke = 0.6 * px;
  return (
    <svg
      x={d.frame.x}
      y={d.frame.y}
      width={d.frame.w}
      height={d.frame.h}
      viewBox={`${d.world.x} ${d.world.y} ${d.world.w} ${d.world.h}`}
      overflow="visible"
    >
      <defs>
        <pattern
          id="filler-hatch-world"
          patternUnits="userSpaceOnUse"
          width={HATCH_MM * k}
          height={HATCH_MM * k}
          patternTransform="rotate(45)"
        >
          <line x1={0} y1={0} x2={0} y2={HATCH_MM * k} stroke="#7a5a1c" strokeWidth={0.12 * k} />
        </pattern>
      </defs>

      {/* The drawn layout - the concrete face - under everything, long-dashed
          and thin: the drafting line for a reference, not a built edge. */}
      <g fill="none" stroke="#7d848c" strokeWidth={0.25 * k} strokeDasharray={`${4 * k} ${2 * k}`}>
        {d.sketch.flatMap((path, i) =>
          segments(path).map(([a, b], j) => <line key={`${i}:${j}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} />),
        )}
      </g>

      {d.pieces.map(({ piece, material }) => {
        const kind = boltKindOf(material);
        if (kind === 'connectors') {
          const c = pieceCentre(piece, material);
          return (
            <ConnectorGlyph
              key={piece.id}
              cx={c.x}
              cy={c.y}
              r={r}
              px={rPx}
              kind={d.atCorners.has(piece.id) ? 'corner' : 'tee'}
            />
          );
        }
        if (kind) return <FixingBody key={piece.id} piece={piece} material={material} px={px} />;
        return <PlacedShapeBody key={piece.id} piece={piece} material={material} strokeWidth={OUTLINE_MM * k} />;
      })}

      {/* The worked-out marks over the pieces, in the screen's order. */}
      <g style={{ strokeWidth: rodStroke }}>
        {d.rods.map(({ rod, length }) => {
          const mid = (rod.from + rod.to) / 2;
          const [x, y, rot] = rod.dir === 'v' ? [rod.at, mid, 90] : [mid, rod.at, 0];
          return (
            <g key={`rod:${rod.dir}:${rod.x}:${rod.y}`} transform={`translate(${x} ${y}) rotate(${rot})`}>
              <RodGlyph length={length} scale={1} px={px} />
            </g>
          );
        })}
      </g>
      {d.nuts.map((e) => (
        <NutGlyph key={`nut:${e.x}:${e.y}:${e.rot}`} x={e.x} y={e.y} rot={e.rot} scale={1} px={px} />
      ))}
      {d.latches.map((e) => (
        <LatchGlyph key={`latch:${e.x}:${e.y}:${e.rot}`} x={e.x} y={e.y} rot={e.rot} scale={1} px={px} />
      ))}
      {d.connectors.map((b) => (
        <ConnectorGlyph key={`${b.x}:${b.y}`} cx={b.x} cy={b.y} r={r} px={rPx} kind={b.kind} />
      ))}

      {/* The ჩაკერება last of all, hatched and outlined: a 5 cm filler is the
          joint a კონექტორი sits on, and drawn under the disc it vanished. */}
      {d.pieces.map(({ piece, material }) =>
        isFiller(material) && material.shape === 'rect' ? (
          <HatchOver key={`hatch:${piece.id}`} piece={piece} material={material} stroke={OUTLINE_MM * 1.6 * k} />
        ) : null,
      )}
    </svg>
  );
}

/** The hatch laid over a rectangular piece, turned with it. */
function HatchOver({ piece, material, stroke }: { piece: Piece; material: Material; stroke: number }) {
  const c = pieceCentre(piece, material);
  const pw = planW(material);
  const ph = planH(material);
  return (
    <rect
      x={-pw / 2}
      y={-ph / 2}
      width={pw}
      height={ph}
      fill="url(#filler-hatch-world)"
      stroke="#5a4210"
      strokeWidth={stroke}
      transform={`translate(${c.x} ${c.y}) rotate(${piece.rot})`}
    />
  );
}

/** A legend key's picture, centred in its box. */
function Icon({ icon, box }: PlacedIcon) {
  const cx = box.x + box.w / 2;
  const cy = box.y + box.h / 2;
  switch (icon.type) {
    case 'material': {
      const m = icon.material;
      // True to one another, but the thin side never shrinks past something
      // that can be seen.
      const pw = planW(m);
      const ph = planH(m);
      const s = Math.min(icon.mmPerCm, box.w / pw, box.h / ph);
      const w = Math.max(pw * s, 1.1);
      const h = Math.max(ph * s, 1.1);
      const stroke = OUTLINE_MM * Math.min(pw / w, ph / h);
      return (
        <g transform={`translate(${cx - w / 2} ${cy - h / 2})`}>
          <ShapeSvg material={m} width={w} height={h} strokeWidth={stroke} />
          {isFiller(m) && m.shape === 'rect' && <rect width={w} height={h} fill="url(#filler-hatch)" />}
        </g>
      );
    }
    case 'connector':
      return <ConnectorGlyph cx={cx} cy={cy} r={1.3} px={1.3 * CONNECTOR_PX_SHARE} kind={icon.kind} />;
    case 'rod':
      return (
        <g transform={`translate(${cx} ${cy})`} style={{ strokeWidth: 0.6 * PX_MM }}>
          <RodGlyph length={box.w} scale={0.1} px={PX_MM * 2} />
        </g>
      );
    case 'nut':
      // The nut on a rod end, the rod coming in from the left as on a wall.
      return (
        <g>
          <line x1={box.x} y1={cy} x2={cx - 1} y2={cy} stroke={BOLT_COLORS.rod.fill} strokeWidth={0.7} />
          <NutGlyph x={cx - 1} y={cy} rot={0} scale={0.3} px={PX_MM} />
        </g>
      );
    case 'latch':
      return (
        <g transform={`translate(${cx} ${cy})`}>
          <LatchShape hub={1.3} wings={4.2} px={PX_MM} />
        </g>
      );
    case 'sketch':
      return (
        <line x1={box.x} y1={cy} x2={box.x + box.w} y2={cy} stroke="#7d848c" strokeWidth={0.25} strokeDasharray="4 2" />
      );
    case 'measure':
    case 'overall': {
      const t = 1.2;
      return (
        <g stroke="#1b1f24" strokeWidth={0.2}>
          <line x1={box.x} y1={cy} x2={box.x + box.w} y2={cy} />
          <line x1={box.x} y1={cy - t} x2={box.x} y2={cy + t} />
          <line x1={box.x + box.w} y1={cy - t} x2={box.x + box.w} y2={cy + t} />
        </g>
      );
    }
  }
}
