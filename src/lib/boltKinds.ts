/**
 * Every ჭანჭიკი kind the ჭანჭიკები menu lists, and whether it EXISTS on a
 * drawing (the user, 2026-11-04).
 *
 * Nothing from that menu is there by itself: while the scheme is being drawn
 * no rod, nut, clamp, waler or connector appears or is counted. Once it is
 * finished, ავტომატურად თავიდან დასმა brings in the kinds chosen in its
 * settings. Each row of the menu then switches its kind wholly on or off -
 * counted and drawn, or neither - and the eye beside it only shows or hides
 * one that exists.
 *
 * Kept on the drawing (`DrawingInfo.bolts`), so a new drawing starts with none.
 */
export type KindKey =
  | 'connectors'
  | 'rods'
  | 'nuts'
  | 'latches'
  | 'walers'
  | 'cornerConnectors'
  | 'halfHead'
  | 'innerConnectors'
  /** ბეტონზე პანელის დამჭერი - placed by hand only, never by the reset */
  | 'holders';

export type KindsOn = Record<KindKey, boolean>;

export const KIND_KEYS: KindKey[] = [
  'connectors',
  'rods',
  'nuts',
  'latches',
  'walers',
  'cornerConnectors',
  'halfHead',
  'innerConnectors',
  'holders',
];

export const NO_KINDS: KindsOn = Object.fromEntries(KIND_KEYS.map((k) => [k, false])) as KindsOn;
export const EVERY_KIND: KindsOn = Object.fromEntries(KIND_KEYS.map((k) => [k, true])) as KindsOn;

/** What a drawing has on, from anything saved: absent means off. */
export function normalizeKindsOn(raw: unknown): KindsOn {
  const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>;
  return Object.fromEntries(KIND_KEYS.map((k) => [k, r[k] === true])) as KindsOn;
}
