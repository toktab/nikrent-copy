/**
 * The interface's icon set.
 *
 * Inline SVG rather than emoji. Emoji render as full-colour bitmaps that ignore
 * the surrounding text colour, differ on every platform — 🗑 is a different
 * object on Windows, macOS and Android — and cannot be sized or aligned
 * reliably next to Georgian text. These are single-path strokes that inherit
 * `currentColor`, so a disabled button's icon dims with its label and the
 * drawing looks the same everywhere.
 *
 * Drawn on a 24×24 grid with a 2px stroke, round caps and joins.
 */

export type IconName =
  | 'plus'
  | 'minus'
  | 'pencil'
  | 'trash'
  | 'copy'
  | 'grid'
  | 'array'
  | 'search'
  | 'download'
  | 'upload'
  | 'print'
  | 'sheet'
  | 'folder'
  | 'users'
  | 'key'
  | 'warning'
  | 'check'
  | 'close'
  | 'undo'
  | 'redo'
  | 'rotate-cw'
  | 'rotate-ccw'
  | 'reset'
  | 'fit'
  | 'column'
  | 'wall'
  | 'chevron-left'
  | 'chevron-right'
  | 'chevron-down'
  | 'arrow-right'
  | 'arrow-down'
  | 'arrow-left'
  | 'arrow-up'
  | 'height'
  | 'dot'
  | 'circle'
  | 'more'
  | 'sliders'
  | 'lock'
  | 'offline';

/** Path data only — stroke styling is applied once, on the <svg>. */
const PATHS: Record<IconName, string> = {
  plus: 'M12 5v14M5 12h14',
  minus: 'M5 12h14',
  pencil: 'M4 20h4L19 9a2.8 2.8 0 0 0-4-4L4 16v4Z M14 6l4 4',
  trash: 'M4 7h16 M9 7V4h6v3 M6 7l1 13h10l1-13 M10 11v6 M14 11v6',
  copy: 'M9 9h11v11H9z M5 15H4V4h11v1',
  grid: 'M4 4h16v16H4z M4 10h16 M4 16h16 M10 4v16 M16 4v16',
  array: 'M4 5h4v4H4z M4 15h4v4H4z M14 5h4v4h-4z M14 15h4v4h-4z',
  search: 'M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14z M20 20l-4-4',
  download: 'M12 4v11 M8 11l4 4 4-4 M5 20h14',
  upload: 'M12 15V4 M8 8l4-4 4 4 M5 20h14',
  print: 'M7 9V4h10v5 M7 18H5a1 1 0 0 1-1-1v-6h16v6a1 1 0 0 1-1 1h-2 M7 15h10v5H7z',
  sheet: 'M4 4h16v16H4z M4 9h16 M9 9v11 M4 14.5h16',
  folder: 'M4 6h5l2 2h9v10a1 1 0 0 1-1 1H5a1 1 0 0 1-1-1V6z',
  users: 'M8 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7z M2 20c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5 M16 5.2a3.5 3.5 0 0 1 0 6.6 M17.5 14.8c2.6.5 4.5 2.5 4.5 5.2',
  key: 'M15 4a5 5 0 1 1-4.6 7L4 17.4V20h3v-2h2v-2h2l1.4-1.4A5 5 0 0 1 15 4z M16.5 8.5h.01',
  warning: 'M12 4 2.5 20h19L12 4z M12 10v4 M12 17h.01',
  check: 'M4 12.5 9.5 18 20 6.5',
  close: 'M6 6l12 12 M18 6L6 18',
  undo: 'M9 7 4 12l5 5 M4 12h10a6 6 0 0 1 0 12h-1',
  redo: 'M15 7l5 5-5 5 M20 12H10a6 6 0 0 0 0 12h1',
  'rotate-cw': 'M20 12a8 8 0 1 1-2.3-5.6 M20 4v5h-5',
  'rotate-ccw': 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v5h5',
  reset: 'M4 12a8 8 0 1 0 2.3-5.6 M4 4v5h5 M12 8v4l3 2',
  fit: 'M4 9V4h5 M20 9V4h-5 M4 15v5h5 M20 15v5h-5',
  column: 'M5 20h14 M7 20V6h10v14 M4 6h16 M10 10v6 M14 10v6',
  // Coursed brickwork: reads as a wall at 15px where a plain
  // rectangle would not.
  wall: 'M3 5h18v14H3z M3 9.7h18 M3 14.3h18 M11 5v4.7 M7 9.7v4.6 M15 9.7v4.6 M11 14.3V19',
  'chevron-left': 'M15 5l-7 7 7 7',
  'chevron-right': 'M9 5l7 7-7 7',
  'arrow-right': 'M4 12h15 M13 6l6 6-6 6',
  'arrow-down': 'M12 4v15 M6 13l6 6 6-6',
  'arrow-left': 'M20 12H5 M11 6l-6 6 6 6',
  'chevron-down': 'M5 9l7 7 7-7',
  'arrow-up': 'M12 20V5 M6 11l6-6 6 6',
  // Double-headed rule: elevation, as distinct from a one-way nudge.
  height: 'M12 4v16 M8 7l4-3 4 3 M8 17l4 3 4-3',
  dot: 'M12 12h.01',
  circle: 'M12 5a7 7 0 1 0 0 14 7 7 0 0 0 0-14z',
  more: 'M5 12h.01 M12 12h.01 M19 12h.01',
  // Three rails with three handles: settings you slide, not a list you read.
  // A plain hamburger here would be indistinguishable from a menu.
  sliders: 'M4 7h16 M4 12h16 M4 17h16 M9 5v4 M16 10v4 M7 15v4',
  // Permission, not progress — carried by a padlock so read-only never rests
  // on colour alone.
  lock: 'M5 11h14v9H5z M8 11V7a4 4 0 0 1 8 0v4',
  // Two arcs, a dot and the slash. A full wifi fan has five strokes that turn
  // into grey mush at the 13px this is actually drawn at.
  offline: 'M3 3l18 18 M12 19.5h.01 M8.4 15.9a5.5 5.5 0 0 1 6.2-1 M4.6 11.6a11 11 0 0 1 12.6-1.4',
};

/** Solid glyphs read better than strokes at this weight. */
const FILLED: Partial<Record<IconName, boolean>> = { dot: true, more: true };

interface Props {
  name: IconName;
  /** px; matches the font size it sits beside */
  size?: number;
  className?: string;
}

export function Icon({ name, size = 15, className }: Props) {
  const filled = FILLED[name];
  return (
    <svg
      className={className ? `icon ${className}` : 'icon'}
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      // Decorative: every icon sits beside a label or a titled button, so
      // announcing it again would only add noise for screen readers.
      aria-hidden="true"
      focusable="false"
    >
      <path d={PATHS[name]} strokeWidth={filled ? 4 : 2} />
    </svg>
  );
}
