import { useMemo, useState } from 'react';
import { dropOrigin } from '../lib/geometry';
import type { WallRunSpec } from '../types';
import { useEditorStore } from '../store/useEditorStore';
import { planSketchFill } from '../lib/sketchFill';
import { Modal } from './Modal';

/**
 * A straight wall, without drawing it first.
 *
 * The quick path for the commonest case — one run, no corners, a length you
 * already know. It is not a second generator: it draws the two-point run and
 * fills it with the same one everything else uses, so the panels it orders and
 * the panels a drawn wall orders can never disagree. The line it leaves behind
 * is the setting-out, and it can be edited afterwards like any other.
 */
export function WallWizardDialog() {
  const materials = useEditorStore((s) => s.materials);
  const generateWallRun = useEditorStore((s) => s.generateWallRun);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);
  const stageW = useEditorStore((s) => s.stageW);
  const stageH = useEditorStore((s) => s.stageH);
  const zoom = useEditorStore((s) => s.zoom);

  const [length, setLength] = useState('300');
  const [thickness, setThickness] = useState('20');
  const [height, setHeight] = useState('300');
  const [includeStopEnds, setIncludeStopEnds] = useState(true);

  const n = (v: string) => Number(String(v).replace(',', '.'));

  // Centred on what the user is looking at — see `dropOrigin`.
  const spec: WallRunSpec = useMemo(() => {
    const at = dropOrigin({ panX, panY, zoom, stageW, stageH }, n(length), n(thickness));
    return {
      length: n(length),
      thickness: n(thickness),
      height: n(height),
      originX: at.x,
      originY: at.y,
      includeStopEnds,
    };
  }, [length, thickness, height, includeStopEnds, panX, panY, zoom, stageW, stageH]);

  const errors: string[] = [];
  if (!Number.isFinite(spec.length) || spec.length <= 0) errors.push('კედლის სიგრძე სავალდებულოა.');
  if (!Number.isFinite(spec.thickness) || spec.thickness <= 0) errors.push('სისქე სავალდებულოა.');
  if (!Number.isFinite(spec.height) || spec.height <= 0) errors.push('სიმაღლე სავალდებულოა.');

  // Live preview of exactly what will be placed, built by the same generator
  // that will place it, so the count on the button is the count you get.
  const plan = useMemo(() => {
    if (errors.length) return null;
    const half = spec.thickness / 2;
    const y = spec.originY + half;
    return planSketchFill(
      {
        id: 'preview',
        points: [
          { x: spec.originX, y },
          { x: spec.originX + spec.length, y },
        ],
      },
      {
        thickness: spec.thickness,
        height: spec.height,
        includeCorners: true,
        includeStopEnds,
      },
      materials,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec, materials, includeStopEnds, errors.length]);

  const submit = () => {
    if (errors.length) return;
    const result = generateWallRun(spec);
    setToast(
      !result.added
        ? 'კედელი ვერ აიწყო — შეამოწმე კატალოგი და ზომები.'
        : result.warnings.length
          ? `დაემატა ${result.added} ელემენტი, ${result.warnings.length} გაფრთხილებით.`
          : `დაემატა ${result.added} ელემენტი.`,
    );
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
        სწორი კედელი ხაზვის გარეშე. ნახაზზე დაემატება <b>ღერძის ხაზიც</b> — შემდეგ
        შეგიძლია გადაათრიო, დაამატო კუთხე ან სიგრძე აკრიფო.
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
            {plan.warnings.slice(0, 6).map((warning: string, i: number) => (
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
