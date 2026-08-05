import { ka, type MessageKey, type Messages } from './ka';

/**
 * Translation.
 *
 * Deliberately small: no library, no async loading, no plural engine. The app
 * ships one language today and the realistic second is a full translation of a
 * fixed key set, which a typed object handles without a runtime.
 *
 * The type system does the work a translation tool normally would — `t()` only
 * accepts a key that exists, and a locale missing an entry fails to compile
 * rather than rendering a blank label.
 */

export type Locale = 'ka';

/**
 * Only Georgian exists so far, and it is complete.
 *
 * A second locale is added here once its file covers the whole key set. There
 * is intentionally no language switcher until then: offering a language that
 * is half-translated looks broken in a way that no missing feature does.
 */
const LOCALES: Record<Locale, Messages> = { ka };

export const DEFAULT_LOCALE: Locale = 'ka';

let current: Locale = DEFAULT_LOCALE;

export function setLocale(locale: Locale): void {
  current = locale;
}

export function getLocale(): Locale {
  return current;
}

/** Locales this build actually ships, for a future switcher. */
export function availableLocales(): Locale[] {
  return Object.keys(LOCALES) as Locale[];
}

/**
 * Look up a message, substituting `{name}` placeholders.
 *
 * Falls back to the source language rather than showing the raw key: a
 * Georgian word in an otherwise English screen is still usable, whereas
 * `recovery.mismatch` is not.
 */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const message = LOCALES[current][key] ?? ka[key] ?? key;
  if (!vars) return message;
  return message.replace(/\{(\w+)\}/g, (whole, name: string) =>
    name in vars ? String(vars[name]) : whole,
  );
}

export type { MessageKey, Messages };
