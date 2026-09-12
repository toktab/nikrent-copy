import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { DetailsPanel } from './DetailsPanel';
import { BomPanel } from './BomPanel';
import { InventoryPanel } from './InventoryPanel';
import { RecommendPanel } from './RecommendPanel';
import { Icon } from './Icon';

/** Right-hand inspector with the three working views. */
export function SidePanel() {
  const tab = useEditorStore((s) => s.inspectorTab);
  const setTab = useEditorStore((s) => s.setInspectorTab);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const shortages = useMemo(() => buildBom(materials, pieces).shortageCount, [materials, pieces]);

  const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);

  return (
    // Wider for recommendations: a card carries a strip of the whole run.
    <aside className={`inspector${tab === 'recommend' ? ' wide' : ''}`}>
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
          className={tab === 'details' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'details'}
          onClick={() => setTab('details')}
        >
          დეტალები
          {selectedIds.length > 0 && <span className="tab-badge sel">{selectedIds.length}</span>}
        </button>
        <button
          className={tab === 'bom' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'bom'}
          onClick={() => setTab('bom')}
        >
          უწყისი
        </button>
        <button
          className={tab === 'inventory' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'inventory'}
          onClick={() => setTab('inventory')}
        >
          მარაგი
          {shortages > 0 && <span className="tab-badge">{shortages}</span>}
        </button>
        <button
          className={tab === 'recommend' ? 'tab active' : 'tab'}
          role="tab"
          aria-selected={tab === 'recommend'}
          onClick={() => setTab('recommend')}
        >
          რეკომენდაცია
        </button>
      </div>

      <div className="tab-body">
        {tab === 'details' && <DetailsPanel />}
        {tab === 'bom' && <BomPanel />}
        {tab === 'inventory' && <InventoryPanel />}
        {tab === 'recommend' && <RecommendPanel />}
      </div>
    </aside>
  );
}
