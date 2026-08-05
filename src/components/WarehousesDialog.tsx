import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { stockIn } from '../lib/inventory';
import { Modal } from './Modal';
import { Icon } from './Icon';

/** Manage the stores the company keeps formwork in. */
export function WarehousesDialog() {
  const warehouses = useEditorStore((s) => s.warehouses);
  const materials = useEditorStore((s) => s.materials);
  const addWarehouse = useEditorStore((s) => s.addWarehouse);
  const renameWarehouse = useEditorStore((s) => s.renameWarehouse);
  const deleteWarehouse = useEditorStore((s) => s.deleteWarehouse);
  const openDialog = useEditorStore((s) => s.openDialog);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  const [newName, setNewName] = useState('');

  const totalIn = (warehouseId: string) =>
    materials.reduce((sum, m) => sum + stockIn(m, warehouseId), 0);

  const askDelete = (id: string, name: string) => {
    const moving = totalIn(id);
    const target = warehouses.find((w) => w.id !== id);
    openDialog({
      kind: 'confirm',
      title: 'საწყობის წაშლა',
      message: moving
        ? `"${name}"-ში ირიცხება ${moving} ერთეული. წაშლისას ეს რაოდენობა გადავა "${target?.name}"-ში. გავაგრძელო?`
        : `წავშალო საწყობი "${name}"?`,
      confirmLabel: 'წაშლა',
      danger: true,
      onConfirm: () => deleteWarehouse(id),
    });
  };

  return (
    <Modal
      title="საწყობები"
      onClose={closeDialog}
      footer={
        <button className="btn" onClick={closeDialog}>
          დახურვა
        </button>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        მარაგი ცალკე ითვლება თითოეულ საწყობში. საწყობის წაშლისას მისი რაოდენობა არ იკარგება —
        გადადის პირველ დარჩენილში.
      </p>

      <div className="doc-list">
        {warehouses.map((w) => (
          <div key={w.id} className="doc-row">
            <input
              className="wh-name"
              value={w.name}
              onChange={(e) => renameWarehouse(w.id, e.target.value)}
            />
            <span className="doc-meta">{totalIn(w.id)} ერთეული</span>
            <div className="doc-actions">
              <button
                className="btn icon danger"
                title={warehouses.length <= 1 ? 'ბოლო საწყობი ვერ წაიშლება' : 'წაშლა'}
                disabled={warehouses.length <= 1}
                onClick={() => askDelete(w.id, w.name)}
              ><Icon name="trash" />
              </button>
            </div>
          </div>
        ))}
      </div>

      <div className="wh-add">
        <input
          value={newName}
          placeholder="ახალი საწყობის სახელი"
          onChange={(e) => setNewName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && newName.trim()) {
              addWarehouse(newName);
              setNewName('');
            }
          }}
        />
        <button
          className="btn primary"
          disabled={!newName.trim()}
          onClick={() => {
            addWarehouse(newName);
            setNewName('');
          }}
        ><Icon name="plus" /> დამატება
        </button>
      </div>
    </Modal>
  );
}
