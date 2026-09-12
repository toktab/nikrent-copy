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

  const selectedSketches = useEditorStore((s) =>
    s.sketch.filter((k) => s.selectedSketchIds.includes(k.id)),
  );

  // A drawn run is a selection too, and until it could be measured and filled
  // from here, picking one put nothing at all in the inspector. Several at once
  // is the normal case for a building — a layout is a few runs that meet — and
  // that used to fall through to the empty state with no way to fill any of it.
  if (!selectedPieces.length && selectedSketches.length === 1) {
    return <SketchDetails path={selectedSketches[0]} />;
  }
  if (!selectedPieces.length && selectedSketches.length > 1) {
    return <SketchGroupDetails paths={selectedSketches} />;
  }

  if (!selectedPieces.length) {
    return (
      <div className="empty">
        მონიშნე ელემენტი დეტალების სანახავად.
        <br />
        <br />
        ცარიელ ადგილას თრევით მონიშნავ რამდენიმეს ერთდროულად; <kbd>Shift</kbd> + დაწკაპუნება
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
        <PositionField x={piece.x} y={piece.y} />
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
/**
 * Opens the ranked ways to fill what is selected, beside the drawing. The
 * selection stays as it is, so the recommendations are for exactly these lines.
 */
function RecommendButton() {
  return (
    <button
      className="btn small"
      title="საუკეთესო ვარიანტები - როგორ შეივსოს ეს ხაზი"
      onClick={() => {
        const s = useEditorStore.getState();
        s.setInspectorOpen(true);
        s.setInspectorTab('recommend');
      }}
    >
      <Icon name="sliders" /> რეკომენდაცია
    </button>
  );
}

function SketchDetails({ path }: { path: SketchPath }) {
  const openDialog = useEditorStore((s) => s.openDialog);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const part = useEditorStore((s) => s.selectedSketchPart);
  const closeSketchPath = useEditorStore((s) => s.closeSketchPath);
  const setSketchPerimeter = useEditorStore((s) => s.setSketchPerimeter);
  const legs = segments(path);
  const perimeter = path.perimeter ?? 'outer';
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
      {/* Which face of the pour this line is, and so which side the panels
          stand on. Nothing in the coordinates says it, and getting it wrong
          builds the whole run inside the concrete. */}
      <div className="kv">
        <span className="k">პერიმეტრი</span>
        <span className="pen-face">
          {(
            [
              ['outer', 'გარე', 'ბეტონი ხაზის შიგნითაა - პანელები გარეთ დგება'],
              ['inner', 'შიდა', 'ბეტონი ხაზის გარეთაა - პანელები შიგნით დგება'],
            ] as const
          ).map(([face, label, why]) => (
            <button
              key={face}
              className={`btn small${perimeter === face ? ' engaged' : ''}`}
              onClick={() => setSketchPerimeter([path.id], face)}
              aria-pressed={perimeter === face}
              title={why}
            >
              {label}
            </button>
          ))}
        </span>
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
          onClick={() => openDialog({ kind: 'sketch-fill', pathIds: [path.id] })}
        >
          <Icon name="wall" /> შევსება ყალიბით
        </button>
        <RecommendButton />
        {/* Joining the two ends after the fact. Drawing back onto the first
            point closes a run as it is drawn, but a run that was finished open
            had no way back to a loop short of redrawing it. */}
        {path.points.length > 2 && (
          <button
            className="btn small"
            onClick={() => closeSketchPath(path.id, !closed)}
            title={
              closed
                ? 'ბოლო წერტილი აღარ შეუერთდება პირველს'
                : 'ბოლო წერტილი შეუერთდება პირველს და კონტური ჩაიკეტება'
            }
          >
            <Icon name={closed ? 'close' : 'check'} />{' '}
            {closed ? 'კონტურის გახსნა' : 'ბოლოების შეერთება'}
          </button>
        )}
        <button className="btn small danger" onClick={deleteSelected}>
          <Icon name="trash" /> წაშლა
        </button>
      </div>

      {closed && (
        <p className="hint-note">
          ჩაკეტილ კონტურში მონაკვეთის სიგრძის აკრეფა შეუძლებელია - ცვლილებას სხვაგან
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
        title="მიმართულება - 0° აღმოსავლეთით, საათის ისრის მიმართულებით"
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

/**
 * Several drawn runs at once — the shape of a real layout.
 *
 * A building is a few runs that happen to meet, so this is the selection people
 * actually have when they want the formwork for it. Filling them one at a time
 * meant retyping the same thickness and height for each and adding the
 * summaries up by hand, and until now the inspector showed nothing here at all.
 */
function SketchGroupDetails({ paths }: { paths: SketchPath[] }) {
  const openDialog = useEditorStore((s) => s.openDialog);
  const deleteSelected = useEditorStore((s) => s.deleteSelected);
  const total = paths.reduce((sum, p) => sum + pathLength(p), 0);
  const legs = paths.reduce((sum, p) => sum + segments(p).length, 0);
  const turns = paths.reduce(
    (sum, p) => sum + Math.max(0, segments(p).length - (p.closed ? 0 : 1)),
    0,
  );

  return (
    <div className="details">
      <div className="kv">
        <span className="k">მონიშნულია</span>
        <b>{paths.length} ხაზი</b>
      </div>
      <div className="kv">
        <span className="k">სულ სიგრძე</span>
        <b>{Math.round(total)} სმ</b>
      </div>
      <div className="kv">
        <span className="k">მონაკვეთი</span>
        <span>
          {legs} · {turns} კუთხე
        </span>
      </div>

      <div className="row-actions">
        <button
          className="btn small primary"
          onClick={() => openDialog({ kind: 'sketch-fill', pathIds: paths.map((p) => p.id) })}
        >
          <Icon name="wall" /> შევსება ყალიბით
        </button>
        <RecommendButton />
        <button className="btn small danger" onClick={deleteSelected}>
          <Icon name="trash" /> წაშლა
        </button>
      </div>

      <p className="hint-note">
        თითოეული ხაზი ცალკე იწყობა - კუთხე მხოლოდ იქ ჩნდება, სადაც ერთი ხაზი
        უხვევს, და არა იქ, სადაც ორი ხაზი ერთმანეთს ხვდება. ცალკე მონაკვეთის
        ზომებისთვის მონიშნე ერთი ხაზი.
      </p>
    </div>
  );
}

/**
 * Exactly where a piece sits, typed.
 *
 * Rotation and elevation could both be typed and this could not, which left the
 * most ordinary precise instruction there is — move it a centimetre, so the
 * leftover beside it becomes a size the catalog stocks — with no way to say it.
 * Dragging cannot: a snap that is right nearly always is wrong exactly when the
 * point is to sit just off something.
 */
function PositionField({ x, y }: { x: number; y: number }) {
  const setPosition = useEditorStore((s) => s.setPosition);
  const [draft, setDraft] = useState<{ x: string; y: string } | null>(null);
  const shown = draft ?? {
    x: String(Math.round(x * 10) / 10),
    y: String(Math.round(y * 10) / 10),
  };

  const commit = (next: { x: string; y: string }) => {
    const nx = Number(next.x.replace(',', '.'));
    const ny = Number(next.y.replace(',', '.'));
    if (Number.isFinite(nx) && Number.isFinite(ny)) setPosition(nx, ny);
    setDraft(null);
  };

  const field = (axis: 'x' | 'y') => (
    <input
      type="number"
      step="any"
      value={shown[axis]}
      onChange={(e) => setDraft({ ...shown, [axis]: e.target.value })}
      onBlur={(e) => commit({ ...shown, [axis]: e.target.value })}
      onWheel={keepWheelOffNumber}
      onKeyDown={(e) => {
        if (e.key === 'Enter') commit({ ...shown, [axis]: (e.target as HTMLInputElement).value });
      }}
    />
  );

  return (
    <span className="leg-fields">
      <span className="rot-field">{field('x')}</span>
      <span className="rot-field">
        {field('y')}
        <span className="deg">სმ</span>
      </span>
    </span>
  );
}
