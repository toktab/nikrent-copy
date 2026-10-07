import type { Material, Piece, SketchPath } from '../types';
import { totalStock } from './inventory';
import { checkPath } from './lengthCheck';

/**
 * The architect's own workbook (`column_formulas.xlsx`), filled in from the
 * open drawing.
 *
 * Same sheets, same column letters, same row names and order, same formulas -
 * so the file he gets is the one he already works from and trusts, only with
 * the counts already typed. One drawing is one კონსტრუქცია; the other four
 * construction columns of ჯამი are left blank for him to use, as in his blank.
 *
 * Pure: the layout and every value are worked out here and unit-tested; the
 * XLSX writing is `exportArchitectWorkbook` in `excelExport.ts`.
 */

/** A value, or one of his formulas together with the value it comes to. */
export type WorkbookCell = string | number | { f: string; v: number } | null;

export interface WorkbookSheet {
  name: string;
  rows: WorkbookCell[][];
  /** column widths, characters */
  widths: number[];
}

export interface WorkbookInput {
  materials: Material[];
  pieces: Piece[];
  sketch: SketchPath[];
  drawingName: string;
}

export const CONSTRUCTION_SHEET = 'კონსტრუქცია 1';
const TOTALS_SHEET = 'ჯამი';

/** His row order, top to bottom, as in the blank workbook - by built-in id. */
const WORKBOOK_ORDER = [
  'waler-100',
  'waler-120',
  'waler-150',
  'waler-300',
  'waler-600',
  'corner-outer-300',
  'post-100',
  'post-200',
  'acc-crane-hook',
  'corner-plate',
  'corner-connector',
  'corner-connector-40',
  'acc-panel-clamp-set',
  'panel-30x300',
  'panel-45x150',
  'panel-45x300',
  'panel-60x150',
  'panel-60x300',
  'panel-75x090',
  'panel-75x150',
  'panel-75x300',
  'panel-90x300',
  'acc-panel-concrete-anchor',
  'acc-nut-washer',
  'corner-inner-20x20x150',
  'corner-inner-20x20x300',
  'corner-inner-20x20x300-joni',
  'filler-10x150',
  'filler-10x300',
  'filler-5x150',
  'filler-5x300',
  'acc-latch-fix',
  'acc-latch-adjustable',
  'acc-base-clamp',
  'acc-scaffold-foot',
  'acc-fixator-sleeve',
  'acc-fixator-nut',
  'rod-60',
  'rod-80',
  'rod-100',
  'rod-150',
];

/**
 * A material as his workbook - and the accounting export his ნაშთი sheet is
 * matched against - names it: "Du კოლონის " in front of the Du parts, the tie
 * rods and their fixings named for the fixator they belong to. A component
 * somebody added keeps its own name.
 */
export function workbookName(m: Material): string {
  if (!m.builtin) return m.name;
  if (m.id.startsWith('rod-')) return `კოლონის ${m.name} ფიქსატორის`;
  if (m.id === 'acc-fixator-sleeve' || m.id === 'acc-fixator-nut') return `კოლონის ${m.name}`;
  return `Du კოლონის ${m.name}`;
}

/**
 * Face area of one piece, m², the way his ჯამი sheet counts it: width × height
 * for panels and fillers, BOTH legs for an inside corner (0.4 × 3 for a
 * 20*20*300), nothing for outside corners and hardware.
 */
export function workbookAreaM2(m: Material): number {
  if (m.category === 'panel' || m.category === 'filler') return round4((m.w * m.h) / 10000);
  if (m.category === 'corner' && m.shape === 'L' && m.name.includes('შიდა')) {
    return round4((2 * m.w * m.h) / 10000);
  }
  return 0;
}

const round2 = (v: number) => Math.round(v * 100) / 100;
const round4 = (v: number) => Math.round(v * 10000) / 10000;

/** His order first; anything else after, in catalog order. */
function inWorkbookOrder(materials: Material[]): Material[] {
  const rank = new Map(WORKBOOK_ORDER.map((id, i) => [id, i]));
  return [...materials]
    .map((m, i) => ({ m, i }))
    .sort((a, b) => (rank.get(a.m.id) ?? 1000 + a.i) - (rank.get(b.m.id) ?? 1000 + b.i))
    .map(({ m }) => m);
}

