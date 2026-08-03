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
  h: number;
}

function panelsByHeight(materials: Material[]): Map<number, PanelOption[]> {
  const map = new Map<number, PanelOption[]>();
  for (const m of materials) {
    if (m.category !== 'panel') continue;
    const list = map.get(m.h) ?? [];
    list.push({ material: m, w: m.w, h: m.h });
    map.set(m.h, list);
  }
  for (const list of map.values()) list.sort((a, b) => b.w - a.w);
  return map;
}

/** Greedy largest-first cover of `target` cm using the given panel widths. */
function coverWidth(
  target: number,
  options: PanelOption[],
): { used: PanelOption[]; remainder: number } {
  const used: PanelOption[] = [];
  let left = target;
  for (const option of options) {
    while (left >= option.w - 0.01) {
      used.push(option);
      left -= option.w;
    }
  }
  return { used, remainder: Math.max(0, Math.round(left * 100) / 100) };
}

/** Split the pour height into courses using the available panel heights. */
function planCourses(height: number, heights: number[]): { courses: number[]; remainder: number } {
  const sorted = [...heights].sort((a, b) => b - a);
  const courses: number[] = [];
  let left = height;
  for (const h of sorted) {
    while (left >= h - 0.01) {
      courses.push(h);
      left -= h;
    }
  }
  return { courses, remainder: Math.max(0, Math.round(left * 100) / 100) };
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
    corners: 0,
    walers: 0,
    ties: 0,
    courses: 0,
    outerX: 0,
    outerY: 0,
  };

  const byHeight = panelsByHeight(materials);
  if (!byHeight.size) {
    return { pieces: [], warnings: ['კატალოგში პანელები ვერ მოიძებნა.'], summary: empty };
  }

  // ── Vertical: how many panel courses stack up the pour height ────────────
  const { courses, remainder: heightRemainder } = planCourses(spec.height, [...byHeight.keys()]);
  if (!courses.length) {
    warnings.push(
      `სიმაღლე ${spec.height} სმ ნებისმიერ პანელზე დაბალია — უმცირესი პანელია ${Math.min(...byHeight.keys())} სმ.`,
    );
  }
  if (heightRemainder > 0.01) {
    warnings.push(
      `სიმაღლეში დარჩა ${heightRemainder} სმ — საჭიროა ჩაკერება ან სპეციალური ელემენტი.`,
    );
  }

  // Courses stack in the vertical direction, which is out of the page in plan.
  // Everything below is therefore drawn once and multiplied by the course count.
  const courseCount = Math.max(1, courses.length);
  const courseHeight = courses[0] ?? Math.min(...byHeight.keys());
  const options = byHeight.get(courseHeight) ?? [];

  // ── Plan: the panel thickness sets how far the formwork stands off ───────
  const panelDepth = options.length ? planH(options[0].material) : 9;
  const { sectionX, sectionY } = spec;

  /** Lay panels along one face, left to right, starting at (x, y). */
  const layFace = (
    startX: number,
    startY: number,
    faceLength: number,
    horizontal: boolean,
  ): number => {
    const { used, remainder } = coverWidth(faceLength, options);
    if (!used.length) {
      warnings.push(
        `${faceLength} სმ სიგრძის მხარე ვერ დაიფარა — ყველაზე ვიწრო პანელია ${
          options.length ? Math.min(...options.map((o) => o.w)) : '—'
        } სმ.`,
      );
    }
    if (remainder > 0.01) {
      warnings.push(`${faceLength} სმ მხარეზე დარჩა ${remainder} სმ — საჭიროა ჩაკერება.`);
    }

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
      pieces.push({ id: uid(), materialId: option.material.id, x, y, rot });
      offset += pw;
    }
    return used.length;
  };

  const originX = spec.originX;
  const originY = spec.originY;

  // Corner profiles occupy the ends of each face, so the panels only have to
  // cover what is left between them — getting this wrong over-orders panels.
  const cornerMaterials = materials.filter((m) => m.category === 'corner' && m.shape === 'L');
  const useCorners = spec.includeCorners && cornerMaterials.length > 0;
  const corner = useCorners
    ? (cornerMaterials.find((m) => m.h === courseHeight) ?? cornerMaterials[0])
    : null;
  const inset = corner ? planW(corner) : 0;

  const clearX = sectionX - inset * 2;
  const clearY = sectionY - inset * 2;
  if (useCorners && (clearX <= 0 || clearY <= 0)) {
    warnings.push(
      `კვეთა ${sectionX}×${sectionY} სმ ძალიან პატარაა ${inset} სმ კუთხეებისთვის — პანელი აღარ ეტევა.`,
    );
  }

  // Top and bottom faces run along X; left and right run along Y, set in by the
  // panel thickness so the four faces close a rectangle around the concrete.
  let panelCount = 0;
  if (clearX > 0) {
    panelCount += layFace(originX + inset, originY - panelDepth, clearX, true); // top
    panelCount += layFace(originX + inset, originY + sectionY, clearX, true); // bottom
  }
  if (clearY > 0) {
    panelCount += layFace(originX - panelDepth, originY + inset, clearY, false); // left
    panelCount += layFace(originX + sectionX, originY + inset, clearY, false); // right
  }

  // ── Corners ──────────────────────────────────────────────────────────────
  let cornerCount = 0;
  if (corner) {
    const cw = planW(corner);
    const ch = planH(corner);
    // One at each concrete corner, each turned to face outwards.
    const spots: Array<[number, number, number]> = [
      [originX - panelDepth, originY - panelDepth, 0],
      [originX + sectionX + panelDepth - cw, originY - panelDepth, 90],
      [originX + sectionX + panelDepth - cw, originY + sectionY + panelDepth - ch, 180],
      [originX - panelDepth, originY + sectionY + panelDepth - ch, 270],
    ];
    for (const [left, top, rot] of spots) {
      const { x, y } = placeAt(left, top, cw, ch, rot);
      pieces.push({ id: uid(), materialId: corner.id, x, y, rot });
      cornerCount++;
    }
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
      warnings.push('კატალოგში ვალერები ვერ მოიძებნა.');
    } else {
      // One run per side of the ring, sized to that side — never one long bar
      // spanning the whole column, which would over-order several times over.
      // Sit just outside the panel faces, hugging the formwork box.
      const walerDepth = planH(pickByLength(materials, 'waler', outerX) ?? materials[0]);
      const runs: Array<{ x: number; y: number; span: number; horizontal: boolean }> = [
        { x: originX - panelDepth, y: originY - panelDepth - walerDepth, span: outerX, horizontal: true },
        { x: originX - panelDepth, y: originY + sectionY + panelDepth, span: outerX, horizontal: true },
        { x: originX - panelDepth - walerDepth, y: originY - panelDepth, span: outerY, horizontal: false },
        { x: originX + sectionX + panelDepth, y: originY - panelDepth, span: outerY, horizontal: false },
      ];

      // In plan all levels sit on top of each other, so one ring is drawn and
      // the rest are counted — stacking them would just be visual noise.
      for (const run of runs) {
        const waler = pickByLength(materials, 'waler', run.span);
        if (!waler) continue;
        const pw = planW(waler);
        const ph = planH(waler);
        const rot = run.horizontal ? 0 : 90;
        const perRun = Math.max(1, Math.ceil(run.span / pw));
        for (let i = 0; i < perRun; i++) {
          const { x, y } = placeAt(
            run.horizontal ? run.x + i * pw : run.x,
            run.horizontal ? run.y : run.y + i * pw,
            pw,
            ph,
            rot,
          );
          pieces.push({ id: uid(), materialId: waler.id, x, y, rot });
          walerCount++;
        }
      }
      // Remaining levels are counted, not drawn (they coincide in plan).
      walerCount *= levels;

      if (spec.includeTies) {
        const tie = pickByLength(materials, 'rod', Math.max(sectionX, sectionY) + panelDepth * 2 + 10);
        if (tie) {
          // Two ties per ring, one across each axis.
          pieces.push({
            id: uid(),
            materialId: tie.id,
            x: originX - panelDepth,
            y: originY + sectionY / 2,
            rot: 0,
          });
          pieces.push({
            id: uid(),
            materialId: tie.id,
            x: originX + sectionX / 2,
            y: originY - panelDepth,
            rot: 90,
          });
          tieCount = 2 * levels;
        } else {
          warnings.push('კატალოგში ჭანჭიკები ვერ მოიძებნა.');
        }
      }
    }
  }

  // Panels and corners repeat per course as well.
  panelCount *= courseCount;
  cornerCount *= courseCount;

  return {
    pieces,
    warnings,
    summary: {
      panels: panelCount,
      corners: cornerCount,
      walers: walerCount,
      ties: tieCount,
      courses: courses.length,
      outerX: Math.round(outerX),
      outerY: Math.round(outerY),
    },
  };
}
