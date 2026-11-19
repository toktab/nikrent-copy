import { useMemo } from 'react';
import { useEditorStore, useKindsOn } from '../store/useEditorStore';
import { allGaps, faceBands, isFace } from '../lib/gap';
import { hiddenSpan, projectPiece } from '../lib/projection';
import { useSyncStore } from '../lib/syncEngine';
import { useOnline } from '../lib/useOnline';
import { combo, overrideLabel } from '../lib/platform';
import { VIEW_LABEL } from '../lib/projection';
import { fmtNum } from '../lib/bom';
import { remainingRows } from '../lib/remaining';
import { Icon } from './Icon';
import { Menu, MenuItem, MenuLabel } from './Menu';
import { replacementsFor } from '../lib/replace';
import { combo as keyCombo } from '../lib/platform';

/**
 * კოპირება, ამოჭრა, ჩასმა and ჩანაცვლება on the bottom rail (the user,
 * 2026-11-17), beside what is selected - so they are found without knowing
 * Ctrl + C / X / V. ჩანაცვლება here is the quick one: the same kind of thing
 * in another size (a 60 panel for a 90, a ჩ5 for a ჩ10), straight from the
 * selection; the top bar's ჩანაცვლება still does the whole drawing.
 */
function SelectionActions() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const clipboard = useEditorStore((s) => s.clipboard.length);
  const copySelection = useEditorStore((s) => s.copySelection);
  const cutSelection = useEditorStore((s) => s.cutSelection);
  const pasteClipboard = useEditorStore((s) => s.pasteClipboard);
  const replaceSelected = useEditorStore((s) => s.replaceSelected);
  const setToast = useEditorStore((s) => s.setToast);

  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);
  const picked = useMemo(() => {
    const set = new Set(selectedIds);
    return pieces.flatMap((p) => (set.has(p.id) && byId.get(p.materialId) ? [byId.get(p.materialId)!] : []));
  }, [pieces, selectedIds, byId]);
  const current = new Set(picked.map((m) => m.id));
  // Same kind, by size: narrowest first, then lowest.
  const options = useMemo(
    () => [...replacementsFor(picked, materials)].sort((a, b) => a.w - b.w || a.h - b.h || a.name.localeCompare(b.name, 'ka')),
    [picked, materials],
  );
  const has = selectedIds.length > 0;
  if (!has && !clipboard) return null;

  return (
    <span className="status-actions">
      <button
        className="btn small ghost"
        disabled={!has}
        onClick={copySelection}
        title={`კოპირება (${keyCombo(['mod', 'C'])})`}
      >
        <Icon name="copy" size={13} /> კოპირება
      </button>
      <button
        className="btn small ghost"
        disabled={!has}
        onClick={cutSelection}
        title={`ამოჭრა (${keyCombo(['mod', 'X'])}) - კოპირდება და ნახაზიდან იშლება`}
      >
        <Icon name="scissors" size={13} /> ამოჭრა
      </button>
      <button
        className="btn small ghost"
        disabled={!clipboard}
        onClick={pasteClipboard}
        title={`ჩასმა (${keyCombo(['mod', 'V'])})${clipboard ? ` - ${clipboard} ელემენტი` : ''}`}
      >
        <Icon name="paste" size={13} /> ჩასმა
      </button>
      <Menu
        up
        align="right"
        trigger={(open) => (
          <button
            className={`btn small ghost${open ? ' active' : ''}`}
            disabled={!has || options.length < 2}
            title={options.length < 2 ? 'მონიშნე ერთი სახეობის ელემენტები - სხვა ზომით შესაცვლელად' : 'იგივე ელემენტი სხვა ზომით'}
          >
            <Icon name="swap" size={13} /> ჩანაცვლება <Icon name="chevron-down" size={11} />
          </button>
        )}
      >
        {(close) => (
          <>
            <MenuLabel>შეცვლა ზომით ({selectedIds.length} მონიშნული)</MenuLabel>
            {options.map((m) => (
              <MenuItem
                key={m.id}
                on={current.has(m.id) && current.size === 1}
                onClick={() => {
                  replaceSelected(m.id);
                  setToast(`ჩანაცვლდა: ${m.name} (Ctrl+Z - დაბრუნება)`);
                  close();
                }}
              >
                {m.name}
              </MenuItem>
            ))}
          </>
        )}
      </Menu>
    </span>
  );
}

