import { describe, expect, it } from 'vitest';
import { isMissingLegColumn } from '../repo';

/**
 * Until migration 0012 runs, a catalog save that sends `leg` fails. Recognising
 * that error is what lets the save go through without it - and it has to stay
 * narrow, or an unrelated failure would switch the leg off for the session.
 */
describe('isMissingLegColumn', () => {
  it('recognises PostgREST\'s schema-cache message', () => {
    expect(
      isMissingLegColumn({
        code: 'PGRST204',
        message: "Could not find the 'leg' column of 'materials' in the schema cache",
      }),
    ).toBe(true);
  });

  it('recognises Postgres\'s own message', () => {
    expect(
      isMissingLegColumn({ message: 'column "leg" of relation "materials" does not exist' }),
    ).toBe(true);
  });

  it('ignores other columns and other errors', () => {
    expect(isMissingLegColumn({ code: 'PGRST204', message: "Could not find the 'measures' column" })).toBe(false);
    expect(isMissingLegColumn({ code: '23514', message: 'new row violates check constraint "materials_leg_check"' })).toBe(false);
    expect(isMissingLegColumn({ message: 'permission denied for table materials' })).toBe(false);
  });
});
