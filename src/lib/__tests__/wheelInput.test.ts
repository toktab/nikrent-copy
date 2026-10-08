import { describe, expect, it } from 'vitest';
import { createWheelClassifier, type WheelSample } from '../wheelInput';

const sample = (over: Partial<WheelSample> = {}): WheelSample => ({
  deltaX: 0,
  deltaY: 0,
  deltaMode: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  ...over,
});

/** A mouse wheel notch: chunky integer deltaY, no horizontal axis. */
const wheelNotch = (dir = 1) => sample({ deltaY: 120 * dir });

/** A trackpad two-finger scroll frame: small, often fractional, has deltaX. */
const trackpadFrame = (dx = 3.5, dy = 7.25) => sample({ deltaX: dx, deltaY: dy });

describe('mouse wheel', () => {
  it('zooms on a plain notch', () => {
    const c = createWheelClassifier();
    const a = c.classify(wheelNotch(-1));
    expect(a.kind).toBe('zoom');
    if (a.kind === 'zoom') expect(a.factor).toBeGreaterThan(1); // up = zoom in
  });

  it('zooms out scrolling down', () => {
    const c = createWheelClassifier();
    const a = c.classify(wheelNotch(1));
    if (a.kind === 'zoom') expect(a.factor).toBeLessThan(1);
  });

  it('stays in zoom mode over a long scroll', () => {
    const c = createWheelClassifier();
    for (let i = 0; i < 20; i++) c.classify(wheelNotch());
    expect(c.classify(wheelNotch()).kind).toBe('zoom');
    expect(c.isTrackpad).toBe(false);
  });
});

describe('trackpad', () => {
  it('pans on a two-finger scroll once recognised', () => {
    const c = createWheelClassifier();
    c.classify(trackpadFrame());
    const a = c.classify(trackpadFrame());
    expect(a.kind).toBe('pan');
    if (a.kind === 'pan') {
      expect(a.dx).toBeCloseTo(3.5);
      expect(a.dy).toBeCloseTo(7.25);
    }
  });

  it('recognises a vertical-only trackpad scroll from fractional deltas', () => {
    const c = createWheelClassifier();
    c.classify(sample({ deltaY: 4.5 }));
    expect(c.classify(sample({ deltaY: 4.5 })).kind).toBe('pan');
  });

  it('treats a pinch as zoom and as proof of a trackpad', () => {
    const c = createWheelClassifier();
    const a = c.classify(sample({ deltaY: -10, ctrlKey: true }));
    expect(a.kind).toBe('zoom');
    if (a.kind === 'zoom') expect(a.factor).toBeGreaterThan(1);
    expect(c.isTrackpad).toBe(true);
  });

  it('pinch zoom is finer than a wheel notch', () => {
    const c = createWheelClassifier();
    const pinch = c.classify(sample({ deltaY: -4, ctrlKey: true }));
    const notch = createWheelClassifier().classify(wheelNotch(-1));
    if (pinch.kind === 'zoom' && notch.kind === 'zoom') {
      expect(pinch.factor).toBeLessThan(notch.factor);
    }
  });
});

describe('Ctrl + wheel, the Windows way to zoom', () => {
  // Windows sends a real mouse wheel with ctrlKey set. Reading that as a
  // trackpad pinch zoomed e¹ ≈ 2.7× per click and convinced the classifier the
  // mouse was a trackpad, so every later scroll panned instead of zooming.
  const ctrlNotch = (dir = 1) => sample({ deltaY: 120 * dir, ctrlKey: true });

  it('zooms by one notch step, not by a pinch curve', () => {
    const a = createWheelClassifier().classify(ctrlNotch(-1));
    expect(a.kind).toBe('zoom');
    if (a.kind === 'zoom') expect(a.factor).toBeCloseTo(1.12);
  });

  it('zooms out on the opposite direction', () => {
    const a = createWheelClassifier().classify(ctrlNotch(1));
    if (a.kind === 'zoom') expect(a.factor).toBeCloseTo(1 / 1.12);
  });

  it('is not taken as evidence of a trackpad', () => {
    const c = createWheelClassifier();
    for (let i = 0; i < 5; i++) c.classify(ctrlNotch(-1));
    expect(c.isTrackpad).toBe(false);
  });

  it('still leaves a plain scroll zooming afterwards', () => {
    const c = createWheelClassifier();
    for (let i = 0; i < 3; i++) c.classify(ctrlNotch(-1));
    expect(c.classify(wheelNotch(-1)).kind).toBe('zoom');
  });

  it('a genuine pinch is still recognised alongside it', () => {
    const c = createWheelClassifier();
    const a = c.classify(sample({ deltaY: -6.5, ctrlKey: true }));
    if (a.kind === 'zoom') expect(a.factor).toBeCloseTo(Math.exp(0.065));
    expect(c.isTrackpad).toBe(true);
  });
});

describe('both devices in one session', () => {
  it('switches back to zoom when a mouse takes over', () => {
    const c = createWheelClassifier();
    for (let i = 0; i < 5; i++) c.classify(trackpadFrame());
    expect(c.isTrackpad).toBe(true);
    // plugging in a mouse: chunky notches erode the trackpad evidence
    for (let i = 0; i < 10; i++) c.classify(wheelNotch());
    expect(c.classify(wheelNotch()).kind).toBe('zoom');
  });
});

describe('modifiers', () => {
  it('⌘/Ctrl-style meta always zooms, even on a trackpad', () => {
    const c = createWheelClassifier();
    for (let i = 0; i < 5; i++) c.classify(trackpadFrame());
    expect(c.classify(sample({ deltaY: -50, metaKey: true })).kind).toBe('zoom');
  });

  it('shift pans horizontally from a one-axis wheel', () => {
    const c = createWheelClassifier();
    const a = c.classify(sample({ deltaY: 60, shiftKey: true }));
    expect(a.kind).toBe('pan');
    if (a.kind === 'pan') {
      expect(a.dx).toBe(60);
      expect(a.dy).toBe(0);
    }
  });
});

describe('delta modes', () => {
  it('expands line-mode deltas to pixels', () => {
    const c = createWheelClassifier();
    c.classify(sample({ deltaX: 1, deltaY: 1, deltaMode: 1 })); // establish trackpad
    const a = c.classify(sample({ deltaX: 1, deltaY: 2, deltaMode: 1 }));
    if (a.kind === 'pan') {
      expect(a.dx).toBe(16);
      expect(a.dy).toBe(32);
    }
  });

  it('expands page-mode deltas by the viewport', () => {
    const c = createWheelClassifier();
    c.classify(sample({ deltaX: 0.5, deltaY: 0.5, deltaMode: 2 }));
    const a = c.classify(sample({ deltaX: 0, deltaY: 1, deltaMode: 2 }), 600);
    if (a.kind === 'pan') expect(a.dy).toBe(600);
  });
});
