import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ADMIN_ONLY_TITLE, useCanEditDrawings } from '../store/useAuthStore';
import { fmtNum, sizeLabel } from '../lib/bom';
import { STATUS_HINT, STATUS_LABEL, STATUS_ORDER, statusOf } from '../lib/inventory';
import { projectSummary, type ProjectPart } from '../lib/projectSummary';
import { CATEGORIES, CATEGORY_ORDER, categoryLabel } from '../data/categories';
import type { Category } from '../types';
import { DrawingPreview } from './DrawingPreview';
import { Modal } from './Modal';
import { Icon } from './Icon';

/**
 * One drawing in detail, opened from the drawings menu: a picture of it, what
 * it uses, and its status - which is where a job is marked finished and its
 * parts handed back to every other drawing.
 */
export function ProjectDialog({ docId }: { docId: string }) {
  const doc = useEditorStore((s) => s.documents.find((d) => d.id === docId));
  const materials = useEditorStore((s) => s.materials);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const setDocumentStatus = useEditorStore((s) => s.setDocumentStatus);
  const switchDocument = useEditorStore((s) => s.switchDocument);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const canEdit = useCanEditDrawings();

  const summary = useMemo(() => (doc ? projectSummary(doc, materials) : null), [doc, materials]);
  const groups = useMemo(() => {
    if (!summary) return [];
    const by = new Map<Category, ProjectPart[]>();
    for (const part of summary.parts) {
      const list = by.get(part.material.category) ?? [];
      list.push(part);
      by.set(part.material.category, list);
    }
    return CATEGORY_ORDER.filter((c) => by.has(c)).map((c) => ({ category: c, parts: by.get(c)! }));
  }, [summary]);

  // Deleted by someone else while this was open.
  if (!doc || !summary) {
    return (
      <Modal title="ნახაზი" onClose={closeDialog}>
        <div className="empty">ნახაზი აღარ არსებობს.</div>
      </Modal>
    );
  }

  const status = statusOf(doc);
  const isOpen = doc.id === activeDocId;
  const updated = new Date(doc.updatedAt).toLocaleString('ka-GE', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });

  return (
    <Modal
      title={doc.name}
      onClose={closeDialog}
      wide
      footer={
        <>
          {!isOpen && (
            <button
              className="btn primary"
              onClick={() => {
                switchDocument(doc.id);
                closeDialog();
              }}
            >
              <Icon name="arrow-right" /> ნახაზის გახსნა
            </button>
          )}
          <span className="flex-spacer" />
          <button className="btn" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      <div className="proj">
        <div className="proj-top">
          <div className="proj-preview">
            <DrawingPreview doc={doc} materials={materials} width={340} height={230} />
          </div>

          <div className="proj-side">
            <div className="proj-label">სტატუსი</div>
            <div className="proj-status" role="radiogroup" aria-label="სტატუსი">
              {STATUS_ORDER.map((s) => (
                <button
                  key={s}
                  role="radio"
                  aria-checked={status === s}
                  className={`proj-status-opt ${s}${status === s ? ' on' : ''}`}
                  disabled={!canEdit}
                  title={canEdit ? undefined : ADMIN_ONLY_TITLE}
                  onClick={() => setDocumentStatus(doc.id, s)}
                >
                  <span className={`status-dot ${s}`} />
                  <span className="proj-status-text">
                    <b>{STATUS_LABEL[s]}</b>
                    <small>{STATUS_HINT[s]}</small>
                  </span>
                </button>
              ))}
            </div>

            <div className="proj-facts">
              <div>
                <span>ელემენტი</span>
                <b>{summary.pieces}</b>
              </div>
              <div>
                <span>სახეობა</span>
                <b>{summary.kinds}</b>
              </div>
              <div>
                <span>წონა, კგ</span>
                <b>{fmtNum(summary.weightKg)}</b>
              </div>
            </div>
            <div className="proj-meta">
              {doc.projectName && <span>პროექტი: {doc.projectName}</span>}
              <span>რევიზია {doc.revision}</span>
              <span>ბოლო ცვლილება {updated}</span>
              {isOpen && <span className="proj-open-tag">ახლა ღიაა</span>}
            </div>
          </div>
        </div>

        {summary.orphans > 0 && (
          <div className="alert">
            {summary.orphans} ელემენტის კომპონენტი კატალოგში აღარ არის - ის აქ არ ითვლება.
          </div>
        )}

        {groups.length === 0 ? (
          <div className="empty">ამ ნახაზში ელემენტი ჯერ არ არის.</div>
        ) : (
          <div className="rem-table-wrap">
            <table className="rem-table">
              <thead>
                <tr>
                  <th>კომპონენტი</th>
                  <th className="num">რაოდენობა</th>
                  <th className="num">წონა, კგ</th>
                </tr>
              </thead>
              <tbody>
                {groups.map((g) => [
                  <tr className="rem-cat" key={g.category}>
                    <td colSpan={3}>
                      <span className="catdot" style={{ background: CATEGORIES[g.category].color }} />
                      {categoryLabel(g.category)}
                      <span className="rem-cat-count">
                        {g.parts.reduce((n, p) => n + p.count, 0)}
                      </span>
                    </td>
                  </tr>,
                  ...g.parts.map(({ material: m, count }) => (
                    <tr key={m.id}>
                      <td>
                        <span className="rem-name">{m.name}</span>
                        <span className="rem-size">
                          {sizeLabel(m)} სმ{m.article ? ` · ${m.article}` : ''}
                        </span>
                      </td>
                      <td className="num">{count}</td>
                      <td className="num">
                        {m.weight > 0 ? fmtNum(count * m.weight) : <span className="rem-dim">-</span>}
                      </td>
                    </tr>
                  )),
                ])}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Modal>
  );
}
