import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { categoryLabel } from '../data/categories';
import { totalStock } from '../lib/inventory';
import { PiecePreview } from './ShapeSvg';
import { Icon } from './Icon';

/** Inspector for the current selection — one piece in detail, or a group summary. */
export function DetailsPanel() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const rotateSelected = useEditorStore((s) => s.rotateSelected);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const duplicateSelected = useEditorStore((s) => s.duplicateSelected);
  const openDialog = useEditorStore((s) => s.openDialog);
  const canManage = useCanManageCatalog();

  const selectedPieces = useMemo(
    () => pieces.filter((p) => selectedIds.includes(p.id)),
    [pieces, selectedIds],
  );

  if (!selectedPieces.length) {
    return (
      <div className="empty">
        მონიშნე ელემენტი დეტალების სანახავად.
        <br />
        <br />
        ცარიელ ადგილას თრევით მონიშნავ რამდენიმეს ერთდროულად; <kbd>Shift</kbd>+დაწკაპუნება
        ამატებს ან აკლებს.
      </div>
    );
  }

  const actions = (
    <div className="row-actions">
      <button className="btn small" onClick={() => rotateSelected(90)} title="მარჯვნივ 90°"><Icon name="rotate-cw" /> 90°
      </button>
      <button className="btn small" onClick={() => rotateSelected(-90)} title="მარცხნივ 90°"><Icon name="rotate-ccw" /> 90°
      </button>
      <button className="btn small" onClick={duplicateSelected}><Icon name="copy" /> დუბლირება
      </button>
      <button className="btn small" onClick={() => openDialog({ kind: 'array' })}><Icon name="array" /> მასივი
      </button>
      <button className="btn small danger" onClick={deleteSelected}><Icon name="trash" /> წაშლა
      </button>
    </div>
  );

  // ── Group summary ─────────────────────────────────────────────────────────
  if (selectedPieces.length > 1) {
    const counts = new Map<string, number>();
    for (const p of selectedPieces) counts.set(p.materialId, (counts.get(p.materialId) ?? 0) + 1);

    return (
      <div className="details">
        <div className="kv">
          <span className="k">მონიშნულია</span>
          <b>{selectedPieces.length} ელემენტი</b>
        </div>
        {[...counts.entries()].map(([materialId, n]) => {
          const m = materials.find((x) => x.id === materialId);
          if (!m) return null;
          return (
            <div className="kv" key={materialId}>
              <span className="k">{m.name}</span>
              <span>{n}</span>
            </div>
          );
        })}
        {actions}
      </div>
    );
  }

  // ── Single piece ──────────────────────────────────────────────────────────
  const piece = selectedPieces[0];
  const material = materials.find((m) => m.id === piece.materialId);
  if (!material) return <div className="empty">მასალა კატალოგში ვერ მოიძებნა.</div>;

  return (
    <div className="details">
      <div className="details-preview">
        <PiecePreview material={material} box={84} />
      </div>

      <div className="kv">
        <span className="k">დასახელება</span>
        <b>{material.name}</b>
      </div>
      <div className="kv">
        <span className="k">კატეგორია</span>
        <span>{categoryLabel(material.category)}</span>
      </div>
      <div className="kv">
        <span className="k">ზომა</span>
        <span>
          {material.w} × {material.h} სმ
        </span>
      </div>
      <div className="kv">
        <span className="k">კოორდინატი</span>
        <span>
          {Math.round(piece.x)}, {Math.round(piece.y)}
        </span>
      </div>
      <div className="kv">
        <span className="k">მოტრიალება</span>
        <RotationField rot={piece.rot} />
      </div>
      <div className="kv">
        <span className="k">მარაგი</span>
        <span>{totalStock(material)} ცალი</span>
      </div>
      {material.weight > 0 && (
        <div className="kv">
          <span className="k">წონა</span>
          <span>{material.weight} კგ</span>
        </div>
      )}

      {actions}
      <button
        className="btn small full"
        style={{ marginTop: 6 }}
        disabled={!canManage}
        title={canManage ? undefined : ADMIN_ONLY_TITLE}
        onClick={() => openDialog({ kind: 'material', materialId: material.id })}
      ><Icon name="pencil" /> კომპონენტის რედაქტირება
      </button>
    </div>
  );
}

/** Exact angle for the selection: any degree, not just quarter turns. */
function RotationField({ rot }: { rot: number }) {
  const setRotation = useEditorStore((s) => s.setRotation);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(Math.round(rot * 10) / 10);

  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) setRotation(n);
    setDraft(null);
  };

  return (
    <span className="rot-field">
      <input
        type="number"
        step={1}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      <span className="deg">°</span>
      <input
        className="rot-slider"
        type="range"
        min={0}
        max={359}
        step={1}
        value={Math.round(rot)}
        onChange={(e) => setRotation(Number(e.target.value))}
      />
    </span>
  );
}
