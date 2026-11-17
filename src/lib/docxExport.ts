import {
  AlignmentType,
  BorderStyle,
  Document,
  HeadingLevel,
  ImageRun,
  Packer,
  PageOrientation,
  Paragraph,
  ShadingType,
  Table,
  TableCell,
  TableRow,
  TextRun,
  WidthType,
} from 'docx';
import type { DrawingDoc, Material } from '../types';
import type { PdfVisibility } from './dimensions';
import { fmtNum, sizeLabel, type Bom } from './bom';
import { fmtGel, type PriceSummary } from './prices';
import { isCountedPart } from './quantities';
import { downloadBlob, stampedName } from './files';
import { renderDrawingSheet, sheetLegendRows, sketchPerimeterM } from './drawingPdf';
import type { SheetSize } from './exportOptions';

/**
 * The PDF again, as a Word document (the user, 2026-11-17): the same pages in
 * the same order - the drawing sheet, its key and title block, then the list
 * of materials with its summary cards and the ფასი quote - but with every
 * word in it text that can be changed by hand before it is printed or sent.
 * The drawing itself stays a picture: it is a plan, not a paragraph.
 */

const FONT = 'Sylfaen'; // ships with Windows and has Georgian; Word falls back if absent
const INK = '1B1F24';
const MUTED = '6B7480';
const BAND = 'EEF1F5';
const DARK = '1B1F24';

const PAPER_MM: Record<SheetSize, { w: number; h: number }> = {
  A4: { w: 297, h: 210 },
  A3: { w: 420, h: 297 },
};
/** Word measures pages in twentieths of a point; 1 mm = 56.7 of them. */
const twip = (mm: number) => Math.round(mm * 56.7);
const MARGIN_MM = 10;

export interface DocxExportOptions {
  doc: DrawingDoc;
  materials: Material[];
  sheet: SheetSize;
  scale: number;
  visibility: PdfVisibility;
  scales?: Record<string, number>;
  bom: Bom | null;
  prices: PriceSummary | null;
}

const t = (text: string, o: { bold?: boolean; size?: number; color?: string } = {}) =>
  new TextRun({ text, font: FONT, bold: o.bold, size: (o.size ?? 10) * 2, color: o.color ?? INK });

const p = (
  runs: TextRun[] | string,
  o: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; after?: number; before?: number } = {},
) =>
  new Paragraph({
    children: typeof runs === 'string' ? [t(runs)] : runs,
    alignment: o.align,
    spacing: { after: o.after ?? 60, before: o.before ?? 0 },
  });

const thin = { style: BorderStyle.SINGLE, size: 4, color: 'C9CED6' };
const borders = { top: thin, bottom: thin, left: thin, right: thin };

function cell(
  content: string | TextRun[],
  o: { width?: number; fill?: string; align?: (typeof AlignmentType)[keyof typeof AlignmentType]; bold?: boolean; color?: string; span?: number; size?: number } = {},
): TableCell {
  return new TableCell({
    children: [
      new Paragraph({
        children: typeof content === 'string' ? [t(content, { bold: o.bold, color: o.color, size: o.size })] : content,
        alignment: o.align,
      }),
    ],
    width: o.width ? { size: o.width, type: WidthType.PERCENTAGE } : undefined,
    shading: o.fill ? { type: ShadingType.CLEAR, color: 'auto', fill: o.fill } : undefined,
    borders,
    columnSpan: o.span,
    margins: { top: 60, bottom: 60, left: 100, right: 100 },
  });
}

const table = (rows: TableRow[]) => new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });

