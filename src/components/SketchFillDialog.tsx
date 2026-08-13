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

  const [height, setHeight] = useState('300');
  const [includeCorners, setIncludeCorners] = useState(true);

  const n = (v: string) => Number(String(v).replace(',', '.'));

  const spec: SketchFillSpec = useMemo(
    () => ({
      height: n(height),
      includeCorners,
    }),
    [height, includeCorners],
  );

  /**
   * Which face of the pour the selection is. Said out loud, because it is what
   * decides where the panels land and it is set somewhere else — at the pen, or
   * on the line itself — so the fill is the last chance to notice it is wrong.
   */
  const kinds = new Set(paths.map((p) => p.perimeter ?? 'outer'));
  const perimeters = [...kinds].map((k) => (k === 'inner' ? 'შიდა' : 'გარე')).join(' და ');

  const errors: string[] = [];
  if (!Number.isFinite(spec.height) || spec.height <= 0) errors.push('სიმაღლე სავალდებულოა.');

  // Live preview of exactly what will be placed, warnings included.
  const plan = useMemo(
    () => (paths.length && !errors.length ? planSketchFillAll(paths, spec, materials) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [paths, spec, materials, errors.length],
  );

  if (!paths.length) return null;

  const submit = () => {
    if (errors.length) return;
    const result = fillSketch(pathIds, spec);
    setToast(
      !result.added
        ? 'ყალიბი ვერ აიწყო - შეამოწმე კატალოგი და ზომები.'
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
        დახაზული ხაზი ბეტონის <b>კიდეა</b> - პანელები ყოველთვის ბეტონის გარეთა მხარეს
        დგება, მხარეს კი ხაზის პერიმეტრი განსაზღვრავს: <b>{perimeters}</b>.
        {paths.length > 1
          ? ` მონიშნულია ${paths.length} ხაზი - ერთი კედლის ორივე მხარე ერთნაირი
             პანელებით, ერთმანეთის პირისპირ აეწყობა. `
          : ' '}
        სიგრძე ნახაზიდან იკითხება:{' '}
        <b>{Math.round(paths.reduce((sum, p) => sum + pathLength(p), 0))} სმ</b>
        {plan && plan.summary.turns > 0 ? ` · ${plan.summary.turns} კუთხე` : ''}.
      </p>

      <div className="form-grid">
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
          <span title="შიდა კუთხეში პროფილი დგება და პანელები მას ებჯინება; მოხსნისას კუთხეს პანელები ხურავს ერთმანეთის გადაფარებით">
            შიდა კუთხის პროფილები
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
          </div>
          <p className="hint-note">
            {plan.summary.courses} რიგი · {plan.summary.runLength} სმ კედელი.
            {plan.summary.openCorners > 0 &&
              ` გარე კუთხე ღიად რჩება (${plan.summary.openCorners} ცალი, თითო მხარეს
                სულ მცირე 20 სმ) - მის დახურვას ოსტატი ადგილზე წყვეტს.`}{' '}
            ვოლერები, ჭანჭიკები და საყრდენები აქ არ ითვლება - ისინი ობიექტზე განისაზღვრება.
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
