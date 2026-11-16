import type { DrawingPrices } from '../types';

/**
 * The ფასი block of the export (the user, 2026-11-16): a price typed by hand,
 * the კვადრატულობა times a price per m², and the კომპლექტის ფასი - every
 * template (column) on the drawing, how many of it times what one costs.
 */
export interface PriceLine {
  name: string;
  count: number;
  unit: number | null;
  sum: number;
}

export interface PriceSummary {
  manual: number | null;
  areaM2: number;
  perM2: number | null;
  areaSum: number | null;
  sets: PriceLine[];
  setSum: number;
  /** what the lines add up to, the hand-typed price included */
  total: number;
}

const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : null);

export function priceSummary(
  prices: DrawingPrices | undefined,
  areaM2: number,
  templates: Array<{ id: string; name: string; price: number | null; count: number }>,
): PriceSummary {
  const manual = num(prices?.manual);
  const perM2 = num(prices?.perM2);
  const areaSum = perM2 !== null ? round2(areaM2 * perM2) : null;
  const sets: PriceLine[] = templates
    .filter((t) => t.count > 0)
    .map((t) => {
      // The export's own price for it, else the template's.
      const unit = num(prices?.templates?.[t.id]) ?? num(t.price);
      return { name: t.name, count: t.count, unit, sum: unit !== null ? round2(unit * t.count) : 0 };
    });
  const setSum = round2(sets.reduce((n, s) => n + s.sum, 0));
  return {
    manual,
    areaM2: round2(areaM2),
    perM2,
    areaSum,
    sets,
    setSum,
    total: round2((manual ?? 0) + (areaSum ?? 0) + setSum),
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** "1 250.5 ₾" */
export function fmtGel(n: number | null): string {
  if (n === null) return '-';
  return `${n.toLocaleString('en-US', { maximumFractionDigits: 2 }).replace(/,/g, ' ')} ₾`;
}
