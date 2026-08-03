import { useMemo, useState } from 'react';
import type { ColumnSpec } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { planColumn } from '../lib/columnWizard';
import { Modal } from './Modal';

/**
 * Builds a complete column formwork assembly from the column's cross-section
 * and pour height — the step that turns this from a drawing tool into an
 * estimating tool.
 */
export function ColumnWizardDialog() {
  const materials = useEditorStore((s) => s.materials);
  const generateColumn = useEditorStore((s) => s.generateColumn);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const zoom = useEditorStore((s) => s.zoom);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);

  const [sectionX, setSectionX] = useState('60');
  const [sectionY, setSectionY] = useState('60');
  const [height, setHeight] = useState('300');
  const [walerSpacing, setWalerSpacing] = useState('75');
  const [includeWalers, setIncludeWalers] = useState(true);
  const [includeTies, setIncludeTies] = useState(true);
  const [includeCorners, setIncludeCorners] = useState(true);

  const n = (v: string) => Number(String(v).replace(',', '.'));

  // Drop the assembly near the top-left of what the user is currently looking at.
  const spec: ColumnSpec = useMemo(
    () => ({
      sectionX: n(sectionX),
      sectionY: n(sectionY),
      height: n(height),
      walerSpacing: n(walerSpacing),
      originX: Math.round((0 - panX) / zoom + 40),
      originY: Math.round((0 - panY) / zoom + 40),
      includeWalers,
      includeTies,
      includeCorners,
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [sectionX, sectionY, height, walerSpacing, includeWalers, includeTies, includeCorners, panX, panY, zoom, stageW, stageH],
  );

  const errors: string[] = [];
  if (!Number.isFinite(spec.sectionX) || spec.sectionX <= 0) errors.push('კვეთის X სავალდებულოა.');
  if (!Number.isFinite(spec.sectionY) || spec.sectionY <= 0) errors.push('კვეთის Y სავალდებულოა.');
  if (!Number.isFinite(spec.height) || spec.height <= 0) errors.push('სიმაღლე სავალდებულოა.');
  if (includeWalers && (!Number.isFinite(spec.walerSpacing) || spec.walerSpacing <= 0)) {
    errors.push('ვალერების ბიჯი დადებითი უნდა იყოს.');
  }

  // Live preview of exactly what will be placed, warnings included.
  const plan = useMemo(
    () => (errors.length ? null : planColumn(spec, materials)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [spec, materials, errors.length],
  );

  const submit = () => {
    if (errors.length) return;
    const result = generateColumn(spec);
    if (!result.added) {
      setToast('კოლონა ვერ აიწყო — შეამოწმე კატალოგი და ზომები.');
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
      title="კოლონის ოსტატი"
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
        ოთხივე მხარე განლაგდება <b>გაშლილად, გვერდიგვერდ</b> — როგორც ფორმვორკის სამუშაო
        ნახაზზე. რაოდენობები პირდაპირ გადადის უწყისში.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>კვეთა X (სმ)</span>
          <input
            autoFocus
            type="number"
            min={1}
            step="any"
            value={sectionX}
            onChange={(e) => setSectionX(e.target.value)}
          />
        </label>
        <label className="field">
          <span>კვეთა Y (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={sectionY}
            onChange={(e) => setSectionY(e.target.value)}
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
          <span>ვალერების ბიჯი (სმ)</span>
          <input
            type="number"
            min={1}
            step="any"
            value={walerSpacing}
            onChange={(e) => setWalerSpacing(e.target.value)}
            disabled={!includeWalers}
          />
        </label>
      </div>

      <div className="wizard-toggles">
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeCorners}
            onChange={(e) => setIncludeCorners(e.target.checked)}
          />
          კუთხეები
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeWalers}
            onChange={(e) => setIncludeWalers(e.target.checked)}
          />
          ვალერები
        </label>
        <label className="check-row">
          <input
            type="checkbox"
            checked={includeTies}
            onChange={(e) => setIncludeTies(e.target.checked)}
            disabled={!includeWalers}
          />
          ჭანჭიკები
        </label>
      </div>

      {plan && (
        <div className="wizard-preview">
          <div className="summary-card">
            <div className="sc-item">
              <span>პანელი</span>
              <b>{plan.summary.panels}</b>
            </div>
            <div className="sc-item">
              <span>კუთხე</span>
              <b>{plan.summary.corners}</b>
            </div>
            <div className="sc-item">
              <span>ვალერი</span>
              <b>{plan.summary.walers}</b>
            </div>
            <div className="sc-item">
              <span>ჭანჭიკი</span>
              <b>{plan.summary.ties}</b>
            </div>
          </div>
          <p className="hint-note">
            {plan.summary.courses} რიგი · ყალიბის გარე ზომა {plan.summary.outerX} ×{' '}
            {plan.summary.outerY} სმ
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
