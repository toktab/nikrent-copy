import { useEffect } from 'react';
import { useEditorStore } from './store/useEditorStore';
import { legacyBritaniaToV1, schemaToSketchPaths } from './lib/detectImport';
import type { LegacyDetectedDoc } from './lib/detection/types';
import { Header } from './components/Header';
import { StatusBar } from './components/StatusBar';
import { OfflineBanner } from './components/OfflineBanner';
import { SyncBanner } from './components/SyncBanner';
import { Palette } from './components/Palette';
import { StageCanvas } from './components/StageCanvas';
import { View3D } from './components/View3D';
import { SidePanel } from './components/SidePanel';
import { MaterialFormDialog } from './components/MaterialFormDialog';
import { SheetImportDialog } from './components/SheetImportDialog';
import { ConfirmDialog } from './components/ConfirmDialog';
import { ArrayDialog } from './components/ArrayDialog';
import { DocumentsDialog } from './components/DocumentsDialog';
import { ColumnWizardDialog } from './components/ColumnWizardDialog';
import { WallWizardDialog } from './components/WallWizardDialog';
import { SketchFillDialog } from './components/SketchFillDialog';
import { TemplatesDialog } from './components/TemplatesDialog';
import { WarehousesDialog } from './components/WarehousesDialog';
import { TitleBlockDialog } from './components/TitleBlockDialog';
import { UsersDialog } from './components/UsersDialog';
import { ErrorLogDialog } from './components/ErrorLogDialog';
import { PasswordDialog } from './components/PasswordDialog';
import { DisplaySettingsDialog } from './components/DisplaySettingsDialog';
import { Icon } from './components/Icon';

export default function App() {
  const dialog = useEditorStore((s) => s.dialog);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const toast = useEditorStore((s) => s.toast);
  const setToast = useEditorStore((s) => s.setToast);
  const viewMode = useEditorStore((s) => s.viewMode);
  const paletteOpen = useEditorStore((s) => s.paletteOpen);
  const inspectorOpen = useEditorStore((s) => s.inspectorOpen);
  const setPaletteOpen = useEditorStore((s) => s.setPaletteOpen);
  const setInspectorOpen = useEditorStore((s) => s.setInspectorOpen);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 5000);
    return () => clearTimeout(t);
  }, [toast, setToast]);

  // Import detection results from /detection page via sessionStorage.
  // Runs after data has loaded to avoid hydrateFromServer overwriting the paths.
  const dataLoaded = useEditorStore((s) => s.dataLoaded);
  useEffect(() => {
    if (!dataLoaded) return;
    const raw = sessionStorage.getItem('detect-import');
    if (!raw) return;
    try {
      const doc: LegacyDetectedDoc = JSON.parse(raw);
      const schema = legacyBritaniaToV1(doc, doc.source?.pdf);
      const paths = schemaToSketchPaths(schema);
      // Through the store's own action, so the lines land in the drawing that
      // is saved and synced, and one undo takes the whole import back out.
      useEditorStore.getState().appendSketch(paths);
      setToast(`დეტექციიდან ${paths.length} მონახაზი ჩაიტვირთა.`);
    } catch (e) {
      setToast('დეტექციის შედეგების ჩატვირთვა ვერ მოხერხდა.');
    } finally {
      sessionStorage.removeItem('detect-import');
    }
  }, [dataLoaded]);

  return (
    <div className="app">
      <Header />
      <SyncBanner />
      <OfflineBanner />

      <div className="body">
        {paletteOpen ? (
          <Palette />
        ) : (
          <button
            className="rail rail-left"
            onClick={() => setPaletteOpen(true)}
            title="მასალების პანელი"
          ><Icon name="chevron-right" /> მასალები
          </button>
        )}

        {viewMode === '3d' ? <View3D /> : <StageCanvas />}

        {inspectorOpen ? (
          <SidePanel />
        ) : (
          <button
            className="rail rail-right"
            onClick={() => setInspectorOpen(true)}
            title="უწყისი და მარაგი"
          ><Icon name="chevron-left" /> უწყისი
          </button>
        )}
      </div>

      <StatusBar />

      {dialog?.kind === 'material' && (
        <MaterialFormDialog key={dialog.materialId ?? 'new'} materialId={dialog.materialId} />
      )}
      {dialog?.kind === 'sheet-import' && <SheetImportDialog />}
      {dialog?.kind === 'array' && <ArrayDialog />}
      {dialog?.kind === 'documents' && <DocumentsDialog />}
      {dialog?.kind === 'column-wizard' && <ColumnWizardDialog />}
      {dialog?.kind === 'wall-wizard' && <WallWizardDialog />}
      {dialog?.kind === 'sketch-fill' && <SketchFillDialog pathIds={dialog.pathIds} />}
      {dialog?.kind === 'templates' && <TemplatesDialog />}
      {dialog?.kind === 'warehouses' && <WarehousesDialog />}
      {dialog?.kind === 'title-block' && <TitleBlockDialog />}
      {dialog?.kind === 'users' && <UsersDialog />}
      {dialog?.kind === 'errors' && <ErrorLogDialog />}
      {dialog?.kind === 'password' && <PasswordDialog />}
      {dialog?.kind === 'display-settings' && <DisplaySettingsDialog />}
      {dialog?.kind === 'confirm' && (
        <ConfirmDialog
          title={dialog.title}
          message={dialog.message}
          confirmLabel={dialog.confirmLabel}
          danger={dialog.danger}
          onConfirm={dialog.onConfirm}
          onCancel={closeDialog}
        />
      )}

      {toast && (
        <div className="toast" onClick={() => setToast(null)}>
          {toast}
        </div>
      )}
    </div>
  );
}
