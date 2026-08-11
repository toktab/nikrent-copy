import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { planSketchFillAll, type SketchFillSpec } from '../lib/sketchFill';
import { pathLength } from '../lib/sketch';
import { Modal } from './Modal';

/**
 * Builds the formwork for a run that has already been drawn.
 *
 * The difference from the wall wizard is everything that is NOT asked for here:
 * no length, no origin, no direction, no leg count. All of that is on the
 * screen already. What is left is what the drawing cannot know — how thick the
 * pour is, how high it goes, and how it is tied.
 */
export function SketchFillDialog({ pathIds }: { pathIds: string[] }) {
  const materials = useEditorStore((s) => s.materials);
  const paths = useEditorStore((s) => s.sketch.filter((k) => pathIds.includes(k.id)));
  const fillSketch = useEditorStore((s) => s.fillSketch);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);

  const [thickness, setThickness] = useState('20');
  const [height, setHeight] = useState('300');
  const [includeCorners, setIncludeCorners] = useState(true);
  const [includeStopEnds, setIncludeStopEnds] = useState(true);

  const n = (v: string) => Number(String(v).replace(',', '.'));

  const spec: SketchFillSpec = useMemo(
    () => ({
      thickness: n(thickness),
      height: n(height),
      includeCorners,
      includeStopEnds,
    }),
    [thickness, height, includeCorners, includeStopEnds],
  );

  const errors: string[] = [];
  if (!Number.isFinite(spec.thickness) || spec.thickness <= 0) errors.push('სისქე სავალდებულოა.');
  if (!Number.isFinite(spec.height) || spec.height <= 0) errors.push('სიმაღლე სავალდებულოა.');

  // Live preview of exactly what will be placed, warnings included.
  const plan = useMemo(
    () => (paths.length && !errors.length ? planSketchFillAll(paths, spec, materials) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths, spec, materials, errors.length],
  );

  if (!paths.length) return null;
  // Only meaningful when every run selected is a closed room; a mixed selection
  // still has ends to stop.
  const closed = paths.every((p) => !!p.closed && p.points.length > 2);

  const submit = () => {
    if (errors.length) return;
    const result = fillSketch(pathIds, spec);
    setToast(
      !result.added
        ? 'ყალიბი ვერ აიწყო — შეამოწმე კატალოგი და ზომები.'
        : result.warnings.length
          ? `დაემატა ${result.added} ელემენტი, ${result.warnings.length} გაფრთხილებით.`
          : `დაემატა ${result.added} ელემენტი.`,
    );
    closeDialog();
  };

  return (
    <Modal
      title="ნახაზის შევსება ყალიბით"
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button className="btn primary" onClick={submit} disabled={errors.length > 0}>
            აწყობა ({plan?.pieces.length ?? 0})
          </button>
        </>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        დახაზული ხაზი კედლის <b>ღერძია</b> — ბეტონი თანაბრად ნაწილდება ორივე მხარეს.
        {paths.length > 1 ? ` მონიშნულია ${paths.length} ხაზი. ` : ' '}
        სიგრძე ნახაზიდან იკითხება:{' '}
        <b>{Math.round(paths.reduce((sum, p) => sum + pathLength(p), 0))} სმ</b>
        {plan && plan.summary.turns > 0 ? ` · ${plan.summary.turns} კუთხე` : ''}.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>სისქე (სმ)</span>
          <input
            autoFocus
            type="number"
            min={1}
            step="any"
            value={thickness}
            onChange={(e) => setThickness(e.target.value)}
          />
        </label>
        <label className="field">
          <span>სიმაღლე (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={height}
            onChange={(e) => setHeight(e.target.value)}
          />
        </label>
      </div>

      <div className="wizard-toggles">
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeCorners}
            onChange={(e) => setIncludeCorners(e.target.checked)}
            disabled={!plan?.summary.turns}
          />
          <span title="მოხსნისას კუთხეს პანელები ხურავს ერთმანეთის გადაფარებით">
            კუთხის პროფილები
          </span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeStopEnds}
            onChange={(e) => setIncludeStopEnds(e.target.checked)}
            disabled={closed}
          />
          <span
            title={
              closed
                ? 'ჩაკეტილ კონტურს ღია ბოლო არ აქვს'
                : 'მოხსენი, თუ კედელი გრძელდება ან არსებულ კონსტრუქციას ებჯინება'
            }
          >
            ბოლოების დახურვა
          </span>
        </label>
      </div>

      {plan && (
        <div className="wizard-preview">
          <div className="summary-card">
            <div className="sc-item">
              <span>პანელი</span>
              <b>{plan.summary.panels}</b>
            </div>
            {plan.summary.fillers > 0 && (
              <div className="sc-item">
                <span>ჩაკერება</span>
                <b>{plan.summary.fillers}</b>
              </div>
            )}
            {plan.summary.corners > 0 && (
              <div className="sc-item">
                <span>კუთხე</span>
                <b>{plan.summary.corners}</b>
              </div>
            )}
            {plan.summary.stopEnds > 0 && (
              <div className="sc-item">
                <span>ბოლო</span>
                <b>{plan.summary.stopEnds}</b>
              </div>
            )}
          </div>
          <p className="hint-note">
            {plan.summary.courses} რიგი · {plan.summary.runLength} სმ კედელი. ვოლერები,
            ჭანჭიკები და საყრდენები აქ არ ითვლება — ისინი ობიექტზე განისაზღვრება.
          </p>
        </div>
      )}

      {plan && plan.warnings.length > 0 && (
        <div className="alert warn">
          <b>გაფრთხილება:</b>
          <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
            {plan.warnings.slice(0, 6).map((warning, i) => (
              <li key={i}>{warning}</li>
            ))}
          </ul>
        </div>
      )}

      {errors.length > 0 && (
        <ul className="errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
