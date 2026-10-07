import { describe, expect, it } from 'vitest';
import {
  DEFAULT_JSON_EXPORT,
  normalizeJsonExport,
  normalizeSheetSize,
  sheetBounds,
} from '../exportOptions';
import { createSeedMaterials } from '../../data/seedCatalog';

const materials = createSeedMaterials();
const byId = new Map(materials.map((m) => [m.id, m]));

/** A 90 × 9 panel, a 400 cm line, and a measured line reaching above both. */
const doc = {
  pieces: [{ id: 'p', materialId: 'panel-90x300', x: 100, y: 100, rot: 0 }],
  sketch: [{ id: 'k', points: [{ x: 0, y: 0 }, { x: 400, y: 0 }] }],
  measures: [{ id: 'm', a: { x: 50, y: -40 }, b: { x: 50, y: 20 } }],
};
const all = { pieces: true, sketch: true, measures: true };

describe('sheetBounds', () => {
  it('takes in everything the sheet carries', () => {
    expect(sheetBounds(doc, byId, all)).toEqual({ x: 0, y: -40, w: 400, h: 149 });
  });

  it('scales a panels-only sheet to the panels', () => {
    expect(sheetBounds(doc, byId, { ...all, sketch: false, measures: false })).toEqual({
      x: 100,
      y: 100,
      w: 90,
      h: 9,
    });
  });

  // Scaled to panels that are not printed, the lines sat small in a corner.
  it('scales a setting-out sheet to its lines when the panels are off', () => {
    expect(sheetBounds(doc, byId, { ...all, pieces: false })).toEqual({ x: 0, y: -40, w: 400, h: 60 });
  });

  it('is null when nothing is left to draw', () => {
    expect(sheetBounds(doc, byId, { pieces: false, sketch: false, measures: false })).toBeNull();
    expect(sheetBounds({ pieces: [], sketch: [], measures: [] }, byId, all)).toBeNull();
  });
});

describe('saved export choices', () => {
  it('repairs a saved JSON choice switch by switch', () => {
    expect(normalizeJsonExport({ sketch: false, lengths: 'yes' })).toEqual({
      ...DEFAULT_JSON_EXPORT,
      sketch: false,
    });
    expect(normalizeJsonExport(null)).toEqual(DEFAULT_JSON_EXPORT);
  });

  it('keeps the file as it always was until lengths are asked for', () => {
    expect(DEFAULT_JSON_EXPORT).toMatchObject({ pieces: true, materials: true, sketch: true, measures: true, titleBlock: true, lengths: false });
  });

  it('only knows the two sheets it can print', () => {
    expect(normalizeSheetSize('A3')).toBe('A3');
    expect(normalizeSheetSize('A5')).toBe('A4');
    expect(normalizeSheetSize(undefined)).toBe('A4');
  });
});