function dataUrlBytes(dataUrl: string): Uint8Array {
  const b64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** The title block as the sheet prints it: object, drawing, scale, sheet, revision, date. */
function titleBlock(doc: DrawingDoc, scale: number, sheet: SheetSize): Table {
  const cells: Array<[string, string, number]> = [
    ['ობიექტი', doc.projectName || '-', 30],
    ['ნახაზი', doc.name, 24],
    ['კლიენტი', doc.info?.clientName?.trim() || '-', 16],
    ['მასშტაბი', `1:${scale}`, 8],
    ['ფურცელი', sheet, 7],
    ['რევიზია', doc.revision || 'A', 7],
    ['თარიღი', new Date().toLocaleDateString('ka-GE'), 8],
  ];
  return table([
    new TableRow({
      children: cells.map(([label, value, w]) =>
        cell([t(label, { size: 7, color: MUTED }), new TextRun({ break: 1 }), t(value, { bold: true, size: 10 })], { width: w }),
      ),
    }),
  ]);
}

/** The key, every row of it, with its count - what the sheet's legend says. */
function legendTable(rows: ReturnType<typeof sheetLegendRows>): Table | null {
  if (!rows.length) return null;
  return table([
    new TableRow({
      tableHeader: true,
      children: [
        cell('პირობითი აღნიშვნა', { fill: BAND, bold: true, width: 38 }),
        cell('შენიშვნა', { fill: BAND, bold: true, width: 46 }),
        cell('რაოდ.', { fill: BAND, bold: true, width: 16, align: AlignmentType.RIGHT }),
      ],
    }),
    ...rows.map(
      (r) =>
        new TableRow({
          children: [
            cell(r.sample ? `${r.label} (${r.sample})` : r.label),
            cell(r.note ?? '', { color: MUTED }),
            cell(r.count ?? '', { align: AlignmentType.RIGHT, bold: true }),
          ],
        }),
    ),
  ]);
}

/** The summary cards, one row of boxes like the PDF's. */
function cards(bom: Bom, perimeterM: number, prices: PriceSummary | null): Table {
  let bolts = 0;
  for (const g of bom.groups) for (const r of g.rows) if (isCountedPart(r.material)) bolts += r.used;
  const items: Array<[string, string, boolean]> = [
    ['ყალიბის ელემენტი', `${bom.totalPieces - bolts} ც.`, false],
    ['ჭანჭიკები', `${bolts} ც.`, false],
    ['პერიმეტრი', perimeterM > 0 ? `${fmtNum(perimeterM)} მ` : '-', false],
    ['კვადრატულობა', `${fmtNum(bom.totalAreaM2)} მ²`, false],
    [`სულ წონა${bom.unweighedRows > 0 ? ' *' : ''}`, `${fmtNum(bom.totalWeightKg)} კგ`, false],
  ];
  if (prices && prices.total > 0) items.push(['ფასი', fmtGel(prices.total), true]);
  return table([
    new TableRow({
      children: items.map(([label, value, dark]) =>
        cell(
          [
            t(label, { size: 7, color: dark ? 'C9CED6' : MUTED }),
            new TextRun({ break: 1 }),
            t(value, { bold: true, size: 12, color: dark ? 'FFFFFF' : INK }),
          ],
          { fill: dark ? DARK : 'F7F9FB' },
        ),
      ),
    }),
  ]);
}

/** The list of materials: by category, with a ჯამი under each and სულ at the foot. */
function bomTable(bom: Bom): Table {
  const q = (v: number, unit: string) => (v > 0 ? `${fmtNum(v)} ${unit}` : '-');
  const rows: TableRow[] = [
    new TableRow({
      tableHeader: true,
      children: [
        cell('კომპონენტი', { fill: BAND, bold: true, width: 44 }),
        cell('ზომა (სმ)', { fill: BAND, bold: true, width: 14, align: AlignmentType.RIGHT }),
        cell('რაოდ.', { fill: BAND, bold: true, width: 12, align: AlignmentType.RIGHT }),
        cell('სიგრძე', { fill: BAND, bold: true, width: 14, align: AlignmentType.RIGHT }),
        cell('წონა', { fill: BAND, bold: true, width: 16, align: AlignmentType.RIGHT }),
      ],
    }),
  ];
  for (const g of bom.groups) {
    rows.push(new TableRow({ children: [cell(g.label, { fill: 'F3F5F8', bold: true, span: 5 })] }));
    for (const r of g.rows) {
      rows.push(
        new TableRow({
          children: [
            cell(r.material.name),
            cell(sizeLabel(r.material), { align: AlignmentType.RIGHT }),
            cell(String(r.used), { align: AlignmentType.RIGHT }),
            cell(q(r.lengthM, 'მ'), { align: AlignmentType.RIGHT }),
            cell(r.weightMissing ? '-' : q(r.weightKg, 'კგ'), { align: AlignmentType.RIGHT }),
          ],
        }),
      );
    }
    rows.push(
      new TableRow({
        children: [
          cell(`ჯამი - ${g.label}`, { fill: 'FAFBFC', bold: true }),
          cell(q(g.areaM2, 'მ²'), { fill: 'FAFBFC', align: AlignmentType.RIGHT }),
          cell(String(g.pieces), { fill: 'FAFBFC', align: AlignmentType.RIGHT, bold: true }),
          cell(q(g.lengthM, 'მ'), { fill: 'FAFBFC', align: AlignmentType.RIGHT }),
          cell(q(g.weightKg, 'კგ'), { fill: 'FAFBFC', align: AlignmentType.RIGHT }),
        ],
      }),
    );
  }
  rows.push(
    new TableRow({
      children: [
        cell('სულ', { fill: BAND, bold: true }),
        cell(q(bom.totalAreaM2, 'მ²'), { fill: BAND, align: AlignmentType.RIGHT, bold: true }),
        cell(String(bom.totalPieces), { fill: BAND, align: AlignmentType.RIGHT, bold: true }),
        cell(q(bom.totalLengthM, 'მ'), { fill: BAND, align: AlignmentType.RIGHT, bold: true }),
        cell(q(bom.totalWeightKg, 'კგ'), { fill: BAND, align: AlignmentType.RIGHT, bold: true }),
      ],
    }),
  );
  return table(rows);
}

/** The ფასი quote, as the PDF lays it out. */
function quote(prices: PriceSummary, doc: DrawingDoc): Array<Paragraph | Table> {
  const lines: Array<[string, string, string, string, boolean]> = [];
  if (prices.perM2 !== null && prices.areaSum !== null) {
    lines.push(['ყალიბი - კვადრატულობა', `${fmtNum(prices.areaM2)} მ²`, `${fmtGel(prices.perM2)} / მ²`, fmtGel(prices.areaSum), false]);
  }
  for (const s of prices.sets) {
    lines.push([s.name, `${s.count} ც.`, s.unit === null ? '-' : fmtGel(s.unit), s.unit === null ? '-' : fmtGel(s.sum), false]);
  }
  if (prices.sets.length > 1) lines.push(['კომპლექტის ფასი', '', '', fmtGel(prices.setSum), true]);
  if (prices.manual !== null) lines.push(['ფასი (შეთანხმებით)', '', '', fmtGel(prices.manual), false]);
  if (!lines.length) return [];
  const meta = [
    doc.info?.clientName?.trim() ? `კლიენტი: ${doc.info.clientName.trim()}` : '',
    `ნახაზი: ${doc.name}`,
    `თარიღი: ${new Date().toLocaleDateString('ka-GE')}`,
  ]
    .filter(Boolean)
    .join('   ·   ');
  return [
    p([], { before: 300 }),
    table([
      new TableRow({
        children: [
          cell([t('ფასი', { bold: true, size: 14, color: 'FFFFFF' })], { fill: DARK, width: 30 }),
          cell([t(meta, { size: 8, color: 'C9CED6' })], { fill: DARK, span: 3, align: AlignmentType.RIGHT }),
        ],
      }),
      new TableRow({
        tableHeader: true,
        children: [
          cell('დასახელება', { fill: 'F3F5F8', bold: true, width: 46 }),
          cell('რაოდენობა', { fill: 'F3F5F8', bold: true, width: 16, align: AlignmentType.RIGHT }),
          cell('ერთეულის ფასი', { fill: 'F3F5F8', bold: true, width: 19, align: AlignmentType.RIGHT }),
          cell('ჯამი', { fill: 'F3F5F8', bold: true, width: 19, align: AlignmentType.RIGHT }),
        ],
      }),
      ...lines.map(
        ([what, qty, unit, sum, sub]) =>
          new TableRow({
            children: [
              cell(what, { fill: sub ? 'FAFBFC' : undefined, bold: sub }),
              cell(qty, { align: AlignmentType.RIGHT }),
              cell(unit, { align: AlignmentType.RIGHT }),
              cell(sum, { align: AlignmentType.RIGHT, bold: true }),
            ],
          }),
      ),
      new TableRow({
        children: [
          cell([t('სულ გადასახდელი', { size: 9, color: '404853' })], { fill: BAND, span: 3, align: AlignmentType.RIGHT }),
          cell([t(fmtGel(prices.total), { bold: true, size: 16 })], { fill: BAND, align: AlignmentType.RIGHT }),
        ],
      }),
    ]),
    p([t('ფასი ლარში (₾). ჭანჭიკების რაოდენობა - რეალური, არა ნახაზის ნიშნების რიცხვი.', { size: 8, color: MUTED })], {
      before: 80,
    }),
  ];
}

/** Builds the Word document and saves it. Null when there was nothing to put in it. */
export async function exportDrawingToDocx(options: DocxExportOptions): Promise<{ scale: number } | null> {
  const { doc, materials, sheet, visibility: vis, bom, prices } = options;
  const paper = PAPER_MM[sheet];

  // The drawing alone - its key and title block are written out below it as
  // text, so they can be changed; drawn into the picture they could not.
  const drawing = vis.pieces || vis.sketchLines || vis.measureLines
    ? await renderDrawingSheet({
        doc,
        materials,
        sheet,
        scale: options.scale,
        visibility: { ...vis, legend: false, titleBlock: false },
        scales: options.scales,
      })
    : null;

  const sections = [];
  const usableW = paper.w - MARGIN_MM * 2;
  const usableH = paper.h - MARGIN_MM * 2;

  if (drawing) {
    // Leave room on the page for the title block under it; the key follows.
    const hMm = usableH - 22;
    const wMm = Math.min(usableW, (hMm * paper.w) / paper.h);
    const pxPerMm = 96 / 25.4;
    const children: Array<Paragraph | Table> = [
      new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [
          new ImageRun({
            type: 'png',
            data: dataUrlBytes(drawing.dataUrl),
            transformation: { width: Math.round(wMm * pxPerMm), height: Math.round(((wMm * paper.h) / paper.w) * pxPerMm) },
          }),
        ],
      }),
    ];
    if (vis.titleBlock) children.push(titleBlock(doc, drawing.scale, sheet));
    const key = vis.legend ? legendTable(sheetLegendRows(doc, materials, vis)) : null;
    if (key) {
      // Kept with its table: on its own at the foot of the sheet it was a
      // heading over nothing, its rows on the next page.
      children.push(
        new Paragraph({
          children: [t('პირობითი აღნიშვნები', { bold: true, size: 11 })],
          spacing: { before: 200, after: 60 },
          keepNext: true,
          pageBreakBefore: true,
        }),
        key,
      );
    }
    sections.push({
      properties: {
        page: {
          size: { width: twip(paper.h), height: twip(paper.w), orientation: PageOrientation.LANDSCAPE },
          margin: { top: twip(MARGIN_MM), bottom: twip(MARGIN_MM), left: twip(MARGIN_MM), right: twip(MARGIN_MM) },
        },
      },
      children,
    });
  }

  const listed = bom && bom.totalPieces > 0 ? bom : null;
  const priced = prices && prices.total > 0 ? prices : null;
  if (listed || priced) {
    const children: Array<Paragraph | Table> = [
      new Paragraph({
        heading: HeadingLevel.HEADING_1,
        children: [t(`${doc.name} - ${listed ? 'მასალების უწყისი' : 'ფასი'}`, { bold: true, size: 16 })],
        spacing: { after: 60 },
      }),
      p([t(`თარიღი: ${new Date().toLocaleDateString('ka-GE')}`, { size: 9, color: MUTED })], { after: 200 }),
    ];
    if (listed) {
      children.push(cards(listed, sketchPerimeterM(doc.sketch ?? []), priced), p([], { after: 160 }), bomTable(listed));
      if (listed.unweighedRows > 0) {
        children.push(
          p([t(`* წონის ჯამი არასრულია - ${listed.unweighedRows} პოზიციას წონა არ აქვს მითითებული.`, { size: 8, color: MUTED })], {
            before: 80,
          }),
        );
      }
    }
    if (priced) children.push(...quote(priced, doc));
    sections.push({
      properties: {
        page: {
          size: { width: twip(210), height: twip(297), orientation: PageOrientation.PORTRAIT },
          margin: { top: twip(14), bottom: twip(14), left: twip(14), right: twip(14) },
        },
      },
      children,
    });
  }

  if (!sections.length) return null;
  const file = new Document({
    creator: 'კუბი',
    title: doc.name,
    styles: { default: { document: { run: { font: FONT, size: 20 } } } },
    sections,
  });
  const blob = await Packer.toBlob(file);
  downloadBlob(blob, stampedName('du-drawing', 'docx'));
  return { scale: drawing?.scale ?? options.scale };
}