export function buildArchitectWorkbook(input: WorkbookInput): WorkbookSheet[] {
  const materials = inWorkbookOrder(input.materials);
  const counts = new Map<string, number>();
  for (const p of input.pieces) counts.set(p.materialId, (counts.get(p.materialId) ?? 0) + 1);
  const count = (m: Material) => counts.get(m.id) ?? 0;
  const q = (sheet: string) => `'${sheet}'`;

  // ── კონსტრუქცია 1: count for one construction × how many constructions ──
  const construction: WorkbookCell[][] = [
    ['დეტალის დასახელება', 'დეტალის რაოდენობა 1 კონსტრუქციაზე', 'კონსტრუქციის რაოდენობა', 'დეტალის რაოდენობა სულ', null, 'ნახაზი'],
  ];
  materials.forEach((m, i) => {
    const r = i + 2;
    const row: WorkbookCell[] = [workbookName(m), count(m), 1, { f: `B${r}*C${r}`, v: count(m) }];
    if (i === 0) row.push(null, input.drawingName);
    construction.push(row);
  });

  // ── ჯამი: per construction, total, weight, area ──
  const totals: WorkbookCell[][] = [
    [
      'დეტალის დასახელება',
      'რაოდენობა კონსტრუქცია 1',
      'რაოდენობა კონსტრუქცია 2',
      'რაოდენობა კონსტრუქცია 3',
      'რაოდენობა კონსტრუქცია 4',
      'რაოდენობა კონსტრუქცია 5',
      'სულ რაოდენობა',
      'ერთეულის წონა',
      'სულ წონა',
      'ერთეულის ფართობი კვ. მ',
      'სულ ფართობი კვ. მ',
    ],
  ];
  let weightTotal = 0;
  let areaTotal = 0;
  materials.forEach((m, i) => {
    const r = i + 2;
    const n = count(m);
    const area = workbookAreaM2(m);
    weightTotal += n * m.weight;
    areaTotal += n * area;
    totals.push([
      workbookName(m),
      { f: `SUMIFS(${q(CONSTRUCTION_SHEET)}!D:D,${q(CONSTRUCTION_SHEET)}!A:A,A${r})`, v: n },
      null,
      null,
      null,
      null,
      { f: `SUM(B${r}:F${r})`, v: n },
      m.weight,
      { f: `G${r}*H${r}`, v: round2(n * m.weight) },
      area,
      { f: `G${r}*J${r}`, v: round4(n * area) },
    ]);
  });
  const last = materials.length + 1;
  totals.push([
    'სულ',
    null,
    null,
    null,
    null,
    null,
    null,
    null,
    { f: `SUM(I2:I${last})`, v: round2(weightTotal) },
    null,
    { f: `SUM(K2:K${last})`, v: round4(areaTotal) },
  ]);

  // ── ნაშთი: in the yard, planned by this drawing, difference ──
  // His columns C and D are rented and returned out of the accounting
  // export; the app holds only what is in the yard, so they stay blank.
  const remaining: WorkbookCell[][] = [
    [
      'saqonlis dasaxeleba',
      'saqonlis jgufi',
      'SumOfgakiravda raodenoba',
      'SumOfdabrunda raodenoba',
      'Dgarebi teritoriaze',
      'დაგეგმილი რაოდენობა',
      'სხვაობა',
    ],
  ];
  materials.forEach((m, i) => {
    const r = i + 2;
    const stock = totalStock(m);
    remaining.push([
      workbookName(m),
      m.builtin ? 'კოლონა' : '',
      null,
      null,
      stock,
      { f: `SUMIFS(${q(TOTALS_SHEET)}!G:G,${q(TOTALS_SHEET)}!A:A,A${r})`, v: count(m) },
      { f: `E${r}-F${r}`, v: stock - count(m) },
    ]);
  });

  // ── აწყობა: every segment's pieces against its length, ცდომილება = D − E ──
  const assembly: WorkbookCell[][] = [
    ['დეტალის დასახელება', 'ფარის სიგრძე', 'ფარის რაოდენობა', 'ჯამური სიგრძე', 'მისაღები სიგრძე', 'ცდომილება', 'ღია კუთხე (სმ)'],
  ];
  const byId = new Map(input.materials.map((m) => [m.id, m]));
  input.sketch.forEach((path, p) => {
    const check = checkPath(path, input.sketch, input.pieces, byId);
    if (!check.orthogonal || !check.courses.length) {
      assembly.push([
        `ხაზი ${p + 1}`,
        check.orthogonal ? 'ელემენტი არ დგას' : 'დახრილი ხაზი - არ შემოწმდა',
      ]);
      return;
    }
    check.courses.forEach((course, c) => {
      for (const face of course.faces) {
        const r = assembly.length + 1;
        const label = [
          `ხაზი ${p + 1}`,
          `მონაკვეთი ${face.leg + 1}`,
          check.courses.length > 1 ? `რიგი ${c + 1}` : null,
        ]
          .filter(Boolean)
          .join(' · ');
        const parts = face.parts.map((x) => (x.count > 1 ? `${x.count}×${x.label}` : x.label)).join(' · ');
        const pieces = face.parts.reduce((n, x) => n + x.count, 0);
        const sum = round2(face.sum / 100);
        const required = round2(face.required / 100);
        assembly.push([
          label,
          parts,
          pieces,
          sum,
          required,
          { f: `D${r}-E${r}`, v: round2(sum - required) },
          face.openCorners.length ? face.openCorners.join(' + ') : null,
        ]);
      }
    });
  });
  if (!input.sketch.length) assembly.push(['ნახაზზე ხაზვის ხაზი არ არის']);

  // ── პრინტ: the delivery list ──
  const print: WorkbookCell[][] = [['დეტალის დასახელება', 'სულ რაოდენობა']];
  materials.forEach((m, i) => {
    const r = i + 2;
    print.push([
      workbookName(m),
      { f: `SUMIFS(${q(TOTALS_SHEET)}!G:G,${q(TOTALS_SHEET)}!A:A,A${r})`, v: count(m) },
    ]);
  });

  return [
    { name: CONSTRUCTION_SHEET, rows: construction, widths: [44, 18, 14, 16, 4, 24] },
    { name: TOTALS_SHEET, rows: totals, widths: [44, 12, 12, 12, 12, 12, 12, 12, 12, 14, 14] },
    { name: 'ნაშთი', rows: remaining, widths: [44, 12, 12, 12, 14, 16, 12] },
    { name: 'აწყობა', rows: assembly, widths: [32, 36, 12, 14, 14, 12, 14] },
    { name: 'პრინტ', rows: print, widths: [44, 14] },
  ];
}
