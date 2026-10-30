import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { CATEGORY_ORDER, categoryLabel } from '../data/categories';
import { boltKindOf } from '../lib/boltMarks';
import {
  DEFAULT_PANEL_DEPTH_CM,
  isMaterialShown,
  normalizeMoveStep,
  normalizePanelDepth,
} from '../lib/objectVisibility';
import { DRAW_STEP_CM } from '../lib/geometry';
import { keepWheelOffNumber } from '../lib/numberField';
import type { Category } from '../types';
import { Icon } from './Icon';
import { Modal } from './Modal';

/**
 * პარამეტრები: the numbers the editor works to, and what the plan draws.
 *
 * One window for the defaults the user asked to be able to change (2026-10-30):
 * how far a piece moves in one step - which is also one square of the grid -
 * how thick a panel is drawn, and which kinds of thing the main scheme shows.
 * Everything here is this person's, on this machine, like the rest of the view.
 */
export function SettingsDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const snapStep = useEditorStore((s) => s.snapStep);
  const setSnapStep = useEditorStore((s) => s.setSnapStep);
  const panelDepth = useEditorStore((s) => s.panelDepth);
  const setPanelDepth = useEditorStore((s) => s.setPanelDepth);
  const resetObjectVisibility = useEditorStore((s) => s.resetObjectVisibility);

  const reset = () => {
    setSnapStep(DRAW_STEP_CM);
    setPanelDepth(DEFAULT_PANEL_DEPTH_CM);
    resetObjectVisibility();
  };

  return (
    <Modal
      title="პარამეტრები"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={reset} title="5 სმ ბიჯი, 10 სმ სისქე, ნაგულისხმევი ხილვადობა">
            ნაგულისხმევი
          </button>
          <button className="btn primary" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      <h4 className="vis-section" style={{ marginTop: 0 }}>
        ზომები
      </h4>
      <div className="form-grid">
        <NumberSetting
          label="გადაადგილების ბიჯი"
          hint="რამდენით გადაადგილდება ელემენტი ერთ ნაბიჯზე (ისრებით ან თრევით) - ბადის ერთი უჯრაც ამხელაა"
          value={snapStep}
          min={DRAW_STEP_CM}
          max={50}
          step={5}
          normalize={(v) => Math.max(DRAW_STEP_CM, normalizeMoveStep(v))}
          onChange={setSnapStep}
        />
        <NumberSetting
          label="ელემენტის სისქე"
          hint="რა სისქით იხაზება პანელი და ჩაკერება გეგმაზე - 10 სმ = ბადის 2 უჯრა"
          value={panelDepth}
          min={1}
          max={30}
          step={1}
          normalize={normalizePanelDepth}
          onChange={setPanelDepth}
        />
      </div>

      <h4 className="vis-section">ხილვადობა ნახაზზე</h4>
      <p className="hint-note" style={{ marginTop: 0 }}>
        დამალული ელემენტი ნახაზზე რჩება - ითვლება სიაში და მარაგში, უბრალოდ არ ჩანს და არ
        მოინიშნება. ჭანჭიკები (შტირი, ქანჩი + დისკო, კონექტორი, ჩამკეტი) ჭანჭიკების მენიუდან
        იმალება.
      </p>
      <VisibilityList />
    </Modal>
  );
}

function NumberSetting({
  label,
  hint,
  value,
  min,
  max,
  step,
  normalize,
  onChange,
}: {
  label: string;
  hint: string;
  value: number;
  min: number;
  max: number;
  step: number;
  normalize: (v: unknown) => number;
  onChange: (v: number) => void;
}) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (raw: string) => {
    if (raw.trim() !== '') onChange(normalize(raw.replace(',', '.')));
    setDraft(null);
  };
  return (
    <label className="field" title={hint}>
      <span>{label}</span>
      <span className="rot-field">
        <input
          type="number"
          min={min}
          max={max}
          step={step}
          value={draft ?? String(value)}
          onWheel={keepWheelOffNumber}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') commit((e.target as HTMLInputElement).value);
          }}
        />
        <span className="deg">სმ</span>
      </span>
      <small className="menu-note">{hint}</small>
    </label>
  );
}

/** A row per category, opened out into its materials for one-by-one choices. */
function VisibilityList() {
  const materials = useEditorStore((s) => s.materials);
  const vis = useEditorStore((s) => s.objectVisibility);
  const setObjectShown = useEditorStore((s) => s.setObjectShown);
  const [open, setOpen] = useState<Category | null>(null);

  const byCategory = useMemo(() => {
    const out = new Map<Category, typeof materials>();
    for (const m of materials) {
      if (boltKindOf(m)) continue;
      out.set(m.category, [...(out.get(m.category) ?? []), m]);
    }
    return out;
  }, [materials]);

  return (
    <div className="settings-vis">
      {CATEGORY_ORDER.map((category) => {
        const list = byCategory.get(category) ?? [];
        if (!list.length) return null;
        const shown = list.filter((m) => isMaterialShown(vis, m)).length;
        const all = shown === list.length;
        const none = shown === 0;
        return (
          <div key={category} className="settings-vis-group">
            <div className="settings-vis-row">
              <label className="vis-check">
                <input
                  type="checkbox"
                  checked={all}
                  ref={(el) => {
                    if (el) el.indeterminate = !all && !none;
                  }}
                  onChange={(e) => setObjectShown({ category }, e.target.checked)}
                />
                <span>
                  {categoryLabel(category)}{' '}
                  <span className="menu-note">
                    {shown} / {list.length}
                  </span>
                </span>
              </label>
              <button
                className="btn icon small ghost"
                onClick={() => setOpen(open === category ? null : category)}
                aria-expanded={open === category}
                aria-label="თითოეული ელემენტი"
                title="თითოეული ელემენტი"
              >
                <Icon name={open === category ? 'chevron-down' : 'chevron-right'} size={14} />
              </button>
            </div>
            {open === category && (
              <div className="settings-vis-items">
                {list.map((m) => (
                  <label key={m.id} className="vis-check">
                    <input
                      type="checkbox"
                      checked={isMaterialShown(vis, m)}
                      onChange={(e) => setObjectShown({ materialId: m.id }, e.target.checked)}
                    />
                    <span>{m.name}</span>
                  </label>
                ))}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}
