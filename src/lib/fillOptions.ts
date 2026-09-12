import type { DrawingDoc, Material } from '../types';
import { coverExact, optionsAt, panelHeights, type PanelOption } from './formwork';
import { available, commitmentsByMaterial, totalStock } from './inventory';

/**
 * Every sensible way to fill one run with panels and ჩაკერება, ranked.
 *
 * The fill generator builds one answer - the fewest pieces - and that is often
 * the right one. But the person filling a drawing chooses between several, for
 * reasons the tool cannot see on its own: this job is short of 90s, that one
 * should not take the 300s, a second filler here would be ugly. So this lists
 * the candidates, orders them by the rules in `docs/FILL-RULES.md`, and lets
 * filters move the order. The rule ids (R2, P4...) below point into that file.
 *
 * Pure: a length, a height, the catalog and optionally stock in; ranked
 * variants out. Nothing is placed - applying a variant is the fill generator's
 * job.
 */

export type FillSort = 'pieces' | 'fillers' | 'scarce';

export interface FillFilters {
  /** prefer stacked shorter courses to 300-high panels */
  fewer300: boolean;
  /** prefer variants using fewer of the widest panel */
  spare90: boolean;
  /** panel widths not to use at all */
  excludeWidths: number[];
  /** ჩაკერება per course, 0 to 3 */
  maxFillers: number;
  /** sink variants that need more than is free */
  useStock: boolean;
  sort: FillSort;
}

export const DEFAULT_FILL_FILTERS: FillFilters = {
  fewer300: false,
  spare90: false,
  excludeWidths: [],
  // Two are allowed (R4) - they just rank below every one-filler answer.
  maxFillers: 2,
  useStock: true,
  sort: 'pieces',
};

/** R3: past three it stops being a closure. */
const MAX_FILLERS = 3;
/** how far past the fewest pieces a variant may go and still be worth listing */
const PIECE_WINDOW = 3;
/** safety cap on candidates per target length */
const CANDIDATE_CAP = 4000;
const EPS = 0.01;

/**
 * Score weights, lowest total wins. Chosen so the order of what matters holds:
 * a piece outweighs every tie-breaker put together.
 */
const WEIGHT = {
  piece: 1000,
  extraFiller: 700, // R4
  adjacentFillers: 3000, // R4
  distinct: 200, // P5
  // R2 outranks P4: the architect lays 90s until they stop fitting and takes
  // what is left, so 8×90 + 45 beats 6×90 + 3×75 even with the narrow 45.
  nonWidest: 60, // R2
  narrow: 40, // P4, only between variants with the same number of 90s
  widthStep: 1, // R2, finest
  // fewer300: has to outweigh what a stack costs - 150 + 150 is two courses and
  // has no 90s, so it takes well over twice the pieces. At 1500 a 700 cm wall
  // stayed on 300s with the filter on, which is the filter doing nothing.
  tall: 5000,
  // spare90: enough to outweigh R2 at the same piece count, not enough to buy
  // extra pieces on an ordinary run.
  spare90: 90,
  fillerSort: 2500,
  scarce: 20,
  scarceSort: 600,
  infeasible: 1e9,
};

export interface VariantPiece {
  materialId: string;
  w: number;
  filler: boolean;
}

export interface CourseFill {
  height: number;
  /** one face of this course, in laying order */
  sequence: VariantPiece[];
}

export interface StockLine {
  materialId: string;
  need: number;
  /** null when stock is not being considered */
  free: number | null;
  after: number | null;
}

export interface Variant {
  key: string;
  /** course heights, bottom to top */
  stack: number[];
  courses: CourseFill[];
  /** materialId → count across every course and face */
  total: Record<string, number>;
  pieces: number;
  panels: number;
  fillers: number;
  distinctSizes: number;
  stock: StockLine[];
  feasible: boolean;
  score: number;
  reasons: string[];
}

export interface FillRequest {
  /** one face, between its corners, cm */
  length: number;
  /** pour height, cm */
  height: number;
  /** 2 for a wall whose two faces are matched (R6) */
  faces?: number;
  materials: Material[];
  /** materialId → how many are free to take; see `freeStock` */
  free?: Map<string, number>;
  /** materialId → how much of it the company has already committed (0..1+) */
  pressure?: Map<string, number>;
  filters?: Partial<FillFilters>;
  /** how many variants to return */
  limit?: number;
}

export interface FillResult {
  variants: Variant[];
  warnings: string[];
}

// ── arithmetic ──────────────────────────────────────────────────────────────

