import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { buildBom } from '../lib/bom';
import {
  exportCatalogFile,
  exportLayoutFile,
  parseCatalogFile,
  parseLayoutFile,
} from '../lib/catalogFile';
import { isLegacyBritania, legacyBritaniaToV1, schemaToSketchPaths } from '../lib/detectImport';
import type { LegacyDetectedDoc } from '../lib/detection/types';
import { pickFile, readFileAsText } from '../lib/files';
import { isConfigured } from '../lib/supabase';
import { materialIdsOnServer } from '../lib/repo';
import { combo, overrideLabel } from '../lib/platform';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { VIEW_HINT, VIEW_LABEL, VIEW_ORDER } from '../lib/projection';
import { BrandMark } from './BrandMark';
import { PresenceBar } from './PresenceBar';
import { SyncBadge } from './SyncBadge';
import { ProfileMenu } from './ProfileMenu';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Tooltip } from './Tooltip';
import { Icon } from './Icon';

/**
 * Grid steps that match the catalog.
 *
 * The panels are 30 / 45 / 60 / 75 / 90 cm, whose common module is 15. The old
 * list offered 10 and 25: a 25 cm grid lands only one of the five panel widths
 * on a grid line, and 10 lands three. Both spent most of their time pulling
 * panels off the joints they were supposed to butt against.
 */
const SNAP_STEPS = [5, 15, 30];

/**
 * Snapping, as one choice rather than two independent switches.
 *
 * Edge is the default and very nearly always the right answer: formwork is not
 * laid out on a grid, it is parts butting against parts, and an absolute grid
 * stops being true the moment a 24 cm corner or a 5 cm filler enters the run —
 * everything after it sits permanently off-grid. The grid earns its place for
 * one job only, setting the first pieces out on the building's axes.
 */
type SnapMode = 'edge' | 'grid' | 'off';
const SNAP_LABEL: Record<SnapMode, string> = {
  edge: 'კიდეზე',
  grid: 'ბადეზე',
  off: 'გამორთ.',
};

const SNAP_HINT: Record<SnapMode, string> = {
  edge: 'პანელები ეკვრება მეზობლის კიდეს - ფორმვორკისთვის ეს სჭირდება',
  grid: 'ბადეზეც და კიდეზეც - ღერძებზე გასატანად',
  off: 'თავისუფალი განთავსება',
};

