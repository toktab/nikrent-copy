import { describe, expect, it } from 'vitest';
import {
  buildArchitectWorkbook,
  workbookAreaM2,
  workbookName,
  type WorkbookCell,
  type WorkbookSheet,
} from '../architectWorkbook';
import { planSketchFillAll } from '../sketchFill';
import { createSeedMaterials } from '../../data/seedCatalog';
import { withCompanyWeights } from '../../data/companyWeights';
import type { Material, SketchPath } from '../../types';

const materials: Material[] = withCompanyWeights(createSeedMaterials()).materials.map((m) =>
  m.id === 'panel-90x300' ? { ...m, stock: { main: 500 } } : m,
);
const byId = new Map(materials.map((m) => [m.id, m]));

/** The 4.90 m wall from his აწყობა example, both faces. */
const WALL: SketchPath[] = [
  { id: 'near', points: [{ x: 0, y: 0 }, { x: 490, y: 0 }], perimeter: 'outer' },
  { id: 'far', points: [{ x: 0, y: 20 }, { x: 490, y: 20 }], perimeter: 'inner' },
];
const plan = planSketchFillAll(WALL, { height: 300, includeCorners: true }, materials);
const book = buildArchitectWorkbook({ materials, pieces: plan.pieces, sketch: WALL, drawingName: 'ბრიტანია' });

const sheet = (name: string): WorkbookSheet => book.find((s) => s.name === name)!;
const rowNamed = (s: string, name: string) => sheet(s).rows.find((r) => r[0] === name)!;
const value = (c: WorkbookCell) => (c && typeof c === 'object' ? c.v : c);
const formula = (c: WorkbookCell) => (c && typeof c === 'object' ? c.f : null);
const used = (id: string) => plan.pieces.filter((p) => p.materialId === id).length;
const lastOf = <T,>(xs: T[]): T => xs[xs.length - 1];

describe('buildArchitectWorkbook - his column_formulas.xlsx, filled in', () => {
  it('has his five sheets, in his order', () => {
    expect(book.map((s) => s.name)).toEqual(['კონსტრუქცია 1', 'ჯამი', 'ნაშთი', 'აწყობა', 'პრინტ']);
  });

  it('names and orders the rows as his workbook does', () => {
    const names = sheet('კონსტრუქცია 1').rows.slice(1).map((r) => r[0]);
    expect(names).toHaveLength(41);
    expect(names[0]).toBe('Du კოლონის waler 100');
    expect(names).toContain('Du კოლონის პანელი 75*090');
    expect(names).toContain('Du კოლონის შიდა კუთხე 20*20*300 ჯონი');
    expect(names).toContain('კოლონის გილზა ფიქსატორის');
    expect(lastOf(names)).toBe('კოლონის ჭანჭიკი (შტირი 150 სმ) ფიქსატორის');
    // His fillers run 10*150, 10*300, 5*150, 5*300.
    expect(names.indexOf('Du კოლონის ჩაკერება 10*300')).toBeLessThan(names.indexOf('Du კოლონის ჩაკერება 5*150'));
  });

  it('counts the drawing into კონსტრუქცია 1 with his B × C formula', () => {
    const rows = sheet('კონსტრუქცია 1').rows;
    const r = rows.findIndex((row) => row[0] === 'Du კოლონის პანელი 90*300');
    expect(rows[r][1]).toBe(used('panel-90x300'));
    expect(rows[r][2]).toBe(1);
    expect(formula(rows[r][3])).toBe(`B${r + 1}*C${r + 1}`);
    expect(value(rows[r][3])).toBe(used('panel-90x300'));
    expect(rows[1][5]).toBe('ბრიტანია');
  });

  it('totals weight and area in ჯამი the way his sheet counts them', () => {
    const panel = rowNamed('ჯამი', 'Du კოლონის პანელი 90*300');
    expect(formula(panel[1])).toContain("SUMIFS('კონსტრუქცია 1'!D:D");
    expect(value(panel[6])).toBe(used('panel-90x300'));
    expect(panel[7]).toBe(94.9);
    expect(value(panel[8])).toBeCloseTo(used('panel-90x300') * 94.9);
    expect(panel[9]).toBe(2.7);

    expect(workbookAreaM2(byId.get('corner-inner-20x20x300')!)).toBe(1.2);
    expect(workbookAreaM2(byId.get('corner-outer-300')!)).toBe(0);
    expect(workbookAreaM2(byId.get('filler-10x150')!)).toBe(0.15);
    expect(workbookAreaM2(byId.get('acc-nut-washer')!)).toBe(0);

    const total = lastOf(sheet('ჯამი').rows);
    expect(total[0]).toBe('სულ');
    expect(formula(total[8])).toBe('SUM(I2:I42)');
  });

  it('works out ნაშთი as yard minus planned, with his formulas', () => {
    const rows = sheet('ნაშთი').rows;
    const r = rows.findIndex((row) => row[0] === 'Du კოლონის პანელი 90*300');
    expect(rows[r][4]).toBe(500);
    expect(formula(rows[r][5])).toBe(`SUMIFS('ჯამი'!G:G,'ჯამი'!A:A,A${r + 1})`);
    expect(formula(rows[r][6])).toBe(`E${r + 1}-F${r + 1}`);
    expect(value(rows[r][6])).toBe(500 - used('panel-90x300'));
  });

  it('checks every segment in აწყობა, and a correctly filled wall reads 0', () => {
    const rows = sheet('აწყობა').rows.slice(1);
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row[3]).toBe(4.9);
      expect(row[4]).toBe(4.9);
      expect(value(row[5])).toBe(0);
    }
    expect(formula(sheet('აწყობა').rows[1][5])).toBe('D2-E2');
  });

  it('lists the delivery in პრინტ from ჯამი', () => {
    const row = rowNamed('პრინტ', 'Du კოლონის პანელი 90*300');
    expect(value(row[1])).toBe(used('panel-90x300'));
  });

  it('keeps a component somebody added, after his rows, under its own name', () => {
    const custom: Material = { ...materials[0], id: 'custom-1', name: 'სპეც ფარი', builtin: false };
    const withCustom = buildArchitectWorkbook({ materials: [custom, ...materials], pieces: [], sketch: [], drawingName: '' });
    const names = withCustom[0].rows.slice(1).map((r) => r[0]);
    expect(lastOf(names)).toBe('სპეც ფარი');
    expect(workbookName(custom)).toBe('სპეც ფარი');
    expect(withCustom[3].rows[1][0]).toBe('ნახაზზე ხაზვის ხაზი არ არის');
  });
});
