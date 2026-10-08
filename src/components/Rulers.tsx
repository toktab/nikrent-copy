import { useEditorStore } from '../store/useEditorStore';
import { niceStep } from '../lib/geometry';
import { isElevation } from '../lib/projection';

const GUTTER = 22; // px reserved for the ruler strips

/** Centimetre rulers along the top and left edges of the stage. */
export function Rulers() {
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const width = useEditorStore((s) => s.stageW);
  const height = useEditorStore((s) => s.stageH);
  const surfaceView = useEditorStore((s) => s.surfaceView);

  const step = niceStep(zoom);
  /**
   * Height grows up while surface y grows down, so in an elevation the vertical
   * ruler has to be read the other way round — otherwise a piece standing
   * 300 cm tall is labelled −300.
   */
  const flipY = isElevation(surfaceView);

  // First tick at or before the left/top edge of the visible area: world = (screen - pan) / zoom
  const ticksX: number[] = [];
  for (let cm = Math.ceil(-panX / zoom / step) * step; cm * zoom + panX < width; cm += step) {
    if (cm * zoom + panX >= GUTTER) ticksX.push(cm);
  }
  const ticksY: number[] = [];
  for (let cm = Math.ceil(-panY / zoom / step) * step; cm * zoom + panY < height; cm += step) {
    if (cm * zoom + panY >= GUTTER) ticksY.push(cm);
  }

  return (
    <>
      <div className="ruler-corner">სმ</div>
      {/* The strips start GUTTER px in, so subtract it to line ticks up with the world. */}
      <div className="ruler ruler-x">
        {ticksX.map((cm) => (
          <div key={cm} className="tick" style={{ left: cm * zoom + panX - GUTTER }}>
            {cm}
          </div>
        ))}
      </div>
      <div className="ruler ruler-y">
        {ticksY.map((cm) => (
          <div key={cm} className="tick" style={{ top: cm * zoom + panY - GUTTER }}>
            {flipY ? -cm : cm}
          </div>
        ))}
      </div>
    </>
  );
}
