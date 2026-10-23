/**
 * The colours the ჭანჭიკები are drawn in, as data.
 *
 * On screen the stylesheet paints them (`styles.css`, the კონექტორები block),
 * and that is where a selected one turns blue. The printed sheet is an SVG
 * drawn with no stylesheet at all, so the glyphs also carry these as plain
 * fill and stroke attributes: a stylesheet rule always beats an attribute, so
 * the screen is untouched, and the PDF draws exactly the same marks.
 *
 * Keep the two in step - change a colour here and in styles.css together.
 */
export const BOLT_COLORS = {
  /** a კონექტორი at a T-joint */
  tee: { fill: '#f5d90a', stroke: '#b59c00' },
  /** a კონექტორი at a კუთხე */
  corner: { fill: '#f5a623', stroke: '#b8740e' },
  /** the bolt across a connector mark, and the red stroke through it */
  bar: '#111111',
  slash: '#b3261e',
  /** a შტირი */
  rod: { fill: '#c0473f', stroke: '#6e211b' },
  /** ქანჩი + დისკო: the washer, then the nut on it */
  washer: { fill: '#b7bfc8', stroke: '#4b525b' },
  nut: { fill: '#5c636d', stroke: '#2c3137' },
  /** the wing piece at the end of a ქანჩი + დისკო */
  wing: { fill: '#e4e7eb', stroke: '#59606a' },
  wingHole: '#8a919a',
  /** ჩამკეტი fix: blue, so a clamp on a joint never reads as a rod-end fitting */
  latch: { fill: '#4f86ee', stroke: '#1d3f8f' },
  latchWedge: '#c9dafc',
} as const;
