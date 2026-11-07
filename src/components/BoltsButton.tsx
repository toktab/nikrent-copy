import { useMemo, useState } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { EVERY_KIND, type KindKey, type KindsOn } from '../lib/boltKinds';
import { boltGroups, type BoltGroup } from '../lib/boltMarks';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Icon } from './Icon';
import { ClampShape, ConnectorGlyph, RING, WingShape } from './BoltLayer';
import { findCornerRods } from '../lib/bolts';
import { CrocodileShape, FrogShape, PanelHolderShape } from './ShapeSvg';
import { soloPanels, WALER_LOCK_NAME, WALER_ROD_NAME, walerTotals } from '../lib/walers';
import { CORNER_CONNECTOR_NAME, cornerConnectorSpots, cornerConnectorTotals, FULL_HEAD_NAME, HALF_HEAD_NAME, INNER_CONNECTOR_NAME, SMALL_NUT_NAME } from '../lib/cornerConnectors';

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
  ['connectors', 'კონექტორები (25 სმ) - T, გარე და შიდა კუთხე'],
  ['rods', 'შტირები'],
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
  ['walers', 'ვოლერები'],
  ['halfHead', 'შტირი 40 სმ ნახევარი თავით'],
  ['fullHead', 'შტირი 40 სმ მთლიანი თავით'],
  ['crocodiles', 'ნიანგი'],
  ['frogs', 'ბაყაყი'],
  ['props', 'დგარი და თავი'],
];

