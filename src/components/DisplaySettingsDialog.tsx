import { useEditorStore } from '../store/useEditorStore';
import {
  LENGTH_KINDS,
  LENGTH_VISIBILITIES,
  type LengthKind,
  type LengthVisibility,
} from '../lib/dimensions';
import { Icon } from './Icon';
import { Modal } from './Modal';

/** The columns: what a length belongs to, and what that takes in. */
const KIND_LABEL: Record<LengthKind, [string, string]> = {
  wall: ['კედელი', 'პანელები, ჩაკერება'],
  line: ['ხაზვა / ხაზი', 'მონახაზის ხაზები'],
  corner: ['კუთხე', 'კუთხის პროფილები'],
  other: ['დანარჩენი სხვა', 'რიგელები, ჭანჭიკები...'],
  measure: ['გაზომვა', 'ზომის ხაზები'],
};

/** The rows: when the length shows. */
const VISIBILITY_LABEL: Record<LengthVisibility, [string, string]> = {
  always: ['სულ აჩვენე', ''],
  hover: ['მაუსის მიტანისას', 'Hover'],
  click: ['დაკლიკებისას', 'Click'],
  never: ['არასდროს', ''],
};

/** A handful of colours that read on the dark surface, plus a free picker. */
const SWATCHES = ['#9aa4b2', '#e6e9ee', '#70a6f5', '#71c575', '#efa831', '#e5484d'];

/**
 * Which lengths show on screen, in one place.
 *
 * A table - one choice per kind of thing - because the question is never
 * "lengths on or off" but "these always, those only when I point at them".
 *
 * What goes on paper used to be a second tab here. It moved to the export
 * window, next to the preview of the sheet and the button that makes it, where
 * every other choice about the PDF now is; a link stays for anyone who looks
 * for it here.
 */
export function DisplaySettingsDialog() {
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const openDialog = useEditorStore((s) => s.openDialog);
  const resetScreenDisplay = useEditorStore((s) => s.resetScreenDisplay);

  return (
    <Modal
      title="ზომების ჩვენება"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={resetScreenDisplay}>
            ნაგულისხმევი
          </button>
          <button className="btn primary" onClick={closeDialog}>
            დახურვა
          </button>
        </>
      }
    >
      <div className="vis-top">
        <p className="hint-note" style={{ margin: 0 }}>
          აირჩიე, როდის ჩანდეს ზომა თითოეულ ტიპზე.
        </p>
        <button
          className="btn small"
          onClick={() => openDialog({ kind: 'export', tab: 'pdf' })}
          title="რა დაიბეჭდოს PDF-ში და რა ჩაიწეროს JSON-ში - ექსპორტის ფანჯარაში"
        >
          <Icon name="print" size={14} /> PDF / JSON - ექსპორტი…
        </button>
      </div>

      <ScreenSettings />
    </Modal>
  );
}

function ScreenSettings() {
  const showLengths = useEditorStore((s) => s.showLengths);
  const visibility = useEditorStore((s) => s.lengthVisibility);
  const style = useEditorStore((s) => s.measureStyle);
  const setShowLengths = useEditorStore((s) => s.setShowLengths);
  const setLengthVisibility = useEditorStore((s) => s.setLengthVisibility);
  const setMeasureStyle = useEditorStore((s) => s.setMeasureStyle);

  return (
    <>
      <label className="vis-check vis-master">
        <input type="checkbox" checked={showLengths} onChange={(e) => setShowLengths(e.target.checked)} />
        <span>
          ზომები ჩართულია <span className="menu-note">D</span>
        </span>
      </label>

      <div className={`vis-scroll${showLengths ? '' : ' muted'}`}>
        <table className="vis-matrix">
          <thead>
            <tr>
              <th />
              {LENGTH_KINDS.map((kind) => (
                <th key={kind} scope="col">
                  {KIND_LABEL[kind][0]}
                  <span>{KIND_LABEL[kind][1]}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {LENGTH_VISIBILITIES.map((row) => (
              <tr key={row}>
                <th scope="row">
                  {VISIBILITY_LABEL[row][0]}
                  {VISIBILITY_LABEL[row][1] && <span>({VISIBILITY_LABEL[row][1]})</span>}
                </th>
                {LENGTH_KINDS.map((kind) => {
                  const on = visibility[kind] === row;
                  return (
                    <td key={kind}>
                      <button
                        type="button"
                        className={`vis-cell${on ? ' on' : ''}`}
                        aria-pressed={on}
                        aria-label={`${KIND_LABEL[kind][0]} - ${VISIBILITY_LABEL[row][0]}`}
                        onClick={() => setLengthVisibility(kind, row)}
                      >
                        {on && <Icon name="check" size={18} />}
                      </button>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <h4 className="vis-section">გაზომვა</h4>
      <div className="vis-extra">
        <label className="vis-check">
          <input
            type="checkbox"
            checked={style.helper}
            onChange={(e) => setMeasureStyle({ helper: e.target.checked })}
          />
          <span>
            დამხმარე მიბმა - კედლის და პანელის აღმოჩენა, შემდეგი წერტილის შეთავაზება, ზომის ხაზების
            მაგნიტი <span className="menu-note">H · Alt - დროებით გამორთვა</span>
          </span>
        </label>
        <label className="vis-check">
          <input
            type="checkbox"
            checked={style.showOffsets}
            onChange={(e) => setMeasureStyle({ showOffsets: e.target.checked })}
          />
          <span>მონიშნულზე კედლიდან დაშორების ჩვენება</span>
        </label>
      </div>

      <div className="form-grid" style={{ marginTop: 12 }}>
        <ColorField label="ხაზის ფერი" value={style.color} onChange={(color) => setMeasureStyle({ color })} />
        <ColorField
          label="მონიშნულის ფერი"
          value={style.focusColor}
          onChange={(focusColor) => setMeasureStyle({ focusColor })}
        />
        <label className="field span2">
          <span>გამჭვირვალობა - {Math.round(style.opacity * 100)}%</span>
          <input
            type="range"
            min={0.15}
            max={1}
            step={0.05}
            value={style.opacity}
            onChange={(e) => setMeasureStyle({ opacity: Number(e.target.value) })}
          />
        </label>
      </div>
    </>
  );
}

function ColorField({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (color: string) => void;
}) {
  return (
    <div className="field span2">
      <span>{label}</span>
      <div className="measure-swatches">
        {SWATCHES.map((c) => (
          <button
            key={c}
            type="button"
            className={`measure-swatch${value.toLowerCase() === c ? ' on' : ''}`}
            style={{ background: c }}
            onClick={() => onChange(c)}
            aria-label={c}
            title={c}
          />
        ))}
        <input type="color" value={value} onChange={(e) => onChange(e.target.value)} />
      </div>
    </div>
  );
}
