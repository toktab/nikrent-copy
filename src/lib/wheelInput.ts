/**
 * Tells a trackpad two-finger scroll apart from a mouse wheel, so both work at
 * once with no setting to choose.
 *
 * The browser reports both as `wheel` events, but they look different:
 *   • a trackpad emits a stream of small, often fractional deltas, frequently
 *     with a non-zero deltaX, and reports a pinch as ctrl+wheel;
 *   • a mouse wheel emits chunky integer deltas (100/120/…) with deltaX === 0.
 *
 * Evidence accumulates rather than being judged per event, because a single
 * trackpad flick can momentarily look mouse-like. Once a device has shown its
 * hand the classification stays stable, and switching devices flips it back
 * within a few events.
 */

export interface WheelSample {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages */
  deltaMode: number;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
}

export type WheelAction =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number };

/** Pixels per line/page when a browser reports non-pixel deltas. */
function toPixels(sample: WheelSample, viewportPx: number): { dx: number; dy: number } {
  const unit = sample.deltaMode === 1 ? 16 : sample.deltaMode === 2 ? viewportPx : 1;
  return { dx: sample.deltaX * unit, dy: sample.deltaY * unit };
}

const EVIDENCE_MAX = 6;
/** At or above this, treat a plain scroll as a trackpad pan. */
const TRACKPAD_THRESHOLD = 2;

export function createWheelClassifier() {
  let evidence = 0;

  const bump = (n: number) => {
    evidence = Math.max(0, Math.min(EVIDENCE_MAX, evidence + n));
  };

  return {
    /** Exposed for tests and debugging. */
    get evidence() {
      return evidence;
    },

    /** True when recent events look like a trackpad. */
    get isTrackpad() {
      return evidence >= TRACKPAD_THRESHOLD;
    },

    /**
     * Decide what a wheel event should do.
     * `viewportPx` is only used to expand page-mode deltas.
     */
    classify(sample: WheelSample, viewportPx = 800): WheelAction {
      const { dx, dy } = toPixels(sample, viewportPx);

      // Ctrl+wheel means zoom either way, but the two sources need telling
      // apart: a trackpad pinch arrives in small or fractional steps and is
      // hard proof of a trackpad, while a mouse wheel with Ctrl held — the
      // normal way to zoom on Windows — sets the same flag in chunky integer
      // notches. Treating those as a pinch zoomed ~2.7× per click and
      // convinced the classifier that a plain mouse was a trackpad.
      if (sample.ctrlKey) {
        const pinch = !Number.isInteger(sample.deltaY) || Math.abs(dy) < 40;
        if (pinch) bump(3);
        return {
          kind: 'zoom',
          factor: pinch ? Math.exp(-dy / 100) : dy < 0 ? 1.12 : 1 / 1.12,
        };
      }

      // Explicit modifier always means zoom, whatever the device.
      if (sample.metaKey) {
        return { kind: 'zoom', factor: dy < 0 ? 1.12 : 1 / 1.12 };
      }

      // Gather evidence from the shape of the deltas.
      if (dx !== 0) bump(2); // mice have no horizontal wheel axis
      if (!Number.isInteger(sample.deltaY)) bump(2); // smooth, sub-pixel scrolling
      else if (Math.abs(dy) >= 100) bump(-1); // chunky notch, looks like a wheel
      if (dy !== 0 && Math.abs(dy) < 16) bump(1); // tiny increments

      // Shift turns a one-axis mouse wheel into horizontal panning.
      if (sample.shiftKey) return { kind: 'pan', dx: dy || dx, dy: 0 };

      if (evidence >= TRACKPAD_THRESHOLD) return { kind: 'pan', dx, dy };

      return { kind: 'zoom', factor: dy < 0 ? 1.12 : 1 / 1.12 };
    },
  };
}

export type WheelClassifier = ReturnType<typeof createWheelClassifier>;
