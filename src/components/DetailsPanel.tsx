import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ADMIN_ONLY_TITLE, useCanManageCatalog } from '../store/useAuthStore';
import { categoryLabel } from '../data/categories';
import { totalStock } from '../lib/inventory';
import { PiecePreview } from './ShapeSvg';
import { Icon } from './Icon';
import { legAngle, legLength, pathLength, segments } from '../lib/sketch';
import { keepWheelOffNumber } from '../lib/numberField';
import type { SketchPath } from '../types';

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

  const selectedSketch = useEditorStore((s) =>
    s.selectedSketchIds.length === 1
      ? (s.sketch.find((k) => k.id === s.selectedSketchIds[0]) ?? null)
      : null,
  );

  // A drawn run is a selection too, and until it could be measured and filled
  // from here, picking one put nothing at all in the inspector.
  if (!selectedPieces.length && selectedSketch) {
    return <SketchDetails path={selectedSketch} />;
  }

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

    // Stacked courses sit exactly on top of each other in plan, so without
    // this a selection of four levels looks identical to one.
    const levels = [...new Set(selectedPieces.map((p) => Math.round(p.z ?? 0)))].sort(
      (a, b) => a - b,
    );

    return (
      <div className="details">
        <div className="kv">
          <span className="k">მონიშნულია</span>
          <b>{selectedPieces.length} ელემენტი</b>
        </div>
        <div className="kv">
          <span className="k">სიმაღლე ძირიდან</span>
          <span>
            {levels.length === 1
              ? `${levels[0]} სმ`
              : `${levels.length} რიგი · ${levels[0]}–${levels[levels.length - 1]} სმ`}
          </span>
        </div>
        <div className="kv">
          <span className="k">გადაწევა სიმაღლეზე</span>
          <NudgeElevation />
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
        <span className="k">სიმაღლე ძირიდან</span>
        <ElevationField z={piece.z ?? 0} />
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

/**
 * Elevation of the piece's underside.
 *
 * The plan cannot show this — two pieces at different heights occupy the same
 * footprint — so this field and the 3D view are the only places a stack is
 * visible at all. Committed on blur and Enter like the rotation field, so
 * typing "300" does not pass through 3, then 30.
 */
function ElevationField({ z }: { z: number }) {
  const setElevation = useEditorStore((s) => s.setElevation);
  const snapStep = useEditorStore((s) => s.snapStep);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(Math.round(z * 10) / 10);

  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) setElevation(n);
    setDraft(null);
  };

  return (
    <span className="rot-field">
      <input
        type="number"
        step={snapStep}
        min={0}
        value={value}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      <span className="deg">სმ</span>
    </span>
  );
}

/**
 * Raising a mixed selection has to be relative — setting one elevation on four
 * courses would collapse them into each other.
 */
