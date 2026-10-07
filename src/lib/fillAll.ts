import type { Material, Piece, SketchPath } from '../types';
import { planSketchFillAll, type RunInfo, type SketchFillSpec } from './sketchFill';
import {
  DEFAULT_FILL_FILTERS,
  freeStock,
  recommendFills,
  stockEntered,
  stockPressure,
  type Variant,
} from './fillOptions';
import { lineStatuses } from './problems';

/**
 * "Fill every wall" - each run with its best recommendation, in one go.
 *
 * Only lines nothing stands on yet: the fill adds pieces, it does not replace
 * them, so filling a line twice orders its panels twice. A line already built
 * is left as it is and said so.
 *
 * Every run in one fill stands the same courses (see `applyFillVariants`), so
 * the first run's best answer decides the stack and every other run takes its
 * best answer on that stack; a run with none there is filled the usual way.
 */
export interface FillAllPlan {
  /** the lines that will be filled */
  pathIds: string[];
  /** lines left alone because pieces already stand on them */
  skippedPathIds: string[];
  /** what each run is filled with - hand straight to `applyFillVariants` */
  picks: Array<{ runKey: string; variant: Variant }>;
  /** runs with no exact answer on the job's stack - filled the usual way */
  unmatched: RunInfo[];
  stack: number[] | null;
}

const sameStack = (a: number[], b: number[]) => a.length === b.length && a.every((h, i) => h === b[i]);

export function planFillAll(input: {
  sketch: SketchPath[];
  /** the selection; every line when empty */
  pathIds?: string[];
  spec: SketchFillSpec;
  materials: Material[];
  pieces: Piece[];
}): FillAllPlan {
  const { sketch, spec, materials, pieces } = input;
  const wanted = input.pathIds?.length ? new Set(input.pathIds) : null;
  const candidates = sketch.filter((p) => !wanted || wanted.has(p.id));

  const byId = new Map(materials.map((m) => [m.id, m]));
  const status = lineStatuses(sketch, pieces, byId);
  const toFill = candidates.filter((p) => status.get(p.id) === 'empty');
  const skippedPathIds = candidates.filter((p) => status.get(p.id) !== 'empty').map((p) => p.id);

  if (!toFill.length || !(spec.height > 0)) {
    return { pathIds: [], skippedPathIds, picks: [], unmatched: [], stack: null };
  }

  const runs = planSketchFillAll(toFill, spec, materials).runs;
  // Stock counted the way the recommendation tab counts it - see `freeStock`.
  const hasStock = stockEntered(materials);
  const free = hasStock ? freeStock(materials, pieces) : undefined;
  const pressure = hasStock ? stockPressure(materials, pieces) : undefined;

  // The job's stack, once the first run has settled it. Held in an object so
  // the loop below reads it as it stands on each pass.
  const job: { stack: number[] | null } = { stack: null };
  const picks: FillAllPlan['picks'] = [];
  const unmatched: RunInfo[] = [];
  for (const run of runs) {
    const { variants } = recommendFills({
      length: run.length,
      height: spec.height,
      faces: run.faces,
      materials,
      free,
      pressure,
      filters: { ...DEFAULT_FILL_FILTERS, useStock: hasStock },
      limit: 60,
    });
    const settled = job.stack;
    const best = settled ? variants.find((v) => sameStack(v.stack, settled)) : variants[0];
    if (!best) {
      unmatched.push(run);
      continue;
    }
    if (!job.stack) job.stack = [...best.stack];
    picks.push({ runKey: run.key, variant: best });
  }

  return { pathIds: toFill.map((p) => p.id), skippedPathIds, picks, unmatched, stack: job.stack };
}
