import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { boltKindOf, boltTotals, type BoltKindName } from '../lib/boltMarks';
import { replacementsFor } from '../lib/replace';
import type { Material } from '../types';
import { Menu, MenuItem, MenuLabel, MenuSep } from './Menu';
import { Icon } from './Icon';

/**
 * ჩანაცვლება in the top bar: swap pieces for another catalog item (the user,
 * 2026-10-23) - see `lib/replace.ts`.
 *
 * Two ways in, one menu. Pick a kind under "მონიშნე ყველა" and every one of it
 * on the drawing is selected; or select pieces by hand with Ctrl + click -
 * marks included - and open the menu again. Either way the lower half then
 * lists what the catalog has of that kind, and a click puts it in their place.
 */

const BOLT_NAMES: Array<[BoltKindName, string]> = [
  ['connectors', 'კონექტორები'],
  ['rods', 'შტირები'],
  ['nuts', 'ქანჩი + დისკო'],
  ['latches', 'ჩამკეტი fix'],
];

export function ReplaceButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const selectAllOf = useEditorStore((s) => s.selectAllOf);
  const replaceSelected = useEditorStore((s) => s.replaceSelected);
  const byId = useMemo(() => new Map(materials.map((m) => [m.id, m])), [materials]);

  // Every catalog item standing on the drawing, by how many - the ჭანჭიკები
  // are listed by kind below, since most of them are marks and not pieces yet.
  const onDrawing = useMemo(() => {
    const n = new Map<string, number>();
    for (const p of pieces) {
      const m = byId.get(p.materialId);
      if (m && !boltKindOf(m)) n.set(m.id, (n.get(m.id) ?? 0) + 1);
    }
    return [...n]
      .map(([id, count]) => ({ m: byId.get(id)!, count }))
      .sort((a, b) => a.m.category.localeCompare(b.m.category) || a.m.name.localeCompare(b.m.name, 'ka'));
  }, [pieces, byId]);
  const totals = useMemo(() => boltTotals(pieces, byId), [pieces, byId]);

  const selected = useMemo(() => {
    const set = new Set(selectedIds);
    return pieces.flatMap((p) => (set.has(p.id) && byId.get(p.materialId) ? [byId.get(p.materialId)!] : []));
  }, [pieces, selectedIds, byId]);
  const options = useMemo(() => replacementsFor(selected, materials), [selected, materials]);
  const current = new Set(selected.map((m) => m.id));

  return (
    <Menu
      align="right"
      trigger={(open) => (
        <button
          // Something selected is something it can replace: the button says so.
          className={`btn replace-btn${open ? ' active' : ''}${selectedIds.length ? ' ready' : ''}`}
          title="ჩანაცვლება - ნაწილების შეცვლა კატალოგის სხვა ნაწილით"
        >
          <Icon name="swap" />
          <span className="btn-label">ჩანაცვლება</span>
        </button>
      )}
    >
      {(close) => (
        <div className="replace-menu">
          <MenuLabel>მონიშნე ყველა</MenuLabel>
          <div className="replace-list">
            {BOLT_NAMES.filter(([k]) => totals[k] > 0).map(([k, name]) => (
              <MenuItem
                key={k}
                trail={<span className="replace-count">{totals[k]} ც.</span>}
                title="მონიშნავს ყველას ნახაზზე - ნიშნები ნამდვილ ნაწილებად იქცევა"
                onClick={() => selectAllOf({ bolts: k })}
              >
                {name}
              </MenuItem>
            ))}
            {onDrawing.map(({ m, count }) => (
              <MenuItem
                key={m.id}
                trail={<span className="replace-count">{count} ც.</span>}
                onClick={() => selectAllOf({ materialId: m.id })}
              >
                {m.name}
              </MenuItem>
            ))}
          </div>
          <MenuSep />
          <MenuLabel>
            ჩაანაცვლე მონიშნული{selected.length ? ` - ${selected.length} ც.` : ''}
          </MenuLabel>
          {selected.length === 0 ? (
            <div className="replace-hint">მონიშნე ნაწილები ზემოთ ან Ctrl + დაწკაპუნებით ნახაზზე</div>
          ) : options.length === 0 ? (
            <div className="replace-hint">მონიშნულია სხვადასხვა ტიპის ნაწილები - მონიშნე ერთი ტიპის</div>
          ) : (
            <div className="replace-list">
              {options.map((m: Material) => (
                <MenuItem
                  key={m.id}
                  on={current.size === 1 && current.has(m.id)}
                  onClick={() => {
                    replaceSelected(m.id);
                    close();
                  }}
                >
                  {m.name}
                </MenuItem>
              ))}
            </div>
          )}
        </div>
      )}
    </Menu>
  );
}
