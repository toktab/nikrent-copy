import {
  cloneElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactElement,
  type ReactNode,
} from 'react';
import { Icon, type IconName } from './Icon';

/**
 * A popover menu.
 *
 * This exists so the toolbar can stop being the only place a setting can live.
 * Six display toggles and eleven file actions were parked permanently in the
 * header because there was nowhere else to put them; almost none of them are
 * touched twice in a session, and together they were what made the header wrap.
 *
 * Positioned `fixed` from the trigger's measured rect so a toolbar that scrolls
 * horizontally on a narrow window cannot clip the menu it opened.
 */

interface MenuProps {
  /** The control that opens it. Given `open` so it can show a pressed state. */
  trigger: (open: boolean) => ReactElement<Record<string, unknown>>;
  /** Which edge of the menu lines up with the trigger. */
  align?: 'left' | 'right';
  children: ReactNode | ((close: () => void) => ReactNode);
}

export function Menu({ trigger, align = 'left', children }: MenuProps) {
  const [open, setOpen] = useState(false);
  const anchor = useRef<HTMLSpanElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ top: number; left?: number; right?: number } | null>(null);

  const close = useCallback(() => setOpen(false), []);

  useLayoutEffect(() => {
    if (!open) {
      setPos(null);
      return;
    }
    const r = anchor.current?.getBoundingClientRect();
    if (!r) return;
    setPos(
      align === 'right'
        ? { top: r.bottom + 6, right: Math.max(window.innerWidth - r.right, 8) }
        : { top: r.bottom + 6, left: Math.max(r.left, 8) },
    );
  }, [open, align]);

  // A menu that survives a click elsewhere, Escape, or the window moving under
  // it would be a menu the user has to dismiss on purpose. None of them are
  // worth that.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!anchor.current?.contains(t) && !panel.current?.contains(t)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
        (anchor.current?.firstElementChild as HTMLElement | null)?.focus();
      }
    };
    window.addEventListener('pointerdown', onDown, true);
    window.addEventListener('keydown', onKey);
    window.addEventListener('resize', close);
    return () => {
      window.removeEventListener('pointerdown', onDown, true);
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', close);
    };
  }, [open, close]);

  // The first item takes focus on open, so the menu is usable from the keyboard
  // alone rather than only by pointer.
  useEffect(() => {
    if (!open || !pos) return;
    const first = panel.current?.querySelector<HTMLElement>('.menu-item:not(:disabled)');
    first?.focus();
  }, [open, pos]);

  const el = trigger(open);

  return (
    <span className="menu-anchor" ref={anchor}>
      {cloneElement(el, {
        onClick: (e: React.MouseEvent) => {
          (el.props.onClick as ((e: React.MouseEvent) => void) | undefined)?.(e);
          setOpen((v) => !v);
        },
        'aria-expanded': open,
        'aria-haspopup': 'menu',
      })}
      {open && pos && (
        <div className="menu" role="menu" ref={panel} style={{ position: 'fixed', ...pos }}>
          {typeof children === 'function' ? children(close) : children}
        </div>
      )}
    </span>
  );
}

interface ItemProps {
  children: ReactNode;
  onClick?: () => void;
  /** Renders a tick — for menu entries that are toggles rather than actions. */
  on?: boolean;
  icon?: IconName;
  /** Keyboard shortcut, shown right-aligned. */
  trail?: ReactNode;
  danger?: boolean;
  disabled?: boolean;
  title?: string;
}

export function MenuItem({
  children,
  onClick,
  on,
  icon,
  trail,
  danger,
  disabled,
  title,
}: ItemProps) {
  const toggle = on !== undefined;
  return (
    <button
      type="button"
      className={`menu-item${on ? ' on' : ''}${danger ? ' danger' : ''}`}
      role={toggle ? 'menuitemcheckbox' : 'menuitem'}
      aria-checked={toggle ? on : undefined}
      disabled={disabled}
      title={title}
      onClick={onClick}
    >
      {icon && <Icon name={icon} size={14} />}
      <span>{children}</span>
      {(trail || toggle) && (
        <span className="trail">{trail ?? (on ? <Icon name="check" size={13} /> : null)}</span>
      )}
    </button>
  );
}

export function MenuLabel({ children }: { children: ReactNode }) {
  return <div className="menu-label">{children}</div>;
}

export function MenuSep() {
  return <div className="menu-sep" role="separator" />;
}
