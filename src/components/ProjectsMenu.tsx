import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { STATUS_LABEL, STATUS_ORDER, statusOf } from '../lib/inventory';
import { projectSummary } from '../lib/projectSummary';
import { sizeLabel } from '../lib/bom';
import type { DrawingDoc } from '../types';
import { MenuLabel } from './Menu';
import { DrawingPreview } from './DrawingPreview';
import { Icon } from './Icon';

/** How many parts the hover card names before it says "and N more". */
const HOVER_PARTS = 6;

/**
 * The drawings list inside the top-left menu, grouped by status.
 *
 * Hover a drawing for what it uses; click it for the details window, where its
 * status is set; the arrow at the end of a row opens the drawing straight away,
 * which is what this menu was for before it had anything else to say.
 */
export function ProjectsMenuList({ close }: { close: () => void }) {
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const switchDocument = useEditorStore((s) => s.switchDocument);
  const openDialog = useEditorStore((s) => s.openDialog);

  const [hover, setHover] = useState<{ doc: DrawingDoc; top: number; left: number } | null>(null);

  const groups = useMemo(
    () =>
      STATUS_ORDER.map((status) => ({
        status,
        docs: documents.filter((d) => statusOf(d) === status),
      })).filter((g) => g.docs.length > 0),
    [documents],
  );

  return (
    <div className="proj-menu" onMouseLeave={() => setHover(null)}>
      {groups.map((g) => (
        <div key={g.status}>
          <MenuLabel>
            <span className={`status-dot ${g.status}`} /> {STATUS_LABEL[g.status]}
          </MenuLabel>
          {g.docs.map((d) => (
            <div
              key={d.id}
              className={`proj-row${d.id === activeDocId ? ' on' : ''}`}
              onMouseEnter={(e) => {
                const row = e.currentTarget.getBoundingClientRect();
                const menu = e.currentTarget.closest('.menu')?.getBoundingClientRect() ?? row;
                // Beside the menu, never over it; kept on screen at the bottom.
                setHover({
                  doc: d,
                  left: menu.right + 8,
                  top: Math.min(row.top, window.innerHeight - 330),
                });
              }}
            >
              <button
                type="button"
                className="menu-item proj-row-main"
                role="menuitem"
                onClick={() => {
                  openDialog({ kind: 'project', docId: d.id });
                  close();
                }}
              >
                <span className="proj-row-name">{d.name}</span>
                <span className="trail">{d.pieces.length || ''}</span>
              </button>
              {d.id === activeDocId ? (
                <span className="proj-row-open here" title="ახლა ღიაა">
                  <Icon name="check" size={13} />
                </span>
              ) : (
                <button
                  type="button"
                  className="proj-row-open"
                  title="გახსნა"
                  aria-label={`${d.name} - გახსნა`}
                  onClick={() => {
                    switchDocument(d.id);
                    close();
                  }}
                >
                  <Icon name="arrow-right" size={13} />
                </button>
              )}
            </div>
          ))}
        </div>
      ))}
      {hover && <HoverCard doc={hover.doc} top={hover.top} left={hover.left} />}
    </div>
  );
}

function HoverCard({ doc, top, left }: { doc: DrawingDoc; top: number; left: number }) {
  const materials = useEditorStore((s) => s.materials);
  const summary = useMemo(() => projectSummary(doc, materials), [doc, materials]);
  const status = statusOf(doc);
  const shown = summary.parts.slice(0, HOVER_PARTS);
  const more = summary.parts.length - shown.length;
  // Flips to the left of the menu when there is no room on the right.
  const x = left + 280 > window.innerWidth ? Math.max(8, left - 280 - 16 - 220) : left;

  return (
    <div className="proj-hover" style={{ top, left: x }} role="tooltip">
      <div className="proj-hover-head">
        <b>{doc.name}</b>
        <span className={`proj-hover-status ${status}`}>
          <span className={`status-dot ${status}`} /> {STATUS_LABEL[status]}
        </span>
      </div>
      <DrawingPreview doc={doc} materials={materials} width={256} height={110} />
      {summary.pieces === 0 ? (
        <div className="proj-hover-empty">ელემენტი ჯერ არ არის.</div>
      ) : (
        <>
          <div className="proj-hover-total">
            {summary.pieces} ელემენტი · {summary.kinds} სახეობა
          </div>
          <ul className="proj-hover-parts">
            {shown.map(({ material: m, count }) => (
              <li key={m.id}>
                <span className="catdot" style={{ background: m.color }} />
                <span className="name">
                  {m.name} <small>{sizeLabel(m)}</small>
                </span>
                <b>× {count}</b>
              </li>
            ))}
          </ul>
          {more > 0 && <div className="proj-hover-more">და კიდევ {more} სახეობა</div>}
        </>
      )}
      <div className="proj-hover-hint">დააჭირე დეტალებისთვის</div>
    </div>
  );
}
