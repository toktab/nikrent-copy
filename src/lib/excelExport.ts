import * as XLSX from 'xlsx';
import type { Bom } from './bom';
import { fmtNum, sizeLabel } from './bom';
import { downloadText, stampedName } from './files';

/** Ordering-sheet columns (Georgian first, English kept for shared use). */
const HEADERS = [
  'კომპონენტი / Component',
  'კატეგორია / Category',
  'ზომა (სმ) / Size (cm)',
  'არტიკული / Article',
  'რაოდენობა / Quantity',
  'სიგრძე (მ) / Length (m)',
  'მარაგი / In stock',
  'ნაშთი / Remaining',
  'ერთ. ფასი / Unit price',
  'ჯამი / Line total',
  'წონა კგ / Weight kg',
];

type Cell = string | number;

function bomRows(bom: Bom): Cell[][] {
  const aoa: Cell[][] = [HEADERS];

  for (const group of bom.groups) {
    for (const row of group.rows) {
      aoa.push([
        row.material.name,
        group.label,
        sizeLabel(row.material),
        row.material.article,
        row.used,
        Number(fmtNum(row.lengthM)),
        row.stock,
        row.remaining,
        row.material.price,
        Number(fmtNum(row.cost)),
        Number(fmtNum(row.weightKg)),
      ]);
    }
    aoa.push([
      `ჯამი — ${group.label}`,
      '',
      '',
      '',
      group.pieces,
      Number(fmtNum(group.lengthM)),
      '',
      '',
      '',
      Number(fmtNum(group.cost)),
      Number(fmtNum(group.weightKg)),
    ]);
    aoa.push([]);
  }

  aoa.push([
    'სულ / Grand total',
    '',
    '',
    '',
    bom.totalPieces,
    Number(fmtNum(bom.totalLengthM)),
    '',
    '',
    '',
    Number(fmtNum(bom.totalCost)),
    Number(fmtNum(bom.totalWeightKg)),
  ]);

  if (bom.unpricedRows > 0) {
    aoa.push([]);
    aoa.push([`⚠ ${bom.unpricedRows} პოზიციას ფასი არ აქვს — ჯამი არასრულია.`]);
  }
  if (bom.unweighedRows > 0) {
    aoa.push([`⚠ ${bom.unweighedRows} პოზიციას წონა არ აქვს — წონის ჯამი არასრულია.`]);
  }
  return aoa;
}

function summaryRows(bom: Bom): Cell[][] {
  const aoa: Cell[][] = [
    [
      'კატეგორია / Category',
      'ელემენტი / Pieces',
      'სიგრძე (მ) / Length (m)',
      'ფართობი (მ²) / Area (m²)',
      'ღირებულება / Cost',
      'წონა კგ / Weight kg',
      'დეფიციტი / Shortages',
    ],
  ];
  for (const g of bom.groups) {
    aoa.push([
      g.label,
      g.pieces,
      Number(fmtNum(g.lengthM)),
      Number(fmtNum(g.areaM2)),
      Number(fmtNum(g.cost)),
      Number(fmtNum(g.weightKg)),
      g.shortages,
    ]);
  }
  aoa.push([
    'სულ / Total',
    bom.totalPieces,
    Number(fmtNum(bom.totalLengthM)),
    Number(fmtNum(bom.totalAreaM2)),
    Number(fmtNum(bom.totalCost)),
    Number(fmtNum(bom.totalWeightKg)),
    bom.shortageCount,
  ]);
  return aoa;
}

function makeSheet(aoa: Cell[][], widths: number[]): XLSX.WorkSheet {
  const ws = XLSX.utils.aoa_to_sheet(aoa);
  ws['!cols'] = widths.map((wch) => ({ wch }));
  return ws;
}

/** One-click ordering sheet as .xlsx (two sheets: list + summary). */
export function exportBomToExcel(bom: Bom): void {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(
    wb,
    makeSheet(bomRows(bom), [34, 22, 15, 16, 12, 14, 11, 11, 13, 13, 13]),
    'უწყისი',
  );
  XLSX.utils.book_append_sheet(wb, makeSheet(summaryRows(bom), [24, 12, 16, 16, 15, 14, 12]), 'შეჯამება');
  XLSX.writeFile(wb, stampedName('du-bom', 'xlsx'));
}

/** Same list as CSV (UTF-8 BOM so Excel shows Georgian correctly). */
export function exportBomToCsv(bom: Bom): void {
  const ws = XLSX.utils.aoa_to_sheet(bomRows(bom));
  downloadText(XLSX.utils.sheet_to_csv(ws), stampedName('du-bom', 'csv'), 'text/csv');
}

export interface CatalogExportRow {
  name: string;
  category: string;
  size: string;
  shape: string;
  article: string;
  supplier: string;
  price: number;
  weight: number;
  /** stock per warehouse, in the same order as `warehouseNames` */
  stockPerWarehouse: number[];
  totalStock: number;
  committed: number;
}

/** Full catalog (every material incl. unused ones) as .xlsx. */
export function exportCatalogToExcel(rows: CatalogExportRow[], warehouseNames: string[]): void {
  const header: Cell[] = [
    'კომპონენტი / Component',
    'კატეგორია / Category',
    'ზომა (სმ) / Size (cm)',
    'ფორმა / Shape',
    'არტიკული / Article',
    'მომწოდებელი / Supplier',
    'ერთ. ფასი / Unit price',
    'წონა კგ / Weight kg',
    ...warehouseNames.map((n) => `მარაგი: ${n}`),
    'სულ მარაგი / Total stock',
    'გამოყენებული / Committed',
    'თავისუფალი / Available',
  ];

  const aoa: Cell[][] = [
    header,
    ...rows.map(
      (r): Cell[] => [
        r.name,
        r.category,
        r.size,
        r.shape,
        r.article,
        r.supplier,
        r.price,
        r.weight,
        ...r.stockPerWarehouse,
        r.totalStock,
        r.committed,
        r.totalStock - r.committed,
      ],
    ),
  ];

  const widths = [34, 22, 15, 10, 16, 18, 12, 12, ...warehouseNames.map(() => 14), 14, 14, 14];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, makeSheet(aoa, widths), 'კატალოგი');
  XLSX.writeFile(wb, stampedName('du-catalog', 'xlsx'));
}
