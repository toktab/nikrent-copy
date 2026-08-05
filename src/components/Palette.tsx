import { useMemo } from 'react';
import type { Material } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { CATEGORIES, CATEGORY_ORDER } from '../data/categories';
import { usageByMaterial } from '../lib/bom';
import { DEFAULT_WAREHOUSE, stockIn, totalStock } from '../lib/inventory';
import { Swatch } from './ShapeSvg';

/** Left-hand material palette: search, grouped list, drag source, inline stock. */
export function Palette() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const query = useEditorStore((s) => s.paletteQuery);
  const setQuery = useEditorStore((s) => s.setPaletteQuery);
  const openDialog = useEditorStore((s) => s.openDialog);
  const canManage = useCanManageCatalog();

  const used = useMemo(() => usageByMaterial(pieces), [pieces]);

  const groups = useMemo(() => {
    const f = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: materials.filter(
        (m) => m.category === category && (!f || m.name.toLowerCase().includes(f)),
      ),
    })).filter((g) => g.items.length > 0);
  }, [materials, query]);

  const setPaletteOpen = useEditorStore((s) => s.setPaletteOpen);

  return (
    <aside className="palette">
      <div className="panel-head">
        <span>მასალები</span>
        <button className="btn icon" title="დაკეცვა" onClick={() => setPaletteOpen(false)}>
          ◂
        </button>
      </div>
      <div className="palette-top">
        <button
          className="btn primary full"
          disabled={!canManage}
          title={canManage ? undefined : ADMIN_ONLY_TITLE}
          onClick={() => openDialog({ kind: 'material' })}
        >
          ＋ ახალი კომპონენტი
        </button>
        <button
          className="btn full"
          disabled={!canManage}
          title={canManage ? undefined : ADMIN_ONLY_TITLE}
          onClick={() => openDialog({ kind: 'sheet-import' })}
        >
          📊 იმპორტი ცხრილიდან
        </button>
        <input
          className="search"
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="🔍 მასალის ძებნა..."
        />
      </div>

      <div className="hint">
        გადმოათრიე მასალა ზედაპირზე. ზომები დაახლოებით სწორ მასშტაბშია (სმ).
      </div>

      <div className="matlist">
        {groups.map((g) => (
          <div key={g.category}>
            <div className="cathead">
              <span className="catdot" style={{ background: CATEGORIES[g.category].color }} />
              {CATEGORIES[g.category].name}
              <span className="cat-count">{g.items.length}</span>
            </div>
            {g.items.map((m) => (
              <PaletteRow key={m.id} material={m} used={used.get(m.id) ?? 0} />
            ))}
          </div>
        ))}
        {groups.length === 0 && <div className="empty">ვერაფერი მოიძებნა.</div>}
      </div>
    </aside>
  );
}

function PaletteRow({ material: m, used }: { material: Material; used: number }) {
  const setStock = useEditorStore((s) => s.setStock);
  const canManage = useCanManageCatalog();
  const openDialog = useEditorStore((s) => s.openDialog);
  const deleteMaterial = useEditorStore((s) => s.deleteMaterial);
  const warehouses = useEditorStore((s) => s.warehouses);
  const setDraggingMaterial = useEditorStore((s) => s.setDraggingMaterial);

  // The palette edits the first warehouse; the Inventory tab handles the rest.
  const primaryWarehouse = warehouses[0]?.id ?? DEFAULT_WAREHOUSE.id;
  const stock = totalStock(m);
  const shortage = used > stock;

  const askDelete = () => {
    if (used > 0) {
      openDialog({
        kind: 'confirm',
        title: 'კომპონენტის წაშლა',
        message: `"${m.name}" ზედაპირზე გამოყენებულია ${used} ცალი. წაშლისას ეს ელემენტებიც წაიშლება. გავაგრძელო?`,
        confirmLabel: `წაშლა (${used} ელემენტიც)`,
        danger: true,
        onConfirm: () => deleteMaterial(m.id, true),
      });
    } else {
      openDialog({
        kind: 'confirm',
        title: 'კომპონენტის წაშლა',
        message: `წავშალო "${m.name}" კატალოგიდან?`,
        confirmLabel: 'წაშლა',
        danger: true,
        onConfirm: () => deleteMaterial(m.id, false),
      });
    }
  };

  return (
    <div className={`mat${shortage ? ' shortage' : ''}`}>
      {/* Only this part is draggable, so the stock input stays clickable. */}
      <div
        className="mat-drag"
        draggable
        onDragStart={(e) => {
          e.dataTransfer.setData('text/plain', m.id);
          e.dataTransfer.effectAllowed = 'copy';
          // dataTransfer is unreadable during dragover, so the stage learns
          // what is being dragged from the store instead.
          setDraggingMaterial(m.id);
        }}
        onDragEnd={() => setDraggingMaterial(null)}
        title={`${m.name} — ${m.w} × ${m.h} სმ`}
      >
        <Swatch material={m} />
        <div className="info">
          <div className="nm">{m.name}</div>
          <div className="dim">
            {m.w} × {m.h} სმ
            {used > 0 && <span className="used-chip">{used}</span>}
          </div>
        </div>
      </div>

      <div className="mat-actions">
        <input
          className={`stock-input${shortage ? ' bad' : ''}`}
          type="number"
          min={0}
          step={1}
          value={stockIn(m, primaryWarehouse)}
          title={
            warehouses.length > 1
              ? `მარაგი: ${warehouses[0].name} (სულ ${stock})`
              : 'მარაგი (ცალი)'
          }
          disabled={!canManage}
          onChange={(e) => setStock(m.id, primaryWarehouse, Number(e.target.value))}
        />
        <button
          className="btn icon"
          disabled={!canManage}
          title={canManage ? 'რედაქტირება' : ADMIN_ONLY_TITLE}
          onClick={() => openDialog({ kind: 'material', materialId: m.id })}
        >
          ✎
        </button>
        <button
          className="btn icon danger"
          disabled={!canManage}
          title={canManage ? 'წაშლა' : ADMIN_ONLY_TITLE}
          onClick={askDelete}
        >
          🗑
        </button>
      </div>
    </div>
  );
}
