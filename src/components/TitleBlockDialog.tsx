import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';

/** 0 = auto: pick the largest standard scale that still fits the sheet. */
const SCALES = [0, 10, 20, 25, 50, 100, 200];

/** Title-block fields printed on the scaled drawing sheet. */
export function TitleBlockDialog() {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const setTitleBlock = useEditorStore((s) => s.setTitleBlock);
  const renameDocument = useEditorStore((s) => s.renameDocument);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  const doc = documents.find((d) => d.id === activeDocId);
  if (!doc) return null;

  return (
    <Modal
      title="ნახაზის მონაცემები"
      onClose={closeDialog}
      footer={
        <button className="btn primary" onClick={closeDialog}>
          დახურვა
        </button>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        ეს ველები იბეჭდება ნახაზის შტამპში.
      </p>

      <div className="form-grid">
        <label className="field span2">
          <span>ობიექტი / პროექტი</span>
          <input
            autoFocus
            value={doc.projectName}
            placeholder="მაგ. ბიზნესცენტრი, ბლოკი B"
            onChange={(e) => setTitleBlock({ projectName: e.target.value })}
          />
        </label>

        <label className="field span2">
          <span>ნახაზის სახელი</span>
          <input value={doc.name} onChange={(e) => renameDocument(doc.id, e.target.value)} />
        </label>

        <label className="field">
          <span>რევიზია</span>
          <input
            value={doc.revision}
            onChange={(e) => setTitleBlock({ revision: e.target.value })}
          />
        </label>

        <label className="field">
          <span>მასშტაბი</span>
          <select
            value={doc.scale}
            onChange={(e) => setTitleBlock({ scale: Number(e.target.value) })}
          >
            {SCALES.map((s) => (
              <option key={s} value={s}>
                {s === 0 ? 'ავტომატური' : `1:${s}`}
              </option>
            ))}
          </select>
        </label>
      </div>
    </Modal>
  );
}
