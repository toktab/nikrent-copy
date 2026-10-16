import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ALL_BOLT_KINDS, connectorCount, rodCount, type BoltKinds } from '../lib/bolts';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Icon } from './Icon';

/**
 * ჭანჭიკები in the top bar: the fixings the drawing needs, in a menu.
 *
 * The კონექტორი count used to sit in the bar by itself. ჭანჭიკი is the
 * general word for this kind of hardware, and more kinds are coming, so the bar
 * carries one button and the menu lists each kind with its count. The marks on
 * the plan are switched from here too - the same switch as in ზომების ჩვენება.
 */

/** Which kinds ავტომატურად თავიდან დასმა puts back - remembered on this machine. */
const KINDS_KEY = 'kubi.boltResetKinds';

function loadKinds(): BoltKinds {
  try {
    const raw = localStorage.getItem(KINDS_KEY);
    if (raw) return { ...ALL_BOLT_KINDS, ...(JSON.parse(raw) as Partial<BoltKinds>) };
  } catch {
    // Storage that is blocked or holds something else: every kind, as new.
  }
  return ALL_BOLT_KINDS;
}

function saveKinds(kinds: BoltKinds) {
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(kinds));
  } catch {
    // Not remembered this time - the choice still applies until the page reloads.
  }
}

const KIND_NAMES: Array<[keyof BoltKinds, string]> = [
  ['connectors', 'კონექტორები'],
  ['rods', 'შტირები'],
];

export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const showBolts = useEditorStore((s) => s.showBolts);
  const setShowBolts = useEditorStore((s) => s.setShowBolts);
  const resetBolts = useEditorStore((s) => s.resetBolts);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const connectors = useMemo(() => connectorCount(pieces, byId), [pieces, byId]);
  const rods = useMemo(() => rodCount(pieces, byId), [pieces, byId]);
  const [kinds, setKinds] = useState<BoltKinds>(loadKinds);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleKind = (k: keyof BoltKinds) => {
    const next = { ...kinds, [k]: !kinds[k] };
    setKinds(next);
    saveKinds(next);
  };
  const chosen = KIND_NAMES.filter(([k]) => kinds[k]).map(([, name]) => name);

  return (
    <Menu
      align="right"
      trigger={(open) => (
        <button
          className={`btn bolts-btn${open ? ' active' : ''}`}
          title="ჭანჭიკები - რამდენი სჭირდება ამ ნახაზს"
        >
          <HardwareIcon />
          <span className="bolts-label">ჭანჭიკები</span>
        </button>
      )}
    >
      <MenuLabel>ჭანჭიკები ამ ნახაზზე</MenuLabel>
      <MenuItem
        title="T-შეერთება, შიდა კუთხე ჩაკერებასთან და ხელით დასმული"
        trail={<span className="bolts-count">{connectors} ც.</span>}
      >
        <span className="bolts-kind">
          <svg className="bolts-btn-mark" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <circle r="6" />
            <line className="bolt-bar" x1="-4" y1="0" x2="4" y2="0" />
            <line className="bolt-slash" x1="-2.5" y1="-4" x2="2.5" y2="4" />
          </svg>
          კონექტორები
        </span>
      </MenuItem>
      <MenuItem
        title="შიდა და გარე მხარის ერთმანეთის პირდაპირ მდგარ შეერთებებში და ხელით დასმული"
        trail={<span className="bolts-count">{rods} ც.</span>}
      >
        <span className="bolts-kind">
          <svg className="rods-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="0.5" y="5" width="13" height="4" rx="2" />
          </svg>
          შტირები
        </span>
      </MenuItem>
      <MenuSep />
      <MenuItem on={showBolts} onClick={() => setShowBolts(!showBolts)}>
        ჩვენება ნახაზზე
      </MenuItem>
      <div className="bolts-reset-row">
        <MenuItem
          icon="reset"
          disabled={chosen.length === 0}
          title={`${chosen.join(', ') || 'არაფერი არ არის არჩეული'} - ხელით გადატანილი და წაშლილი ისევ ავტომატურად დაისმება. Ctrl+Z აბრუნებს`}
          onClick={() => {
            resetBolts(kinds);
            setShowBolts(true);
          }}
        >
          ავტომატურად თავიდან დასმა
        </MenuItem>
        <button
          type="button"
          className={`bolts-reset-settings${settingsOpen ? ' on' : ''}`}
          aria-expanded={settingsOpen}
          title="რომელი ჭანჭიკები დაისვას თავიდან"
          onClick={() => setSettingsOpen((v) => !v)}
        >
          <Icon name="sliders" size={14} />
        </button>
      </div>
      {settingsOpen &&
        KIND_NAMES.map(([k, name]) => (
          <MenuItem key={k} on={kinds[k]} onClick={() => toggleKind(k)}>
            <span className="bolts-reset-kind">{name}</span>
          </MenuItem>
        ))}
    </Menu>
  );
}

/**
 * The ჭანჭიკები button's own symbol, as the user drew it: two rounded bars
 * crossed, outline only - fixings in general, not any one kind.
 */
function HardwareIcon() {
  return (
    <svg className="bolts-btn-icon" width="15" height="15" viewBox="0 0 16 16" aria-hidden="true">
      <rect x="5.5" y="1" width="5" height="14" rx="2.5" />
      <rect x="1" y="5.5" width="14" height="5" rx="2.5" />
    </svg>
  );
}
