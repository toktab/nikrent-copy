import { useMemo, useState, type KeyboardEvent } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { isElevation } from '../lib/projection';
import { runFillAll } from './FillAllButton';
import { Modal } from './Modal';

/**
 * Ctrl/⌘ + K: type what you want and go there - a tool, a window, a tab, a
 * drawing, or every piece of one size on the drawing ("90*300").
 *
 * The buttons are where they are for somebody learning the app; this is for
 * the same person a month later, who knows the word and not the corner.
 */
interface Command {
  id: string;
  label: string;
  hint?: string;
  run: () => void;
}

const MAX_SHOWN = 40;

export function CommandPalette() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const documents = useEditorStore((s) => s.documents);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const simple = useEditorStore((s) => s.simpleMode);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);

  const commands = useMemo<Command[]>(() => {
    const store = () => useEditorStore.getState();
    const openTab = (tab: 'recommend' | 'bom' | 'inventory') => {
      store().setInspectorOpen(true);
      store().setInspectorTab(tab);
    };
    const inPlan = () => {
      const s = store();
      if (s.viewMode !== '2d') s.setViewMode('2d');
      if (isElevation(s.surfaceView)) s.setSurfaceView('plan');
    };
    const list: Command[] = [
      { id: 'pen', label: 'ხაზვა', hint: 'G', run: () => (inPlan(), store().setTool('pen')) },
      { id: 'measure', label: 'გაზომვა', hint: 'M', run: () => (inPlan(), store().setTool('measure')) },
      { id: 'fill-all', label: 'ყველას შევსება', hint: 'ცარიელი ხაზები', run: runFillAll },
      { id: 'remaining', label: 'ნაშთი', hint: 'მარაგი ამ ნახაზის შემდეგ', run: () => store().openDialog({ kind: 'remaining' }) },
      {
        id: 'workbook',
        label: 'Excel - არქიტექტორის ფორმატი',
        hint: 'კონსტრუქცია, ჯამი, ნაშთი, აწყობა, პრინტ',
        run: () => {
          const s = store();
          const name = s.documents.find((d) => d.id === s.activeDocId)?.name ?? '';
          void import('../lib/excelExport').then(({ exportArchitectWorkbook }) =>
            exportArchitectWorkbook({ materials: s.materials, pieces: s.pieces, sketch: s.sketch, drawingName: name }),
          );
        },
      },
      {
        id: 'export-pdf',
        label: 'ექსპორტი - PDF',
        hint: 'ბეჭდვა: ნახაზი, ხაზები, ზომები, შტამპი, უწყისი',
        run: () => store().openDialog({ kind: 'export', tab: 'pdf' }),
      },
      {
        id: 'export-json',
        label: 'ექსპორტი - JSON',
        hint: 'ნახაზის ფაილი',
        run: () => store().openDialog({ kind: 'export', tab: 'json' }),
      },
      { id: 'recommend', label: 'რეკომენდაცია', hint: 'მარჯვენა პანელი', run: () => openTab('recommend') },
      { id: 'bom', label: 'უწყისი', hint: 'მარჯვენა პანელი', run: () => (simple ? store().setSimpleMode(false) : null, openTab('bom')) },
      { id: 'inventory', label: 'მარაგი', hint: 'მარჯვენა პანელი', run: () => (simple ? store().setSimpleMode(false) : null, openTab('inventory')) },
      { id: 'documents', label: 'ნახაზები', hint: 'ახალი, სახელი, ასლი', run: () => store().openDialog({ kind: 'documents' }) },
      { id: 'templates', label: 'შაბლონები', run: () => store().openDialog({ kind: 'templates' }) },
      { id: 'column', label: 'კოლონის ოსტატი', run: () => store().openDialog({ kind: 'column-wizard' }) },
      { id: 'wall', label: 'კედლის ოსტატი', run: () => store().openDialog({ kind: 'wall-wizard' }) },
      { id: 'lengths', label: 'ზომების ჩვენება', run: () => store().openDialog({ kind: 'display-settings' }) },
      { id: 'fit', label: 'ნახაზის ჩატევა ეკრანზე', run: () => store().fitToContent() },
      {
        id: 'simple',
        label: simple ? 'მარტივი რეჟიმის გამორთვა' : 'მარტივი რეჟიმი',
        run: () => store().setSimpleMode(!simple),
      },
      { id: 'keys', label: 'კლავიშები', hint: '?', run: () => store().openDialog({ kind: 'shortcuts' }) },
      { id: 'tour', label: 'ტური - როგორ მუშავს', run: () => store().openDialog({ kind: 'tour' }) },
    ];

    for (const doc of documents) {
      list.push({
        id: `doc:${doc.id}`,
        label: `ნახაზი: ${doc.name}`,
        hint: `${doc.pieces.length} ელემენტი`,
        run: () => store().switchDocument(doc.id),
      });
    }

    // Every size on the drawing, to pick all of its pieces out at once.
    const used = new Map<string, string[]>();
    for (const p of pieces) used.set(p.materialId, [...(used.get(p.materialId) ?? []), p.id]);
    for (const m of materials) {
      const ids = used.get(m.id);
      if (!ids) continue;
      list.push({
        id: `mat:${m.id}`,
        label: `${m.name} - მონიშნვა ნახაზზე`,
        hint: `${ids.length} ცალი`,
        run: () => {
          inPlan();
          store().selectSketchMany([]);
          store().setSelection(ids);
        },
      });
    }
    return list;
  }, [documents, materials, pieces, simple]);

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase();
    const hits = q
      ? commands.filter((c) => `${c.label} ${c.hint ?? ''}`.toLowerCase().includes(q))
      : commands;
    return hits.slice(0, MAX_SHOWN);
  }, [commands, query]);

  const run = (command: Command | undefined) => {
    if (!command) return;
    closeDialog();
    command.run();
  };

  const onKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActive((i) => Math.min(shown.length - 1, i + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((i) => Math.max(0, i - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      run(shown[active]);
    }
  };

  return (
    <Modal title="ძებნა" onClose={closeDialog}>
      <input
        className="search command-input"
        autoFocus
        value={query}
        onChange={(e) => {
          setQuery(e.target.value);
          setActive(0);
        }}
        onKeyDown={onKey}
        placeholder="მაგ. ნაშთი, ხაზვა, 90*300…"
      />
      <div className="command-list" role="listbox">
        {shown.length === 0 && <div className="empty">ვერაფერი მოიძებნა.</div>}
        {shown.map((c, i) => (
          <button
            key={c.id}
            type="button"
            role="option"
            aria-selected={i === active}
            className={`command-item${i === active ? ' on' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => run(c)}
          >
            <span>{c.label}</span>
            {c.hint && <small>{c.hint}</small>}
          </button>
        ))}
      </div>
    </Modal>
  );
}
