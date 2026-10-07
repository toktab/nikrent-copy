import { describe, expect, it } from 'vitest';
import { DEFAULT_FILL_DEFAULTS, normalizeFillDefaults } from '../fillDefaults';

describe('normalizeFillDefaults', () => {
  it('keeps what was chosen', () => {
    expect(normalizeFillDefaults({ height: 450, includeCorners: false })).toEqual({ height: 450, includeCorners: false });
  });

  it('falls back to 300 with corners for anything missing or broken', () => {
    expect(normalizeFillDefaults(undefined)).toEqual(DEFAULT_FILL_DEFAULTS);
    expect(normalizeFillDefaults({ height: -5 })).toEqual(DEFAULT_FILL_DEFAULTS);
    expect(normalizeFillDefaults({ height: 'tall', includeCorners: 'yes' })).toEqual(DEFAULT_FILL_DEFAULTS);
    expect(normalizeFillDefaults({ height: 150 })).toEqual({ height: 150, includeCorners: true });
  });
});
