import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { DetailsPanel } from './DetailsPanel';
import { BomPanel } from './BomPanel';
import { InventoryPanel } from './InventoryPanel';
import { RecommendPanel } from './RecommendPanel';
import { Icon } from './Icon';

/** Right-hand inspector with the working views. ნაშთი has its own window - see RemainingDialog. */
export function SidePanel() {
  const tab = useEditorStore((s) => s.inspectorTab);
  const setTab = useEditorStore((s) => s.setInspectorTab);
  const simple = useEditorStore((s) => s.simpleMode);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const selected = useEditorStore((s) => s.selectedIds.length + s.selectedSketchIds.length);
  const shortages = useMemo(() => buildBom(materials, pieces).shortageCount, [materials, pieces]);

  const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);

  // Simple mode keeps the one view the drawing is worked in; the bill of
  // materials and the stock stay a click away in full mode.
  const shown = simple ? 'recommend' : tab;

  return (
    <aside className="inspector">
      <div className="panel-head">
        <button
          className="btn icon ghost small"
          title="დაკეცვა"
          aria-label="პანელის დაკეცვა"
          onClick={() => setInspectorOpen(false)}
        >
          <Icon name="chevron-right" />
        </button>
      </div>
      <div className="tabs" role="tablist">
        <button
          className={shown === 'recommend' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={shown === 'recommend'}
          onClick={() => setTab('recommend')}
        >
          რეკომენდაცია
          {selected > 0 && <span className="tab-badge sel">{selected}</span>}
        </button>
        {!simple && (
          <>
            <button
              className={shown === 'bom' ? 'tab active' : 'tab'}
              role="tab"
              aria-selected={shown === 'bom'}
              onClick={() => setTab('bom')}
            >
              უწყისი
            </button>
            <button
              className={shown === 'inventory' ? 'tab active' : 'tab'}
              role="tab"
              aria-selected={shown === 'inventory'}
              onClick={() => setTab('inventory')}
            >
              მარაგი
              {shortages > 0 && <span className="tab-badge">{shortages}</span>}
            </button>
          </>
        )}
      </div>

      <div className="tab-body">
        {shown === 'recommend' && <SelectionTab />}
        {shown === 'bom' && <BomPanel />}
        {shown === 'inventory' && <InventoryPanel />}
      </div>
    </aside>
  );
}

/**
 * What is selected, and - for drawn lines - the ranked ways to fill them.
 *
 * One tab rather than two: a line's details (its legs, its side, whether what
 * stands on it adds up) and the answers for filling it are read together, and
 * flipping between two tabs to do that was the complaint. A selected piece has
 * nothing to recommend, so it gets its details alone, as before.
 */
function SelectionTab() {
  const pieces = useEditorStore((s) => s.selectedIds.length);
  const lines = useEditorStore((s) => s.selectedSketchIds.length);
  const recommend = lines > 0 && pieces === 0;

  return (
    <>
      {recommend && <h3 className="section-title">დეტალები</h3>}
      <DetailsPanel />
      {/* Always mounted, only hidden: the height, filters and picks live in it,
          and they reset every time a panel was clicked and the line picked
          again. Hidden, it previews nothing on the drawing. */}
      <section id="recommendations" className="section" hidden={!recommend}>
        <h3 className="section-title">რეკომენდაცია</h3>
        <RecommendPanel active={recommend} />
      </section>
    </>
  );
}
