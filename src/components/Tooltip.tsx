import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

/**
 * The interface's tooltip.
 *
 * The native `title` attribute cannot do the thing the design asks for — a
 * disabled control saying both what it would do and why it can't — because it
 * is one line of unstyled plain text that appears after about a second. It is
 * also unreliable on disabled form controls, which is exactly where the reason
 * matters most.
 *
 * So the handlers live on a wrapper rather than on the control: the wrapper is
 * never disabled, so it hears the pointer whatever the browser decides to do
 * with the button inside it.
 *
 * Positioned `fixed` from the wrapper's measured rect, because the toolbar and
 * the side panels both clip their overflow and an absolutely-positioned tip
 * would be cut off by them.
 */

interface Props {
  /** What the control does. Omit to render children with no tip at all. */
  label?: ReactNode;
  /** Why it can't be used right now. Renders as a second, quieter line. */
  reason?: ReactNode;
  /** Shown beside the reason — a lock for permission, a warning for state. */
  icon?: IconName;
  side?: 'top' | 'bottom';
  children: ReactNode;
}

const GAP = 8;
const DELAY_MS = 380;

export function Tooltip({ label, reason, icon, side = 'bottom', children }: Props) {
  const anchor = useRef<HTMLSpanElement>(null);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [at, setAt] = useState<{ x: number; y: number; side: 'top' | 'bottom' } | null>(null);

  const hide = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = null;
    setAt(null);
  }, []);

  const show = useCallback(() => {
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      const r = anchor.current?.getBoundingClientRect();
      if (!r) return;
      // Flip up when there is not room below, so a tip on the bottom toolbar
      // does not open off the bottom of the window.
      const below = side === 'bottom' && window.innerHeight - r.bottom > 90;
      setAt({
        x: Math.min(Math.max(r.left + r.width / 2, 90), window.innerWidth - 90),
        y: below ? r.bottom + GAP : r.top - GAP,
        side: below ? 'bottom' : 'top',
      });
    }, DELAY_MS);
  }, [side]);

  // Escape closes it, and so does anything that scrolls it away from its
  // anchor — a tip left floating beside nothing is worse than no tip.
  useEffect(() => {
    if (!at) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') hide();
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('resize', hide);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('resize', hide);
    };
  }, [at, hide]);

  useEffect(() => () => void (timer.current && clearTimeout(timer.current)), []);

  if (!label && !reason) return <>{children}</>;

  return (
    <span
      ref={anchor}
      className="tip-anchor"
      onPointerEnter={(e) => e.pointerType !== 'touch' && show()}
      onPointerLeave={hide}
      onPointerDown={hide}
      onFocusCapture={show}
      onBlurCapture={hide}
    >
      {children}
      {at && (
        <span
          className={`tip${reason ? ' tip-rich' : ''} tip-${at.side}`}
          role="tooltip"
          style={{ left: at.x, top: at.y }}
        >
          {icon && <Icon name={icon} size={14} />}
          <span className="tip-text">
            <span>{label}</span>
            {reason && <span className="tip-reason">{reason}</span>}
          </span>
        </span>
      )}
    </span>
  );
}
