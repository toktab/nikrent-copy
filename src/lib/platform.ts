/**
 * Which keyboard the user is actually on.
 *
 * The shortcut *handlers* already accept either modifier (`e.metaKey ||
 * e.ctrlKey`), so both platforms have always worked. What was wrong is what the
 * interface *said*: hard-coded `⌘Z` and `Ctrl/⌘` labels, which read as noise on
 * Windows and as a wrong key on a machine that has no ⌘ at all.
 */

export type Platform = 'mac' | 'windows' | 'other';

interface NavigatorLike {
  userAgentData?: { platform?: string };
  platform?: string;
  userAgent?: string;
}

/**
 * Sources are consulted in order of trustworthiness — the modern
 * `userAgentData` hint, then the deprecated but accurate `navigator.platform`,
 * then the spoofable user-agent string — and the first that recognises
 * anything wins. Reading them as one blob lets a stale user-agent override a
 * good hint.
 *
 * macOS is tested before Windows on purpose: "Darwin" contains "win", and an
 * iPad reports as a Mac and does use ⌘ once a keyboard is attached.
 */
function classify(value: string | undefined): Platform | null {
  if (!value) return null;
  const s = value.toLowerCase();
  if (/mac|darwin|iphone|ipad|ipod/.test(s)) return 'mac';
  if (/windows|win32|win64/.test(s)) return 'windows';
  return null;
}

export function detectPlatform(nav?: NavigatorLike | null): Platform {
  return (
    classify(nav?.userAgentData?.platform) ??
    classify(nav?.platform) ??
    classify(nav?.userAgent) ??
    'other'
  );
}

export const PLATFORM: Platform = detectPlatform(
  typeof navigator === 'undefined' ? null : navigator,
);

export interface KeyNames {
  /** the primary command modifier */
  mod: string;
  shift: string;
  alt: string;
  /** the key that deletes a selection */
  del: string;
  enter: string;
  /** how macOS strings symbols together vs. how Windows spells them out */
  join: string;
}

const MAC_KEYS: KeyNames = { mod: '⌘', shift: '⇧', alt: '⌥', del: '⌫', enter: '⏎', join: '' };
const PC_KEYS: KeyNames = {
  mod: 'Ctrl',
  shift: 'Shift',
  alt: 'Alt',
  del: 'Del',
  enter: 'Enter',
  join: ' + ',
};

export function keyNames(platform: Platform = PLATFORM): KeyNames {
  return platform === 'mac' ? MAC_KEYS : PC_KEYS;
}

/**
 * Renders a shortcut for the current platform: `combo(['mod', 'Z'])` gives
 * "⌘Z" on a Mac and "Ctrl + Z" everywhere else. Named parts (`mod`, `shift`,
 * `alt`, `del`, `enter`) are translated; anything else is passed through, so
 * `combo(['mod', 'სქროლი'])` works too.
 */
export function combo(parts: string[], platform: Platform = PLATFORM): string {
  const k = keyNames(platform);
  const named: Record<string, string> = {
    mod: k.mod,
    shift: k.shift,
    alt: k.alt,
    del: k.del,
    enter: k.enter,
  };
  return parts.map((p) => named[p] ?? p).join(k.join);
}

/**
 * The "ignore what the tool wants to do" modifier, held during a drag.
 *
 * Either Alt or Control, on every platform, for the same reason the command
 * shortcuts accept either ⌘ or Ctrl: the handler should not care which keyboard
 * is under the hands. On a Mac Alt is ⌥, which the browser does report — but ⌥
 * is a busy key there, claimed by the window manager and by the trackpad in
 * ways that vary by machine, and a modifier that works on most Macs is not one
 * anybody will trust. Control is free on all three platforms once a drag is
 * already under way.
 *
 * Alt may be held from the start of a drag: nothing claims it at the moment of
 * the press any more. Control may not, because there it already means "add to
 * the selection" - one key meaning two things a few milliseconds apart is how a
 * modifier becomes a coin toss.
 */
export function overrideHeld(e: { altKey: boolean; ctrlKey: boolean }): boolean {
  return e.altKey || e.ctrlKey;
}

/**
 * How to write that modifier for the keyboard in front of the user.
 *
 * One key, not both. Control is accepted as a fallback and deliberately not
 * advertised: a hint naming two keys reads as "either of these might work",
 * which is a worse thing to tell someone than just naming the one that does.
 * ⌥ is also what the rest of the interface already says, and a modifier that
 * means one thing everywhere is the point.
 */
export function overrideLabel(platform: Platform = PLATFORM): string {
  return keyNames(platform).alt;
}
