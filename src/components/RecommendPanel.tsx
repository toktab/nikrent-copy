import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { planSketchFillAll, type RunInfo, type SketchFillSpec } from '../lib/sketchFill';
import {
  choiceFromVariant,
  DEFAULT_FILL_FILTERS,
  freeStock,
  recommendFills,
  stockEntered,
  stockPressure,
  variantSummary,
  type FillFilters,
  type FillSort,
  type Variant,
} from '../lib/fillOptions';

/** Panel widths offered as on/off chips, widest first (R2). */
const WIDTHS = [90, 75, 60, 45, 30];

const SORT_LABEL: Record<FillSort, string> = {
  pieces: 'ყველაზე ცოტა ელემენტი',
  fillers: 'ყველაზე ცოტა ჩაკერება',
  scarce: 'მარაგის დაზოგვა',
};

interface RunList {
  run: RunInfo;
  variants: Variant[];
  warnings: string[];
}

/**
 * The ranked ways to fill what is selected.
 *
 * One section per wall run - both faces and every course of it are one answer
 * (R6, P6) - with its variants best first, as `docs/FILL-RULES.md` orders them.
 * Pointing at a card shows it faint on the drawing; clicking picks it for that
 * run; one button builds every run as picked, as one undo step. Nothing here
 * decides anything the fill generator does not already: it only chooses which
 * of its exact answers gets built.
 */
