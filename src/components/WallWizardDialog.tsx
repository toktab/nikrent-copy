import { useMemo, useState } from 'react';
import type { WallSpec } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { planWall } from '../lib/wallWizard';
import { Modal } from './Modal';

/**
 * Builds a straight wall's formwork from its run, thickness and pour height.
 *
 * Walls are the most common formwork on a job, and laying one by hand means
 * placing dozens of panels and counting ties by eye — which is exactly where a
 * short order comes from.
 */
export function WallWizardDialog() {
  const materials = useEditorStore((s) => s.materials);
  const generateWall = useEditorStore((s) => s.generateWall);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const zoom = useEditorStore((s) => s.zoom);

  const [length, setLength] = useState('300');
  const [thickness, setThickness] = useState('20');
  const [height, setHeight] = useState('300');
  const [walerSpacing, setWalerSpacing] = useState('75');
  const [tieSpacing, setTieSpacing] = useState('100');
  const [includeWalers, setIncludeWalers] = useState(true);
  const [includeTies, setIncludeTies] = useState(true);
  const [includeStopEnds, setIncludeStopEnds] = useState(true);

  const n = (v: string) => Number(String(v).replace(',', '.'));

  // Drop the assembly near the top-left of what the user is currently looking at.
  const spec: WallSpec = useMemo(
    () => ({
      length: n(length),
      thickness: n(thickness),
      height: n(height),
      walerSpacing: n(walerSpacing),
      tieSpacing: n(tieSpacing),
      originX: Math.round((0 - panX) / zoom + 40),
      originY: Math.round((0 - panY) / zoom + 40),
      includeWalers,
      includeTies,
      includeStopEnds,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      length, thickness, height, walerSpacing, tieSpacing,
      includeWalers, includeTies, includeStopEnds, panX, panY, zoom,
    ],
  );

  const errors: string[] = [];
  if (!Number.isFinite(spec.length) || spec.length <= 0) errors.push('კედლის სიგრძე სავალდებულოა.');
  if (!Number.isFinite(spec.thickness) || spec.thickness <= 0) errors.push('სისქე სავალდებულოა.');
  if (!Number.isFinite(spec.height) || spec.height <= 0) errors.push('სიმაღლე სავალდებულოა.');
  if (includeWalers && (!Number.isFinite(spec.walerSpacing) || spec.walerSpacing <= 0)) {
    errors.push('ვოლერების ბიჯი დადებითი უნდა იყოს.');
  }
  if (includeTies && (!Number.isFinite(spec.tieSpacing) || spec.tieSpacing <= 0)) {
    errors.push('ჭანჭიკების ბიჯი დადებითი უნდა იყოს.');
  }

  // Live preview of exactly what will be placed, warnings included.
  const plan = useMemo(
    () => (errors.length ? null : planWall(spec, materials)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, materials, errors.length],
  );

  const submit = () => {
    if (errors.length) return;
    const result = generateWall(spec);
    if (!result.added) {
      setToast('კედელი ვერ აიწყო — შეამოწმე კატალოგი და ზომები.');
    } else {
      setToast(
        result.warnings.length
          ? `დაემატა ${result.added} ელემენტი, ${result.warnings.length} გაფრთხილებით.`
          : `დაემატა ${result.added} ელემენტი.`,
      );
    }
    closeDialog();
  };

  return (
    <Modal
      title="კედლის ოსტატი"
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
        ორივე მხარე განლაგდება <b>ბეტონის გასწვრივ</b>. ჭანჭიკები ნაწილდება სიგრძეზე —
        რაც უფრო გრძელია კედელი, მით მეტი ჭანჭიკი.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>სიგრძე (სმ)</span>
          <input
            autoFocus
            type="number"
            min={1}
            step="any"
            value={length}
            onChange={(e) => setLength(e.target.value)}
          />
        </label>
        <label className="field">
          <span>სისქე (სმ)</span>
          <input
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
        <label className="field">
          <span>ვოლერების ბიჯი (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={walerSpacing}
            onChange={(e) => setWalerSpacing(e.target.value)}
            disabled={!includeWalers}
          />
        </label>
        <label className="field">
          <span>ჭანჭიკების ბიჯი (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={tieSpacing}
            onChange={(e) => setTieSpacing(e.target.value)}
            disabled={!includeTies || !includeWalers}
          />
        </label>
      </div>

      <div className="wizard-toggles">
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeStopEnds}
            onChange={(e) => setIncludeStopEnds(e.target.checked)}
          />
          <span title="მოხსენი, თუ კედელი გრძელდება ან არსებულ კონსტრუქციას ებჯინება">
            ბოლოების დახურვა
          </span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeWalers}
            onChange={(e) => setIncludeWalers(e.target.checked)}
          />
          <span>ვოლერები</span>
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeTies}
            onChange={(e) => setIncludeTies(e.target.checked)}
            disabled={!includeWalers}
          />
          <span>ჭანჭიკები</span>
        </label>
      </div>

      {plan && (
        <div className="wizard-preview">
          <div className="summary-card">
            <div className="sc-item">
              <span>პანელი</span>
              <b>{plan.summary.panels}</b>
            </div>
            {plan.summary.stopEnds > 0 && (
              <div className="sc-item">
                <span>ბოლო</span>
                <b>{plan.summary.stopEnds}</b>
              </div>
            )}
            {plan.summary.fillers > 0 && (
              <div className="sc-item">
                <span>ჩაკერება</span>
                <b>{plan.summary.fillers}</b>
              </div>
            )}
            <div className="sc-item">
              <span>ვოლერი</span>
              <b>{plan.summary.walers}</b>
            </div>
            <div className="sc-item">
              <span>ჭანჭიკი</span>
              <b>{plan.summary.ties}</b>
            </div>
          </div>
          <p className="hint-note">
            {plan.summary.courses} რიგი · ყალიბის გარე ზომა {plan.summary.outerLength} ×{' '}
            {plan.summary.outerThickness} სმ
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
