import { describe, expect, it } from 'vitest';
import { COMPANY_WEIGHTS, withCompanyWeights } from '../../data/companyWeights';
import { createSeedMaterials } from '../../data/seedCatalog';

describe('withCompanyWeights - the workbook weights', () => {
  it('names only materials the catalog has', () => {
    const ids = new Set(createSeedMaterials().map((m) => m.id));
    expect(Object.keys(COMPANY_WEIGHTS).filter((id) => !ids.has(id))).toEqual([]);
  });

  it('fills blank weights from the workbook and leaves what it does not know blank', () => {
    const { materials, filled } = withCompanyWeights(createSeedMaterials());
    expect(filled).toBe(Object.keys(COMPANY_WEIGHTS).length);
    expect(materials.find((m) => m.id === 'panel-90x300')!.weight).toBe(94.9);
    expect(materials.find((m) => m.id === 'corner-inner-20x20x300')!.weight).toBe(56.6);
    expect(materials.find((m) => m.id === 'acc-panel-concrete-anchor')!.weight).toBe(0);
  });

  it('never writes over a weight somebody typed, and a second press changes nothing', () => {
    const typed = createSeedMaterials().map((m) => (m.id === 'panel-90x300' ? { ...m, weight: 95 } : m));
    const once = withCompanyWeights(typed);
    expect(once.materials.find((m) => m.id === 'panel-90x300')!.weight).toBe(95);

    const again = withCompanyWeights(once.materials);
    expect(again.filled).toBe(0);
    expect(again.materials).toBe(once.materials);
  });
});
