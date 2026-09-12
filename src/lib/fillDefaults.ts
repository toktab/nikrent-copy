/**
 * The pour height and corner treatment a job is filled with, remembered.
 *
 * A job is 300 high with inside corner profiles far more often than not, but
 * when it is not, it is not for every wall of it - and retyping 450 and
 * unticking the corners in every dialog, for every line, is how one wall ends
 * up filled at the old height. So whichever of the fill dialog, the
 * recommendation tab and "fill every wall" last changed them, the others open
 * with the same.
 */
export interface FillDefaults {
  /** pour height, cm */
  height: number;
  includeCorners: boolean;
}

export const DEFAULT_FILL_DEFAULTS: FillDefaults = { height: 300, includeCorners: true };

/** Anything saved - junk included - as usable defaults. */
export function normalizeFillDefaults(value: unknown): FillDefaults {
  const saved = (value && typeof value === 'object' ? value : {}) as Record<string, unknown>;
  const height = Number(saved.height);
  return {
    height: Number.isFinite(height) && height > 0 && height <= 2000 ? height : DEFAULT_FILL_DEFAULTS.height,
    includeCorners:
      typeof saved.includeCorners === 'boolean' ? saved.includeCorners : DEFAULT_FILL_DEFAULTS.includeCorners,
  };
}