function gcd(a: number, b: number): number {
  let x = Math.round(Math.abs(a));
  let y = Math.round(Math.abs(b));
  while (y) [x, y] = [y, x % y];
  return x;
}

/**
 * What panels alone can never cover: `length mod gcd(widths)`.
 *
 * With the Du catalog every width is a multiple of 15, so this is `length mod
 * 15` - 0, 5 or 10 - and it is exactly the ჩაკერება a run needs (FILL-RULES).
 */
export function fillerRemainder(length: number, widths: number[]): number {
  const module = widths.reduce((g, w) => gcd(g, w), 0);
  if (!module) return length;
  return Math.round(((length % module) + module) % module);
}

/** Every stack of course heights that makes the pour height exactly, tallest first. */
export function courseStacks(height: number, heights: number[], maxCourses = 4): number[][] {
  const sorted = [...new Set(heights)].sort((a, b) => b - a);
  const out: number[][] = [];
  const walk = (rest: number, from: number, acc: number[]) => {
    if (Math.abs(rest) <= EPS) {
      if (acc.length) out.push([...acc]);
      return;
    }
    if (acc.length >= maxCourses) return;
    for (let i = from; i < sorted.length; i++) {
      if (sorted[i] <= rest + EPS) {
        acc.push(sorted[i]);
        walk(rest - sorted[i], i, acc);
        acc.pop();
      }
    }
  };
  walk(height, 0, []);
  return out;
}

/** One entry per width, first material wins - the catalog order breaks ties. */
function byWidth(options: PanelOption[]): PanelOption[] {
  const seen = new Set<number>();
  return options.filter((o) => (seen.has(o.w) ? false : (seen.add(o.w), true)));
}

/** Every multiset of filler widths of at most `max` pieces, as count arrays. */
function fillerCombos(widths: number[], max: number): number[][] {
  const out: number[][] = [];
  const counts = new Array(widths.length).fill(0);
  const walk = (i: number, left: number) => {
    if (i === widths.length) {
      out.push([...counts]);
      return;
    }
    for (let k = 0; k <= left; k++) {
      counts[i] = k;
      walk(i + 1, left - k);
    }
    counts[i] = 0;
  };
  walk(0, max);
  return out;
}

/**
 * Every multiset of panel widths (widest first) summing to `target`, using at
 * most `maxPanels` pieces. Pruned by the fewest pieces the rest could still take.
 */
function panelCombos(target: number, widths: number[], maxPanels: number): number[][] {
  const out: number[][] = [];
  const counts = new Array(widths.length).fill(0);
  const walk = (i: number, rest: number, used: number) => {
    if (out.length >= CANDIDATE_CAP) return;
    if (Math.abs(rest) <= EPS) {
      out.push([...counts]);
      return;
    }
    if (i >= widths.length || rest < 0) return;
    const w = widths[i];
    if (used + Math.ceil((rest - EPS) / w) > maxPanels) return;
    for (let k = Math.floor((rest + EPS) / w); k >= 0; k--) {
      counts[i] = k;
      walk(i + 1, rest - k * w, used + k);
    }
    counts[i] = 0;
  };
  walk(0, target, 0);
  return out;
}

/**
 * R5 / P1: size groups widest first, a filler between each pair of groups, any
 * filler left over at the end.
 */
export function layOrder(panels: VariantPiece[], fillers: VariantPiece[]): VariantPiece[] {
  const groups: VariantPiece[][] = [];
  for (const p of [...panels].sort((a, b) => b.w - a.w)) {
    const last = groups[groups.length - 1];
    if (last && last[0].w === p.w) last.push(p);
    else groups.push([p]);
  }
  const queue = [...fillers].sort((a, b) => b.w - a.w);
  const out: VariantPiece[] = [];
  groups.forEach((group, i) => {
    out.push(...group);
    if (i < groups.length - 1 && queue.length) out.push(queue.shift()!);
  });
  out.push(...queue);
  return out;
}

interface CourseCandidate {
  sequence: VariantPiece[];
  panels: number;
  fillers: number;
}

