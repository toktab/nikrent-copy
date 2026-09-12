import { describe, expect, it } from 'vitest';
import { isMissingMeasuresColumn } from '../repo';

/**
 * Only the server saying the measures column is missing may switch measured
 * lines off for the session - not any error that happens to mention them.
 */
describe('isMissingMeasuresColumn', () => {
  it("recognises PostgREST's schema-cache message", () => {
    expect(
      isMissingMeasuresColumn({
        code: 'PGRST204',
        message: "Could not find the 'measures' column of 'documents' in the schema cache",
      }),
    ).toBe(true);
  });

  it("recognises Postgres's own message", () => {
    expect(
      isMissingMeasuresColumn({
        code: '42703',
        message: 'column "measures" of relation "documents" does not exist',
      }),
    ).toBe(true);
  });

  it('ignores other errors, including ones that mention measures', () => {
    expect(isMissingMeasuresColumn({ code: 'PGRST204', message: "Could not find the 'sketch' column" })).toBe(false);
    expect(isMissingMeasuresColumn({ code: '23502', message: 'measures: null value in column violates not-null' })).toBe(false);
    expect(isMissingMeasuresColumn({ message: 'permission denied for table documents' })).toBe(false);
  });
});
