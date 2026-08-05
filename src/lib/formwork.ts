import type { Material } from '../types';
import { lengthCm, planH, planW, rotatedExtent } from './geometry';

/**
 * Geometry shared by the formwork generators.
 *
 * Columns and walls differ in how the faces are arranged, not in how a face is
 * covered or how a piece is positioned — so those parts live here and both
 * wizards use them. Duplicating them would mean a fix like the rotated-origin
 * correction below getting made in one generator and not the other.
 */

export interface PanelOption {
  material: Material;
  w: number;
}

/** Half-centimetre steps: catalog sizes are whole cm, custom ones may be .5. */
const RESOLUTION = 2;

export interface CoverResult {
  /** indices into the `sizes` array, widest first */
  picks: number[];
  /** cm that no combination could cover */
  remainder: number;
}

/**
 * Fewest pieces whose sizes add up to exactly `target`, or the best cover short
 * of it when no exact combination exists.
 *
 * Greedy largest-first looks obvious and is wrong. A 105 cm face has an exact
 * 75 + 30 answer, but greedy takes the 90 first and is then stuck with 15 it
 * cannot place — so the wizard reported a shortfall that did not exist and the
 * layout came up a panel short. The same trap hits stacking: a 180 cm pour is
 * 90 + 90, but greedy takes 150 and strands 30. Faces and pours are small and
 * quantised, so an exact search costs nothing and always finds the answer when
 * one exists.
 */
export function coverExact(target: number, sizes: number[]): CoverResult {
  const n = Math.round(target * RESOLUTION);
  const steps = sizes.map((s) => Math.round(s * RESOLUTION));
  if (n <= 0 || !steps.some((s) => s > 0)) {
    return { picks: [], remainder: Math.max(0, target) };
  }

  // best[i] = fewest pieces summing to exactly i; pick[i] = the last one used.
  const best = new Float64Array(n + 1).fill(Infinity);
  const pick = new Int32Array(n + 1).fill(-1);
  best[0] = 0;

  for (let i = 1; i <= n; i++) {
    for (let k = 0; k < steps.length; k++) {
      const step = steps[k];
      if (step <= 0 || step > i) continue;
      const candidate = best[i - step] + 1;
      if (candidate < best[i]) {
        best[i] = candidate;
        pick[i] = k;
      }
    }
  }

  // Exact if the target itself is reachable; otherwise cover as much as any
  // combination can and report the gap honestly.
  let reach = n;
  while (reach > 0 && !Number.isFinite(best[reach])) reach--;

  const picks: number[] = [];
  for (let at = reach; at > 0; ) {
    const k = pick[at];
    picks.push(k);
    at -= steps[k];
  }
  picks.sort((a, b) => steps[b] - steps[a]); // widest first, the order they lay

  return { picks, remainder: Math.round(((n - reach) / RESOLUTION) * 100) / 100 };
}

/** Panel heights available in the catalog, tallest first. */
export function panelHeights(materials: Material[]): number[] {
  const heights = new Set<number>();
  for (const m of materials) if (m.category === 'panel') heights.add(m.h);
  return [...heights].sort((a, b) => b - a);
}

/** Materials of one category that stand a given course height. */
export function optionsAt(
  materials: Material[],
  category: Material['category'],
  height: number,
): PanelOption[] {
  return materials
    .filter((m) => m.category === category && m.h === height)
    .map((m): PanelOption => ({ material: m, w: planW(m) }))
    .sort((a, b) => b.w - a.w);
}

/**
 * Cover one face: panels first, then close whatever strip is left with
 * ჩაკერება fillers.
 *
 * Fillers are searched separately rather than thrown into one big search, and
 * only once the panels have covered something. They exist to close a strip the
 * panel widths cannot reach — a 70 cm face is 60 + a 10 cm filler — not to
 * build a whole face out of 5 cm strips, which is exactly what a single
 * combined search does when no panel happens to fit.
 */
export function coverFace(
  target: number,
  panels: PanelOption[],
  fillers: PanelOption[],
  /**
   * Let fillers cover the run on their own when no panel fits at all.
   *
   * Off for a long face, where it would build a 3 m wall out of 5 cm strips.
   * On for a short closure like a wall stop-end: a 20 cm end is narrower than
   * every panel in the catalog, and two 10 cm fillers is exactly how it is
   * closed on site. Without this the end is simply left open.
   */
  fillersAlone = false,
): { used: PanelOption[]; remainder: number } {
  const byPanels = coverExact(
    target,
    panels.map((o) => o.w),
  );
  const used = byPanels.picks.map((i) => panels[i]);
  let remainder = byPanels.remainder;

  if ((used.length || fillersAlone) && remainder > 0.01 && fillers.length) {
    const byFillers = coverExact(
      remainder,
      fillers.map((o) => o.w),
    );
    used.push(...byFillers.picks.map((i) => fillers[i]));
    remainder = byFillers.remainder;
  }
  return { used, remainder };
}

/**
 * `Piece.x/y` is the top-left of the UN-rotated box, and rotation happens about
 * the centre — so a turned piece does not start where its footprint starts.
 * This converts "I want the footprint's top-left corner here" into the x/y to
 * store. Without it, every rotated face lands offset from the assembly.
 */
export function placeAt(left: number, top: number, pw: number, ph: number, rot: number) {
  const { w, h } = rotatedExtent(pw, ph, rot);
  return { x: left + w / 2 - pw / 2, y: top + h / 2 - ph / 2 };
}

/** Smallest material of a category whose length reaches `needed` cm. */
export function pickByLength(
  materials: Material[],
  category: Material['category'],
  needed: number,
): Material | undefined {
  const candidates = materials
    .filter((m) => m.category === category)
    .sort((a, b) => lengthCm(a) - lengthCm(b));
  return candidates.find((m) => lengthCm(m) >= needed - 0.01) ?? candidates[candidates.length - 1];
}

/** Plan thickness of the panels standing a given course, or the Du default. */
export function panelDepthFor(options: PanelOption[]): number {
  return options.length ? planH(options[0].material) : 9;
}
