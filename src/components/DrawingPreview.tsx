import { useMemo } from 'react';
import type { DrawingDoc, Material } from '../types';
import { contentBounds, planH, planW } from '../lib/geometry';
import { sketchBounds } from '../lib/scaleSketch';

/**
 * A small picture of a drawing that is not necessarily the open one - the drawn
 * lines and every piece as a coloured box, fitted to the frame.
 *
 * Deliberately plain: no lengths, no labels, no L-profile outlines. It answers
 * "which job is this" at a glance, and the real surface is one click away.
 */
export function DrawingPreview({
  doc,
  materials,
  width,
  height,
}: {
  doc: DrawingDoc;
  materials: Material[];
  width: number;
  height: number;
}) {
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  const box = useMemo(() => {
    const a = contentBounds(doc.pieces, byId);
    const b = sketchBounds(doc.sketch);
    if (!a && !b) return null;
    const x0 = Math.min(a?.x ?? Infinity, b?.x ?? Infinity);
    const y0 = Math.min(a?.y ?? Infinity, b?.y ?? Infinity);
    const x1 = Math.max(a ? a.x + a.w : -Infinity, b ? b.x + b.w : -Infinity);
    const y1 = Math.max(a ? a.y + a.h : -Infinity, b ? b.y + b.h : -Infinity);
    // A margin of a twentieth, and never a zero-size box for a single line.
    const pad = Math.max(20, Math.max(x1 - x0, y1 - y0) * 0.05);
    return { x: x0 - pad, y: y0 - pad, w: x1 - x0 + 2 * pad, h: y1 - y0 + 2 * pad };
  }, [doc.pieces, doc.sketch, byId]);

  if (!box) {
    return (
      <div className="drawing-preview empty" style={{ width, height }}>
        ცარიელი ნახაზი
      </div>
    );
  }

  // One screen pixel in world cm, so a line reads the same at any drawing size.
  const px = Math.max(box.w / width, box.h / height);

  return (
    <svg
      className="drawing-preview"
      width={width}
      height={height}
      viewBox={`${box.x} ${box.y} ${box.w} ${box.h}`}
      preserveAspectRatio="xMidYMid meet"
      aria-hidden="true"
    >
      {doc.sketch.map((path) => (
        <polyline
          key={path.id}
          points={[...path.points, ...(path.closed && path.points.length ? [path.points[0]] : [])]
            .map((p) => `${p.x},${p.y}`)
            .join(' ')}
          fill="none"
          stroke="var(--muted)"
          strokeWidth={px * 1.2}
          strokeDasharray={`${px * 4} ${px * 3}`}
        />
      ))}
      {doc.pieces.map((p) => {
        const m = byId.get(p.materialId);
        if (!m) return null;
        const w = planW(m);
        const h = planH(m);
        return (
          <rect
            key={p.id}
            x={p.x}
            y={p.y}
            // A 9 cm deep panel would vanish at this scale; give it a pixel and a half.
            width={Math.max(w, px * 1.5)}
            height={Math.max(h, px * 1.5)}
            transform={p.rot ? `rotate(${p.rot} ${p.x + w / 2} ${p.y + h / 2})` : undefined}
            fill={m.color}
          />
        );
      })}
    </svg>
  );
}
