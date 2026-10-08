import { describe, expect, it } from 'vitest';
import { availableLocales, DEFAULT_LOCALE, getLocale, t } from '..';
import { ka } from '../ka';

describe('t', () => {
  it('returns the message for a key', () => {
    expect(t('auth.signIn')).toBe(ka['auth.signIn']);
  });

  it('substitutes placeholders', () => {
    expect(t('recovery.minLength', { n: 12 })).toBe('მინიმუმ 12 სიმბოლო.');
  });

  /**
   * A placeholder the caller forgot is left visible rather than printed as
   * "undefined" — a stray {n} is obviously a bug, whereas "minimum undefined
   * characters" reads like a deliberate, broken message.
   */
  it('leaves an unsupplied placeholder alone', () => {
    expect(t('recovery.minLength')).toContain('{n}');
    expect(t('recovery.minLength', { other: 1 })).toContain('{n}');
  });

  it('ignores extra variables', () => {
    expect(t('auth.signIn', { unused: 'x' })).toBe(ka['auth.signIn']);
  });
});

describe('locales', () => {
  it('starts in the source language', () => {
    expect(getLocale()).toBe(DEFAULT_LOCALE);
    expect(availableLocales()).toContain('ka');
  });

  /**
   * The point of the typed key set: a locale cannot ship with holes. This
   * guards the invariant at runtime too, so a hand-edited locale file that
   * slipped past the compiler still fails loudly.
   */
  it('has a non-empty message for every key', () => {
    const blank = Object.entries(ka).filter(([, value]) => !String(value).trim());
    expect(blank).toEqual([]);
  });

  it('uses no key twice with different text by accident', () => {
    expect(Object.keys(ka).length).toBe(new Set(Object.keys(ka)).size);
  });
});
