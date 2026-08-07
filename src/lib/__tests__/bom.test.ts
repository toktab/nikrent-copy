import { describe, expect, it } from 'vitest';
import type { DrawingDoc, Material, Piece } from '../../types';
import { buildBom, drawingSizeLabel, fmtNum, sizeLabel, usageByMaterial } from '../bom';

function material(over: Partial<Material> = {}): Material {
  return {
    id: 'panel',
    name: 'პანელი 45*300',
    category: 'panel',
    w: 45,
    h: 300,
    depth: 9,
    shape: 'rect',
    color: '#c9a36a',
    builtin: true,
    stock: { main: 10 },
    weight: 0,
    article: '',
    supplier: '',
    ...over,
  };
}

const piece = (materialId: string, id: string): Piece => ({
  id,
  materialId,
  x: 0,
  y: 0,
  rot: 0,
});

const panel = material({ id: 'panel', weight: 40 });
const waler = material({
  id: 'waler',
  name: 'waler 300',
  category: 'waler',
  w: 300,
  h: 12,
  depth: 9,
  shape: 'line',
  stock: { main: 1 },
  weight: 12,
});

describe('buildBom', () => {
  it('is empty when nothing is placed', () => {
    const bom = buildBom([panel], []);
    expect(bom.groups).toHaveLength(0);
    expect(bom.totalPieces).toBe(0);
  });

  it('lists only materials that are actually used', () => {
    const bom = buildBom([panel, waler], [piece('panel', 'a')]);
    expect(bom.groups).toHaveLength(1);
    expect(bom.groups[0].category).toBe('panel');
  });

  it('counts quantity, stock and remaining', () => {
    const bom = buildBom([panel], [piece('panel', 'a'), piece('panel', 'b')]);
    const row = bom.groups[0].rows[0];
    expect(row.used).toBe(2);
    expect(row.stock).toBe(10);
    expect(row.remaining).toBe(8);
    expect(row.shortage).toBe(false);
  });

  it('flags a shortage when used exceeds stock', () => {
    const bom = buildBom([waler], [piece('waler', 'a'), piece('waler', 'b')]);
    const row = bom.groups[0].rows[0];
    expect(row.remaining).toBe(-1);
    expect(row.shortage).toBe(true);
    expect(bom.shortageCount).toBe(1);
  });

  it('sums the length of every structural item, not just the linear ones', () => {
    // A "პანელი 45*300" is 3 m long exactly like a 3 m waler. Counting length
    // only for `shape: 'line'` left panels, corners and fillers — most of a
    // real order — reporting nothing at all.
    const bom = buildBom([panel, waler], [piece('panel', 'a'), piece('waler', 'b')]);
    expect(bom.totalLengthM).toBeCloseTo(6); // 3 m panel + 3 m waler
    expect(bom.groups.find((g) => g.category === 'panel')!.rows[0].lengthM).toBeCloseTo(3);
  });

  it('counts face area only for what actually forms the concrete face', () => {
    const bom = buildBom([panel, waler], [piece('panel', 'a'), piece('waler', 'b')]);
    // panel 45×300 cm = 1.35 m²; a waler has a profile, not a face
    expect(bom.totalAreaM2).toBeCloseTo(1.35);
    expect(bom.groups.find((g) => g.category === 'waler')!.rows[0].areaM2).toBe(0);
  });

  it('gives accessories neither a length nor an area', () => {
    // A nut is ordered by the piece; 8 cm of "length" per nut is noise in the
    // metres total and 0.0064 m² is noise in the area total.
    const nut = material({ id: 'nut', name: 'ქანჩი', category: 'acc', w: 8, h: 8 });
    const bom = buildBom([nut], [piece('nut', 'a')]);
    expect(bom.totalLengthM).toBe(0);
    expect(bom.totalAreaM2).toBe(0);
    expect(bom.totalPieces).toBe(1);
  });

  it('totals weight', () => {
    const bom = buildBom([panel, waler], [piece('panel', 'a'), piece('panel', 'b'), piece('waler', 'c')]);
    expect(bom.totalWeightKg).toBe(92); // 2×40 + 1×12
  });

  it('reports rows with no weight so the total is not read as complete', () => {
    const free = material({ id: 'free', weight: 0 });
    const bom = buildBom([free], [piece('free', 'a')]);
    expect(bom.unweighedRows).toBe(1);
  });

  it('counts pieces whose material was deleted as orphans', () => {
    const bom = buildBom([panel], [piece('panel', 'a'), piece('ghost', 'b')]);
    expect(bom.orphanPieces).toBe(1);
    expect(bom.totalPieces).toBe(1);
  });

  it('sums stock across warehouses', () => {
    const split = material({ id: 'split', stock: { main: 3, site: 4 } });
    const bom = buildBom([split], [piece('split', 'a')]);
    expect(bom.groups[0].rows[0].stock).toBe(7);
  });

  describe('company-wide commitment', () => {
    const docs: DrawingDoc[] = [
      {
        id: 'd1',
        name: 'A',
        updatedAt: 0,
        pieces: [piece('panel', 'a')],
      sketch: [],
        projectName: '',
        revision: 'A',
        scale: 50,
      },
      {
        id: 'd2',
        name: 'B',
        updatedAt: 0,
        pieces: [piece('panel', 'b'), piece('panel', 'c')],
      sketch: [],
        projectName: '',
        revision: 'A',
        scale: 50,
      },
    ];

    it('separates this drawing from everything committed elsewhere', () => {
      const bom = buildBom([panel], docs[0].pieces, docs, 'd1');
      const row = bom.groups[0].rows[0];
      expect(row.used).toBe(1); // on this drawing
      expect(row.committed).toBe(3); // across both drawings
      expect(row.remaining).toBe(9); // stock 10 − this drawing
      expect(row.available).toBe(7); // stock 10 − all drawings
    });
  });
});

describe('labels', () => {
  it('uses width × height for boxes', () => {
    expect(sizeLabel(panel)).toBe('45 × 300');
    expect(drawingSizeLabel(panel)).toBe('45 × 300');
  });

  it('uses length alone on the drawing for linear items', () => {
    expect(drawingSizeLabel(waler)).toBe('300 სმ');
    // tables keep both dimensions
    expect(sizeLabel(waler)).toBe('300 × 12');
  });
});

describe('usageByMaterial', () => {
  it('counts per material id', () => {
    const map = usageByMaterial([piece('panel', 'a'), piece('panel', 'b'), piece('waler', 'c')]);
    expect(map.get('panel')).toBe(2);
    expect(map.get('waler')).toBe(1);
  });
});

describe('fmtNum', () => {
  it('drops needless decimals', () => {
    expect(fmtNum(3)).toBe('3');
    expect(fmtNum(3.5)).toBe('3.50');
  });
});