/** Every exact way to fill one course of one height, within the piece window. */
function courseCandidates(
  length: number,
  height: number,
  materials: Material[],
  filters: FillFilters,
): CourseCandidate[] {
  const exclude = new Set(filters.excludeWidths);
  const panels = byWidth(optionsAt(materials, 'panel', height)).filter((o) => !exclude.has(o.w));
  const fillers = byWidth(optionsAt(materials, 'filler', height));
  const maxFillers = Math.max(0, Math.min(MAX_FILLERS, Math.round(filters.maxFillers)));
  const panelWidths = panels.map((o) => o.w);
  const fillerWidths = fillers.map((o) => o.w);

  // The fewest pieces any filler choice allows, so the window is shared.
  const combos = fillerCombos(fillerWidths, fillers.length ? maxFillers : 0).map((counts) => {
    const fillerCm = counts.reduce((sum, k, i) => sum + k * fillerWidths[i], 0);
    const fillerCount = counts.reduce((sum, k) => sum + k, 0);
    const target = length - fillerCm;
    let minPanels = Infinity;
    if (Math.abs(target) <= EPS) minPanels = 0;
    else if (target > 0 && panelWidths.length) {
      const cover = coverExact(target, panelWidths);
      if (cover.remainder <= EPS) minPanels = cover.picks.length;
    }
    return { counts, target, fillerCount, minPanels };
  });
  const reachable = combos.filter((c) => Number.isFinite(c.minPanels));
  if (!reachable.length) return [];
  const fewest = Math.min(...reachable.map((c) => c.minPanels + c.fillerCount));
  const maxPieces = fewest + PIECE_WINDOW;

  const out: CourseCandidate[] = [];
  for (const combo of reachable) {
    const room = maxPieces - combo.fillerCount;
    if (combo.minPanels > room) continue;
    const fillerPieces: VariantPiece[] = [];
    combo.counts.forEach((k, i) => {
      for (let n = 0; n < k; n++) {
        fillerPieces.push({ materialId: fillers[i].material.id, w: fillers[i].w, filler: true });
      }
    });
    const panelSets =
      Math.abs(combo.target) <= EPS ? [new Array(panelWidths.length).fill(0)] : panelCombos(combo.target, panelWidths, room);
    for (const counts of panelSets) {
      const panelPieces: VariantPiece[] = [];
      counts.forEach((k, i) => {
        for (let n = 0; n < k; n++) {
          panelPieces.push({ materialId: panels[i].material.id, w: panels[i].w, filler: false });
        }
      });
      // A run of fillers alone is a closure only when it is short enough (R3).
      if (!panelPieces.length && !fillerPieces.length) continue;
      out.push({
        sequence: layOrder(panelPieces, fillerPieces),
        panels: panelPieces.length,
        fillers: fillerPieces.length,
      });
    }
  }
  return out;
}

const adjacentFillers = (sequence: VariantPiece[]) =>
  sequence.reduce((n, p, i) => n + (p.filler && sequence[i - 1]?.filler ? 1 : 0), 0);

// ── ranking ─────────────────────────────────────────────────────────────────

