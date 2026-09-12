import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import {
  LENGTH_KINDS,
  LENGTH_VISIBILITIES,
  type LengthKind,
  type LengthVisibility,
  type PdfVisibility,
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

const PDF_EXTRAS: Array<[keyof PdfVisibility, string]> = [
  ['sketchLines', 'მონახაზის ხაზები'],
  ['measureLines', 'ზომის ხაზები'],
  ['overall', 'ჯამური ზომები (სიგანე და სიმაღლე ნახაზის გარეთ)'],
];

/** A handful of colours that read on the dark surface, plus a free picker. */
const SWATCHES = ['#9aa4b2', '#e6e9ee', '#70a6f5', '#71c575', '#efa831', '#e5484d'];

/**
 * Everything about which lengths show, in one place.
 *
 * The screen side is a table - one choice per kind of thing - because the
 * question is never "lengths on or off" but "these always, those only when I
 * point at them". The PDF side is simpler: paper has no pointer, so each length
 * is on the sheet or it is not.
 */
export function DisplaySettingsDialog() {
  const [view, setView] = useState<'screen' | 'pdf'>('screen');
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const resetScreenDisplay = useEditorStore((s) => s.resetScreenDisplay);
  const resetPdfVisibility = useEditorStore((s) => s.resetPdfVisibility);

  return (
    <Modal
      title="ზომების ჩვენება"
      wide
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={view === 'screen' ? resetScreenDisplay : resetPdfVisibility}>
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
          {view === 'screen'
            ? 'აირჩიე, როდის ჩანდეს ზომა თითოეულ ტიპზე.'
            : 'აირჩიე, რა დაიბეჭდოს PDF-ში.'}
        </p>
        <div className="seg" role="group" aria-label="სად">
          <button className={view === 'screen' ? 'on' : undefined} onClick={() => setView('screen')}>
            ეკრანი
          </button>
          <button className={view === 'pdf' ? 'on' : undefined} onClick={() => setView('pdf')}>
            <Icon name="print" size={14} /> PDF
          </button>
        </div>
      </div>

      {view === 'screen' ? <ScreenSettings /> : <PdfSettings />}
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

function PdfSettings() {
  const pdf = useEditorStore((s) => s.pdfVisibility);
  const setPdfVisibility = useEditorStore((s) => s.setPdfVisibility);

  return (
    <>
      <div className="vis-scroll">
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
            <tr>
              <th scope="row">ზომა PDF-ში</th>
              {LENGTH_KINDS.map((kind) => (
                <td key={kind}>
                  <button
                    type="button"
                    className={`vis-cell${pdf[kind] ? ' on' : ''}`}
                    aria-pressed={pdf[kind]}
                    aria-label={`${KIND_LABEL[kind][0]} - PDF`}
                    onClick={() => setPdfVisibility({ [kind]: !pdf[kind] })}
                  >
                    {pdf[kind] && <Icon name="check" size={18} />}
                  </button>
                </td>
              ))}
            </tr>
          </tbody>
        </table>
      </div>

      <h4 className="vis-section">ნახაზზე</h4>
      <div className="vis-extra">
        {PDF_EXTRAS.map(([key, label]) => (
          <label key={key} className="vis-check">
            <input
              type="checkbox"
              checked={pdf[key]}
              onChange={(e) => setPdfVisibility({ [key]: e.target.checked })}
            />
            <span>{label}</span>
          </label>
        ))}
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
