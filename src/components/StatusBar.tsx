import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { allGaps, isFace } from '../lib/gap';
import { hiddenSpan, projectPiece } from '../lib/projection';
import { useSyncStore } from '../lib/syncEngine';
import { useOnline } from '../lib/useOnline';
import { combo } from '../lib/platform';
import { VIEW_LABEL } from '../lib/projection';
import { Icon } from './Icon';

/**
 * The bottom rail.
 *
 * This replaces a footer of eleven keyboard hints that were all equally loud
 * and never changed. Four hints stay — the ones that are genuinely hard to
 * discover — and the space they free goes to the things that do change: what
 * is selected, which view is on screen, and whether the network is there.
 */
export function StatusBar() {
  const selected = useEditorStore((s) => s.selectedIds.length);
  const total = useEditorStore((s) => s.pieces.length);
  const zoom = useEditorStore((s) => s.zoom);
  const viewMode = useEditorStore((s) => s.viewMode);
  const surfaceView = useEditorStore((s) => s.surfaceView);
  const pending = useSyncStore((s) => s.pendingChanges);
  const online = useOnline();
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const showGaps = useEditorStore((s) => s.showGaps);

  // Only counted while the check is on. Running it over every piece on every
  // keystroke to display a number nobody asked for would be a tax on drawing.
  const openGaps = useMemo(() => {
    if (!showGaps) return 0;
    const byId = new Map(materials.map((m) => [m.id, m]));
    const rects = pieces.flatMap((p) => {
      const m = byId.get(p.materialId);
      if (!isFace(m) || !m) return [];
      const r = projectPiece(p, m, surfaceView);
      return [{
        ...r,
        heightCm: m.h,
        span: hiddenSpan(p, m, surfaceView),
        faceAxis: viewMode === '3d' || surfaceView !== 'plan'
          ? undefined
          : ((r.w >= r.h ? 'u' : 'v') as 'u' | 'v'),
      }];
    });
    return allGaps(rects).length;
  }, [showGaps, pieces, materials, surfaceView, viewMode]);

  const view = viewMode === '3d' ? '3D' : VIEW_LABEL[surfaceView];

  return (
    <footer className="statusbar">
      <span className="hintlist">
        <span>
          <kbd>R</kbd> მოტრიალება
        </span>
        <span>
          <kbd>{combo(['mod', 'Z'])}</kbd> დაბრუნება
        </span>
        <span>
          <kbd>{combo(['mod', 'D'])}</kbd> დუბლირება
        </span>
        <span className="opt">
          <kbd>Alt</kbd>+კლიკი — ქვედა ელემენტი
        </span>
        <span className="opt">
          <kbd>Space</kbd>+თრევა — ხედის გადაწევა
        </span>
      </span>

      <span className="flex-spacer" />

      {!online && (
        <span className="status-offline" title="ცვლილებები ინახება ლოკალურად">
          <Icon name="offline" size={13} /> ოფლაინ
          {pending && <span className="status-queued">ცვლილებები რიგშია</span>}
        </span>
      )}
      {showGaps && (
        <span className={`status-gaps${openGaps ? ' open' : ''}`}>
          {openGaps ? `${openGaps} ხვრელი` : 'ხვრელი არაა'}
        </span>
      )}
      {selected > 0 && (
        <span className="status-sel">
          მონიშნული <b>{selected}</b>
        </span>
      )}
      <span className="status-view">
        {total} ელემენტი · {view} · {Math.round(zoom * 100)}%
      </span>
    </footer>
  );
}