export function recommendFills(req: FillRequest): FillResult {
  const filters: FillFilters = { ...DEFAULT_FILL_FILTERS, ...req.filters };
  const faces = Math.max(1, Math.round(req.faces ?? 1));
  const limit = req.limit ?? 12;
  const warnings: string[] = [];
  const names = new Map(req.materials.map((m) => [m.id, m.name]));

  if (!(req.length > 0)) return { variants: [], warnings: ['მონაკვეთის სიგრძე ნულზე მეტი უნდა იყოს.'] };
  if (!(req.height > 0)) return { variants: [], warnings: ['სიმაღლე ნულზე მეტი უნდა იყოს.'] };

  const heights = panelHeights(req.materials);
  const tallest = heights[0] ?? 0;
  const widest = Math.max(
    0,
    ...req.materials.filter((m) => m.category === 'panel').map((m) => m.w),
  );
  const stacks = courseStacks(req.height, heights);
  if (!stacks.length) {
    return {
      variants: [],
      warnings: [`${req.height} სმ სიმაღლე პანელების ნებისმიერი სიმაღლით ზუსტად არ შედგება.`],
    };
  }

  const perHeight = new Map<number, CourseCandidate[]>();
  const candidatesAt = (h: number) => {
    if (!perHeight.has(h)) perHeight.set(h, courseCandidates(req.length, h, req.materials, filters));
    return perHeight.get(h)!;
  };

  const variants: Variant[] = [];
  const seen = new Set<string>();

  for (const stack of stacks) {
    const distinctHeights = [...new Set(stack)];
    const lists = distinctHeights.map(candidatesAt);
    if (lists.some((l) => !l.length)) continue;

    // P6: a height repeated in the stack uses the same sequence each time. Mixed
    // heights combine their few best courses, which is all that can ever win.
    const shortlist = (list: CourseCandidate[]) =>
      distinctHeights.length === 1
        ? list
        : [...list].sort((a, b) => a.panels + a.fillers - (b.panels + b.fillers)).slice(0, 4);
    let combos: CourseCandidate[][] = [[]];
    for (const list of lists.map(shortlist)) {
      combos = combos.flatMap((prefix) => list.map((c) => [...prefix, c]));
    }

    for (const combo of combos) {
      const pick = new Map(distinctHeights.map((h, i) => [h, combo[i]]));
      const courses: CourseFill[] = stack.map((h) => ({ height: h, sequence: pick.get(h)!.sequence }));
      const key = courses.map((c) => `${c.height}:${c.sequence.map((p) => (p.filler ? `f${p.w}` : p.w)).join('.')}`).join('|');
      if (seen.has(key)) continue;
      seen.add(key);
      variants.push(buildVariant(key, stack, courses));
    }
  }

  function buildVariant(key: string, stack: number[], courses: CourseFill[]): Variant {
    const total: Record<string, number> = {};
    let panels = 0;
    let fillers = 0;
    let extraFillers = 0;
    let adjacent = 0;
    let narrow = 0;
    let nonWidest = 0;
    let steps = 0;
    let tall = 0;
    let widestCount = 0;
    const widths = new Set<number>();

    for (const course of courses) {
      const courseFillers = course.sequence.filter((p) => p.filler).length;
      extraFillers += Math.max(0, courseFillers - 1) * faces;
      adjacent += adjacentFillers(course.sequence) * faces;
      for (const p of course.sequence) {
        total[p.materialId] = (total[p.materialId] ?? 0) + faces;
        if (p.filler) {
          fillers += faces;
          continue;
        }
        panels += faces;
        widths.add(p.w);
        if (p.w < 60) narrow += faces;
        if (p.w < widest) nonWidest += faces;
        if (p.w === widest) widestCount += faces;
        steps += Math.round((widest - p.w) / 15) * faces;
        if (course.height === tallest) tall += faces;
      }
    }

    const stock: StockLine[] = Object.entries(total).map(([materialId, need]) => {
      const free = req.free?.has(materialId) ? req.free.get(materialId)! : null;
      return { materialId, need, free, after: free === null ? null : free - need };
    });
    const feasible = !filters.useStock || stock.every((s) => s.free === null || s.need <= s.free);
    const scarcity = Object.entries(total).reduce(
      (sum, [id, need]) => sum + need * (req.pressure?.get(id) ?? 0),
      0,
    );

    let score =
      (panels + fillers) * WEIGHT.piece +
      extraFillers * WEIGHT.extraFiller +
      adjacent * WEIGHT.adjacentFillers +
      widths.size * WEIGHT.distinct +
      narrow * WEIGHT.narrow +
      nonWidest * WEIGHT.nonWidest +
      steps * WEIGHT.widthStep +
      scarcity * (filters.sort === 'scarce' ? WEIGHT.scarceSort : WEIGHT.scarce);
    if (filters.fewer300) score += tall * WEIGHT.tall;
    if (filters.spare90) score += widestCount * WEIGHT.spare90;
    if (filters.sort === 'fillers') score += fillers * WEIGHT.fillerSort;
    if (!feasible) score += WEIGHT.infeasible;

    return {
      key,
      stack,
      courses,
      total,
      pieces: panels + fillers,
      panels,
      fillers,
      distinctSizes: widths.size,
      stock,
      feasible,
      score,
      reasons: [],
      // carried for the reasons below, not part of the public shape
      ...({ widestCount, adjacent, tall } as object),
    } as Variant;
  }

  variants.sort((a, b) => a.score - b.score || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0));

  if (!variants.length) {
    const panelWidths = [...new Set(req.materials.filter((m) => m.category === 'panel').map((m) => m.w))];
    warnings.push(
      `${req.length} სმ ${filters.maxFillers} ჩაკერებით ზუსტად არ ივსება` +
        (fillerRemainder(req.length, panelWidths)
          ? ` - საჭიროა ${fillerRemainder(req.length, panelWidths)} სმ ჩაკერება. გაზარდე ჩაკერების ლიმიტი ან ჩართე სხვა ზომები.`
          : ' - ჩართე სხვა ზომები.'),
    );
    return { variants: [], warnings };
  }

  // Reasons are relative to the rest of the list, so they are worked out last.
  const feasibleOnes = variants.filter((v) => v.feasible);
  const fewest = Math.min(...(feasibleOnes.length ? feasibleOnes : variants).map((v) => v.pieces));
  const extra = (v: Variant) => v as Variant & { widestCount: number; adjacent: number; tall: number };
  const mostWidest = Math.max(...variants.filter((v) => v.pieces === fewest).map((v) => extra(v).widestCount));

  for (const v of variants) {
    const x = extra(v);
    const reasons: string[] = [];
    reasons.push(v.pieces === fewest ? 'ყველაზე ცოტა ელემენტი' : `+${v.pieces - fewest} ელემენტი`);
    if (v.fillers === 0) reasons.push('ჩაკერების გარეშე');
    if (x.adjacent > 0) reasons.push('ორი ჩაკერება ერთმანეთის გვერდით');
    else if (v.fillers > faces * v.courses.length) reasons.push('ერთზე მეტი ჩაკერება');
    if (widest && x.widestCount < mostWidest) {
      reasons.push(`${widest}-ებს ზოგავს (${mostWidest - x.widestCount} ცალი)`);
    }
    if (tallest && x.tall === 0 && v.stack.some((h) => h !== tallest)) {
      reasons.push(`${tallest}-ის პანელის გარეშე`);
    }
    for (const s of v.stock) {
      if (s.free !== null && s.need > s.free) {
        reasons.push(`მარაგი არ ყოფნის: ${names.get(s.materialId) ?? s.materialId} (აკლია ${s.need - s.free})`);
      }
    }
    v.reasons = reasons;
    delete (v as Partial<typeof x>).widestCount;
    delete (v as Partial<typeof x>).adjacent;
    delete (v as Partial<typeof x>).tall;
  }

  if (!feasibleOnes.length && filters.useStock) {
    warnings.push('არცერთი ვარიანტი არ ჯდება მარაგში - ნაჩვენებია ყველაზე ახლოს მყოფები.');
  }
  return { variants: variants.slice(0, limit), warnings };
}

