import type { WheelEvent } from 'react';

/**
 * Stop a wheel over a focused number field from editing it.
 *
 * Browsers treat the wheel as a stepper on a focused `input[type=number]`.
 * Both places these appear in this app — the material palette and the
 * inventory table — are long scrolling lists, so the gesture for "read further
 * down" and the gesture for "change this count" are the same one, and the
 * second happens silently to whichever field was last clicked.
 *
 * Blurring rather than preventing: the person was scrolling, so the list
 * should scroll. Swallowing the event would trap the wheel over a field and
 * make the panel feel broken, which is a worse answer than losing focus.
 */
export function keepWheelOffNumber(e: WheelEvent<HTMLInputElement>): void {
  if (document.activeElement === e.currentTarget) e.currentTarget.blur();
}
