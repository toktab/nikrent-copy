/**
 * The architect's PDF, faint under the drawing.
 *
 * Tracing in the other window turns a PDF into lines on its own terms. This is
 * the other half of the same need and a much older habit: put the drawing on
 * the table, lay tracing paper over it, and draw. The page sits under the
 * layout at whatever transparency reads best, and ხაზვა works exactly as it
 * always does on top of it - snapping, typed lengths, the 5 cm rule.
 *
 * It is a backdrop and nothing more. Nothing is measured from it and nothing
 * it shows reaches the bill of materials; a line only exists once somebody has
 * drawn it. That is also why it is not saved with the drawing: a rendered A3
 * page is megabytes, the drawing is a few kilobytes of coordinates, and a
 * backdrop that quietly multiplied every save by a hundred would be a bad
 * trade for something you look at while you draw and then switch off.
 */

export interface Underlay {
  /** PNG data URL of the rendered page */
  src: string;
  fileName: string;
  page: number;
  pageCount: number;
  /** the rendered page's own size, in PDF points */
  ptW: number;
  ptH: number;
  /** top-left corner on the drawing, in world cm */
  x: number;
  y: number;
  /** how wide the page is laid out, in world cm - this is the scale */
  widthCm: number;
  /** 0.05 to 1; the drawing has to stay the thing you can see */
  opacity: number;
  /**
   * Flip the page's colours. Drawings are black on white and the surface is
   * dark, so inverted is right nearly always - it turns a glaring white sheet
   * into pale lines on the dark ground. A coloured drawing (red structure,
   * blue services) reads better as it was drawn, hence the switch.
   */
  invert: boolean;
  visible: boolean;
  /** false while it is being positioned: dragging the page moves it */
  locked: boolean;
}

export const DEFAULT_OPACITY = 0.45;
/** Enough to see the lines, never enough to be mistaken for the drawing. */
export const MAX_OPACITY = 0.9;
const MIN_OPACITY = 0.05;
const MIN_WIDTH_CM = 20;
const MAX_WIDTH_CM = 200_000;

export const clampOpacity = (v: number): number =>
  Math.min(MAX_OPACITY, Math.max(MIN_OPACITY, Number.isFinite(v) ? v : DEFAULT_OPACITY));

export const clampWidth = (v: number): number =>
  Math.min(MAX_WIDTH_CM, Math.max(MIN_WIDTH_CM, Number.isFinite(v) && v > 0 ? v : MIN_WIDTH_CM));

/**
 * A first placement for a page nobody has scaled yet.
 *
 * One point is one centimetre, which is wrong but wrong in a useful way: an A3
 * sheet lands about 12 metres across, the size of a small building, so it
 * arrives on screen at a believable scale instead of as a speck or a wall of
 * white. The architect then sets the real width, or drags a known wall to
 * match, which is the same single correction tracing asks for.
 */
export function placeUnderlay(
  page: { src: string; fileName: string; page: number; pageCount: number; ptW: number; ptH: number },
  over: Partial<Underlay> = {},
): Underlay {
  return {
    ...page,
    x: 0,
    y: 0,
    widthCm: clampWidth(page.ptW),
    opacity: DEFAULT_OPACITY,
    invert: true,
    visible: true,
    locked: false,
    ...over,
  };
}

/** The page's rectangle on the drawing, in world cm. */
export function underlayBox(u: Underlay): { x: number; y: number; w: number; h: number } {
  const w = clampWidth(u.widthCm);
  return { x: u.x, y: u.y, w, h: u.ptW > 0 ? (w * u.ptH) / u.ptW : w };
}

/** A change to the backdrop, with the values that have limits kept inside them. */
export function patchUnderlay(current: Underlay, patch: Partial<Underlay>): Underlay {
  const next = { ...current, ...patch };
  return {
    ...next,
    opacity: clampOpacity(next.opacity),
    widthCm: clampWidth(next.widthCm),
    page: Math.min(Math.max(1, Math.round(next.page)), Math.max(1, next.pageCount)),
  };
}

const CM_PER_INCH = 2.54;
const PT_PER_INCH = 72;

/**
 * The drawing scale the page is currently laid out at - the 50 of "1:50".
 *
 * An architect reads a sheet by its scale, so this is the number that says
 * whether the placement is right: set the width by eye and it reads 1:47, and
 * you know to nudge it; calibrate it off a known wall and it should land on a
 * round 1:50 or 1:100. Worth more than the width in centimetres, which means
 * nothing on its own.
 */
export function paperScale(u: Underlay): number | null {
  const paperCm = (u.ptW / PT_PER_INCH) * CM_PER_INCH;
  if (!(paperCm > 0)) return null;
  return clampWidth(u.widthCm) / paperCm;
}

/**
 * Scale the page so a feature the architect measured on screen becomes the
 * length they say it is, keeping the point they measured from where it is.
 * The width is the scale, so this is one multiplication - and the anchor is
 * what stops the sheet sliding off while it resizes.
 */
export function scaleToLength(
  u: Underlay,
  measuredCm: number,
  realCm: number,
  anchor: { x: number; y: number },
): Underlay {
  if (!(measuredCm > 0) || !(realCm > 0)) return u;
  const factor = realCm / measuredCm;
  return patchUnderlay(u, {
    widthCm: u.widthCm * factor,
    x: anchor.x - (anchor.x - u.x) * factor,
    y: anchor.y - (anchor.y - u.y) * factor,
  });
}
