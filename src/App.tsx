import { useEffect } from 'react';
import { useEditorStore } from './store/useEditorStore';
import { combo } from './lib/platform';
import { Header } from './components/Header';
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
import { TemplatesDialog } from './components/TemplatesDialog';
import { WarehousesDialog } from './components/WarehousesDialog';
import { TitleBlockDialog } from './components/TitleBlockDialog';
import { UsersDialog } from './components/UsersDialog';
import { ErrorLogDialog } from './components/ErrorLogDialog';
import { PasswordDialog } from './components/PasswordDialog';
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

  return (
    <div className="app">
      <Header />

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

      <footer className="footer">
        <span>
          <kbd>თრევა</kbd> გადაადგილება
        </span>
        <span>
          <kbd>R</kbd> მოტრიალება
        </span>
        <span>
          <kbd>{combo(['del'])}</kbd> წაშლა
        </span>
        <span>
          <kbd>{combo(['mod', 'Z'])}</kbd> დაბრუნება
        </span>
        <span>
          <kbd>{combo(['mod', 'D'])}</kbd> დუბლირება
        </span>
        <span>
          <kbd>ისრები</kbd> გადაწევა
        </span>
        <span>
          <kbd>{combo(['shift'])}</kbd>+კლიკი — მონიშვნის დამატება
        </span>
        <span>
          <kbd>Alt</kbd>+კლიკი — ქვედა ელემენტის მონიშვნა
        </span>
        <span>
          <kbd>Space</kbd>+თრევა ან შუა ღილაკი — ხედის გადაწევა
        </span>
        <span>
          <kbd>ორი თითი</kbd> ხედის გადაწევა
        </span>
        <span>
          <kbd>{combo(['mod'])}</kbd>+სქროლი ან პინჩი — მასშტაბი
        </span>
      </footer>

      {dialog?.kind === 'material' && (
        <MaterialFormDialog key={dialog.materialId ?? 'new'} materialId={dialog.materialId} />
      )}
      {dialog?.kind === 'sheet-import' && <SheetImportDialog />}
      {dialog?.kind === 'array' && <ArrayDialog />}
      {dialog?.kind === 'documents' && <DocumentsDialog />}
      {dialog?.kind === 'column-wizard' && <ColumnWizardDialog />}
      {dialog?.kind === 'wall-wizard' && <WallWizardDialog />}
      {dialog?.kind === 'templates' && <TemplatesDialog />}
      {dialog?.kind === 'warehouses' && <WarehousesDialog />}
      {dialog?.kind === 'title-block' && <TitleBlockDialog />}
      {dialog?.kind === 'users' && <UsersDialog />}
      {dialog?.kind === 'errors' && <ErrorLogDialog />}
      {dialog?.kind === 'password' && <PasswordDialog />}
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
