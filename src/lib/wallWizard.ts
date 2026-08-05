import type { Material, Piece, WallSpec } from '../types';
import { uid } from './ids';
import { planH, planW } from './geometry';
import {
  coverFace,
  optionsAt,
  panelDepthFor,
  panelHeights,
  pickByLength,
  placeAt,
  coverExact,
  type PanelOption,
} from './formwork';

/**
 * Generates the formwork for a straight wall from its run, thickness and pour
 * height.
 *
 * In PLAN — looking down — a wall is two parallel faces standing off the
 * concrete, closed at the ends if this pour ends there:
 *
 *     ══════════════════════════   face A
 *     ░░░░░░ concrete ░░░░░░░░░░   thickness
 *     ══════════════════════════   face B
 *     └────── length ──────────┘
 *
 * Two things differ from a column and drive the whole layout. A wall is open
 * along its length rather than closed around a small section, so ties are
 * spaced ALONG the run instead of two per ring — on a long wall that is the
 * difference between a handful of ties and dozens. And the ends may be open on
 * purpose, where the pour meets an earlier one or existing structure, so
 * closing them is a choice rather than a given.
 *
 * As with columns, geometry the catalog cannot satisfy is reported rather than
 * quietly rounded: an under-count here is a short delivery on site.
 */

export interface WallPlan {
  pieces: Piece[];
  warnings: string[];
  summary: {
    panels: number;
    fillers: number;
    stopEnds: number;
    walers: number;
    ties: number;
    courses: number;
    /** outer size of the formwork in plan, cm */
    outerLength: number;
    outerThickness: number;
  };
}

