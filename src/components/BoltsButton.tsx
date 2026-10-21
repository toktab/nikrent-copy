import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { ALL_BOLT_KINDS, connectorCount, latchCount, nutCount, rodCount, type BoltKinds } from '../lib/bolts';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Icon } from './Icon';
import { LatchShape } from './BoltLayer';

/**
 * ჭანჭიკები in the top bar: the fixings the drawing needs, in a menu.
 *
 * The კონექტორი count used to sit in the bar by itself. ჭანჭიკი is the
 * general word for this kind of hardware, and more kinds are coming, so the bar
 * carries one button and the menu lists each kind with its count. Each kind is
 * shown or hidden on the plan from its own row; there is no all-at-once switch
 * here any more - four rows already say it, kind by kind.
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
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
];

export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const shown = useEditorStore((s) => s.boltsShown);
  const toggleKindShown = useEditorStore((s) => s.toggleBoltKind);
  // The all-kinds switch left this menu but still lives in ზომების ჩვენება;
  // a kind switched on here must actually appear, whatever that one says.
  const toggleBoltKind = (k: keyof BoltKinds) => {
    if (!shown[k]) setShowBolts(true);
    toggleKindShown(k);
  };
  const setShowBolts = useEditorStore((s) => s.setShowBolts);
  const resetBolts = useEditorStore((s) => s.resetBolts);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const connectors = useMemo(() => connectorCount(pieces, byId), [pieces, byId]);
  const rods = useMemo(() => rodCount(pieces, byId), [pieces, byId]);
  const nuts = useMemo(() => nutCount(pieces, byId), [pieces, byId]);
  const latches = useMemo(() => latchCount(pieces, byId), [pieces, byId]);
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
        trail={<KindTrail count={connectors} shown={shown.connectors} />}
        onClick={() => toggleBoltKind('connectors')}
      >
        <span className={`bolts-kind${shown.connectors ? '' : ' off'}`}>
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
        trail={<KindTrail count={rods} shown={shown.rods} />}
        onClick={() => toggleBoltKind('rods')}
      >
        <span className={`bolts-kind${shown.rods ? '' : ' off'}`}>
          <svg className="rods-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="0.5" y="5" width="13" height="4" rx="2" />
          </svg>
          შტირები
        </span>
      </MenuItem>
      <MenuItem
        title="ორი თითო შტირზე - ერთი თითო ბოლოზე"
        trail={<KindTrail count={nuts} shown={shown.nuts} />}
        onClick={() => toggleBoltKind('nuts')}
      >
        <span className={`bolts-kind${shown.nuts ? '' : ' off'}`}>
          <svg className="nuts-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect className="nut-washer" x="4" y="1" width="2.5" height="12" rx="0.8" />
            <rect className="nut-nut" x="6.5" y="4.5" width="5" height="5" rx="0.8" />
          </svg>
          ქანჩი + დისკო
        </span>
      </MenuItem>
      <MenuItem
        title="თითო ყველა ქანჩი + დისკოზე - ჩაკეტავს მას"
        trail={<KindTrail count={latches} shown={shown.latches} />}
        onClick={() => toggleBoltKind('latches')}
      >
        <span className={`bolts-kind${shown.latches ? '' : ' off'}`}>
          <svg className="latch-mark" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <LatchShape hub={4} wings={12} />
          </svg>
          ჩამკეტი fix
        </span>
      </MenuItem>
      <MenuSep />
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
 * A kind's count and whether it is on the plan. Clicking the row hides that
 * kind - marks and placed pieces alike - and clicking again brings it back;
 * the count stays, struck through, because the drawing still needs them.
 */
function KindTrail({ count, shown }: { count: number; shown: boolean }) {
  return (
    <span className="bolts-trail" title={shown ? 'ჩანს ნახაზზე - დააჭირე დასამალად' : 'დამალულია - დააჭირე საჩვენებლად'}>
      <span className={`bolts-count${shown ? '' : ' off'}`}>{count} ც.</span>
      <Icon name={shown ? 'eye' : 'eye-off'} size={13} />
    </span>
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
