import { describe, expect, it } from 'vitest';
import { migratePersisted } from '../useEditorStore';
import { DEFAULT_LENGTH_VISIBILITY } from '../../lib/dimensions';

/**
 * Saved preferences from before lengths were set per kind of thing.
 *
 * The old on/off switch (v4) and the three modes (v5) both become the master
 * switch plus the table. Anyone who had lengths off keeps them off; "all" keeps
 * every length on; everyone else starts on the default table.
 */
describe('migratePersisted', () => {
  it('turns the old switch, off, into the master switch off', () => {
    const next = migratePersisted({ showDims: false, zoom: 2 });
    expect(next).toMatchObject({ showLengths: false, zoom: 2 });
    expect('showDims' in next).toBe(false);
  });

  it('turns the off mode into the master switch off', () => {
    expect(migratePersisted({ dimMode: 'off' }).showLengths).toBe(false);
  });

  it('keeps "all" meaning every length, always', () => {
    const next = migratePersisted({ dimMode: 'all' });
    expect(next.showLengths).toBe(true);
    expect(Object.values(next.lengthVisibility!)).toEqual(['always', 'always', 'always', 'always', 'always']);
    expect('dimMode' in next).toBe(false);
  });

  it('gives everyone else the default table', () => {
    expect(migratePersisted({ dimMode: 'selected' }).lengthVisibility).toEqual(DEFAULT_LENGTH_VISIBILITY);
    expect(migratePersisted({ showDims: true })).toMatchObject({
      showLengths: true,
      lengthVisibility: DEFAULT_LENGTH_VISIBILITY,
    });
  });

  it('leaves a table that is already saved alone', () => {
    const saved = { ...DEFAULT_LENGTH_VISIBILITY, wall: 'always' as const };
    expect(migratePersisted({ lengthVisibility: saved }).lengthVisibility).toEqual(saved);
  });

  it('still moves retired grid steps onto the panel module', () => {
    expect(migratePersisted({ snapStep: 10 }).snapStep).toBe(15);
    expect(migratePersisted({ snapStep: 25 }).snapStep).toBe(30);
  });

  it('survives nothing having been saved', () => {
    expect(migratePersisted(undefined)).toEqual({});
  });
});