export function planWall(spec: WallSpec, materials: Material[]): WallPlan {
  const warnings: string[] = [];
  const pieces: Piece[] = [];
  const empty = {
    panels: 0,
    fillers: 0,
    stopEnds: 0,
    walers: 0,
    ties: 0,
    courses: 0,
    outerLength: 0,
    outerThickness: 0,
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
  const panelDepth = panelDepthFor(optionsAt(materials, 'panel', courseHeight));

  const { length, thickness, originX, originY } = spec;

  if (thickness <= 0 || length <= 0) {
    return { pieces: [], warnings: ['კედლის სიგრძე და სისქე ნულზე მეტი უნდა იყოს.'], summary: empty };
  }

  /**
   * With stop-ends the two long faces wrap past the concrete and the end panel
   * closes between them — otherwise a panel-thickness hole is left at all four
   * corners, exactly as it would be on a column laid without corner profiles.
   * Without stop-ends the faces span the concrete only, because the run
   * continues and the next pour picks it up.
   */
  const faceLength = spec.includeStopEnds ? length + panelDepth * 2 : length;
  const faceStartX = spec.includeStopEnds ? originX - panelDepth : originX;

  let panelCount = 0;
  let fillerCount = 0;
  let stopEndCount = 0;
  let elevation = 0;

  /** Lay one run of panels; `horizontal` false turns them a quarter turn. */
  const layRun = (
    startX: number,
    startY: number,
    runLength: number,
    horizontal: boolean,
    panelOptions: PanelOption[],
    fillerOptions: PanelOption[],
    z: number,
    fillersAlone = false,
  ): { panels: number; fillers: number } => {
    const { used, remainder } = coverFace(runLength, panelOptions, fillerOptions, fillersAlone);

    if (!used.length) {
      warnings.push(
        `${runLength} სმ სიგრძის მხარე ვერ დაიფარა — ყველაზე ვიწრო პანელია ${
          panelOptions.length ? Math.min(...panelOptions.map((o) => o.w)) : '—'
        } სმ.`,
      );
    } else if (remainder > 0.01) {
      warnings.push(
        `${runLength} სმ მხარეზე დარჩა ${remainder} სმ — ამ ზომის ელემენტი კატალოგში არ არის.`,
      );
    }

    let panels = 0;
    let fillers = 0;
    let offset = 0;
    for (const option of used) {
      const pw = planW(option.material);
      const ph = planH(option.material);
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

  for (let c = 0; c < courseCount; c++) {
    const thisHeight = courses[c] ?? courseHeight;
    const panelOptions = optionsAt(materials, 'panel', thisHeight);
    const fillerOptions = optionsAt(materials, 'filler', thisHeight);

    const tally = (r: { panels: number; fillers: number }) => {
      panelCount += r.panels;
      fillerCount += r.fillers;
    };

    // The two long faces, one either side of the concrete.
    tally(
      layRun(faceStartX, originY - panelDepth, faceLength, true, panelOptions, fillerOptions, elevation),
    );
    tally(
      layRun(faceStartX, originY + thickness, faceLength, true, panelOptions, fillerOptions, elevation),
    );

    // The ends, closing between the faces.
    if (spec.includeStopEnds) {
      const before = pieces.length;
      tally(
        layRun(originX - panelDepth, originY, thickness, false, panelOptions, fillerOptions, elevation, true),
      );
      tally(
        layRun(originX + length, originY, thickness, false, panelOptions, fillerOptions, elevation, true),
      );
      stopEndCount += pieces.length - before;
    }

    elevation += thisHeight;
  }

  const outerLength = spec.includeStopEnds ? length + panelDepth * 2 : length;
  const outerThickness = thickness + panelDepth * 2;
  const totalHeight = courses.reduce((sum, h) => sum + h, 0);

  // ── Walers: runs along the outside of each face at every level ────────────
  let walerCount = 0;
  let tieCount = 0;

  if (spec.includeWalers && spec.walerSpacing > 0 && totalHeight > 0) {
    const levels = Math.max(1, Math.floor(totalHeight / spec.walerSpacing));
    if (!materials.some((m) => m.category === 'waler')) {
      warnings.push('კატალოგში ვოლერები ვერ მოიძებნა.');
    } else {
      const sample = pickByLength(materials, 'waler', outerLength);
      const walerDepth = sample ? planH(sample) : 9;

      const tie = spec.includeTies
        ? pickByLength(materials, 'rod', outerThickness + 10)
        : undefined;
      if (spec.includeTies && !tie) warnings.push('კატალოგში ჭანჭიკები ვერ მოიძებნა.');

      // How many ties fit along the run. A wall is tied at intervals down its
      // length, so this scales with the wall — unlike a column, which takes two
      // per ring however big it is.
      const tiesPerLevel =
        spec.includeTies && spec.tieSpacing > 0 ? Math.max(1, Math.round(length / spec.tieSpacing)) : 0;

      for (let level = 0; level < levels; level++) {
        const ringZ = spec.walerSpacing * level + spec.walerSpacing / 2;

        for (const crossY of [
          originY - panelDepth - walerDepth,
          originY + thickness + panelDepth,
        ]) {
          const waler = pickByLength(materials, 'waler', outerLength);
          if (!waler) continue;
          const pw = planW(waler);
          const ph = planH(waler);
          const perRun = Math.max(1, Math.ceil(outerLength / pw));
          // Stock lengths rarely match the run exactly; centre the overhang so
          // the waler stays symmetric rather than jutting out at one end only.
          const start = faceStartX - (perRun * pw - outerLength) / 2;
          for (let i = 0; i < perRun; i++) {
            const { x, y } = placeAt(start + i * pw, crossY, pw, ph, 0);
            pieces.push({ id: uid(), materialId: waler.id, x, y, rot: 0, z: ringZ });
            walerCount++;
          }
        }

        // Ties cross the wall, so in plan they run across the thickness.
        if (tie && tiesPerLevel > 0) {
          const tw = planW(tie);
          const th = planH(tie);
          const pitch = length / tiesPerLevel;
          for (let i = 0; i < tiesPerLevel; i++) {
            // Centred in each bay rather than on the ends, where a tie would
            // clash with the stop-end.
            const atX = originX + pitch * (i + 0.5);
            const { x, y } = placeAt(
              atX - th / 2,
              originY + thickness / 2 - tw / 2,
              tw,
              th,
              90,
            );
            pieces.push({ id: uid(), materialId: tie.id, x, y, rot: 90, z: ringZ });
            tieCount++;
          }
        }
      }
    }
  }

  return {
    pieces,
    // Each face of each course reports for itself, so identical courses produce
    // the same sentence repeatedly. Courses with different geometry differ and
    // are kept.
    warnings: [...new Set(warnings)],
    summary: {
      panels: panelCount,
      fillers: fillerCount,
      stopEnds: stopEndCount,
      walers: walerCount,
      ties: tieCount,
      courses: courses.length,
      outerLength: Math.round(outerLength),
      outerThickness: Math.round(outerThickness),
    },
  };
}
