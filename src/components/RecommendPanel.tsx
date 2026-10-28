import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { useStockView } from '../store/useStockView';
import { freeStock, stockEntered } from '../lib/fillOptions';
import { MAX_WALL_CM } from '../lib/sketchFill';
import { segments } from '../lib/sketch';
import {
  enclosed,
  legsForOffset,
  offsetFace,
  offsetSide,
  panelSide,
  piecesOnLines,
  towardsLabel,
} from '../lib/outerLines';
import type { Material, Piece, SketchPath } from '../types';
import { findRods } from '../lib/bolts';
import {
  solveLayout,
  wallMates,
  type LayoutFilters,
  type LayoutVariant,
  type OverhangEnds,
  type WallSummary,
} from '../lib/layoutSolver';

/** Panel widths offered as on/off chips, widest first (R2). */
const WIDTHS = [90, 75, 60, 45, 30];

const OVERHANG_LABEL: Record<OverhangEnds, string> = {
  none: 'ხაზის ბოლოს არ გასცდეს',
  both: 'გასცდეს ორივე ბოლოში',
  start: 'გასცდეს დასაწყისში',
  end: 'გასცდეს ბოლოში',
};

const MAX_OVERHANG = [15, 30, 45, 60, 90, 150, 300];

/**
 * The ranked ways to fill what is selected, as whole layouts.
 *
 * The layout solver (`lib/layoutSolver`, `docs/LAYOUT-SOLVER.md`) fills every
 * selected line together the way the architect does by hand: outside corners
 * lapped, both faces of a wall carrying the same panels, fillers against the
 * corners, faces allowed past their line where that saves a piece. Each card
 * is one whole answer; pointing at it shows it faint on the drawing, clicking
 * picks it, one button builds it as one undo step.
 */
