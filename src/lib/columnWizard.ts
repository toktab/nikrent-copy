import type { ColumnSpec, Material, Piece } from '../types';
import { uid } from './ids';
import { lengthCm, planH, planW, rotatedExtent } from './geometry';

/**
 * Generates the formwork for a rectangular column from its cross-section and
 * pour height.
 *
 * The drawing surface is a PLAN view — looking down on the column — so the four
 * faces are laid out as an actual rectangle around the concrete, the way a
 * formwork layout drawing shows it:
 *
 *        ┌──── face (top) ────┐
 *        │                    │
 *      face                 face
 *        │                    │
 *        └─── face (bottom) ──┘
 *
 * A panel occupies `width × 9 cm` in plan; its 300 cm is height, out of the
 * page. Walers ring the outside at each level and tie rods cross the column.
 *
 * Where the catalog cannot satisfy the geometry exactly (an odd face width, a
 * pour height that does not divide into available panel heights) the generator
 * reports a warning rather than silently rounding — an under-count here becomes
 * a short delivery on site.
 */

export interface ColumnPlan {
  pieces: Piece[];
  warnings: string[];
  summary: {
    panels: number;
    /** ჩაკერება used to close what the panel widths could not */
    fillers: number;
    corners: number;
    walers: number;
    ties: number;
    /** how many panel courses stack up the height */
    courses: number;
    /** outer size of the formwork box in plan, cm */
    outerX: number;
    outerY: number;
  };
}

