import * as XLSX from 'xlsx';
import type { RawRow } from './sheetSchema';
import { SHEET_TEMPLATE_HEADERS } from './sheetSchema';
import { readFileAsArrayBuffer } from './files';

/**
 * The SheetJS-dependent half of spreadsheet import.
 *
 * Kept separate from `sheetSchema.ts` (headers, aliases, validation) so the
 * import dialog can render and validate without pulling ~150 kB of SheetJS into
 * the main bundle. This module is only ever loaded via `await import()`.
 */

function firstSheetRows(wb: XLSX.WorkBook): RawRow[] {
  const sheetName = wb.SheetNames[0];
  if (!sheetName) return [];
  const sheet = wb.Sheets[sheetName];
  return XLSX.utils.sheet_to_json<RawRow>(sheet, { defval: '', raw: true });
}

/** Reads .xlsx / .xls / .csv chosen from disk. */
export async function readSheetFile(file: File): Promise<RawRow[]> {
  const buffer = await readFileAsArrayBuffer(file);
  const wb = XLSX.read(buffer, { type: 'array' });
  return firstSheetRows(wb);
}

/** Reads pasted CSV/TSV text (SheetJS sniffs the delimiter). */
export function readPastedText(text: string): RawRow[] {
  if (!text.trim()) return [];
  const wb = XLSX.read(text, { type: 'string' });
  return firstSheetRows(wb);
}

/** Downloads a small example file so users know the expected columns. */
export function downloadImportTemplate(): void {
  const aoa = [
    SHEET_TEMPLATE_HEADERS,
    ['პანელი 120*300', 'panel', 120, 300, 'rect', '#c9a36a', 12, 340, 46.5, 'DU-P120300', 'Du'],
    ['waler 450', 'waler', 450, 12, 'line', '', 30, 120, 18, 'DU-W450', 'Du'],
    ['შიდა კუთხე 20*20*200', 'corner', 20, 200, 'L', '', 8, 95, 12.4, 'DU-C2020200', 'Du'],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), 'components');
  XLSX.writeFile(wb, 'du-components-template.xlsx');
}
