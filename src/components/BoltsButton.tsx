import { useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { EVERY_KIND, type KindKey, type KindsOn } from '../lib/boltKinds';
import { boltGroups, type BoltGroup } from '../lib/boltMarks';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Icon } from './Icon';
import { ClampShape, WingShape } from './BoltLayer';
import { soloPanels, WALER_LOCK_NAME, WALER_ROD_NAME, walerTotals } from '../lib/walers';
import { CORNER_CONNECTOR_NAME, cornerConnectorSpots, cornerConnectorTotals, HALF_HEAD_NAME, INNER_CONNECTOR_NAME, SMALL_NUT_NAME } from '../lib/cornerConnectors';

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

function loadKinds(): KindsOn {
  try {
    const raw = localStorage.getItem(KINDS_KEY);
    if (raw) return { ...EVERY_KIND, ...(JSON.parse(raw) as Partial<KindsOn>) };
  } catch {
    // Storage that is blocked or holds something else: every kind, as new.
  }
  return EVERY_KIND;
}

function saveKinds(kinds: KindsOn) {
  try {
    localStorage.setItem(KINDS_KEY, JSON.stringify(kinds));
  } catch {
    // Not remembered this time - the choice still applies until the page reloads.
  }
}

const KIND_NAMES: Array<[KindKey, string]> = [
  ['connectors', 'კონექტორები'],
  ['rods', 'შტირები'],
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
  ['walers', 'ვოლერები'],
  ['cornerConnectors', 'კუთხის კონექტორი 25 სმ - გარე'],
  ['halfHead', 'შტირი 40 სმ ნახევარი თავით'],
  ['innerConnectors', 'კუთხის კონექტორი 25 სმ - შიდა'],
];