/**
 * The bottom rail.
 *
 * This replaces a footer of eleven keyboard hints that were all equally loud
 * and never changed. Four hints stay — the ones that are genuinely hard to
 * discover — and the space they free goes to the things that do change: what
 * is selected, which view is on screen, and whether the network is there.
 */
export function StatusBar() {
  const selected = useEditorStore((s) => s.selectedIds.length);
  const total = useEditorStore((s) => s.pieces.length);
  const zoom = useEditorStore((s) => s.zoom);
  const viewMode = useEditorStore((s) => s.viewMode);
  const surfaceView = useEditorStore((s) => s.surfaceView);
  const pending = useSyncStore((s) => s.pendingChanges);
  const online = useOnline();
  const pieces = useEditorStore((s) => s.pieces);
  // Real quantities of every ჭანჭიკი, not marks (quantities.ts).
  const kinds = useKindsOn();
  const materials = useEditorStore((s) => s.materials);
  const showGaps = useEditorStore((s) => s.showGaps);
  const simple = useEditorStore((s) => s.simpleMode);

  // Only counted while the check is on. Running it over every piece on every
  // keystroke to display a number nobody asked for would be a tax on drawing.
  const openGaps = useMemo(() => {
    if (!showGaps) return 0;
    const byId = new Map(materials.map((m) => [m.id, m]));
    const rects = pieces.flatMap((p) => {
      const m = byId.get(p.materialId);
      if (!isFace(m) || !m) return [];
      const r = projectPiece(p, m, surfaceView);
      return [{
        ...r,
        heightCm: m.h,
        span: hiddenSpan(p, m, surfaceView),
        bands: faceBands(r, m, p.rot, viewMode === '3d' || surfaceView !== 'plan'),
      }];
    });
    return allGaps(rects).length;
  }, [showGaps, pieces, materials, surfaceView, viewMode]);

  // What the drawing weighs, for the truck. Always on: a count and a sum per
  // component, nothing like the gap check's cost.
  const weight = useMemo(() => remainingRows(materials, pieces, { show: 'used', kinds }), [materials, pieces, kinds]);

  const view = viewMode === '3d' ? '3D' : VIEW_LABEL[surfaceView];

  return (
    <footer className="statusbar">
      {/* Simple mode is for somebody who already knows the keys, or does not
          need them: the hints go, what the drawing says stays. */}
      {!simple && (
        <span className="hintlist">
          <span>
            <kbd>R</kbd> მოტრიალება
          </span>
          <span>
            <kbd>{combo(['mod', 'Z'])}</kbd> დაბრუნება
          </span>
          <span>
            <kbd>{combo(['mod', 'D'])}</kbd> დუბლირება
          </span>
          {/* The two modifiers that only exist mid-drag. Nobody discovers a key
              you have to already be holding something to use, and both had been
              found the hard way — by asking why the thing would not move. */}
          <span className="opt">
            <kbd>{combo(['shift'])}</kbd> + თრევა - სწორ ხაზზე
          </span>
          <span className="opt">
            <kbd>{overrideLabel()}</kbd> + თრევა - მიბმის გარეშე
          </span>
          <span className="opt">
            <kbd>Space</kbd> + თრევა - ხედის გადაწევა
          </span>
        </span>
      )}

      <span className="flex-spacer" />

      <SelectionActions />

      {!online && (
        <span className="status-offline" title="ცვლილებები ინახება ლოკალურად">
          <Icon name="offline" size={13} /> ოფლაინ
          {pending && <span className="status-queued">ცვლილებები რიგშია</span>}
        </span>
      )}
      {showGaps && (
        <span className={`status-gaps${openGaps ? ' open' : ''}`}>
          {openGaps ? `${openGaps} ნაპრალი` : 'ნაპრალი არაა'}
        </span>
      )}
      {selected > 0 && (
        <span className="status-sel">
          მონიშნული <b>{selected}</b>
        </span>
      )}
      {total > 0 && (
        <span
          className="status-weight"
          title={
            weight.unweighed
              ? `${weight.unweighed} კომპონენტს წონა არ აქვს - ჯამი არასრულია (მარაგი → „წონები (Excel-იდან)“)`
              : 'ნახაზის სრული წონა'
          }
        >
          {fmtNum(weight.weightKg)} კგ{weight.unweighed ? '*' : ''}
        </span>
      )}
      <span className="status-view">
        {total} ელემენტი{simple ? '' : ` · ${view}`} · {Math.round(zoom * 100)}%
      </span>
    </footer>
  );
}
