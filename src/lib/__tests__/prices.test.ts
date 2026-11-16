import { describe, expect, it } from 'vitest';
import { priceSummary } from '../prices';

describe('the export ფასი', () => {
  it('adds the typed price, area × per m², and the set of columns', () => {
    const s = priceSummary(
      { show: true, manual: 100, perM2: 10, templates: { t2: 300 } },
      61,
      [
        { id: 't1', name: 'კოლონა 60×60', price: 250, count: 4 },
        { id: 't2', name: 'კოლონა 40×40', price: 200, count: 2 },
      ],
    );
    expect(s.areaSum).toBe(610);
    // the template's own 250, and 300 typed in the export over the 200
    expect(s.sets.map((x) => x.sum)).toEqual([1000, 600]);
    expect(s.setSum).toBe(1600);
    expect(s.total).toBe(100 + 610 + 1600);
  });
});
