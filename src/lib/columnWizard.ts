import type { ColumnSpec, Material, Piece } from '../types';
import { uid } from './ids';
import { planH, planW } from './geometry';
import {
  coverExact,
  coverFace,
  optionsAt,
  panelDepthFor,
  panelHeights,
  pickByLength,
  placeAt,
  type PanelOption,
} from './formwork';

// Re-exported: the cover search was tested here before it moved to ./formwork,
// and it is still the natural place to look for it from a wizard's tests.
export { coverExact, type CoverResult } from './formwork';

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
      `სიმაღლე ${spec.height} სმ ნებისმიერ პანელზე დაბალია - უმცირესი პანელია ${Math.min(...heights)} სმ.`,
    );
  }
  if (stack.remainder > 0.01) {
    warnings.push(
      `სიმაღლეში დარჩა ${stack.remainder} სმ - საჭიროა ჩაკერება ან სპეციალური ელემენტი.`,
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
        `${faceLength} სმ სიგრძის მხარე ვერ დაიფარა - ყველაზე ვიწრო პანელია ${
          panelOptions.length ? Math.min(...panelOptions.map((o) => o.w)) : '-'
        } სმ.`,
      );
    } else if (remainder > 0.01) {
      warnings.push(
        `${faceLength} სმ მხარეზე დარჩა ${remainder} სმ - ამ ზომის ელემენტი კატალოგში არ არის.`,
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
        `კვეთა ${sectionX}×${sectionY} სმ ძალიან პატარაა ${planW(corner)} სმ კუთხეებისთვის - პანელი აღარ ეტევა.`,
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
      // An L is drawn with its legs on the LEFT and the BOTTOM, so the notch
      // starts out facing up-right. The top-left corner of the column needs its
      // legs on the top and the left — a quarter turn on from that. Every spot
      // used to be one turn short, which pointed each notch outwards and buried
      // a leg in the concrete.
      const spots: Array<[number, number, number]> = [
        [originX - panelDepth, originY - panelDepth, 90],
        [originX + sectionX + panelDepth - cw, originY - panelDepth, 180],
        [originX + sectionX + panelDepth - cw, originY + sectionY + panelDepth - ch, 270],
        [originX - panelDepth, originY + sectionY + panelDepth - ch, 0],
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
