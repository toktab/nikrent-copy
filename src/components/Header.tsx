import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import {
  exportCatalogFile,
  exportLayoutFile,
  parseCatalogFile,
  parseLayoutFile,
} from '../lib/catalogFile';
import { pickFile, readFileAsText } from '../lib/files';
import { combo } from '../lib/platform';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { PresenceBar } from './PresenceBar';
import { SyncBadge } from './SyncBadge';
import { ProfileMenu } from './ProfileMenu';

const SNAP_STEPS = [1, 5, 10, 25];

export function Header() {
  const snap = useEditorStore((s) => s.snap);
  const snapStep = useEditorStore((s) => s.snapStep);
  const zoom = useEditorStore((s) => s.zoom);
  const showDims = useEditorStore((s) => s.showDims);
  const showNames = useEditorStore((s) => s.showNames);
  const forceLabels = useEditorStore((s) => s.forceLabels);
  const edgeSnap = useEditorStore((s) => s.edgeSnap);
  const showOverlaps = useEditorStore((s) => s.showOverlaps);
  const viewMode = useEditorStore((s) => s.viewMode);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const warehouses = useEditorStore((s) => s.warehouses);
  const storageError = useEditorStore((s) => s.storageError);

  const setSnap = useEditorStore((s) => s.setSnap);
  const setSnapStep = useEditorStore((s) => s.setSnapStep);
  const setShowDims = useEditorStore((s) => s.setShowDims);
  const setShowNames = useEditorStore((s) => s.setShowNames);
  const setForceLabels = useEditorStore((s) => s.setForceLabels);
  const setEdgeSnap = useEditorStore((s) => s.setEdgeSnap);
  const setShowOverlaps = useEditorStore((s) => s.setShowOverlaps);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const undo = useEditorStore((s) => s.undo);
  const redo = useEditorStore((s) => s.redo);
  const zoomBy = useEditorStore((s) => s.zoomBy);
  const fitToContent = useEditorStore((s) => s.fitToContent);
  const switchDocument = useEditorStore((s) => s.switchDocument);
  const openDialog = useEditorStore((s) => s.openDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const canManage = useCanManageCatalog();

  const shortages = useMemo(
    () => buildBom(materials, pieces).shortageCount,
    [materials, pieces],
  );
  const hasSelection = selectedIds.length > 0;
  const [printing, setPrinting] = useState(false);

  /** Scaled, dimensioned drawing sheet with the title block. */
  const printDrawing = async () => {
    const doc = documents.find((d) => d.id === activeDocId);
    if (!doc || !pieces.length) return;
    setPrinting(true);
    try {
      const { exportDrawingToPdf } = await import('../lib/drawingPdf');
      const result = exportDrawingToPdf({ doc: { ...doc, pieces }, materials });
      if (!result) setToast('ნახაზი ცარიელია.');
      else if (result.rescaled) {
        setToast(`ნახაზი არ ეტეოდა 1:${doc.scale}-ში — დაიბეჭდა 1:${result.scale} მასშტაბით.`);
      }
    } catch (e) {
      setToast(`ბეჭდვა ვერ მოხერხდა: ${(e as Error).message}`);
    } finally {
      setPrinting(false);
    }
  };

  // ── file actions ──────────────────────────────────────────────────────────
  const importCatalog = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const {
        materials: incoming,
        warehouses: incomingWarehouses,
        skipped,
      } = parseCatalogFile(await readFileAsText(file));
      openDialog({
        kind: 'confirm',
        title: 'კატალოგის იმპორტი',
        message: `ფაილში ${incoming.length} მასალაა${skipped ? ` (${skipped} სტრიქონი გამოტოვდა)` : ''}. ეს ჩაანაცვლებს მიმდინარე კატალოგს და მარაგებს. გავაგრძელო?`,
        confirmLabel: 'ჩანაცვლება',
        onConfirm: () => {
          const dropped = useEditorStore.getState().replaceCatalog(incoming, incomingWarehouses);
          setToast(
            dropped > 0
              ? `კატალოგი ჩაიტვირთა. ${dropped} ელემენტი წაიშალა (მასალა აღარ არსებობს).`
              : 'კატალოგი ჩაიტვირთა.',
          );
        },
      });
    } catch (e) {
      setToast(`კატალოგის წაკითხვა ვერ მოხერხდა: ${(e as Error).message}`);
    }
  };

  const importLayout = async () => {
    const file = await pickFile('application/json,.json');
    if (!file) return;
    try {
      const incoming = parseLayoutFile(await readFileAsText(file));
      const known = new Set(materials.map((m) => m.id));
      const usable = incoming.filter((p) => known.has(p.materialId));
      const dropped = incoming.length - usable.length;

      if (!usable.length) {
        setToast(
          'ნახაზი ვერ ჩაიტვირთა — ფაილის მასალები ამ კატალოგში არ არის. ჯერ კატალოგი დააიმპორტე.',
        );
        return;
      }

      const apply = () => {
        useEditorStore.getState().replaceLayout(usable);
        useEditorStore.getState().fitToContent();
        setToast(
          dropped > 0
            ? `ნახაზი ჩაიტვირთა (${usable.length}). ${dropped} ელემენტი გამოტოვდა — მასალა კატალოგში არ არის.`
            : `ნახაზი ჩაიტვირთა (${usable.length} ელემენტი).`,
        );
      };

      // Never silently overwrite a drawing that is already on the surface.
      if (pieces.length) {
        openDialog({
          kind: 'confirm',
          title: 'ნახაზის იმპორტი',
          message: `მიმდინარე ნახაზი (${pieces.length} ელემენტი) ჩანაცვლდება ფაილის ${usable.length} ელემენტით. გავაგრძელო?`,
          confirmLabel: 'ჩანაცვლება',
          onConfirm: apply,
        });
      } else {
        apply();
      }
    } catch (e) {
      setToast(`ნახაზის წაკითხვა ვერ მოხერხდა: ${(e as Error).message}`);
    }
  };

  const clearAll = () => {
    if (!pieces.length) return;
    openDialog({
      kind: 'confirm',
      title: 'ზედაპირის გასუფთავება',
      message: `ყველა ელემენტი (${pieces.length}) წაიშალოს ზედაპირიდან? კატალოგი და მარაგები რჩება.`,
      confirmLabel: 'გასუფთავება',
      danger: true,
      onConfirm: () => useEditorStore.getState().clearPieces(),
    });
  };

  const resetCatalog = () => {
    openDialog({
      kind: 'confirm',
      title: 'კატალოგის აღდგენა',
      message:
        'კატალოგი დაუბრუნდება 41 ჩაშენებულ Du მასალას. ყველა დამატებული კომპონენტი და შეყვანილი მარაგი წაიშლება. გავაგრძელო?',
      confirmLabel: 'აღდგენა',
      danger: true,
      onConfirm: () => {
        useEditorStore.getState().resetCatalog();
        setToast('კატალოგი აღდგა.');
      },
    });
  };

  return (
    <header className="header">
      <div className="bar bar-main">
        <h1>
          <span>Du</span> ფორმვორკი
        </h1>

        <div className="doc-picker">
          <select
            value={activeDocId}
            onChange={(e) => switchDocument(e.target.value)}
            title="მიმდინარე ნახაზი"
          >
            {documents.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name} ({d.pieces.length})
              </option>
            ))}
          </select>
          <button
            className="btn small"
            onClick={() => openDialog({ kind: 'documents' })}
            title="ნახაზების მართვა"
          >
            ნახაზები…
          </button>
          <PresenceBar />
        </div>

        <div className="view-switch" role="group" aria-label="ხედი">
          <button
            className={`btn small${viewMode === '2d' ? ' active' : ''}`}
            onClick={() => setViewMode('2d')}
            title="გეგმა — რედაქტირებადი"
          >
            2D
          </button>
          <button
            className={`btn small${viewMode === '3d' ? ' active' : ''}`}
            onClick={() => setViewMode('3d')}
            title="სივრცითი ხედი — მხოლოდ სანახავად"
          >
            3D
          </button>
        </div>

        {shortages > 0 && (
          <span className="shortage-badge" title="კომპონენტი, რომლის მარაგიც არ ჰყოფნის">
            ⚠ დეფიციტი: {shortages}
          </span>
        )}

        <div className="toolbar">
          <button className="btn" onClick={undo} disabled={!canUndo} title={`დაბრუნება (${combo(['mod', 'Z'])})`}>
            ↩
          </button>
          <button className="btn" onClick={redo} disabled={!canRedo} title={`გამეორება (${combo(['mod', 'shift', 'Z'])})`}>
            ↪
          </button>

          <span className="sep" />

          <button
            className={`btn${snap ? ' active' : ''}`}
            onClick={() => setSnap(!snap)}
            title="ბადეზე მიბმა"
          >
            ⊞ მიბმა: <b>{snap ? 'ჩართ.' : 'გამ.'}</b>
          </button>
          <select
            value={snapStep}
            onChange={(e) => setSnapStep(Number(e.target.value))}
            title="ბადის ბიჯი"
          >
            {SNAP_STEPS.map((s) => (
              <option key={s} value={s}>
                {s} სმ
              </option>
            ))}
          </select>

          <span className="sep" />

          <button
            className="btn"
            onClick={() => openDialog({ kind: 'column-wizard' })}
            title="კოლონის ავტომატური აწყობა"
          >
            🏛 კოლონა
          </button>

          <span className="sep" />

          <button
            className="btn"
            onClick={() => rotateSelected(90)}
            disabled={!hasSelection}
            title="მოტრიალება 90° (R). ზუსტი კუთხე — „დეტალები“ ჩანართში."
          >
            ⟳ 90°
          </button>
          <button
            className="btn"
            onClick={duplicateSelected}
            disabled={!hasSelection}
            title={`დუბლირება (${combo(['mod', 'D'])})`}
          >
            ⧉
          </button>
          <button
            className="btn"
            onClick={() => openDialog({ kind: 'array' })}
            disabled={!hasSelection}
            title="მასივი — ასლების გამრავლება"
          >
            ⋮⋮ მასივი
          </button>
          <button
            className="btn danger"
            onClick={deleteSelected}
            disabled={!hasSelection}
            title={`წაშლა (${combo(['del'])})`}
          >
            🗑
          </button>

          <span className="sep" />

          <button className="btn" onClick={() => zoomBy(1 / 1.2)}>
            −
          </button>
          <span className="zoomlabel">{Math.round(zoom * 100)}%</span>
          <button className="btn" onClick={() => zoomBy(1.2)}>
            ＋
          </button>
          <button className="btn" onClick={fitToContent} title="ჩატევა">
            ⤢ ცენტრი
          </button>
        </div>

        <div className="header-right">
          <SyncBadge />
          <ProfileMenu />
        </div>
      </div>

      <div className="bar bar-sub">
        <div className="toolbar left">
          <span className="group-label">წარწერები</span>
          <button
            className={`btn small${showDims ? ' active' : ''}`}
            onClick={() => setShowDims(!showDims)}
            title="ყველა ელემენტზე ზომის ჩვენება"
          >
            ზომები
          </button>
          <button
            className={`btn small${showNames ? ' active' : ''}`}
            onClick={() => setShowNames(!showNames)}
          >
            სახელები
          </button>
          <button
            className={`btn small${forceLabels ? ' active' : ''}`}
            onClick={() => setForceLabels(!forceLabels)}
            title="წარწერები არ დაიმალოს ძალიან პატარა/დაშორებულ ხედზეც"
          >
            ყოველთვის
          </button>

          <span className="sep" />
          <span className="group-label">დახმარება</span>
          <button
            className={`btn small${edgeSnap ? ' active' : ''}`}
            onClick={() => setEdgeSnap(!edgeSnap)}
            title="მიბმა მეზობელი ელემენტის კიდეზე — პანელები ზუსტად ეკვრება ერთმანეთს"
          >
            კიდეზე მიბმა
          </button>
          <button
            className={`btn small${showOverlaps ? ' active' : ''}`}
            onClick={() => setShowOverlaps(!showOverlaps)}
            title="გადაფარებული ელემენტების მონიშვნა"
          >
            გადაფარება
          </button>

        </div>

        <div className="toolbar">
          <span className="group-label">კატალოგი</span>
          <button
            className="btn small"
            onClick={() => exportCatalogFile(materials, warehouses)}
            title="მასალები, ფასები და მარაგები ერთ ფაილად — სარეზერვო ასლი და სხვა კომპიუტერზე გადატანა"
          >
            ⤓ ექსპორტი
          </button>
          <button
            className="btn small"
            disabled={!canManage}
            onClick={() => void importCatalog()}
            title={
              canManage
                ? 'ადრე შენახული კატალოგის ფაილის ჩატვირთვა (ჩაანაცვლებს მიმდინარეს)'
                : ADMIN_ONLY_TITLE
            }
          >
            ⤒ იმპორტი
          </button>
          <button
            className="btn small danger"
            disabled={!canManage}
            onClick={resetCatalog}
            title={
              canManage
                ? '41 ჩაშენებული Du მასალის დაბრუნება — დამატებული კომპონენტები და მარაგები წაიშლება'
                : ADMIN_ONLY_TITLE
            }
          >
            აღდგენა
          </button>

          <span className="sep" />

          <span className="group-label">ნახაზი</span>
          <button
            className="btn small"
            onClick={() => openDialog({ kind: 'title-block' })}
            title="ობიექტი, რევიზია, მასშტაბი"
          >
            შტამპი…
          </button>
          <button
            className="btn small"
            onClick={printDrawing}
            disabled={!pieces.length || printing}
            title="მასშტაბური ნახაზი შტამპით (PDF)"
          >
            {printing ? '…' : '🖨 ბეჭდვა'}
          </button>
          <button
            className="btn small"
            onClick={() => exportLayoutFile(pieces)}
            disabled={!pieces.length}
            title="მიმდინარე ნახაზი ფაილად — არქივი ან კოლეგისთვის გასაგზავნად"
          >
            ⤓ ექსპორტი
          </button>
          <button
            className="btn small"
            onClick={() => void importLayout()}
            title="ნახაზის ფაილის ჩატვირთვა (ჩაანაცვლებს მიმდინარე ნახაზს)"
          >
            ⤒ იმპორტი
          </button>
          <button
            className="btn small danger"
            onClick={clearAll}
            disabled={!pieces.length}
            title="ყველა ელემენტის წაშლა ზედაპირიდან — კატალოგი და მარაგები რჩება"
          >
            გასუფთავება
          </button>
        </div>
      </div>

      {storageError && <div className="storage-banner">⚠ {storageError}</div>}
    </header>
  );
}