export function RecommendPanel({
  active = true,
}: {
  /** false while it is kept mounted but hidden: nothing is previewed on the drawing */
  active?: boolean;
} = {}) {
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);
  const pieces = useEditorStore((s) => s.pieces);
  const selectedSketchIds = useEditorStore((s) => s.selectedSketchIds);
  const filters = useEditorStore((s) => s.layoutFilters);
  const setLayoutFilters = useEditorStore((s) => s.setLayoutFilters);
  const applyLayout = useEditorStore((s) => s.applyLayout);
  const setRecommendPreview = useEditorStore((s) => s.setRecommendPreview);
  const setToast = useEditorStore((s) => s.setToast);

  const selected = useMemo(
    () => sketch.filter((k) => selectedSketchIds.includes(k.id)),
    [sketch, selectedSketchIds],
  );

  /**
   * What a picked closed line has inside it, and what it sits inside. The outer line of a wall picked
   * alone still has to be solved against the inner face it goes round - its
   * panels are the ones the outer face must match - so whatever lines are
   * inside it come into the suggestion with it, built pieces and all.
   */
  const inside = useMemo(() => {
    const lines = new Set<string>();
    const around = new Set<string>();
    let count = 0;
    const flagged: string[] = [];
    for (const path of selected) {
      const found = enclosed(path, sketch, pieces, materials);
      found.lines.forEach((id) => lines.add(id));
      count += found.pieces;
      // Something inside it means the concrete is inside it: a გარე line.
      if ((found.lines.length || found.pieces) && path.perimeter === 'inner') flagged.push(path.id);
    }
    // ...and every other face of the walls picked - inside or round it, open or
    // closed: a wall is filled as one thing, or its joints do not line up and
    // no შტირი goes through (`wallMates`).
    wallMates(sketch, selected.map((p) => p.id)).forEach((id) => around.add(id));
    for (const path of selected) {
      lines.delete(path.id);
      around.delete(path.id);
    }
    for (const id of around) lines.delete(id);
    return { lines: [...lines], around: [...around], pieces: count, flagged };
  }, [selected, sketch, pieces, materials]);

  const paths = useMemo(
    () => [...selected, ...sketch.filter((k) => inside.lines.includes(k.id) || inside.around.includes(k.id))],
    [selected, sketch, inside],
  );

  // Opened at the job's remembered height and corners, and remembering any
  // change for the next fill - see `lib/fillDefaults`.
  const [height, setHeight] = useState(() => {
    const saved = useEditorStore.getState().fillDefaults;
    return String(saved && saved.height > 0 ? saved.height : 300);
  });
  const [includeCorners, setIncludeCorners] = useState(
    () => useEditorStore.getState().fillDefaults?.includeCorners ?? true,
  );
  useEffect(() => {
    const h = Number(String(height).replace(',', '.'));
    if (Number.isFinite(h) && h > 0) useEditorStore.getState().setFillDefaults({ height: h, includeCorners });
  }, [height, includeCorners]);

  const [picked, setPicked] = useState(0);
  const [hover, setHover] = useState<number | null>(null);
  const h = Number(String(height).replace(',', '.'));

  const setFilter = <K extends keyof LayoutFilters>(key: K, value: LayoutFilters[K]) => {
    setLayoutFilters({ ...filters, [key]: value });
    setPicked(0); // a new order means #1 is a different answer
  };
  const toggle = (key: 'excludeWidths' | 'spareWidths', w: number) =>
    setFilter(key, filters[key].includes(w) ? filters[key].filter((x) => x !== w) : [...filters[key], w]);

  // Stock only means something once it has been entered; see `stockEntered`.
  // Counted the way the ნაშთი sheet counts it: less what the other active
  // drawings hold, and not at all for an unimportant drawing.
  const view = useStockView();
  const hasStock = useMemo(() => stockEntered(materials) && !view.unlimited, [materials, view]);
  const free = useMemo(
    () => (hasStock ? freeStock(materials, pieces, view) : undefined),
    [hasStock, materials, pieces, view],
  );

  const result = useMemo(
    () =>
      paths.length && h > 0
        ? solveLayout({
            paths,
            height: h,
            includeCorners,
            materials,
            pieces,
            free,
            filters: { ...filters, useStock: filters.useStock && hasStock },
            limit: 8,
          })
        : null,
    [paths, h, includeCorners, materials, pieces, free, filters, hasStock],
  );
  const variants = result?.variants ?? [];
  const chosen = Math.min(picked, Math.max(0, variants.length - 1));
  /**
   * How many შტირი spots each variant leaves the drawing with - the thing the
   * two faces are matched for, counted the way the ჭანჭიკები menu counts it.
   */
  const rodSpots = useMemo(() => {
    const byId = new Map(materials.map((m) => [m.id, m]));
    return variants.map((v) => {
      const gone = new Set(v.remove);
      return findRods([...pieces.filter((p) => !gone.has(p.id)), ...v.add], byId).length;
    });
  }, [variants, pieces, materials]);

  // What is picked - or pointed at - shown faint on the drawing.
  useEffect(() => {
    if (!active || !variants.length) {
      setRecommendPreview(null);
      return;
    }
    setRecommendPreview(variants[hover ?? chosen]?.add ?? null);
  }, [active, variants, hover, chosen, setRecommendPreview]);

  // Leaving the tab, or the panel, takes the ghost with it.
  useEffect(() => () => setRecommendPreview(null), [setRecommendPreview]);

  if (!paths.length) {
    return (
      <div className="empty">
        მონიშნე ხაზვის ხაზები - ერთი კედელი, შიდა და გარე ხაზი ერთად, ან მთელი ნახაზი - და აქ
        გამოჩნდება, რა ვარიანტებით ჯობია შევსება, საუკეთესოდან დაწყებული.
      </div>
    );
  }

  const apply = () => {
    const variant = variants[chosen];
    if (!variant) return;
    const done = applyLayout(variant.add, variant.remove);
    setRecommendPreview(null);
    setToast(
      !done.added
        ? 'ყალიბი ვერ აიწყო - შეამოწმე კატალოგი და ზომები.'
        : done.removed
          ? `დაემატა ${done.added} ელემენტი, შეიცვალა ${done.removed}.`
          : `დაემატა ${done.added} ელემენტი.`,
    );
  };

  return (
    <div className="rec">
      <div className="rec-controls">
        <label className="field">
          <span>სიმაღლე (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={height}
            onChange={(e) => {
              setHeight(e.target.value);
              setPicked(0);
            }}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={includeCorners} onChange={(e) => setIncludeCorners(e.target.checked)} />
          <span>შიდა კუთხის პროფილები</span>
        </label>
        <label className="check-row" title="ხაზზე უკვე მდგომი ელემენტები რჩება და ვარიანტები მათ გარშემო იწყობა; გამორთულზე - იცვლება">
          <input
            type="checkbox"
            checked={filters.keepPlaced}
            onChange={(e) => setFilter('keepPlaced', e.target.checked)}
          />
          <span>დადებულის შენარჩუნება</span>
        </label>
        <label
          className="check-row"
          title="ორივე მხარის ყველა შეერთება ერთმანეთის პირისპირ, რომ ყველგან შტირი დაჯდეს - თუნდაც მეტი ელემენტის ან ჩაკერების ფასად"
        >
          <input type="checkbox" checked={filters.rodsFirst} onChange={(e) => setFilter('rodsFirst', e.target.checked)} />
          <span>შტირები პირველ რიგში</span>
        </label>
      </div>

      <div className="rec-chips">
        <select
          className="rec-select"
          value={filters.outerCorners}
          onChange={(e) => setFilter('outerCorners', e.target.value as LayoutFilters['outerCorners'])}
          title="გარე კუთხე"
        >
          <option value="lap">გარე კუთხე - გადაფარვით</option>
          <option value="open">გარე კუთხე - ღია 20 სმ</option>
        </select>
        <select
          className="rec-select"
          value={filters.overhangEnds}
          onChange={(e) => setFilter('overhangEnds', e.target.value as OverhangEnds)}
          title="შეიძლება თუ არა პანელმა ხაზის თავისუფალ ბოლოს გასცდეს"
        >
          {(Object.keys(OVERHANG_LABEL) as OverhangEnds[]).map((key) => (
            <option key={key} value={key}>
              {OVERHANG_LABEL[key]}
            </option>
          ))}
        </select>
        <select
          className="rec-select"
          value={filters.maxOverhang}
          onChange={(e) => setFilter('maxOverhang', Number(e.target.value))}
          title="რამდენით შეიძლება გასცდეს ხაზს ან კუთხეს, მაქსიმუმ"
        >
          {MAX_OVERHANG.map((cm) => (
            <option key={cm} value={cm}>
              გაცდენა ≤ {cm} სმ
            </option>
          ))}
        </select>
      </div>

      <div className="rec-chips">
        <Chip on={filters.fewer300} onClick={() => setFilter('fewer300', !filters.fewer300)} title="300-ის ნაკლები პანელი - რიგები 150 + 150">
          300-ის ნაკლები
        </Chip>
        <Chip
          on={filters.useStock && hasStock}
          disabled={!hasStock}
          onClick={() => setFilter('useStock', !filters.useStock)}
          title={hasStock ? 'მარაგში არ ჯდომა ვარიანტები ქვემოთ' : 'მარაგი ჯერ შეყვანილი არ არის'}
        >
          მარაგი
        </Chip>
        <select
          className="rec-select"
          value={filters.maxFillers}
          onChange={(e) => setFilter('maxFillers', Number(e.target.value))}
          title="ჩაკერება ერთ მხარეზე, მაქსიმუმ"
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              ჩაკ. ≤ {n}
            </option>
          ))}
        </select>
      </div>

      <div className="rec-chips" aria-label="პანელის სიგანეები">
        <span className="rec-chips-label">ზომები</span>
        {WIDTHS.map((w) => {
          const on = !filters.excludeWidths.includes(w);
          return (
            <Chip key={w} on={on} onClick={() => toggle('excludeWidths', w)} title={on ? `${w} სმ პანელის გამორთვა` : `${w} სმ პანელის ჩართვა`}>
              {w}
            </Chip>
          );
        })}
      </div>
      <div className="rec-chips" aria-label="დასაზოგი ზომები">
        <span className="rec-chips-label">დაზოგე</span>
        {WIDTHS.map((w) => (
          <Chip
            key={w}
            on={filters.spareWidths.includes(w)}
            disabled={filters.excludeWidths.includes(w)}
            onClick={() => toggle('spareWidths', w)}
            title={`${w} სმ პანელი მხოლოდ მაშინ, როცა სხვა გზა უარესია`}
          >
            {w}
          </Chip>
        ))}
      </div>

      {!hasStock && (
        <p className="hint-note" style={{ margin: 0 }}>
          მარაგი ჯერ შეყვანილი არ არის - ვარიანტები მარაგის გარეშე ფასდება.
        </p>
      )}
      {inside.flagged.length > 0 && (
        <div className="alert warn rec-switch" style={{ margin: 0 }}>
          ამ ხაზის შიგნით ხაზები ან ელემენტები დგას - ის გარე ხაზი უნდა იყოს, ახლა შიდაა.
          <button
            className="btn small primary"
            onClick={() => useEditorStore.getState().setSketchPerimeter(inside.flagged, 'outer')}
          >
            გარედ გადართვა
          </button>
        </div>
      )}
      {inside.lines.length > 0 && (
        <p className="hint-note" style={{ margin: 0 }}>
          შიგნით მყოფი {inside.lines.length} ხაზი და {inside.pieces} ელემენტი ვარიანტებში ჩართულია -
          გარე მხარე მათ შეეწყობა.
          {filters.keepPlaced && inside.pieces > 0
            ? ' შიდა მხარის ხელახლა, ორივე მხარის ერთად შესარჩევად გამორთე დადებულის შენარჩუნება.'
            : ''}
        </p>
      )}
      {inside.around.length > 0 && (
        <p className="hint-note" style={{ margin: 0 }}>
          კედლის მეორე მხარე ({inside.around.length} ხაზი) ვარიანტებში ჩართულია - ორივე მხარე ერთად
          შეირჩევა, შეერთებები ერთმანეთის პირისპირ, რომ შტირები დაჯდეს.
        </p>
      )}
      {filters.keepPlaced && (variants[chosen]?.unmatched ?? 0) > 0 && (
        <div className="alert warn rec-switch" style={{ margin: 0 }}>
          {variants[chosen].unmatched} პანელს პირისპირ წყვილი არ აქვს - იქ შტირი ვერ ჩადგება, რადგან მეორე მხარე
          უკვე დაწყობილია. ორივე მხარე ერთად თავიდან შეირჩევა, რომ ყველა შეერთება ერთმანეთის პირისპირ დადგეს.
          <button className="btn small primary" onClick={() => setFilter('keepPlaced', false)}>
            ორივე მხარის თავიდან შერჩევა
          </button>
        </div>
      )}
      <OuterLineMaker lines={selected} sketch={sketch} pieces={pieces} materials={materials} />
      {result?.warnings.map((w) => (
        <p key={w} className="alert warn" style={{ margin: 0 }}>
          {w}
        </p>
      ))}

      {variants.map((v, i) => (
        <button
          type="button"
          key={v.key}
          className={`rec-card${i === chosen ? ' on' : ''}${v.feasible ? '' : ' short'}`}
          aria-pressed={i === chosen}
          onClick={() => setPicked(i)}
          onMouseEnter={() => setHover(i)}
          onMouseLeave={() => setHover(null)}
        >
          <div className="rec-card-top">
            <span className="rec-rank">
              #{i + 1}
              {i === 0 ? ' საუკეთესო' : ''}
            </span>
            <span className="rec-count">
              {countLine(v)} · შტირი {rodSpots[i] ?? 0}
            </span>
          </div>
          {v.walls.map((wall, k) => (
            <WallRow key={wall.key} wall={wall} index={k} many={v.walls.length > 1} />
          ))}
          <div className="rec-reasons">{v.reasons.join(' · ')}</div>
        </button>
      ))}

      <div className="rec-apply">
        <button className="btn primary" onClick={apply} disabled={!variants.length}>
          გამოყენება
        </button>
      </div>
    </div>
  );
}