export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const shown = useEditorStore((s) => s.boltsShown);
  const toggleKindShown = useEditorStore((s) => s.toggleBoltKind);
  // The all-kinds switch left this menu but still lives in ზომების ჩვენება;
  // a kind switched on here must actually appear, whatever that one says.
  const toggleBoltKind = (k: 'connectors' | 'rods' | 'nuts' | 'latches' | 'holders' | 'crocodiles' | 'frogs' | 'props') => {
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
  const fullShown = useEditorStore((s) => s.fullHeadShown);
  const setFullShown = useEditorStore((s) => s.setFullHeadShown);
  const fullGroups = useMemo(() => {
    const by = new Map<number, number>();
    for (const r of findCornerRods(pieces, byId)) by.set(r.count, (by.get(r.count) ?? 0) + 1);
    return [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each);
  }, [pieces, byId]);
  const setWalersShown = useEditorStore((s) => s.setWalersShown);
  // The three connector kinds, one row: counted together, on and shown together.
  const connectorsOn = on.connectors || on.cornerConnectors || on.innerConnectors;
  const connectorsShown = shown.connectors && ccShown && innerShown;
  const connectorGroups = useMemo(() => {
    const by = new Map<number, number>();
    const add = (list: Array<{ places: number; each: number }>) => {
      for (const g of list) by.set(g.each, (by.get(g.each) ?? 0) + g.places);
    };
    add(groups.connectors);
    if (on.cornerConnectors) add(cc.groups);
    if (on.innerConnectors) add(cc.innerGroups);
    return [...by].map(([each, places]) => ({ places, each })).sort((a, b) => b.each - a.each);
  }, [groups.connectors, cc, on.cornerConnectors, on.innerConnectors]);
  const toggleConnectorsShown = () => {
    const next = !connectorsShown;
    if (next) setShowBolts(true);
    if (shown.connectors !== next) toggleKindShown('connectors');
    setCcShown(next);
    setInnerShown(next);
  };
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
      {/* კონექტორები 25 სმ - every one of them in one row (the user, 2026-11-07):
          the placed ones at T-joints and the worked-out ones at outside and
          inside corners are the same part. */}
      <MenuItem
        title="კონექტორი 25 სმ: T-შეერთებაზე (5 ც. ადგილზე), გარე კუთხეში ჩ5-ით და შიდა კუთხეში ჩ5 / ჩ10-ით (300-ზე 5, 150 / 90-ზე 2). დაისმება „ავტომატურად თავიდან დასმა“-თი ან ხელით"
        trail={<KindTrail groups={connectorGroups} on={connectorsOn} shown={connectorsShown} onEye={toggleConnectorsShown} />}
        onClick={() => {
          for (const k of ['connectors', 'cornerConnectors', 'innerConnectors'] as const) setKindOn(k, !connectorsOn);
        }}
      >
        <span className={`bolts-kind${connectorsOn ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <ConnectorGlyph cx={0} cy={0} r={6.2} px={0.5} label="" ring={RING.connector} />
          </svg>
          კონექტორები (25 სმ)
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
          <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <ConnectorGlyph cx={0} cy={0} r={6.2} px={0.5} label="" head="half" ring={RING.halfHead} />
          </svg>
          {HALF_HEAD_NAME}
        </span>
      </MenuItem>
      {/* ...and where an inside corner's leg end faces an outer joint, the
          whole-head შტირი 40 სმ (წაჭრის გარეშე). */}
      <MenuItem
        title="შიდა კუთხის ფეხის ბოლოს პირდაპირ, გარე ფასადის შეერთებასთან: შტირი 40 სმ მთლიანი თავით (წაჭრის გარეშე), გარედან ქანჩი + დისკო. 300-ზე 5, 150 / 90-ზე 2"
        trail={
          <KindTrail
            groups={fullGroups}
            on={on.fullHead}
            shown={fullShown}
            onEye={() => {
              if (!fullShown) setShowBolts(true);
              setFullShown(!fullShown);
            }}
          />
        }
        onClick={() => setKindOn('fullHead', !on.fullHead)}
      >
        <span className={`bolts-kind${on.fullHead ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
            <ConnectorGlyph cx={0} cy={0} r={6.2} px={0.5} label="" head="full" ring={RING.fullHead} />
          </svg>
          {FULL_HEAD_NAME}
        </span>
      </MenuItem>
      {on.innerConnectors && cc.innerConnectors > 0 && (
        <div className="bolts-sub">
          <span>{SMALL_NUT_NAME}</span>
          <span className="bolts-calc">{cc.innerConnectors} × 1 =</span>
          <b>{cc.smallNuts} ც.</b>
        </div>
      )}
      {/* პანელის ბეტონზე სამაგრი: placed by hand only, at the foot of a panel
          with nothing facing it - counted as placed, never by the reset. */}
      <MenuItem
        title="ცალმხრივი პანელის (პირისპირ პანელი რომ არ აქვს) ძირში, ბეტონზე - მხოლოდ ხელით დაისმება ელემენტებიდან, ავტომატურად არასდროს. თითო დასმულზე 1"
        trail={<KindTrail groups={groups.holders} on shown={shown.holders} onEye={() => toggleBoltKind('holders')} />}
        // Never off, only hidden: the row does what its eye does.
        onClick={() => toggleBoltKind('holders')}
      >
        <span className={`bolts-kind${shown.holders ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="0 0 6 6" aria-hidden="true">
            <PanelHolderShape w={6} h={6} px={0.5} />
          </svg>
          პანელის ბეტონზე სამაგრი
        </span>
      </MenuItem>
      {/* ნიანგი and ბაყაყი: placed by ავტომატურად თავიდან დასმა on the places
          the rule names, or by hand - see lib/clamps.ts. */}
      <MenuItem
        title="ორ პანელს შორის ჩაკერება - ნიანგი სამივეზე გადადის, ფასადის უკანა მხარეს. 300-ზე 4, 150 / 90-ზე 2. დაისმება „ავტომატურად თავიდან დასმა“-თი ან ხელით"
        trail={<KindTrail groups={groups.crocodiles} on={on.crocodiles} shown={shown.crocodiles} onEye={() => toggleBoltKind('crocodiles')} />}
        onClick={() => setKindOn('crocodiles', !on.crocodiles)}
      >
        <span className={`bolts-kind${on.crocodiles ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="0 -4 24 12" aria-hidden="true">
            <CrocodileShape w={24} h={4} px={0.8} />
          </svg>
          ნიანგი
        </span>
      </MenuItem>
      <MenuItem
        title="ორი პანელი ერთმანეთის გვერდით, ჩაკერების გარეშე - ბაყაყი ორივეზე, ფასადის უკანა მხარეს. 300-ზე 4, 150 / 90-ზე 2. დაისმება „ავტომატურად თავიდან დასმა“-თი ან ხელით"
        trail={<KindTrail groups={groups.frogs} on={on.frogs} shown={shown.frogs} onEye={() => toggleBoltKind('frogs')} />}
        onClick={() => setKindOn('frogs', !on.frogs)}
      >
        <span className={`bolts-kind${on.frogs ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="0 -3 14 10" aria-hidden="true">
            <FrogShape w={14} h={4} px={0.6} />
          </svg>
          ბაყაყი
        </span>
      </MenuItem>
      <MenuItem
        title="დგარი და თავი: პატარა - 150 / 90-იან პანელზე, დიდი - 300-იანზე. „ავტომატურად თავიდან დასმა“ - თითო ყოველ ცალმხრივ პანელზე (პირისპირ პანელი რომ არ აქვს), ზურგიდან, შუაში. ხელითაც - პანელს ეკვრის"
        trail={<KindTrail groups={groups.props} on={on.props} shown={shown.props} onEye={() => toggleBoltKind('props')} />}
        onClick={() => setKindOn('props', !on.props)}
      >
        <span className={`bolts-kind${on.props ? '' : ' off'}`}>
          <svg width="14" height="14" viewBox="0 0 14 14" aria-hidden="true">
            <rect x="5.5" y="1" width="3" height="11" rx="1" fill="#2f7de1" stroke="#163f78" strokeWidth="0.6" />
            <rect x="3" y="0.5" width="8" height="2" fill="#4a525c" />
            <rect x="2.5" y="11.5" width="9" height="2" fill="#4a525c" />
            <path d="M 8.5 5.5 H 11 V 7.5 H 8.5" fill="none" stroke="#163f78" strokeWidth="0.9" />
          </svg>
          დგარი და თავი
        </span>
      </MenuItem>
      <MenuSep />
      <div className="bolts-reset-row">
        <MenuItem
          icon="reset"
          disabled={chosen.length === 0}
          title={`${chosen.join(', ') || 'არაფერი არ არის არჩეული'} - ხელით გადატანილი და წაშლილი ისევ ავტომატურად დაისმება. Ctrl+Z აბრუნებს`}
          onClick={() => {
            // The corner connectors go with the კონექტორები choice - one part.
            resetBolts({ ...kinds, cornerConnectors: kinds.connectors, innerConnectors: kinds.connectors });
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
