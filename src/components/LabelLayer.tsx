import { useMemo } from 'react';
import type { Material, Piece } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { drawingSizeLabel } from '../lib/bom';
import { planH, planW, rotatedExtent } from '../lib/geometry';

/** Font sizes tried for an inside label, largest first, with their padding. */
const FONT_STEPS: Array<{ size: number; pad: number }> = [
  { size: 11, pad: 8 },
  { size: 10, pad: 6 },
  { size: 9, pad: 4 },
];
const CHAR_W = 0.58; // average glyph width as a fraction of the font size
const LINE_H = 1.28;
/** Below this on-screen size a piece is a speck — labelling it is just noise. */
const MIN_VISIBLE_PX = 12;
/** An outside label is only worth drawing once the piece itself is this big. */
const MIN_OUTSIDE_PX = 20;

interface Placed {
  key: string;
  x: number;
  y: number;
  lines: string[];
  font: number;
  inside: boolean;
  selected: boolean;
}

/**
 * Always-on CAD style labels.
 *
 * They live in a screen-space overlay rather than inside the zoomed `#world`
 * layer, which means the text is always horizontal (no matter how the piece is
 * rotated) and always a readable physical size (no matter the zoom) — exactly
 * what a drafter expects. Positions come straight from the same
 * `screen = world * zoom + pan` mapping the canvas uses.
 */
export function LabelLayer() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const showDims = useEditorStore((s) => s.showDims);
  const showNames = useEditorStore((s) => s.showNames);
  const forceLabels = useEditorStore((s) => s.forceLabels);
  const selectedIds = useEditorStore((s) => s.selectedIds);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const selected = useMemo(() => new Set(selectedIds), [selectedIds]);

  const labels = useMemo(() => {
    if (!showDims && !showNames) return [];
    // Genuinely too dense to read: bail out unless the user forces labels on.
    if (zoom < 0.12 && !forceLabels) return [];

    const ctx: Ctx = {
      zoom,
      panX,
      panY,
      stageW,
      stageH,
      showDims,
      showNames,
      forceLabels,
      selected,
    };

    const out: Placed[] = [];
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (!m) continue;
      const placed = place(p, m, ctx);
      if (placed) out.push(placed);
    }
    return out;
  }, [pieces, byId, zoom, panX, panY, stageW, stageH, showDims, showNames, forceLabels, selected]);

  return (
    <div className="label-layer">
      {labels.map((l) => (
        <div
          key={l.key}
          className={`plabel ${l.inside ? 'inside' : 'outside'}${l.selected ? ' sel' : ''}`}
          style={{ left: l.x, top: l.y, fontSize: l.font }}
        >
          {l.lines.map((line, i) => (
            <span key={i} className={i === 0 && l.lines.length > 1 ? 'nm' : 'dim'}>
              {line}
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

interface Ctx {
  zoom: number;
  panX: number;
  panY: number;
  stageW: number;
  stageH: number;
  showDims: boolean;
  showNames: boolean;
  forceLabels: boolean;
  selected: Set<string>;
}

function measure(lines: string[], font: number) {
  const longest = lines.reduce((n, t) => Math.max(n, t.length), 0);
  return { w: longest * font * CHAR_W, h: lines.length * font * LINE_H };
}

function place(p: Piece, m: Material, ctx: Ctx): Placed | null {
  const { zoom, panX, panY, forceLabels } = ctx;

  // Screen-space footprint in the plan view (w × depth), at any rotation.
  const pw = planW(m);
  const ph = planH(m);
  const extent = rotatedExtent(pw, ph, p.rot);
  const sw = extent.w * zoom;
  const sh = extent.h * zoom;
  const longest = Math.max(sw, sh);

  // The centre of a piece is rotation-invariant.
  const cx = panX + (p.x + pw / 2) * zoom;
  const cy = panY + (p.y + ph / 2) * zoom;

  // Cheap off-screen cull so big drawings stay smooth.
  const margin = 220;
  if (cx < -margin || cy < -margin || cx > ctx.stageW + margin || cy > ctx.stageH + margin) {
    return null;
  }
  if (longest < MIN_VISIBLE_PX && !forceLabels) return null;

  const size = drawingSizeLabel(m);
  const full: string[] = [];
  if (ctx.showNames) full.push(m.name);
  if (ctx.showDims) full.push(size);
  if (!full.length) return null;

  // Try to fit the label inside the piece, largest font first: at each size
  // prefer name + size, then fall back to the size alone. The dimension is the
  // information that must survive, so a legible size beats a cramped name.
  for (const step of FONT_STEPS) {
    for (const lines of full.length > 1 && ctx.showDims ? [full, [size]] : [full]) {
      const t = measure(lines, step.size);
      if (t.w + step.pad <= sw && t.h + step.pad <= sh) {
        return { key: p.id, x: cx, y: cy, lines, font: step.size, inside: true, selected: ctx.selected.has(p.id) };
      }
    }
  }

  if (longest < MIN_OUTSIDE_PX && !forceLabels) return null;

  // Outside labels stay short so a dense drawing does not turn into confetti.
  const lines = ctx.showDims ? [size] : full;
  const font = FONT_STEPS[0].size;
  const t = measure(lines, font);
  const above = cy - sh / 2 - 5 - t.h / 2;
  // Flip below when the label would collide with the ruler strip.
  const y = above < 26 ? cy + sh / 2 + 5 + t.h / 2 : above;

  return { key: p.id, x: cx, y, lines, font, inside: false, selected: ctx.selected.has(p.id) };
}