export function Header() {
  const snap = useEditorStore((s) => s.snap);
  const snapStep = useEditorStore((s) => s.snapStep);
  const zoom = useEditorStore((s) => s.zoom);
  const showLengths = useEditorStore((s) => s.showLengths);
  const pdfVisibility = useEditorStore((s) => s.pdfVisibility);
  const measureHelper = useEditorStore((s) => s.measureStyle.helper);
  const setMeasureStyle = useEditorStore((s) => s.setMeasureStyle);
  const showNames = useEditorStore((s) => s.showNames);
  const forceLabels = useEditorStore((s) => s.forceLabels);
  const edgeSnap = useEditorStore((s) => s.edgeSnap);
  const showOverlaps = useEditorStore((s) => s.showOverlaps);
  const showGaps = useEditorStore((s) => s.showGaps);
  const tool = useEditorStore((s) => s.tool);
  const showSketch = useEditorStore((s) => s.showSketch);
  const viewMode = useEditorStore((s) => s.viewMode);
  const surfaceView = useEditorStore((s) => s.surfaceView);
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const sketch = useEditorStore((s) => s.sketch);
  const measures = useEditorStore((s) => s.measures);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const canUndo = useEditorStore((s) => s.past.length > 0);
  const canRedo = useEditorStore((s) => s.future.length > 0);
  const documents = useEditorStore((s) => s.documents);
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const warehouses = useEditorStore((s) => s.warehouses);
  const storageError = useEditorStore((s) => s.storageError);

  const setSnap = useEditorStore((s) => s.setSnap);
  const setSnapStep = useEditorStore((s) => s.setSnapStep);
  const setShowNames = useEditorStore((s) => s.setShowNames);
  const setForceLabels = useEditorStore((s) => s.setForceLabels);
  const setEdgeSnap = useEditorStore((s) => s.setEdgeSnap);
  const setShowOverlaps = useEditorStore((s) => s.setShowOverlaps);
  const setShowGaps = useEditorStore((s) => s.setShowGaps);
  const setTool = useEditorStore((s) => s.setTool);
  const penPerimeter = useEditorStore((s) => s.penPerimeter);
  const setPenPerimeter = useEditorStore((s) => s.setPenPerimeter);
  const setShowSketch = useEditorStore((s) => s.setShowSketch);
  const setViewMode = useEditorStore((s) => s.setViewMode);
  const setSurfaceView = useEditorStore((s) => s.setSurfaceView);
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
  const activeDoc = documents.find((d) => d.id === activeDocId);

  // Two booleans, one choice. Grid keeps edge snapping on underneath it —
  // within 8 screen pixels of a neighbour you always want the joint, whatever
  // the grid says, and there is no reading of "grid, and also let panels miss
  // each other by 3 cm" that anyone wants.
  const snapMode: SnapMode = snap ? 'grid' : edgeSnap ? 'edge' : 'off';
  const setSnapMode = (mode: SnapMode) => {
    setSnap(mode === 'grid');
    setEdgeSnap(mode !== 'off');
  };

  /** Scaled, dimensioned drawing sheet with the title block. */
  const printDrawing = async () => {
    const doc = documents.find((d) => d.id === activeDocId);
    if (!doc || !pieces.length) return;
    setPrinting(true);
    try {
      const { exportDrawingToPdf } = await import('../lib/drawingPdf');
      // The sheet prints what the screen shows: a layout hidden on screen is
      // one the user has decided is not part of this drawing any more.
      const result = exportDrawingToPdf({
        doc: { ...doc, pieces, sketch: showSketch ? doc.sketch : [] },
        materials,
        showSketch,
        visibility: pdfVisibility,
      });
      if (!result) setToast('ნახაზი ცარიელია.');
      else if (result.rescaled) {
        setToast(`ნახაზი არ ეტეოდა 1:${doc.scale}-ში - დაიბეჭდა 1:${result.scale} მასშტაბით.`);
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
      const text = await readFileAsText(file);
      const data = JSON.parse(text);

      // Check if this is a detection JSON (LegacyDetectedDoc) first.
      if (isLegacyBritania(data)) {
        const doc = data as LegacyDetectedDoc;
        const schema = legacyBritaniaToV1(doc, doc.source?.pdf || file.name);
        const sketchPaths = schemaToSketchPaths(schema);
        if (!sketchPaths.length) {
          setToast('დეტექციის ფაილში ელემენტები არ მოიძებნა.');
          return;
        }
        const apply = () => {
          useEditorStore.getState().appendSketch(sketchPaths);
          useEditorStore.getState().fitToContent();
          setToast(`დეტექციიდან ${sketchPaths.length} მონახაზი ჩაიტვირთა.`);
        };
        if (pieces.length || useEditorStore.getState().sketch.length) {
          openDialog({
            kind: 'confirm',
            title: 'დეტექციის იმპორტი',
            message: `მიმდინარე მონახაზს დაემატება ${sketchPaths.length} ელემენტი დეტექციიდან. გავაგრძელო?`,
            confirmLabel: 'დამატება',
            onConfirm: apply,
          });
        } else {
          apply();
        }
        return;
      }

      // Otherwise, a drawing file. It opens as a drawing of its own, so there
      // is nothing on screen to overwrite and nothing to confirm.
      const parsed = parseLayoutFile(text);

      // With a server, a material this screen lacks may already be there -
      // created by someone else since this tab loaded. Adding the file's older
      // copy would overwrite theirs, so the import waits for a reload instead.
      if (isConfigured) {
        const local = new Set(materials.map((m) => m.id));
        const missing = [...new Set(parsed.pieces.map((p) => p.materialId))].filter(
          (id) => !local.has(id),
        );
        const onServer = await materialIdsOnServer(missing);
        if (onServer.size) {
          setToast(
            `ფაილის ${onServer.size} მასალა სერვერზე უკვე არსებობს, ეს ეკრანი ძველია - გადატვირთე გვერდი და ისევ შემოიტანე.`,
          );
          return;
        }
      }

      const result = useEditorStore.getState().importDrawing(parsed, {
        // Without a server there is no one else's catalog to protect.
        addMissingMaterials: canManage || !isConfigured,
      });

      if (!result.created) {
        setToast(
          'ნახაზი ვერ ჩაიტვირთა - ფაილის მასალები ამ კატალოგში არ არის. ჯერ კატალოგი დააიმპორტე.',
        );
        return;
      }
      useEditorStore.getState().fitToContent();

      const name = parsed.meta.name || file.name;
      const report = [
        `„${name}“ ჩაიტვირთა ახალ ნახაზად: ${result.added} ელემენტი, ${parsed.sketch.length} ხაზი, ${parsed.measures.length} ზომა.`,
      ];
      if (result.addedMaterials) {
        report.push(`კატალოგს დაემატა ${result.addedMaterials} მასალა.`);
      }
      if (result.droppedPieces) {
        report.push(
          `${result.droppedPieces} ელემენტი გამოტოვდა - მასალა კატალოგში არ არის, ადმინისტრატორმა დაამატოს.`,
        );
      }
      if (result.mismatched) {
        report.push(`${result.mismatched} მასალის ზომა ამ კატალოგში განსხვავდება - დარჩა ადგილობრივი.`);
      }
      setToast(report.join(' '));
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

  /** Admin-only controls say what they would do and why they can't. */
  const gate = (label: string) => (canManage ? undefined : label);

  return (
    <header className="header">
      {/* ── row 1: what you are looking at, and who else is ─────────────── */}
      <div className="row row-top">
        <div className="row-left">
          <BrandMark size={22} />
          <span className="sep" />

          <Menu
            trigger={(open) => (
              <button className={`doc-pick${open ? ' open' : ''}`} title="მიმდინარე ნახაზი">
                <span className="doc-pick-name">{activeDoc?.name ?? 'ნახაზი'}</span>
                <span className="doc-pick-count">{activeDoc?.pieces.length ?? 0}</span>
                <Icon name="chevron-down" size={14} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>ნახაზები</MenuLabel>
                {documents.map((d) => (
                  <MenuItem
                    key={d.id}
                    on={d.id === activeDocId}
                    trail={d.pieces.length || undefined}
                    onClick={() => {
                      switchDocument(d.id);
                      close();
                    }}
                  >
                    {d.name}
                  </MenuItem>
                ))}
                <MenuSep />
                <MenuItem
                  icon="folder"
                  onClick={() => {
                    openDialog({ kind: 'documents' });
                    close();
                  }}
                >
                  ნახაზების მართვა…
                </MenuItem>
              </>
            )}
          </Menu>
        </div>

        <div className="seg" role="group" aria-label="ხედი">
          {VIEW_ORDER.map((v) => (
            <button
              key={v}
              className={viewMode === '2d' && surfaceView === v ? 'on' : undefined}
              aria-pressed={viewMode === '2d' && surfaceView === v}
              onClick={() => {
                setViewMode('2d');
                setSurfaceView(v);
              }}
              title={VIEW_HINT[v]}
            >
              {VIEW_LABEL[v]}
            </button>
          ))}
          <button
            className={viewMode === '3d' ? 'on' : undefined}
            aria-pressed={viewMode === '3d'}
            onClick={() => setViewMode('3d')}
            title="სივრცითი ხედი - რედაქტირებადი"
          >
            3D
          </button>
        </div>

        <div className="row-right">
          {/* Everything that is used once a session rather than once a minute.
              These eleven actions used to be a permanent second toolbar. */}
          <Menu
            align="right"
            trigger={(open) => (
              <button
                className={`btn icon ghost${open ? ' active' : ''}`}
                aria-label="ნახაზისა და კატალოგის მოქმედებები"
              >
                <Icon name="more" size={17} />
              </button>
            )}
          >
            {(close) => (
              <>
                <MenuLabel>ნახაზი</MenuLabel>
                <MenuItem
                  icon="sheet"
                  onClick={() => {
                    openDialog({ kind: 'title-block' });
                    close();
                  }}
                >
                  შტამპი…
                </MenuItem>
                <MenuItem
                  icon="print"
                  disabled={!pieces.length || printing}
                  onClick={() => {
                    void printDrawing();
                    close();
                  }}
                >
                  {printing ? 'იბეჭდება…' : 'ბეჭდვა (PDF)'}
                </MenuItem>
                <MenuItem
                  icon="download"
                  // A drawing of lines alone is still a drawing worth taking along.
                  disabled={!pieces.length && !sketch.length && !measures.length}
                  onClick={() => {
                    // The live mirrors, not the stored copy, so the file holds
                    // exactly what is on screen this instant.
                    if (activeDoc) {
                      exportLayoutFile({ ...activeDoc, pieces, sketch, measures }, materials);
                    }
                    close();
                  }}
                >
                  ნახაზის ექსპორტი
                </MenuItem>
                <MenuItem
                  icon="upload"
                  onClick={() => {
                    void importLayout();
                    close();
                  }}
                >
                  ნახაზის იმპორტი
                </MenuItem>
                <MenuItem
                  icon="trash"
                  danger
                  disabled={!pieces.length}
                  onClick={() => {
                    clearAll();
                    close();
                  }}
                >
                  ზედაპირის გასუფთავება
                </MenuItem>

                <MenuSep />
                <MenuLabel>კატალოგი</MenuLabel>
                <MenuItem
                  icon="download"
                  onClick={() => {
                    exportCatalogFile(materials, warehouses);
                    close();
                  }}
                >
                  კატალოგის ექსპორტი
                </MenuItem>
                <MenuItem
                  icon="upload"
                  disabled={!canManage}
                  title={gate(ADMIN_ONLY_TITLE)}
                  onClick={() => {
                    void importCatalog();
                    close();
                  }}
                >
                  კატალოგის იმპორტი
                </MenuItem>
                <MenuItem
                  icon="reset"
                  danger
                  disabled={!canManage}
                  title={gate(ADMIN_ONLY_TITLE)}
                  onClick={() => {
                    resetCatalog();
                    close();
                  }}
                >
                  ჩაშენებული კატალოგის აღდგენა
                </MenuItem>
              </>
            )}
          </Menu>

          <SyncBadge />
          <PresenceBar />
          {/* The divider belongs to the account menu, not to the row: without a
              server there is no account, and a rule floating on its own at the
              right edge reads as a rendering fault. */}
          <ProfileMenu />
        </div>
      </div>

      {/* ── row 2: what you do to it ────────────────────────────────────── */}
      <div className="row row-tools">
        <Tooltip label="დაბრუნება" reason={combo(['mod', 'Z'])}>
          <button className="btn icon ghost" onClick={undo} disabled={!canUndo} aria-label="დაბრუნება">
            <Icon name="undo" size={17} />
          </button>
        </Tooltip>
        <Tooltip label="გამეორება" reason={combo(['mod', 'shift', 'Z'])}>
          <button className="btn icon ghost" onClick={redo} disabled={!canRedo} aria-label="გამეორება">
            <Icon name="redo" size={17} />
          </button>
        </Tooltip>

        <span className="sep" />

        <Menu
          trigger={(open) => (
            <button className={`btn${open ? ' active' : ''}`} title={SNAP_HINT[snapMode]}>
              <Icon name="grid" /> მიბმა: <b>{SNAP_LABEL[snapMode]}</b>
              {snapMode === 'grid' && <span className="snap-step">{snapStep} სმ</span>}
              <Icon name="chevron-down" size={12} />
            </button>
          )}
        >
          {(close) => (
            <>
              <MenuLabel>მიბმა</MenuLabel>
              {(['edge', 'grid', 'off'] as SnapMode[]).map((mode) => (
                <MenuItem
                  key={mode}
                  on={mode === snapMode}
                  title={SNAP_HINT[mode]}
                  onClick={() => {
                    setSnapMode(mode);
                    if (mode !== 'grid') close();
                  }}
                >
                  {SNAP_LABEL[mode]}
                </MenuItem>
              ))}
              {/* Only when there is a grid to have a step. */}
              {snapMode === 'grid' && (
                <>
                  <MenuSep />
                  <MenuLabel>ბადის ბიჯი</MenuLabel>
                  {SNAP_STEPS.map((s) => (
                    <MenuItem
                      key={s}
                      on={s === snapStep}
                      onClick={() => {
                        setSnapStep(s);
                        close();
                      }}
                    >
                      {s} სმ
                      {/* The one step every panel width divides into. */}
                      {s === 15 && <span className="menu-note">პანელის მოდული</span>}
                    </MenuItem>
                  ))}
                </>
              )}
            </>
          )}
        </Menu>

        <Menu
          trigger={(open) => (
            <button className={`btn icon${open ? ' active' : ''}`} aria-label="ხედის პარამეტრები">
              <Icon name="sliders" size={16} />
            </button>
          )}
        >
          <>
            <MenuItem
              icon="eye"
              onClick={() => openDialog({ kind: 'display-settings' })}
              title="რა ზომა როდის ჩანდეს - ეკრანზე და PDF-ში"
            >
              ზომების ჩვენება…
            </MenuItem>
            <MenuSep />
            <MenuLabel>წარწერები</MenuLabel>
            <MenuItem on={showNames} onClick={() => setShowNames(!showNames)}>
              სახელები
            </MenuItem>
            <MenuItem
              on={forceLabels}
              onClick={() => setForceLabels(!forceLabels)}
              title="წარწერები არ დაიმალოს ძალიან პატარა/დაშორებულ ხედზეც"
            >
              ყოველთვის
            </MenuItem>
            <MenuSep />
            <MenuItem
              on={showSketch}
              onClick={() => setShowSketch(!showSketch)}
              title="დახაზული გეგმის ჩვენება - გამორთვისას არც ჩანს, არც ებმება"
            >
              მონახაზი
            </MenuItem>

            <MenuSep />
            <MenuLabel>შემოწმება</MenuLabel>
            {/* Edge snapping used to live here as a third toggle. It is the
                snap control now — it was never a display option. */}
            <MenuItem
              on={showOverlaps}
              onClick={() => setShowOverlaps(!showOverlaps)}
              title="გადაფარებული ელემენტების მონიშვნა"
            >
              გადაფარება
            </MenuItem>
            <MenuItem
              on={showGaps}
              onClick={() => setShowGaps(!showGaps)}
              title="ყველა ღია ნაპრალი ნახაზზე - შეკვეთამდე შესამოწმებლად"
            >
              ყველა ნაპრალი
            </MenuItem>
          </>
        </Menu>

        {/* Which lengths show, on screen and on paper - its own menu, because it
            is a table of choices rather than a switch. */}
        <Tooltip
          label="ზომების ჩვენება"
          reason={`რა ზომა როდის ჩანდეს - ეკრანზე და PDF-ში · D - ${showLengths ? 'ყველა ზომის დამალვა' : 'ზომების ჩვენება'}`}
        >
          <button
            className={`btn icon${showLengths ? '' : ' engaged'}`}
            onClick={() => openDialog({ kind: 'display-settings' })}
            aria-label="ზომების ჩვენება"
          >
            <Icon name="eye" size={16} />
          </button>
        </Tooltip>

        <span className="sep" />

        {/* Draw the layout first, fill it with formwork after. Grouped with the
            wizards because it is the same kind of thing: a way of getting a
            whole wall onto the drawing rather than a panel at a time. */}
        <Tooltip
          label="ხაზვა - გეგმის მონახაზი"
          reason={
            surfaceView === 'plan'
              ? `G - ხაზვა, Shift + G - შიდა პერიმეტრი, V - არჩევა · სწორი კუთხეები; ${overrideLabel()} - თავისუფალი კუთხე. Enter - დასრულება`
              : 'მხოლოდ გეგმაზე - მონახაზი გეგმის ხაზებია'
          }
        >
          <button
            className={`btn${tool === 'pen' ? ' engaged' : ''}`}
            onClick={() => setTool(tool === 'pen' ? 'select' : 'pen')}
            disabled={viewMode === '3d' || surfaceView !== 'plan'}
            aria-pressed={tool === 'pen'}
          >
            <Icon name="pen" /> <span className="btn-label">ხაზვა</span>
          </button>
        </Tooltip>

        {/* Which face of the pour is being drawn. Only while the pen is out,
            because with the pen away it is a setting for nothing — and while
            the pen IS out it is the one thing about the next line that the
            coordinates will not record. */}
        {tool === 'pen' && (
          <span className="pen-face" role="group" aria-label="პერიმეტრი">
            {(
              [
                ['outer', 'გარე', 'ბეტონი ხაზის შიგნითაა - პანელები გარეთ დგება'],
                ['inner', 'შიდა', 'ბეტონი ხაზის გარეთაა - პანელები შიგნით დგება'],
              ] as const
            ).map(([face, label, why]) => (
              <button
                key={face}
                className={`btn small${penPerimeter === face ? ' engaged' : ''}`}
                onClick={() => setPenPerimeter(face)}
                aria-pressed={penPerimeter === face}
                title={why}
              >
                {label}
              </button>
            ))}
          </span>
        )}

        {/* Measuring sits beside drawing because it is the same kind of act:
            setting a line out against what is already there. */}
        <Tooltip
          label="გაზომვა - ზომის ხაზი"
          reason={
            surfaceView === 'plan'
              ? 'M - გაზომვა · მიიტანე კედელთან ან პანელთან, დააჭირე, მერე მეორე წერტილზე · Shift - 15° კუთხეები · Esc - გაუქმება'
              : 'მხოლოდ გეგმაზე'
          }
        >
          <button
            className={`btn${tool === 'measure' ? ' engaged' : ''}`}
            onClick={() => setTool(tool === 'measure' ? 'select' : 'measure')}
            disabled={viewMode === '3d' || surfaceView !== 'plan'}
            aria-pressed={tool === 'measure'}
          >
            <Icon name="ruler" /> <span className="btn-label">გაზომვა</span>
          </button>
        </Tooltip>
        {tool === 'measure' && (
          <span className="pen-face" role="group" aria-label="გაზომვის დამხმარე">
            {/* The helper can be wrong about one particular line; this is the
                way to place that one by hand. */}
            <button
              className={`btn small${measureHelper ? ' engaged' : ''}`}
              onClick={() => setMeasureStyle({ helper: !measureHelper })}
              aria-pressed={measureHelper}
              title={
                measureHelper
                  ? 'დამხმარე ჩართულია: კედლის/პანელის აღმოჩენა, შეთავაზება, მაგნიტი. H - გამორთვა · Alt - დროებით'
                  : 'დამხმარე გამორთულია: თავისუფალი ხაზი. H - ჩართვა'
              }
            >
              <Icon name="magnet" size={14} /> {measureHelper ? 'დამხმარე' : 'თავისუფალი'}
            </button>
            <button
              className="btn icon small"
              onClick={() => openDialog({ kind: 'display-settings' })}
              title="ზომების ჩვენება და ზომის ხაზის პარამეტრები"
              aria-label="ზომების ჩვენება და ზომის ხაზის პარამეტრები"
            >
              <Icon name="sliders" size={14} />
            </button>
          </span>
        )}

        <button
          className="btn raised"
          onClick={() => openDialog({ kind: 'column-wizard' })}
          title="კოლონის ავტომატური აწყობა"
        >
          <Icon name="column" /> <span className="btn-label">კოლონა</span>
        </button>
        <button
          className="btn raised"
          onClick={() => openDialog({ kind: 'wall-wizard' })}
          title="კედლის ავტომატური აწყობა"
        >
          <Icon name="wall" /> <span className="btn-label">კედელი</span>
        </button>
        <button
          className="btn"
          onClick={() => openDialog({ kind: 'templates' })}
          title="შენახული შაბლონები - მონიშნულის შენახვა და ჩასმა"
        >
          <Icon name="copy" /> <span className="btn-label">შაბლონი</span>
        </button>

        <span className="sep" />

        {/* Act on the selection. Disabled with nothing selected, and each one
            says so rather than just going grey. */}
        <Tooltip
          label="მოტრიალება 90°"
          reason={hasSelection ? 'R · ზუსტი კუთხე „დეტალებში“' : 'ჯერ მონიშნე ელემენტი'}
        >
          <button
            className="btn icon ghost"
            onClick={() => rotateSelected(90)}
            disabled={!hasSelection}
            aria-label="მოტრიალება 90°"
          >
            <Icon name="rotate-cw" size={17} />
          </button>
        </Tooltip>
        <Tooltip
          label="დუბლირება"
          reason={hasSelection ? combo(['mod', 'D']) : 'ჯერ მონიშნე ელემენტი'}
        >
          <button
            className="btn icon ghost"
            onClick={duplicateSelected}
            disabled={!hasSelection}
            aria-label="დუბლირება"
          >
            <Icon name="copy" size={17} />
          </button>
        </Tooltip>
        <Tooltip
          label="მასივი"
          reason={hasSelection ? 'ასლების გამრავლება ბადეზე' : 'ჯერ მონიშნე ელემენტი'}
        >
          <button
            className="btn icon ghost"
            onClick={() => openDialog({ kind: 'array' })}
            disabled={!hasSelection}
            aria-label="მასივი"
          >
            <Icon name="array" size={17} />
          </button>
        </Tooltip>
        <Tooltip
          label="წაშლა"
          reason={hasSelection ? combo(['del']) : 'ჯერ მონიშნე ელემენტი'}
        >
          <button
            className="btn icon ghost danger"
            onClick={deleteSelected}
            disabled={!hasSelection}
            aria-label="წაშლა"
          >
            <Icon name="trash" size={17} />
          </button>
        </Tooltip>

        <span className="flex-spacer" />

        <div className="zoom-group">
          <button
            className="btn icon small"
            onClick={() => zoomBy(1 / 1.2)}
            aria-label="დაშორება"
            title="დაშორება"
          >
            <Icon name="minus" size={15} />
          </button>
          <span className="zoomlabel">{Math.round(zoom * 100)}%</span>
          <button
            className="btn icon small"
            onClick={() => zoomBy(1.2)}
            aria-label="მიახლოება"
            title="მიახლოება"
          >
            <Icon name="plus" size={15} />
          </button>
          <button
            className="btn icon ghost"
            onClick={fitToContent}
            aria-label="ნახაზის ჩატევა ეკრანზე"
            title="ჩატევა"
          >
            <Icon name="fit" size={16} />
          </button>
        </div>
      </div>

      {storageError && (
        <div className="storage-banner">
          <Icon name="warning" /> {storageError}
        </div>
      )}
      {shortages > 0 && <ShortageBar count={shortages} />}
    </header>
  );
}

/**
 * Inventory cannot cover the drawing. This is the one number the yard cares
 * about, so it gets a line of its own under the toolbar rather than a badge
 * competing for space inside it.
 */
function ShortageBar({ count }: { count: number }) {
  const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);
  const setInspectorTab = useEditorStore((s) => s.setInspectorTab);
  return (
    <div className="shortage-bar">
      <span className="badge shortage">დეფიციტი</span>
      <span>
        <b>{count}</b> კომპონენტს მარაგი არ ჰყოფნის ამ ნახაზისთვის.
      </span>
      <button
        className="btn small"
        onClick={() => {
          setInspectorOpen(true);
          setInspectorTab('bom');
        }}
      >
        უწყისში ნახვა
      </button>
    </div>
  );
}
