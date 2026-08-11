import { describe, expect, it } from 'vitest';
import { combo, detectPlatform, keyNames, overrideHeld, overrideLabel } from '../platform';

const MAC_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const WIN_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';
const LINUX_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120 Safari/537.36';

describe('detectPlatform', () => {
  it('reads the modern userAgentData hint first', () => {
    expect(detectPlatform({ userAgentData: { platform: 'Windows' }, userAgent: MAC_UA })).toBe(
      'windows',
    );
  });

  it('falls back to navigator.platform', () => {
    expect(detectPlatform({ platform: 'MacIntel', userAgent: '' })).toBe('mac');
    expect(detectPlatform({ platform: 'Win32', userAgent: '' })).toBe('windows');
  });

  it('falls back to the user agent string', () => {
    expect(detectPlatform({ userAgent: MAC_UA })).toBe('mac');
    expect(detectPlatform({ userAgent: WIN_UA })).toBe('windows');
    expect(detectPlatform({ userAgent: LINUX_UA })).toBe('other');
  });

  it('treats an iPad as a Mac — it has a ⌘ key when a keyboard is attached', () => {
    expect(detectPlatform({ userAgent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X)' })).toBe(
      'mac',
    );
  });

  it('does not read "Darwin" as Windows', () => {
    // "darwin" contains "win"; a naive substring test gets this backwards
    expect(detectPlatform({ platform: 'Darwin' })).toBe('mac');
  });

  it('is safe with no navigator at all, as during a build', () => {
    expect(detectPlatform(null)).toBe('other');
    expect(detectPlatform(undefined)).toBe('other');
    expect(detectPlatform({})).toBe('other');
  });
});

describe('combo', () => {
  it('uses Mac symbols with no separator', () => {
    expect(combo(['mod', 'Z'], 'mac')).toBe('⌘Z');
    expect(combo(['mod', 'shift', 'Z'], 'mac')).toBe('⌘⇧Z');
    expect(combo(['del'], 'mac')).toBe('⌫');
  });

  it('spells the keys out and joins with a spaced + everywhere else', () => {
    expect(combo(['mod', 'Z'], 'windows')).toBe('Ctrl + Z');
    expect(combo(['mod', 'shift', 'Z'], 'windows')).toBe('Ctrl + Shift + Z');
    expect(combo(['del'], 'windows')).toBe('Del');
  });

  it('treats Linux like Windows', () => {
    expect(combo(['mod', 'D'], 'other')).toBe('Ctrl + D');
  });

  it('passes unknown parts through, so prose can be mixed in', () => {
    expect(combo(['mod', 'სქროლი'], 'mac')).toBe('⌘სქროლი');
    expect(combo(['mod', 'სქროლი'], 'windows')).toBe('Ctrl + სქროლი');
  });

  it('never leaves a Mac-only glyph on a PC label', () => {
    for (const parts of [['mod', 'Z'], ['mod', 'shift', 'Z'], ['del'], ['alt', 'X']]) {
      expect(combo(parts, 'windows')).not.toMatch(/[⌘⇧⌥⌫]/);
    }
  });
});

describe('keyNames', () => {
  it('gives every platform a full set', () => {
    for (const p of ['mac', 'windows', 'other'] as const) {
      const k = keyNames(p);
      for (const value of [k.mod, k.shift, k.alt, k.del, k.enter]) {
        expect(value.length).toBeGreaterThan(0);
      }
    }
  });
});

describe('the drag override modifier', () => {
  it('answers to either Alt or Control, on every keyboard', () => {
    expect(overrideHeld({ altKey: true, ctrlKey: false })).toBe(true);
    expect(overrideHeld({ altKey: false, ctrlKey: true })).toBe(true);
    expect(overrideHeld({ altKey: false, ctrlKey: false })).toBe(false);
  });

  // Named as one key even though two work. "Either of these might" is a worse
  // thing to tell someone than naming the one that does — and it agrees with
  // every other hint in the interface, which is the point of a modifier.
  it('names one key, in the script of the keyboard in front of the user', () => {
    expect(overrideLabel('mac')).toBe('⌥');
    expect(overrideLabel('windows')).toBe('Alt');
    expect(overrideLabel('other')).toBe('Alt');
  });
});
