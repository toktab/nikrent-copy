import { describe, expect, it } from 'vitest';
import {
  clampOpacity,
  paperScale,
  patchUnderlay,
  placeUnderlay,
  scaleToLength,
  underlayBox,
  type Underlay,
} from '../underlay';

const page = {
  src: 'data:image/png;base64,xx',
  fileName: 'britania.pdf',
  page: 1,
  pageCount: 3,
  ptW: 1190,
  ptH: 842,
};

const sheet = (over: Partial<Underlay> = {}): Underlay => placeUnderlay(page, over);

describe('the PDF behind the drawing', () => {
  it('arrives visible, faint and ready to be moved', () => {
    const u = sheet();
    expect(u.visible).toBe(true);
    expect(u.locked).toBe(false);
    expect(u.opacity).toBeGreaterThan(0.1);
    expect(u.opacity).toBeLessThan(0.7);
  });

  it('keeps the page’s proportions whatever width it is given', () => {
    const box = underlayBox(sheet({ widthCm: 2380 }));
    expect(box.w).toBe(2380);
    expect(box.h).toBeCloseTo(2380 * (842 / 1190), 3);
  });

  // Fully opaque, the backdrop stops being a backdrop and the drawing is lost
  // in it; at zero it is a file nobody can see and a puzzle about why.
  it('never lets the backdrop take over, or vanish', () => {
    expect(clampOpacity(5)).toBeLessThanOrEqual(0.9);
    expect(clampOpacity(0)).toBeGreaterThan(0);
    expect(clampOpacity(Number.NaN)).toBeGreaterThan(0);
  });

  it('refuses a width that would make the page a speck', () => {
    expect(underlayBox(sheet({ widthCm: 0 })).w).toBeGreaterThan(0);
    expect(underlayBox(sheet({ widthCm: -40 })).w).toBeGreaterThan(0);
  });

  it('stays on a page the file actually has', () => {
    expect(patchUnderlay(sheet(), { page: 9 }).page).toBe(3);
    expect(patchUnderlay(sheet(), { page: 0 }).page).toBe(1);
    expect(patchUnderlay(sheet(), { page: 2.4 }).page).toBe(2);
  });

  it('arrives with its colours flipped, which is right on a dark surface', () => {
    expect(sheet().invert).toBe(true);
    expect(patchUnderlay(sheet(), { invert: false }).invert).toBe(false);
  });

  describe('the scale it reads at', () => {
    /**
     * An architect checks a sheet by its scale, not by its width in
     * centimetres. An A3 page is 42 cm of paper across; laid out as 21 metres
     * of building, that is 1:50.
     */
    it('says 1:50 when the page is laid out at fifty times paper size', () => {
      const a3 = placeUnderlay({ ...page, ptW: 1190.5, ptH: 842 }, { widthCm: 2100 });
      expect(Math.round(paperScale(a3)!)).toBe(50);
    });

    it('doubles when the sheet is laid out twice as big', () => {
      const small = placeUnderlay(page, { widthCm: 1000 });
      const big = placeUnderlay(page, { widthCm: 2000 });
      expect(paperScale(big)! / paperScale(small)!).toBeCloseTo(2, 6);
    });

    it('follows a calibration, so scaling off a wall lands on a round number', () => {
      const a3 = placeUnderlay({ ...page, ptW: 1190.5, ptH: 842 }, { widthCm: 1050 });
      expect(Math.round(paperScale(a3)!)).toBe(25);
      // A wall measured 100 on the sheet is really 200: everything doubles.
      const fixed = scaleToLength(a3, 100, 200, { x: 0, y: 0 });
      expect(Math.round(paperScale(fixed)!)).toBe(50);
    });
  });

  describe('scaling it to something known', () => {
    it('makes the measured feature the length it really is', () => {
      const u = sheet({ widthCm: 1190 });
      // 100 cm on screen is really 500: everything grows five times.
      const scaled = scaleToLength(u, 100, 500, { x: 0, y: 0 });
      expect(scaled.widthCm).toBe(5950);
    });

    it('holds the point you measured from still', () => {
      const u = sheet({ widthCm: 1000, x: 100, y: 50 });
      const anchor = { x: 300, y: 250 };
      const scaled = scaleToLength(u, 100, 200, anchor);
      // The anchor was 200 cm into the page across; after doubling it is 400,
      // so the page's corner has to move back by the same amount.
      expect(anchor.x - scaled.x).toBeCloseTo((anchor.x - u.x) * 2, 6);
      expect(anchor.y - scaled.y).toBeCloseTo((anchor.y - u.y) * 2, 6);
    });

    it('does nothing with a length nobody can use', () => {
      const u = sheet();
      expect(scaleToLength(u, 0, 500, { x: 0, y: 0 })).toBe(u);
      expect(scaleToLength(u, 100, 0, { x: 0, y: 0 })).toBe(u);
    });
  });
});