// ── reading a variant ───────────────────────────────────────────────────────

/**
 * Whether real stock has been entered: any panel with a count. Until then every
 * variant would read as short of everything, which says nothing - so the
 * ranking leaves stock out rather than marking the whole list red.
 */
export function stockEntered(materials: Material[]): boolean {
  return materials.some((m) => m.category === 'panel' && totalStock(m) > 0);
}

/**
 * A variant in one line: `7×90 · ჩ10 · 60`. One face of each distinct course,
 * in laying order; a stack is named first, `150+150: …`.
 */
export function variantSummary(variant: Variant): string {
  const describe = (sequence: VariantPiece[]) => {
    const groups: Array<{ label: string; count: number }> = [];
    for (const p of sequence) {
      const label = p.filler ? `ჩ${p.w}` : String(p.w);
      const last = groups[groups.length - 1];
      if (last && last.label === label) last.count++;
      else groups.push({ label, count: 1 });
    }
    return groups.map((g) => (g.count > 1 ? `${g.count}×${g.label}` : g.label)).join(' · ');
  };
  const seen = new Set<number>();
  const parts: string[] = [];
  for (const course of variant.courses) {
    if (seen.has(course.height)) continue;
    seen.add(course.height);
    parts.push(describe(course.sequence));
  }
  const stack = variant.stack.length > 1 ? `${variant.stack.join('+')}: ` : '';
  return stack + parts.join(' | ');
}

// ── handing a variant to the fill generator ─────────────────────────────────

/**
 * A variant as the fill generator takes it: the course stack for the job, and
 * each course height's sequence in laying order (P6: a height repeated in the
 * stack is one sequence). Goes into `SketchFillSpec.stack` / `.choices`.
 */
export function choiceFromVariant(variant: Variant): {
  stack: number[];
  sequences: Record<number, Array<{ materialId: string; w: number }>>;
} {
  const sequences: Record<number, Array<{ materialId: string; w: number }>> = {};
  for (const course of variant.courses) {
    if (sequences[course.height]) continue;
    sequences[course.height] = course.sequence.map(({ materialId, w }) => ({ materialId, w }));
  }
  return { stack: [...variant.stack], sequences };
}

// ── stock, from the drawings ────────────────────────────────────────────────

/** How many of each material is free: owned, minus what every drawing has already placed. */
export function freeStock(materials: Material[], documents: DrawingDoc[]): Map<string, number> {
  const commitments = commitmentsByMaterial(documents, '');
  return new Map(materials.map((m) => [m.id, Math.max(0, available(m, commitments.get(m.id)))]));
}

/**
 * How spoken-for each material already is across the company: committed over
 * owned. 0 is untouched, 1 is all of it placed somewhere, above 1 is short.
 * Materials nobody owns any of count as fully pressed, so they are spared.
 */
export function stockPressure(materials: Material[], documents: DrawingDoc[]): Map<string, number> {
  const commitments = commitmentsByMaterial(documents, '');
  return new Map(
    materials.map((m) => {
      const owned = totalStock(m);
      const committed = commitments.get(m.id)?.committed ?? 0;
      return [m.id, owned > 0 ? committed / owned : 1];
    }),
  );
}
