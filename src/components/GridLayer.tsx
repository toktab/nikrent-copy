import { GRID_MAJOR_CM, gridStep } from '../lib/geometry';
import { useEditorStore } from '../store/useEditorStore';

/**
 * The squares under the drawing, drawn as lines at their exact screen places.
 *
 * It used to be a repeating CSS gradient on a 40 m sheet inside the scaled
 * world layer. The browser rounds each repeat of a background to whole device
 * pixels, so at most zooms a square came out a fraction of a pixel too big or
 * too small, and the error added up square by square: seven metres from the
 * origin the lines stood half a square from where 5 cm really is. A panel put
 * exactly on the grid looked off it after one arrow press (the user,
 * 2026-11-17). Each line here is placed from the world coordinate it stands
 * for, so nothing can add up.
 */
export function GridLayer({ elevation }: { elevation: boolean }) {
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const snapStep = useEditorStore((s) => s.snapStep);

  const fine = gridStep(zoom, snapStep);
  const lines = (step: number) => {
    let d = '';
    // World cm at the screen's edges, widened to whole steps.
    const x0 = Math.floor(-panX / zoom / step) * step;
    const x1 = Math.ceil((stageW - panX) / zoom / step) * step;
    const y0 = Math.floor(-panY / zoom / step) * step;
    const y1 = Math.ceil((stageH - panY) / zoom / step) * step;
    // Half a pixel on: a 1 px line centred on the pixel grid stays crisp.
    const sx = (x: number) => Math.round(x * zoom + panX) + 0.5;
    const sy = (y: number) => Math.round(y * zoom + panY) + 0.5;
    for (let x = x0; x <= x1; x += step) d += `M${sx(x)} 0V${stageH}`;
    for (let y = y0; y <= y1; y += step) d += `M0 ${sy(y)}H${stageW}`;
    return d;
  };

  // Plan only starts at the origin; an elevation reaches above the ground too.
  void elevation;
  return (
    <svg className="grid-layer" width={stageW} height={stageH} aria-hidden="true">
      <path d={lines(fine)} className="grid-fine" />
      {GRID_MAJOR_CM % fine === 0 && <path d={lines(GRID_MAJOR_CM)} className="grid-major" />}
    </svg>
  );
}