function NudgeElevation() {
  const nudgeElevation = useEditorStore((s) => s.nudgeElevation);
  const snapStep = useEditorStore((s) => s.snapStep);
  const step = Math.max(1, snapStep);

  return (
    <span className="row-actions" style={{ marginTop: 0 }}>
      <button
        className="btn small"
        onClick={() => nudgeElevation(step)}
        title={`ყველა მონიშნული ${step} სმ-ით მაღლა`}
      >
        <Icon name="arrow-up" /> +{step}
      </button>
      <button
        className="btn small"
        onClick={() => nudgeElevation(-step)}
        title={`ყველა მონიშნული ${step} სმ-ით დაბლა`}
      >
        <Icon name="arrow-down" /> −{step}
      </button>
    </span>
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

/**
 * A drawn run: what it measures, and what to do with it.
 *
 * The legs are listed because a layout is specified leg by leg — "the north
 * wall is 4.27 m" — and dragging cannot land on 427 however carefully it is
 * done. Reading them back is half the value; typing over one is the other half.
 */
function SketchDetails({ path }: { path: SketchPath }) {
  const openDialog = useEditorStore((s) => s.openDialog);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const part = useEditorStore((s) => s.selectedSketchPart);
  const legs = segments(path);
  const closed = !!path.closed && path.points.length > 2;
  const picked = part?.pathId === path.id && part.kind === 'leg' ? part.index : null;

  return (
    <div className="details">
      <div className="kv">
        <span className="k">მონიშნულია</span>
        <b>{closed ? 'ჩაკეტილი კონტური' : 'ხაზი'}</b>
      </div>
      <div className="kv">
        <span className="k">სულ სიგრძე</span>
        <b>{Math.round(pathLength(path))} სმ</b>
      </div>
      {part?.pathId === path.id && part.kind === 'vertex' && (
        <div className="kv">
          <span className="k">კვანძი</span>
          <b>
            #{part.index + 1} · {Math.round(path.points[part.index]?.x ?? 0)},{' '}
            {Math.round(path.points[part.index]?.y ?? 0)}
          </b>
        </div>
      )}
      <div className="kv">
        <span className="k">მონაკვეთი</span>
        <span>
          {legs.length} · {legs.length > 1 ? `${legs.length - (closed ? 0 : 1)} კუთხე` : 'სწორი'}
        </span>
      </div>

      <div className="leg-list">
        {legs.map(([a, b], i) => (
          <div className={`kv${picked === i ? ' picked' : ''}`} key={i}>
            <span className="k">{i + 1}.</span>
            <span className="leg-fields">
              <LegField pathId={path.id} index={i} cm={legLength(a, b)} locked={closed} />
              {/* The bearing, typed. Dragging can put a wall at roughly forty
                  degrees; only a field can put it at forty. */}
              <AngleField pathId={path.id} index={i} deg={legAngle(a, b)} locked={closed} />
            </span>
          </div>
        ))}
      </div>

      <div className="row-actions">
        <button
          className="btn small primary"
          onClick={() => openDialog({ kind: 'sketch-fill', pathId: path.id })}
        >
          <Icon name="wall" /> შევსება ყალიბით
        </button>
        <button className="btn small danger" onClick={deleteSelected}>
          <Icon name="trash" /> წაშლა
        </button>
      </div>

      {closed && (
        <p className="hint-note">
          ჩაკეტილ კონტურში მონაკვეთის სიგრძის აკრეფა შეუძლებელია — ცვლილებას სხვაგან
          წასასვლელი არ აქვს და კონტური იშლება. გადაათრიე მონაკვეთი ნახაზზე.
        </p>
      )}
    </div>
  );
}

/** One leg's length, typed. Committed on blur and Enter, like the others. */
function LegField({
  pathId,
  index,
  cm,
  locked,
}: {
  pathId: string;
  index: number;
  cm: number;
  locked: boolean;
}) {
  const setLegLength = useEditorStore((s) => s.setLegLength);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(Math.round(cm * 10) / 10);

  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n) && n > 0) setLegLength(pathId, index, n);
    setDraft(null);
  };

  return (
    <span className="rot-field">
      <input
        type="number"
        min={1}
        step="any"
        value={value}
        disabled={locked}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onWheel={keepWheelOffNumber}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      <span className="deg">სმ</span>
    </span>
  );
}

/** One leg's bearing in degrees, typed. Committed on blur and Enter. */
function AngleField({
  pathId,
  index,
  deg,
  locked,
}: {
  pathId: string;
  index: number;
  deg: number;
  locked: boolean;
}) {
  const setLegAngle = useEditorStore((s) => s.setLegAngle);
  const [draft, setDraft] = useState<string | null>(null);
  const value = draft ?? String(deg);

  const commit = (raw: string) => {
    const n = Number(raw.replace(',', '.'));
    if (Number.isFinite(n)) setLegAngle(pathId, index, n);
    setDraft(null);
  };

  return (
    <span className="rot-field">
      <input
        type="number"
        step="any"
        value={value}
        disabled={locked}
        title="მიმართულება — 0° აღმოსავლეთით, საათის ისრის მიმართულებით"
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => commit(e.target.value)}
        onWheel={keepWheelOffNumber}
        onKeyDown={(e) => {
          if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
        }}
      />
      <span className="deg">°</span>
    </span>
  );
}