interface PanelOption {
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
function panelHeights(materials: Material[]): number[] {
  const heights = new Set<number>();
  for (const m of materials) if (m.category === 'panel') heights.add(m.h);
  return [...heights].sort((a, b) => b - a);
}

/** Materials of one category that stand a given course height. */
function optionsAt(materials: Material[], category: Material['category'], height: number) {
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
function coverFace(
  target: number,
  panels: PanelOption[],
  fillers: PanelOption[],
): { used: PanelOption[]; remainder: number } {
  const byPanels = coverExact(
    target,
    panels.map((o) => o.w),
  );
  const used = byPanels.picks.map((i) => panels[i]);
  let remainder = byPanels.remainder;

  if (used.length && remainder > 0.01 && fillers.length) {
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
 * store. Without it, every rotated face lands offset from the column.
 */
function placeAt(left: number, top: number, pw: number, ph: number, rot: number) {
  const { w, h } = rotatedExtent(pw, ph, rot);
  return { x: left + w / 2 - pw / 2, y: top + h / 2 - ph / 2 };
}

/** Smallest material of a category whose length reaches `needed` cm. */
function pickByLength(materials: Material[], category: Material['category'], needed: number) {
  const candidates = materials
    .filter((m) => m.category === category)
    .sort((a, b) => lengthCm(a) - lengthCm(b));
  return candidates.find((m) => lengthCm(m) >= needed - 0.01) ?? candidates[candidates.length - 1];
}

export function planColumn(spec: ColumnSpec, materials: Material[]): ColumnPlan {
  const warnings: string[] = [];
  const pieces: Piece[] = [];
  const empty = {
    panels: 0,
    fillers: 0,
    corners: 0,
    walers: 0,
    ties: 0,
    courses: 0,
    outerX: 0,
    outerY: 0,
  };

  const heights = panelHeights(materials);
  if (!heights.length) {
    return { pieces: [], warnings: ['კატალოგში პანელები ვერ მოიძებნა.'], summary: empty };
  }

  // ── Vertical: how many panel courses stack up the pour height ────────────
  const stack = coverExact(spec.height, heights);
  const courses = stack.picks.map((i) => heights[i]);
  if (!courses.length) {
    warnings.push(
      `სიმაღლე ${spec.height} სმ ნებისმიერ პანელზე დაბალია — უმცირესი პანელია ${Math.min(...heights)} სმ.`,
    );
  }
  if (stack.remainder > 0.01) {
    warnings.push(
      `სიმაღლეში დარჩა ${stack.remainder} სმ — საჭიროა ჩაკერება ან სპეციალური ელემენტი.`,
    );
  }

  const courseCount = Math.max(1, courses.length);
  const courseHeight = courses[0] ?? Math.min(...heights);

  // ── Plan: the panel thickness sets how far the formwork stands off ───────
  const firstCoursePanels = optionsAt(materials, 'panel', courseHeight);
  const panelDepth = firstCoursePanels.length ? planH(firstCoursePanels[0].material) : 9;
  const { sectionX, sectionY } = spec;

  /**
   * Lay one face at a given elevation. Every stacked course emits real pieces,
   * so the bill of materials counts what will actually be delivered rather
   * than a multiplier applied after the fact.
   */
  const layFace = (
    startX: number,
    startY: number,
    faceLength: number,
    horizontal: boolean,
    panelOptions: PanelOption[],
    fillerOptions: PanelOption[],
    z: number,
  ): { panels: number; fillers: number } => {
    const { used, remainder } = coverFace(faceLength, panelOptions, fillerOptions);

    if (!used.length) {
      warnings.push(
        `${faceLength} სმ სიგრძის მხარე ვერ დაიფარა — ყველაზე ვიწრო პანელია ${
          panelOptions.length ? Math.min(...panelOptions.map((o) => o.w)) : '—'
        } სმ.`,
      );
    } else if (remainder > 0.01) {
      warnings.push(
        `${faceLength} სმ მხარეზე დარჩა ${remainder} სმ — ამ ზომის ელემენტი კატალოგში არ არის.`,
      );
    }

    let panels = 0;
    let fillers = 0;
    let offset = 0;
    for (const option of used) {
      const pw = planW(option.material);
      const ph = planH(option.material);
      // A vertical face is the same panel turned a quarter turn in plan.
      const rot = horizontal ? 0 : 90;
      const { x, y } = placeAt(
        horizontal ? startX + offset : startX,
        horizontal ? startY : startY + offset,
        pw,
        ph,
        rot,
      );
      pieces.push({ id: uid(), materialId: option.material.id, x, y, rot, z });
      if (option.material.category === 'filler') fillers++;
      else panels++;
      offset += pw;
    }
    return { panels, fillers };
  };

  const originX = spec.originX;
  const originY = spec.originY;

  const cornerMaterials = materials.filter((m) => m.category === 'corner' && m.shape === 'L');
  if (spec.includeCorners && !cornerMaterials.length) {
    warnings.push('კატალოგში კუთხის პროფილი ვერ მოიძებნა.');
  }

  /**
   * The corner profile for a course must be as tall as that course — a 300 cm
   * corner on a 150 cm course would stand 150 cm proud of the pour. The wizard
   * used to choose one corner for the whole column and repeat it at every
   * course elevation, which did exactly that.
   */
  const cornerFor = (height: number): Material | null =>
    spec.includeCorners ? (cornerMaterials.find((m) => m.h === height) ?? null) : null;

  // Stack the courses up the pour. Each one is placed for real at its own
  // elevation, so the BOM counts every panel that has to be delivered.
  let panelCount = 0;
  let fillerCount = 0;
  let cornerCount = 0;
  let elevation = 0;

  for (let c = 0; c < courseCount; c++) {
    const thisHeight = courses[c] ?? courseHeight;
    const panelOptions = optionsAt(materials, 'panel', thisHeight);
    const fillerOptions = optionsAt(materials, 'filler', thisHeight);
    const corner = cornerFor(thisHeight);
    const first = c === 0;

    if (first && spec.includeCorners && cornerMaterials.length && !corner) {
      warnings.push(`${thisHeight} სმ სიმაღლის კუთხის პროფილი კატალოგში არ არის.`);
    }

    /**
     * How much of the concrete face the corner profile itself covers.
     *
     * A corner's leg is measured from the OUTSIDE of the formwork box, so a leg
     * standing off a 9 cm panel reaches `leg − 9` along the concrete. Using the
     * bare leg here left a panel-thickness hole between every corner and the
     * panel beside it — visible on the drawing and short on the order.
     */
    const inset = corner ? Math.max(0, planW(corner) - panelDepth) : 0;

    /**
     * Face lengths. With corner profiles all four faces sit between them.
     * Without corners the two X faces wrap the ends instead: four faces each
     * spanning only their own section leaves a panel-thickness hole at every
     * box corner, so the box has to close pinwheel-fashion, as it does on site.
     */
    const xFaceLength = corner ? sectionX - inset * 2 : sectionX + panelDepth * 2;
    const xFaceStart = corner ? originX + inset : originX - panelDepth;
    const yFaceLength = sectionY - inset * 2;
    const yFaceStart = originY + inset;

    if (first && !corner && spec.includeCorners === false) {
      warnings.push(
        `კუთხის პროფილების გარეშე ორი მხარე ${panelDepth * 2} სმ-ით გრძელდება (${xFaceLength} სმ), რომ ყუთის კუთხეები დაიხუროს.`,
      );
    }
    if (first && corner && (xFaceLength <= 0 || yFaceLength <= 0)) {
      warnings.push(
        `კვეთა ${sectionX}×${sectionY} სმ ძალიან პატარაა ${planW(corner)} სმ კუთხეებისთვის — პანელი აღარ ეტევა.`,
      );
    }

    const tally = (r: { panels: number; fillers: number }) => {
      panelCount += r.panels;
      fillerCount += r.fillers;
    };

    const lay = (x: number, y: number, len: number, horizontal: boolean) =>
      tally(layFace(x, y, len, horizontal, panelOptions, fillerOptions, elevation));

    if (xFaceLength > 0) {
      lay(xFaceStart, originY - panelDepth, xFaceLength, true);
      lay(xFaceStart, originY + sectionY, xFaceLength, true);
    }
    if (yFaceLength > 0) {
      lay(originX - panelDepth, yFaceStart, yFaceLength, false);
      lay(originX + sectionX, yFaceStart, yFaceLength, false);
    }

    // ── Corners, one at each concrete corner, turned to face outwards ──────
    if (corner) {
      const cw = planW(corner);
      const ch = planH(corner);
      const spots: Array<[number, number, number]> = [
        [originX - panelDepth, originY - panelDepth, 0],
        [originX + sectionX + panelDepth - cw, originY - panelDepth, 90],
        [originX + sectionX + panelDepth - cw, originY + sectionY + panelDepth - ch, 180],
        [originX - panelDepth, originY + sectionY + panelDepth - ch, 270],
      ];
      for (const [left, top, rot] of spots) {
        const { x, y } = placeAt(left, top, cw, ch, rot);
        pieces.push({ id: uid(), materialId: corner.id, x, y, rot, z: elevation });
        cornerCount++;
      }
    }

    elevation += thisHeight;
  }

  const outerX = sectionX + panelDepth * 2;
  const outerY = sectionY + panelDepth * 2;

  // ── Walers: a ring around the outside at every level ─────────────────────
  let walerCount = 0;
  let tieCount = 0;
  const totalHeight = courses.reduce((sum, h) => sum + h, 0);

  if (spec.includeWalers && spec.walerSpacing > 0 && totalHeight > 0) {
    const levels = Math.max(1, Math.floor(totalHeight / spec.walerSpacing));
    if (!materials.some((m) => m.category === 'waler')) {
      warnings.push('კატალოგში ვოლერები ვერ მოიძებნა.');
    } else {
      // One run per side of the ring, sized to that side — never one long bar
      // spanning the whole column, which would over-order several times over.
      // Sit just outside the panel faces, hugging the formwork box.
      const walerDepth = planH(pickByLength(materials, 'waler', outerX) ?? materials[0]);
      const runs = [
        { along: originX - panelDepth, cross: originY - panelDepth - walerDepth, span: outerX, horizontal: true },
        { along: originX - panelDepth, cross: originY + sectionY + panelDepth, span: outerX, horizontal: true },
        { along: originY - panelDepth, cross: originX - panelDepth - walerDepth, span: outerY, horizontal: false },
        { along: originY - panelDepth, cross: originX + sectionX + panelDepth, span: outerY, horizontal: false },
      ];

      const tie = spec.includeTies
        ? pickByLength(materials, 'rod', Math.max(sectionX, sectionY) + panelDepth * 2 + 10)
        : null;
      if (spec.includeTies && !tie) warnings.push('კატალოგში ჭანჭიკები ვერ მოიძებნა.');

      // Every ring is placed for real at its own height. They coincide in plan
      // — which is correct for a plan view — but they are separate pieces on
      // the order, and the 3D view shows them at their true elevations.
      for (let level = 0; level < levels; level++) {
        const ringZ = spec.walerSpacing * level + spec.walerSpacing / 2;

        for (const run of runs) {
          const waler = pickByLength(materials, 'waler', run.span);
          if (!waler) continue;
          const pw = planW(waler);
          const ph = planH(waler);
          const rot = run.horizontal ? 0 : 90;
          const perRun = Math.max(1, Math.ceil(run.span / pw));
          // Stock lengths rarely match the side exactly; centre the overhang so
          // the ring stays symmetric instead of jutting out on one side only.
          const start = run.along - (perRun * pw - run.span) / 2;
          for (let i = 0; i < perRun; i++) {
            const at = start + i * pw;
            const { x, y } = placeAt(
              run.horizontal ? at : run.cross,
              run.horizontal ? run.cross : at,
              pw,
              ph,
              rot,
            );
            pieces.push({ id: uid(), materialId: waler.id, x, y, rot, z: ringZ });
            walerCount++;
          }
        }

        // Two ties per ring, one across each axis, both centred on the column.
        if (tie) {
          const tw = planW(tie);
          const th = planH(tie);
          const cx = originX + sectionX / 2;
          const cy = originY + sectionY / 2;
          const across = placeAt(cx - tw / 2, cy - th / 2, tw, th, 0);
          const along = placeAt(cx - th / 2, cy - tw / 2, tw, th, 90);
          pieces.push({ id: uid(), materialId: tie.id, ...across, rot: 0, z: ringZ });
          pieces.push({ id: uid(), materialId: tie.id, ...along, rot: 90, z: ringZ });
          tieCount += 2;
        }
      }
    }
  }

  return {
    pieces,
    // Each face of each course reports for itself, so the four sides of one
    // course produce the same sentence four times. Courses with different
    // geometry say different things and are kept.
    warnings: [...new Set(warnings)],
    summary: {
      panels: panelCount,
      fillers: fillerCount,
      corners: cornerCount,
      walers: walerCount,
      ties: tieCount,
      courses: courses.length,
      outerX: Math.round(outerX),
      outerY: Math.round(outerY),
    },
  };
}
