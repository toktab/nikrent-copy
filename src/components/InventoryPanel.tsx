import { keepWheelOffNumber } from '../lib/numberField';
import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { CATEGORIES, CATEGORY_ORDER, categoryLabel } from '../data/categories';
import { sizeLabel } from '../lib/bom';
import { commitmentsByMaterial, emptyCommitment, stockIn, totalStock } from '../lib/inventory';
import { Icon } from './Icon';

/**
 * Stock per component. Shows what the company owns, what every drawing has
 * already committed, and what is genuinely free to allocate.
 */
export function InventoryPanel() {
  const materials = useEditorStore((s) => s.materials);
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const warehouses = useEditorStore((s) => s.warehouses);
  const setStock = useEditorStore((s) => s.setStock);
  const canManage = useCanManageCatalog();
  const openDialog = useEditorStore((s) => s.openDialog);

  const [query, setQuery] = useState('');
  const [onlyShortages, setOnlyShortages] = useState(false);
  // Which store the inline inputs edit. '' means "show the combined total".
  const [activeWarehouse, setActiveWarehouse] = useState(warehouses[0]?.id ?? '');

  const commitments = useMemo(
    () => commitmentsByMaterial(documents, activeDocId),
    [documents, activeDocId],
  );

  const editing = warehouses.find((w) => w.id === activeWarehouse) ?? warehouses[0];
  const editingId = editing?.id ?? '';

  const groups = useMemo(() => {
    const f = query.trim().toLowerCase();
    return CATEGORY_ORDER.map((category) => ({
      category,
      items: materials.filter((m) => {
        if (m.category !== category) return false;
        if (f && !m.name.toLowerCase().includes(f) && !m.article.toLowerCase().includes(f)) {
          return false;
        }
        if (onlyShortages) {
          const c = commitments.get(m.id) ?? emptyCommitment();
          if (totalStock(m) - c.committed >= 0) return false;
        }
        return true;
      }),
    })).filter((g) => g.items.length > 0);
  }, [materials, query, onlyShortages, commitments]);

  const totals = useMemo(() => {
    let stock = 0;
    let shortages = 0;
    for (const m of materials) {
      const owned = totalStock(m);
      const c = commitments.get(m.id) ?? emptyCommitment();
      stock += owned;
      if (owned - c.committed < 0) shortages++;
    }
    return { stock, shortages, count: materials.length };
  }, [materials, commitments]);

  const exportXlsx = async () => {
    // SheetJS is loaded on demand — see BomPanel for why.
    const { exportCatalogToExcel } = await import('../lib/excelExport');
    exportCatalogToExcel(
      materials.map((m) => {
        const c = commitments.get(m.id) ?? emptyCommitment();
        return {
          name: m.name,
          category: categoryLabel(m.category),
          size: sizeLabel(m),
          shape: m.shape,
          article: m.article,
          supplier: m.supplier,
          weight: m.weight,
          stockPerWarehouse: warehouses.map((w) => stockIn(m, w.id)),
          totalStock: totalStock(m),
          committed: c.committed,
        };
      }),
      warehouses.map((w) => w.name),
    );
  };

  return (
    <div className="inventory">
      <div className="summary-card">
        <div className="sc-item">
          <span>კომპონენტი</span>
          <b>{totals.count}</b>
        </div>
        <div className="sc-item">
          <span>სულ მარაგი</span>
          <b>{totals.stock}</b>
        </div>
        <div className={`sc-item${totals.shortages ? ' warn' : ''}`}>
          <span>არ ჰყოფნის</span>
          <b>{totals.shortages}</b>
        </div>
      </div>

      <div className="wh-bar">
        <select value={editingId} onChange={(e) => setActiveWarehouse(e.target.value)}>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>
              {w.name}
            </option>
          ))}
        </select>
        <button
          className="btn small"
          disabled={!canManage}
          title={canManage ? undefined : ADMIN_ONLY_TITLE}
          onClick={() => openDialog({ kind: 'warehouses' })}
        >
          საწყობები…
        </button>
      </div>

      <input
        className="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="კომპონენტი ან აღნიშვნა…"
      />
      <label className="check-row">
        <input
          type="checkbox"
          checked={onlyShortages}
          onChange={(e) => setOnlyShortages(e.target.checked)}
        />
        მხოლოდ დეფიციტი (ყველა ნახაზის გათვალისწინებით)
      </label>
      <div className="export-row">
        <button className="btn small" onClick={() => void exportXlsx()}><Icon name="download" /> კატალოგი Excel-ში
        </button>
      </div>

      {groups.length === 0 && <div className="empty">ვერაფერი მოიძებნა.</div>}

      {groups.map((g) => (
        <div key={g.category} className="bom-group">
          <div className="bom-cat">
            <span className="catdot" style={{ background: CATEGORIES[g.category].color }} />
            <b>{CATEGORIES[g.category].name}</b>
          </div>
          <table className="bom-table inv-table">
            <thead>
              <tr>
                <th>კომპონენტი</th>
                <th className="num" title="განთავსებულია ყველა ნახაზზე">
                  დაკავებ.
                </th>
                <th className="num" title={editing ? `მარაგი: ${editing.name}` : 'მარაგი'}>
                  მარაგი
                </th>
                <th className="num" title="სულ მარაგი მინუს ყველა ნახაზი">
                  თავისუფ.
                </th>
              </tr>
            </thead>
            <tbody>
              {g.items.map((m) => {
                const c = commitments.get(m.id) ?? emptyCommitment();
                const owned = totalStock(m);
                const free = owned - c.committed;
                const shortage = free < 0;
                const multi = warehouses.length > 1;
                return (
                  <tr key={m.id} className={shortage ? 'short' : ''}>
                    <td>
                      <button
                        className="link-name"
                        disabled={!canManage}
                        title={canManage ? 'რედაქტირება' : ADMIN_ONLY_TITLE}
                        onClick={() => openDialog({ kind: 'material', materialId: m.id })}
                      >
                        {m.name}
                      </button>
                      <span className="bom-size">
                        {sizeLabel(m)} სმ{m.article ? ` · ${m.article}` : ''}
                      </span>
                      {c.byDocument.length > 1 && (
                        <span className="bom-size" title="განაწილება ნახაზებზე">
                          {c.byDocument.map((d) => `${d.name}: ${d.count}`).join(' · ')}
                        </span>
                      )}
                    </td>
                    <td className="num">{c.committed || ''}</td>
                    <td className="num">
                      <input
                        className={`stock-input${shortage ? ' bad' : ''}`}
                        onWheel={keepWheelOffNumber}
                        type="number"
                        min={0}
                        step={1}
                        value={stockIn(m, editingId)}
                        disabled={!canManage}
                        onChange={(e) => setStock(m.id, editingId, Number(e.target.value))}
                      />
                      {multi && <span className="bom-size">სულ {owned}</span>}
                    </td>
                    <td className="num">
                      {free}
                      {shortage && <span className="warn-badge"><Icon name="warning" /></span>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ))}
    </div>
  );
}
