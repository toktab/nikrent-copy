import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { connectorCount } from '../lib/bolts';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';

/**
 * ჭანჭიკები in the top bar: the fixings the drawing needs, in a menu.
 *
 * The კონექტორი count used to sit in the bar by itself. ჭანჭიკი is the
 * general word for this kind of hardware, and more kinds are coming, so the bar
 * carries one button and the menu lists each kind with its count. The marks on
 * the plan are switched from here too - the same switch as in ზომების ჩვენება.
 */
export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const showBolts = useEditorStore((s) => s.showBolts);
  const setShowBolts = useEditorStore((s) => s.setShowBolts);
  const resetBolts = useEditorStore((s) => s.resetBolts);
  const connectors = useMemo(
    () => connectorCount(pieces, new Map(materials.map((m) => [m.id, m]))),
    [pieces, materials],
  );

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
      <MenuSep />
      <MenuItem on={showBolts} onClick={() => setShowBolts(!showBolts)}>
        კონექტორების ჩვენება ნახაზზე
      </MenuItem>
      <MenuItem
        icon="reset"
        title="ხელით გადატანილი და წაშლილი კონექტორები ისევ ავტომატურად დაისმება - Ctrl+Z აბრუნებს"
        onClick={() => {
          resetBolts();
          setShowBolts(true);
        }}
      >
        ავტომატურად თავიდან დასმა
      </MenuItem>
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
