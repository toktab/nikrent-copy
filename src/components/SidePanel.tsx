import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import { DetailsPanel } from './DetailsPanel';
import { BomPanel } from './BomPanel';
import { InventoryPanel } from './InventoryPanel';
import { Icon } from './Icon';

type Tab = 'details' | 'bom' | 'inventory';

/** Right-hand inspector with the three working views. */
export function SidePanel() {
  const [tab, setTab] = useState<Tab>('bom');
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const shortages = useMemo(() => buildBom(materials, pieces).shortageCount, [materials, pieces]);

  const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);

  return (
    <aside className="inspector">
      <div className="panel-head">
        <button className="btn icon" title="დაკეცვა" onClick={() => setInspectorOpen(false)}><Icon name="chevron-right" />
        </button>
      </div>
      <div className="tabs">
        <button className={tab === 'details' ? 'tab active' : 'tab'} onClick={() => setTab('details')}>
          დეტალები
        </button>
        <button className={tab === 'bom' ? 'tab active' : 'tab'} onClick={() => setTab('bom')}>
          უწყისი
        </button>
        <button
          className={tab === 'inventory' ? 'tab active' : 'tab'}
          onClick={() => setTab('inventory')}
        >
          მარაგი
          {shortages > 0 && <span className="tab-badge">{shortages}</span>}
        </button>
      </div>

      <div className="tab-body">
        {tab === 'details' && <DetailsPanel />}
        {tab === 'bom' && <BomPanel />}
        {tab === 'inventory' && <InventoryPanel />}
      </div>
    </aside>
  );
}
