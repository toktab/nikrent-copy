import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';

/** Manage the saved drawings: switch, rename, duplicate, delete, create. */
export function DocumentsDialog() {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const switchDocument = useEditorStore((s) => s.switchDocument);
  const renameDocument = useEditorStore((s) => s.renameDocument);
  const duplicateDocument = useEditorStore((s) => s.duplicateDocument);
  const deleteDocument = useEditorStore((s) => s.deleteDocument);
  const newDocument = useEditorStore((s) => s.newDocument);
  const openDialog = useEditorStore((s) => s.openDialog);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');

  const startRename = (id: string, name: string) => {
    setEditingId(id);
    setDraftName(name);
  };

  const commitRename = () => {
    if (editingId) renameDocument(editingId, draftName);
    setEditingId(null);
  };

  const askDelete = (id: string, name: string) => {
    openDialog({
      kind: 'confirm',
      title: 'ნახაზის წაშლა',
      message: `წავშალო ნახაზი "${name}"? ეს მოქმედება შეუქცევადია.`,
      confirmLabel: 'წაშლა',
      danger: true,
      onConfirm: () => deleteDocument(id),
    });
  };

  return (
    <Modal
      title="ნახაზები"
      onClose={closeDialog}
      footer={
        <>
          <button
            className="btn primary"
            onClick={() => {
              newDocument();
              closeDialog();
            }}
          >
            ＋ ახალი ნახაზი
          </button>
          <span className="flex-spacer" />
          <button className="btn" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        კატალოგი და მარაგები საერთოა ყველა ნახაზისთვის — ნახაზი მხოლოდ განთავსებულ
        ელემენტებს ინახავს.
      </p>

      <div className="doc-list">
        {documents.map((doc) => {
          const active = doc.id === activeDocId;
          return (
            <div key={doc.id} className={`doc-row${active ? ' active' : ''}`}>
              <button
                className="doc-open"
                onClick={() => {
                  switchDocument(doc.id);
                  closeDialog();
                }}
                title="გახსნა"
              >
                <span className="doc-dot">{active ? '●' : '○'}</span>
                {editingId === doc.id ? (
                  <input
                    autoFocus
                    value={draftName}
                    onClick={(e) => e.stopPropagation()}
                    onChange={(e) => setDraftName(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') commitRename();
                      if (e.key === 'Escape') setEditingId(null);
                    }}
                  />
                ) : (
                  <span className="doc-name">{doc.name}</span>
                )}
                <span className="doc-meta">
                  {doc.pieces.length} ელემენტი · {new Date(doc.updatedAt).toLocaleDateString('ka-GE')}
                </span>
              </button>

              <div className="doc-actions">
                <button
                  className="btn icon"
                  title="სახელის შეცვლა"
                  onClick={() => startRename(doc.id, doc.name)}
                >
                  ✎
                </button>
                <button
                  className="btn icon"
                  title="ასლის შექმნა"
                  onClick={() => {
                    duplicateDocument(doc.id);
                    closeDialog();
                  }}
                >
                  ⧉
                </button>
                <button
                  className="btn icon danger"
                  title={documents.length <= 1 ? 'ბოლო ნახაზი ვერ წაიშლება' : 'წაშლა'}
                  disabled={documents.length <= 1}
                  onClick={() => askDelete(doc.id, doc.name)}
                >
                  🗑
                </button>
              </div>
            </div>
          );
        })}
      </div>
    </Modal>
  );
}