function countLine(v: LayoutVariant): string {
  const parts = [`${v.panels + v.fillers} ელ.`];
  if (v.fillers) parts.push(`${v.fillers} ჩაკ.`);
  if (v.corners) parts.push(`${v.corners} კუთხე`);
  if (v.remove.length) parts.push(`იცვლება ${v.remove.length}`);
  return parts.join(' · ');
}

/** `45 · 3×90 · ჩ5` - one face in laying order, repeats grouped. */
export function describeParts(parts: string[]): string {
  const groups: Array<{ label: string; count: number }> = [];
  for (const label of parts) {
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.count++;
    else groups.push({ label, count: 1 });
  }
  return groups.map((g) => (g.count > 1 ? `${g.count}×${g.label}` : g.label)).join(' · ');
}

/** One wall: each face drawn to scale against the longer one, and in words. */
function WallRow({ wall, index, many }: { wall: WallSummary; index: number; many: boolean }) {
  const widthOf = (p: string) => Number(p.replace('ჩ', '')) || 0;
  const longest = Math.max(1, ...wall.faces.map((f) => f.parts.reduce((s, p) => s + widthOf(p), 0)));
  return (
    <div className="rec-wall">
      <div className="rec-wall-head">
        {many ? `კედელი ${index + 1}` : 'კედელი'} · {wall.length} სმ · {wall.faces.length === 2 ? '2 მხარე' : '1 მხარე'}
      </div>
      {wall.faces.map((face, f) => {
        const total = face.parts.reduce((s, p) => s + widthOf(p), 0);
        return (
          <div key={f} className="rec-face">
            <div className="rec-strip thin" aria-hidden="true" style={{ width: `${(total / longest) * 100}%` }}>
              {face.parts.map((p, i) => (
                <span key={i} className={p.startsWith('ჩ') ? 'filler' : undefined} style={{ flex: `${widthOf(p)} 0 0` }}>
                  {widthOf(p) >= 45 ? p : ''}
                </span>
              ))}
            </div>
            <div className="rec-summary">
              {describeParts(face.parts)}
              {face.overhang > 0 ? <span className="rec-over"> · +{face.overhang} სმ</span> : null}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function Chip({
  on,
  onClick,
  disabled,
  title,
  children,
}: {
  on: boolean;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      className={`rec-chip${on ? ' on' : ''}`}
      aria-pressed={on}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {children}
    </button>
  );
}

/**
 * Whether a line already has the other face of its wall drawn: another line
 * running alongside one of its legs, no further than a wall is thick.
 */
function hasPartner(path: SketchPath, sketch: SketchPath[]): boolean {
  const mine = segments(path);
  return sketch.some(
    (other) =>
      other.id !== path.id &&
      segments(other).some(([c, d]) =>
        mine.some(([a, b]) => {
          const across = a.y === b.y;
          if (across !== (c.y === d.y)) return false;
          const gap = across ? Math.abs(c.y - a.y) : Math.abs(c.x - a.x);
          if (gap < 0.5 || gap > MAX_WALL_CM) return false;
          const [lo1, hi1] = across ? [Math.min(a.x, b.x), Math.max(a.x, b.x)] : [Math.min(a.y, b.y), Math.max(a.y, b.y)];
          const [lo2, hi2] = across ? [Math.min(c.x, d.x), Math.max(c.x, d.x)] : [Math.min(c.y, d.y), Math.max(c.y, d.y)];
          return Math.min(hi1, hi2) - Math.max(lo1, lo2) > 0.5;
        }),
      ),
  );
}

/**
 * The other face of a built wall, as a line: offered for a picked line that
 * has panels on it and nothing drawn alongside it yet. One distance for every
 * side, or each leg its own - walls are not all one thickness. Only the line
 * is made; it is then picked, and the suggestions above fill it to match the
 * face it goes round.
 */
function OuterLineMaker({
  lines,
  sketch,
  pieces,
  materials,
}: {
  lines: SketchPath[];
  sketch: SketchPath[];
  pieces: Piece[];
  materials: Material[];
}) {
  const addSketchPaths = useEditorStore((s) => s.addSketchPaths);
  const setToast = useEditorStore((s) => s.setToast);
  const [same, setSame] = useState(true);
  const [where, setWhere] = useState<'outer' | 'inner'>('outer');
  const [distance, setDistance] = useState('20');
  const [perLeg, setPerLeg] = useState<Record<string, string>>({});

  // Any line still on its own - built or not. Making the other face BEFORE
  // filling is the better way round: both are then filled together and every
  // joint lines up for a შტირი (the user's ნახაზი 3, 2026-10-23).
  const built = useMemo(() => lines.filter((l) => !hasPartner(l, sketch)), [lines, sketch]);
  const empty = useMemo(
    () => built.every((l) => piecesOnLines([l], pieces, materials).length === 0),
    [built, pieces, materials],
  );
  if (!built.length) return null;

  const num = (v: string | undefined, fallback: number) => {
    const n = Number(String(v ?? '').replace(',', '.'));
    return Number.isFinite(n) && n > 0 ? n : fallback;
  };
  const all = num(distance, 20);
  const plans = built.map((line) => {
    const side = offsetSide(line, panelSide(line, sketch, pieces, materials), where);
    const legs = legsForOffset(line, side);
    const distances = legs.map((leg) => (same ? all : num(perLeg[`${line.id}:${leg.index}`], all)));
    return { line, side, legs, distances };
  });

  const make = () => {
    const made = plans.flatMap((p) => {
      const path = offsetFace(p.line, p.side, p.distances, where);
      return path ? [path] : [];
    });
    if (!made.length) {
      setToast('ხაზი ვერ შეიქმნა - ხაზი 90°-იანი უნდა იყოს.');
      return;
    }
    addSketchPaths(made);
    setToast(`შეიქმნა ${made.length} ${where === 'outer' ? 'გარე' : 'შიდა'} ხაზი - ქვემოთ მისი შევსების ვარიანტებია.`);
  };

  return (
    <section className="rec-outer">
      <div className="rec-wall-head">ახალი ხაზის შექმნა - მანძილი ამ ხაზიდან (კედლის სისქე)</div>
      {empty && (
        <p className="hint-note" style={{ margin: 0 }}>
          რჩევა: ჯერ კედლის მეორე მხარე შექმენი და მერე შეავსე - ორივე მხარე ერთად შეირჩევა, შეერთებები
          ერთმანეთის პირისპირ დადგება და ყველგან შტირი დაჯდება.
        </p>
      )}
      <span className="pen-face">
        {(
          [
            ['outer', 'გარე', 'ახალი ხაზი ამ ხაზის გარეთ'],
            ['inner', 'შიდა', 'ახალი ხაზი ამ ხაზის შიგნით'],
          ] as const
        ).map(([value, label, why]) => (
          <button
            key={value}
            type="button"
            className={`btn small${where === value ? ' engaged' : ''}`}
            aria-pressed={where === value}
            title={why}
            onClick={() => setWhere(value)}
          >
            {label}
          </button>
        ))}
      </span>
      <label className="check-row">
        <input type="checkbox" checked={same} onChange={(e) => setSame(e.target.checked)} />
        <span>ყველა მხარეს ერთნაირი</span>
      </label>
      {same ? (
        <label className="field">
          <span>მანძილი (სმ)</span>
          <input type="number" min={5} max={MAX_WALL_CM} step={5} value={distance} onChange={(e) => setDistance(e.target.value)} />
        </label>
      ) : (
        plans.map((p) =>
          p.legs.map((leg) => {
            const key = `${p.line.id}:${leg.index}`;
            return (
              <label className="field rec-leg" key={key}>
                <span>
                  {towardsLabel(leg.towards)} · {leg.length} სმ
                </span>
                <input
                  type="number"
                  min={5}
                  max={MAX_WALL_CM}
                  step={5}
                  value={perLeg[key] ?? distance}
                  onChange={(e) => setPerLeg((v) => ({ ...v, [key]: e.target.value }))}
                />
              </label>
            );
          }),
        )
      )}
      <button className="btn" onClick={make}>
        {where === 'outer' ? 'გარე' : 'შიდა'} ხაზის შექმნა
      </button>
    </section>
  );
}