export function RecommendPanel({
  active = true,
}: {
  /** false while it is kept mounted but hidden: nothing is previewed on the drawing */
  active?: boolean;
} = {}) {
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);
  const selectedSketchIds = useEditorStore((s) => s.selectedSketchIds);
  const applyFillVariants = useEditorStore((s) => s.applyFillVariants);
  const setRecommendPreview = useEditorStore((s) => s.setRecommendPreview);
  const setToast = useEditorStore((s) => s.setToast);

  const paths = useMemo(
    () => sketch.filter((k) => selectedSketchIds.includes(k.id)),
    [sketch, selectedSketchIds],
  );

  const [height, setHeight] = useState('300');
  const [includeCorners, setIncludeCorners] = useState(true);
  const [filters, setFilters] = useState<FillFilters>({ ...DEFAULT_FILL_FILTERS });
  /** runKey → which of its variants is picked */
  const [picked, setPicked] = useState<Record<string, number>>({});
  const [hover, setHover] = useState<{ runKey: string; index: number } | null>(null);

  const h = Number(String(height).replace(',', '.'));
  const spec: SketchFillSpec = useMemo(() => ({ height: h, includeCorners }), [h, includeCorners]);
  const setFilter = <K extends keyof FillFilters>(key: K, value: FillFilters[K]) => {
    setFilters((f) => ({ ...f, [key]: value }));
    setPicked({}); // a new order means #1 is a different answer
  };

  // Stock only means something once it has been entered; see `stockEntered`.
  // Counted against the open drawing only, the same figure the ნაშთი tab shows.
  const pieces = useEditorStore((s) => s.pieces);
  const hasStock = useMemo(() => stockEntered(materials), [materials]);
  const free = useMemo(() => (hasStock ? freeStock(materials, pieces) : undefined), [hasStock, materials, pieces]);
  const pressure = useMemo(
    () => (hasStock ? stockPressure(materials, pieces) : undefined),
    [hasStock, materials, pieces],
  );

  const runs = useMemo(
    () => (paths.length && h > 0 ? planSketchFillAll(paths, spec, materials).runs : []),
    [paths, spec, materials, h],
  );

  const lists = useMemo(() => {
    const out: RunList[] = [];
    for (const run of runs) {
      const result = recommendFills({
        length: run.length,
        height: h,
        faces: run.faces,
        materials,
        free,
        pressure,
        filters: { ...filters, useStock: filters.useStock && hasStock },
        limit: 8,
      });
      out.push({ run, ...result });
    }
    return out;
  }, [runs, h, materials, free, pressure, filters, hasStock]);

  /**
   * Every run in one fill stands the same courses, so the first run's pick
   * decides the stack and the rest only offer variants on it.
   */
  const shown = useMemo(() => {
    if (!lists.length) return lists;
    const first = lists[0];
    const stack = first.variants[Math.min(picked[first.run.key] ?? 0, first.variants.length - 1)]?.stack;
    if (!stack) return lists;
    const same = (v: Variant) => v.stack.length === stack.length && v.stack.every((x, i) => x === stack[i]);
    return lists.map((list, i) => {
      if (i === 0) return list;
      const onStack = list.variants.filter(same);
      return onStack.length
        ? { ...list, variants: onStack }
        : { ...list, warnings: [...list.warnings, `${stack.join('+')} სმ რიგებზე ეს კედელი ზუსტად არ ივსება.`] };
    });
  }, [lists, picked]);

  const pickOf = (list: RunList) => Math.min(picked[list.run.key] ?? 0, Math.max(0, list.variants.length - 1));

  // What is picked - or pointed at - shown faint on the drawing.
  useEffect(() => {
    if (!active || !paths.length || !(h > 0) || !shown.length) {
      setRecommendPreview(null);
      return;
    }
    const choices: NonNullable<SketchFillSpec['choices']> = {};
    let stack: number[] | undefined;
    for (const list of shown) {
      const index = hover?.runKey === list.run.key ? hover.index : pickOf(list);
      const variant = list.variants[index];
      if (!variant) continue;
      const choice = choiceFromVariant(variant);
      stack ??= choice.stack;
      choices[list.run.key] = choice.sequences;
    }
    setRecommendPreview(planSketchFillAll(paths, { ...spec, stack, choices }, materials).pieces);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, shown, hover, picked, paths, spec, materials, h]);

  // Leaving the tab, or the panel, takes the ghost with it.
  useEffect(() => () => setRecommendPreview(null), [setRecommendPreview]);

  if (!paths.length) {
    return (
      <div className="empty">
        მონიშნე ხაზვის ხაზი - კედლის ორივე მხარე ერთად - და აქ გამოჩნდება, რა პანელებით ჯობია
        მისი შევსება, საუკეთესოდან დაწყებული.
      </div>
    );
  }

  const apply = () => {
    const picks = shown
      .map((list) => ({ runKey: list.run.key, variant: list.variants[pickOf(list)] }))
      .filter((p): p is { runKey: string; variant: Variant } => !!p.variant);
    if (!picks.length) return;
    const result = applyFillVariants(
      paths.map((p) => p.id),
      spec,
      picks,
    );
    setRecommendPreview(null);
    setToast(
      !result.added
        ? 'ყალიბი ვერ აიწყო - შეამოწმე კატალოგი და ზომები.'
        : result.warnings.length
          ? `დაემატა ${result.added} ელემენტი, ${result.warnings.length} გაფრთხილებით.`
          : `დაემატა ${result.added} ელემენტი.`,
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
              setPicked({});
            }}
          />
        </label>
        <label className="check-row">
          <input type="checkbox" checked={includeCorners} onChange={(e) => setIncludeCorners(e.target.checked)} />
          <span>შიდა კუთხის პროფილები</span>
        </label>
      </div>

      <div className="rec-chips">
        <Chip on={filters.fewer300} onClick={() => setFilter('fewer300', !filters.fewer300)} title="300-ის ნაკლები პანელი - რიგები 150+150">
          300-ის ნაკლები
        </Chip>
        <Chip on={filters.spare90} onClick={() => setFilter('spare90', !filters.spare90)} title="იგივე ელემენტების რაოდენობით - ნაკლები 90-ანი">
          90-ების დაზოგვა
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
          title="ჩაკერება ერთ რიგზე, მაქსიმუმ"
        >
          {[0, 1, 2, 3].map((n) => (
            <option key={n} value={n}>
              ჩაკ. ≤ {n}
            </option>
          ))}
        </select>
        <select
          className="rec-select"
          value={filters.sort}
          onChange={(e) => setFilter('sort', e.target.value as FillSort)}
          title="რის მიხედვით ლაგდება"
        >
          {(Object.keys(SORT_LABEL) as FillSort[]).map((key) => (
            <option key={key} value={key}>
              {SORT_LABEL[key]}
            </option>
          ))}
        </select>
      </div>

      <div className="rec-chips" aria-label="პანელის სიგანეები">
        {WIDTHS.map((w) => {
          const on = !filters.excludeWidths.includes(w);
          return (
            <Chip
              key={w}
              on={on}
              onClick={() =>
                setFilter(
                  'excludeWidths',
                  on ? [...filters.excludeWidths, w] : filters.excludeWidths.filter((x) => x !== w),
                )
              }
              title={on ? `${w} სმ პანელის გამორთვა` : `${w} სმ პანელის ჩართვა`}
            >
              {w}
            </Chip>
          );
        })}
      </div>

      {!hasStock && (
        <p className="hint-note" style={{ margin: 0 }}>
          მარაგი ჯერ შეყვანილი არ არის - ვარიანტები მარაგის გარეშე ფასდება.
        </p>
      )}

      {shown.map((list, runIndex) => {
        const chosen = pickOf(list);
        return (
          <section className="rec-run" key={list.run.key}>
            <div className="rec-run-head">
              <b>{shown.length > 1 ? `კედელი ${runIndex + 1}` : 'კედელი'}</b>
              <span>
                {list.run.length} სმ · {list.run.faces === 2 ? '2 მხარე' : '1 მხარე'}
              </span>
            </div>
            {list.warnings.map((w) => (
              <p key={w} className="alert warn" style={{ margin: 0 }}>
                {w}
              </p>
            ))}
            {list.variants.map((v, i) => (
              <button
                type="button"
                key={v.key}
                className={`rec-card${i === chosen ? ' on' : ''}${v.feasible ? '' : ' short'}`}
                aria-pressed={i === chosen}
                onClick={() => setPicked((p) => ({ ...p, [list.run.key]: i }))}
                onMouseEnter={() => setHover({ runKey: list.run.key, index: i })}
                onMouseLeave={() => setHover(null)}
              >
                <div className="rec-card-top">
                  <span className="rec-rank">
                    #{i + 1}
                    {i === 0 ? ' საუკეთესო' : ''}
                  </span>
                  <span className="rec-count">
                    {v.pieces} ელ.{v.fillers ? ` · ${v.fillers} ჩაკ.` : ''}
                  </span>
                </div>
                <Strip variant={v} />
                <div className="rec-summary">{variantSummary(v)}</div>
                {/* The architect's own check, on the answer: every course adds
                    up to the run exactly. True by construction - shown because
                    it is the number he trusts, not because it could be wrong. */}
                {v.courses.every(
                  (c) => Math.abs(c.sequence.reduce((sum, p) => sum + p.w, 0) - list.run.length) < 0.05,
                ) && <div className="rec-check">ცდომილება 0 ✓</div>}
                <div className="rec-reasons">{v.reasons.join(' · ')}</div>
              </button>
            ))}
          </section>
        );
      })}

      <div className="rec-apply">
        <button className="btn primary" onClick={apply} disabled={!shown.some((l) => l.variants.length)}>
          გამოყენება
        </button>
      </div>
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

/** One face of the bottom course, drawn to scale: panels, and the filler standing out. */
function Strip({ variant }: { variant: Variant }) {
  const sequence = variant.courses[0]?.sequence ?? [];
  return (
    <div className="rec-strip" aria-hidden="true">
      {sequence.map((p, i) => (
        <span key={i} className={p.filler ? 'filler' : undefined} style={{ flex: `${p.w} 0 0` }}>
          {p.w >= 45 ? p.w : ''}
        </span>
      ))}
    </div>
  );
}
