import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { Modal } from './Modal';

/**
 * Repeat the selection along one axis — the fast way to lay out a run of
 * panels or a ladder of walers without dragging each one.
 */
export function ArrayDialog() {
  const selectedIds = useEditorStore((s) => s.selectedIds);
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const arraySelection = useEditorStore((s) => s.arraySelection);
  const closeDialog = useEditorStore((s) => s.closeDialog);

  // Sensible default pitch: the width of the first selected piece, so panels
  // placed side by side simply butt together.
  const first = pieces.find((p) => p.id === selectedIds[0]);
  const firstMat = first ? materials.find((m) => m.id === first.materialId) : undefined;
  const defaultPitch = firstMat ? (first!.rot % 180 === 0 ? firstMat.w : firstMat.h) : 50;

  const [count, setCount] = useState('3');
  const [pitch, setPitch] = useState(String(defaultPitch));
  const [axis, setAxis] = useState<'x' | 'y'>('x');

  const countNum = Math.floor(Number(count));
  const pitchNum = Number(String(pitch).replace(',', '.'));

  const errors: string[] = [];
  if (!selectedIds.length) errors.push('ჯერ მონიშნე ელემენტი.');
  if (!Number.isFinite(countNum) || countNum < 1) errors.push('ასლების რაოდენობა 1-ზე მეტი უნდა იყოს.');
  if (countNum > 200) errors.push('ერთდროულად მაქსიმუმ 200 ასლი.');
  if (!Number.isFinite(pitchNum) || pitchNum === 0) errors.push('ბიჯი უნდა იყოს არანულოვანი რიცხვი.');

  const submit = () => {
    if (errors.length) return;
    arraySelection({ count: countNum, pitch: pitchNum, axis });
    closeDialog();
  };

  return (
    <Modal
      title="მასივი — ასლების გამრავლება"
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button className="btn primary" onClick={submit} disabled={errors.length > 0}>
            შექმნა ({errors.length ? 0 : countNum * selectedIds.length})
          </button>
        </>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        მონიშნულია <b>{selectedIds.length}</b> ელემენტი. ასლები დაემატება არსებულის გვერდით,
        მითითებული ბიჯით.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>ასლების რაოდენობა</span>
          <input
            autoFocus
            type="number"
            min={1}
            step={1}
            value={count}
            onChange={(e) => setCount(e.target.value)}
          />
        </label>

        <label className="field">
          <span>ბიჯი (სმ)</span>
          <input
            type="number"
            step="any"
            value={pitch}
            onChange={(e) => setPitch(e.target.value)}
          />
        </label>

        <label className="field span2">
          <span>მიმართულება</span>
          <div className="row-actions" style={{ marginTop: 0 }}>
            <button
              className={`btn small${axis === 'x' ? ' active' : ''}`}
              onClick={() => setAxis('x')}
            >
              → ჰორიზონტალურად
            </button>
            <button
              className={`btn small${axis === 'y' ? ' active' : ''}`}
              onClick={() => setAxis('y')}
            >
              ↓ ვერტიკალურად
            </button>
          </div>
        </label>
      </div>

      <p className="hint-note">
        უარყოფითი ბიჯი ასლებს საპირისპირო მიმართულებით განათავსებს.
      </p>

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