export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const shown = useEditorStore((s) => s.boltsShown);
  const toggleKindShown = useEditorStore((s) => s.toggleBoltKind);
  // The all-kinds switch left this menu but still lives in ზომების ჩვენება;
  // a kind switched on here must actually appear, whatever that one says.
  const toggleBoltKind = (k: 'connectors' | 'rods' | 'nuts' | 'latches') => {
    if (!shown[k]) setShowBolts(true);
    toggleKindShown(k);
  };
  const setShowBolts = useEditorStore((s) => s.setShowBolts);
  const resetBolts = useEditorStore((s) => s.resetBolts);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  // Only the kinds the drawing has on are counted (lib/boltKinds.ts).
  const on = useKindsOn();
  const setKindOn = useEditorStore((s) => s.setKindOn);
  const groups = useMemo(() => boltGroups(pieces, byId, on), [pieces, byId, on]);
  const walers = useMemo(() => walerTotals(soloPanels(pieces, byId)), [pieces, byId]);
  const walersShown = useEditorStore((s) => s.walersShown);
  const cc = useMemo(() => cornerConnectorTotals(cornerConnectorSpots(pieces, byId)), [pieces, byId]);
  const ccShown = useEditorStore((s) => s.cornerConnectorsShown);
  const setCcShown = useEditorStore((s) => s.setCornerConnectorsShown);
  const halfShown = useEditorStore((s) => s.halfHeadShown);
  const innerShown = useEditorStore((s) => s.innerConnectorsShown);
  const setInnerShown = useEditorStore((s) => s.setInnerConnectorsShown);
  const setHalfShown = useEditorStore((s) => s.setHalfHeadShown);
  const setWalersShown = useEditorStore((s) => s.setWalersShown);
  const [kinds, setKinds] = useState<KindsOn>(loadKinds);
  const [settingsOpen, setSettingsOpen] = useState(false);

  const toggleKind = (k: KindKey) => {
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
        title="დაისმება მხოლოდ ღილაკით „ავტომატურად თავიდან დასმა“ ან ხელით - T-შეერთებაზე და შიდა კუთხე ჩაკერებასთან"
        trail={<KindTrail groups={groups.connectors} on={on.connectors} shown={shown.connectors} onEye={() => toggleBoltKind('connectors')} />}
        onClick={() => setKindOn('connectors', !on.connectors)}
      >
        <span className={`bolts-kind${on.connectors ? '' : ' off'}`}>
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
        trail={<KindTrail groups={groups.rods} on={on.rods} shown={shown.rods} onEye={() => toggleBoltKind('rods')} />}
        onClick={() => setKindOn('rods', !on.rods)}
      >
        <span className={`bolts-kind${on.rods ? '' : ' off'}`}>
          <svg className="rods-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="0.5" y="5" width="13" height="4" rx="2" />
          </svg>
          შტირები
        </span>
      </MenuItem>
      <MenuItem
        title="შტირი × 2 (თითო ბოლოზე) + კონექტორები + ვოლერის შტირები + კუთხის კონექტორები 25 სმ + შტირები 40 სმ ნახევარი თავით - თითო თითოზე"
        trail={<KindTrail groups={groups.nuts} on={on.nuts} shown={shown.nuts} onEye={() => toggleBoltKind('nuts')} />}
        onClick={() => setKindOn('nuts', !on.nuts)}
      >
        <span className={`bolts-kind${on.nuts ? '' : ' off'}`}>
          <svg className="nuts-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect className="nut-washer" x="2.5" y="1" width="2.5" height="12" rx="0.8" />
            <rect className="nut-nut" x="5" y="4.5" width="5" height="5" rx="0.8" />
            <g transform="translate(11.2 7)">
              <WingShape hub={2.4} wings={10} px={0.6} />
            </g>
          </svg>
          ქანჩი + დისკო
        </span>
      </MenuItem>
      <MenuItem
        title="შტირის ორივე მხარეს, კედლის გარე მხარეზე - შტირებს შორის: 8 300-ზე, 2 150 / 90-ზე"
        trail={<KindTrail groups={groups.latches} on={on.latches} shown={shown.latches} onEye={() => toggleBoltKind('latches')} />}
        onClick={() => setKindOn('latches', !on.latches)}
      >
        <span className={`bolts-kind${on.latches ? '' : ' off'}`}>
          <svg className="latch-mark" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <ClampShape len={11} thick={4} px={0.7} />
          </svg>
          ჩამკეტი fix
        </span>
      </MenuItem>
      {/* ვოლერები: worked out behind every panel with nothing facing it -
          3 up a 300, 2 up a 150 / 90 - and what each one is bolted with. */}
      <MenuItem
        title="პანელი, რომელსაც კედლის მეორე მხარეს პირისპირ პანელი არ აქვს: 300-ზე 3 ვოლერი, 150 / 90-ზე 2. თითო ვოლერზე 2 შტირი 40 სმ, 2 ჩასაკეტი, 2 ქანჩი + დისკო"
        trail={
          <KindTrail
            groups={walers.groups}
            on={on.walers}
            shown={walersShown}
            onEye={() => {
              if (!walersShown) setShowBolts(true);
              setWalersShown(!walersShown);
            }}
          />
        }
        onClick={() => setKindOn('walers', !on.walers)}
      >
        <span className={`bolts-kind${on.walers ? '' : ' off'}`}>
          <svg className="walers-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="0.5" y="4.5" width="13" height="5" rx="1.5" />
            <circle cx="4" cy="7" r="1.2" />
            <circle cx="10" cy="7" r="1.2" />
          </svg>
          ვოლერები
        </span>
      </MenuItem>
      {on.walers && walers.walers > 0 && (
        <div className="bolts-sub">
          <span>{WALER_ROD_NAME}</span>
          <span className="bolts-calc">{walers.walers} × 2 =</span>
          <b>{walers.rods} ც.</b>
          <span>{WALER_LOCK_NAME}</span>
          <span className="bolts-calc">{walers.rods} × 1 =</span>
          <b>{walers.locks} ც.</b>
          <span>ქანჩი + დისკო ვოლერზე</span>
          <span className="bolts-calc">{walers.rods} × 1 =</span>
          <b>{walers.nuts} ც.</b>
        </div>
      )}
      {/* კუთხის კონექტორი 25 სმ: worked out at every outside corner closed
          with a ჩ5 - through the through panel and the ჩ5 into the run. */}
      <MenuItem
        title="გარე კუთხეში, სადაც გამავალ პანელსა და მომდევნო პანელს შორის ჩ5 დგას: 25 სმ კონექტორი ორივეში გადის, გარედან ქანჩი + დისკო. 300-ზე 5, 150 / 90-ზე 2"
        trail={
          <KindTrail
            groups={cc.groups}
            on={on.cornerConnectors}
            shown={ccShown}
            onEye={() => {
              if (!ccShown) setShowBolts(true);
              setCcShown(!ccShown);
            }}
          />
        }
        onClick={() => setKindOn('cornerConnectors', !on.cornerConnectors)}
      >
        <span className={`bolts-kind${on.cornerConnectors ? '' : ' off'}`}>
          <svg className="cc-menu-mark" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <line x1="3" y1="7" x2="13" y2="7" />
            <ellipse cx="2.5" cy="7" rx="1.6" ry="3.2" />
          </svg>
          {CORNER_CONNECTOR_NAME}
        </span>
      </MenuItem>
      {/* ...and where the corner is closed with a ჩ10, the half-head
          შტირი 40 სმ (წაჭრილი გაიკა) instead. */}
      <MenuItem
        title="გარე კუთხეში, სადაც გამავალ პანელსა და მომდევნო პანელს შორის ჩ10 დგას: შტირი 40 სმ ნახევარი თავით (წაჭრილი გაიკა, არა სრული თავით), გარედან ქანჩი + დისკო. 300-ზე 5, 150 / 90-ზე 2"
        trail={
          <KindTrail
            groups={cc.halfGroups}
            on={on.halfHead}
            shown={halfShown}
            onEye={() => {
              if (!halfShown) setShowBolts(true);
              setHalfShown(!halfShown);
            }}
          />
        }
        onClick={() => setKindOn('halfHead', !on.halfHead)}
      >
        <span className={`bolts-kind${on.halfHead ? '' : ' off'}`}>
          <svg className="cc-menu-mark half" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <line x1="3" y1="7" x2="13" y2="7" />
            <ellipse cx="2.5" cy="7" rx="1.6" ry="3.2" />
          </svg>
          {HALF_HEAD_NAME}
        </span>
      </MenuItem>
      {/* ...and at inside corners: the same 25 cm connector from inside the
          profile, ჩ5 or ჩ10 alike, with the small ბარაშკა on it. */}
      <MenuItem
        title="შიდა კუთხეში, კუთხის პროფილსა და პანელს შორის ჩ5 ან ჩ10: 25 სმ კონექტორი პროფილიდან ჩაკერებაში და პანელში, ბოლოზე პატარა ბარაშკა (გილზა + გაიკა). 300-ზე 5, 150 / 90-ზე 2"
        trail={
          <KindTrail
            groups={cc.innerGroups}
            on={on.innerConnectors}
            shown={innerShown}
            onEye={() => {
              if (!innerShown) setShowBolts(true);
              setInnerShown(!innerShown);
            }}
          />
        }
        onClick={() => setKindOn('innerConnectors', !on.innerConnectors)}
      >
        <span className={`bolts-kind${on.innerConnectors ? '' : ' off'}`}>
          <svg className="cc-menu-mark inner" width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <line x1="3" y1="7" x2="13" y2="7" />
            <ellipse cx="3" cy="7" rx="1.1" ry="2.2" />
          </svg>
          {INNER_CONNECTOR_NAME}
        </span>
      </MenuItem>
      {on.innerConnectors && cc.innerConnectors > 0 && (
        <div className="bolts-sub">
          <span>{SMALL_NUT_NAME}</span>
          <span className="bolts-calc">{cc.innerConnectors} × 1 =</span>
          <b>{cc.smallNuts} ც.</b>
        </div>
      )}
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
 * A kind's count and whether it is on the plan. The count is written the way
 * the user reads the drawing: so many places on the plan × so many at each
 * (one above the other, as the 3D shows) = how many in all.
 *
 * Clicking the row puts the kind on the drawing or takes it off - counted and
 * drawn, or neither (the user, 2026-11-04); the eye only shows or hides one
 * that is on.
 */
function KindTrail({
  groups,
  on,
  shown,
  onEye,
}: {
  groups: BoltGroup[];
  on: boolean;
  shown: boolean;
  onEye: () => void;
}) {
  const count = groups.reduce((n, g) => n + g.places * g.each, 0);
  const calc = groups.map((g) => `${g.places} × ${g.each}`).join(' + ');
  return (
    <span className="bolts-trail">
      {on && calc && (
        <span className="bolts-calc" title="ადგილი გეგმაზე × თითო ადგილზე (3D) = სულ">
          {calc} =
        </span>
      )}
      <span className={`bolts-count${on && shown ? '' : ' off'}`}>{on ? `${count} ც.` : 'გამორთ.'}</span>
      {/* The eye only shows or hides a kind that is on - the row itself is
          what puts it on the drawing or takes it off. */}
      <button
        type="button"
        className="bolts-eye"
        disabled={!on}
        title={!on ? 'ჯერ ჩართე - დააჭირე სტრიქონს' : shown ? 'ჩანს ნახაზზე - დამალვა' : 'დამალულია - ჩვენება'}
        aria-label={shown ? 'დამალვა' : 'ჩვენება'}
        onClick={(e) => {
          e.stopPropagation();
          onEye();
        }}
      >
        <Icon name={on && shown ? 'eye' : 'eye-off'} size={13} />
      </button>
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
