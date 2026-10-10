import { useMemo, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { scaleFactor, sketchBounds } from '../lib/scaleSketch';
import { Modal } from './Modal';

/**
 * The size of the whole drawn layout, as one number.
 *
 * A layout traced off a PDF or brought in from detection has the right shape
 * at the wrong size: the scale was a guess, or the sheet was cropped before
 * anyone printed it. Correcting it wall by wall is an afternoon; the
 * architect knows one figure for the whole thing - how wide the building is -
 * and everything else follows from it.
 *
 * Width and height move together. Stretching one axis on its own would keep
 * the corners square and quietly make every length in one direction wrong by
 * a different amount than the other, with nothing on the drawing to say so.
 */
export function DrawingSizeDialog() {
  const sketch = useEditorStore((s) => s.sketch);
  const measures = useEditorStore((s) => s.measures);
  const pieces = useEditorStore((s) => s.pieces);
  const scaleDrawing = useEditorStore((s) => s.scaleDrawing);
  const closeDialog = useEditorStore((s) => s.closeDialog);
  const setToast = useEditorStore((s) => s.setToast);

  const box = useMemo(() => sketchBounds(sketch, measures), [sketch, measures]);
  const [width, setWidth] = useState(box ? String(Math.round(box.w)) : '');

  if (!box || box.w <= 0) {
    return (
      <Modal
        title="ნახაზის ზომა"
        onClose={closeDialog}
        footer={
          <button className="btn primary" onClick={closeDialog}>
            დახურვა
          </button>
        }
      >
        <p className="hint-note" style={{ marginTop: 0 }}>
          ჯერ ხაზები არ არის. დახაზე გეგმა ან ჩამოიტანე PDF-დან, მერე მთელ ნახაზს ერთი რიცხვით
          მისცემ ნამდვილ ზომას.
        </p>
      </Modal>
    );
  }

  const target = Number(String(width).replace(',', '.'));
  const factor = scaleFactor(box.w, target);
  const nextHeight = factor ? box.h * factor : box.h;
  const unchanged = !factor || Math.abs(factor - 1) < 0.0005;

  const apply = () => {
    if (!factor) return;
    scaleDrawing(factor);
    setToast(
      `ნახაზი გაიწელა ${(factor).toFixed(3)}-ჯერ - ახლა ${Math.round(box.w * factor)} × ${Math.round(
        nextHeight,
      )} სმ.`,
    );
    closeDialog();
  };

  return (
    <Modal
      title="ნახაზის ზომა"
      onClose={closeDialog}
      footer={
        <>
          <button className="btn" onClick={closeDialog}>
            გაუქმება
          </button>
          <button className="btn primary" disabled={unchanged} onClick={apply}>
            შეცვლა
          </button>
        </>
      }
    >
      <p className="hint-note" style={{ marginTop: 0 }}>
        მთელი დახაზული გეგმის ზომა. ჩაწერე ნამდვილი სიგანე და დანარჩენი პროპორციულად მიჰყვება -
        კუთხეები და შეერთებები ადგილზე რჩება.
      </p>

      <div className="form-grid">
        <label className="field">
          <span>სიგანე (სმ)</span>
          <input
            autoFocus
            type="number"
            min={1}
            step="any"
            value={width}
            onChange={(e) => setWidth(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !unchanged) apply();
            }}
          />
        </label>
        <label className="field">
          <span>სიმაღლე (სმ)</span>
          <input type="number" value={Math.round(nextHeight)} readOnly tabIndex={-1} />
        </label>
      </div>

      <div className="size-now">
        <div>
          <span>ახლა</span>
          <b>
            {Math.round(box.w)} × {Math.round(box.h)} სმ
          </b>
        </div>
        <div>
          <span>გახდება</span>
          <b>
            {factor ? `${Math.round(box.w * factor)} × ${Math.round(nextHeight)} სმ` : '-'}
          </b>
        </div>
        <div>
          <span>კოეფიციენტი</span>
          <b>{factor ? `× ${factor.toFixed(3)}` : '-'}</b>
        </div>
      </div>

      {pieces.length > 0 && (
        <p className="hint-note">
          ზედაპირზე {pieces.length} ელემენტია. ისინი არ გაიწელება - პანელი ნამდვილი ზომისაა და
          იქვე რჩება. ზომის შეცვლის შემდეგ შევსება თავიდან გააკეთე.
        </p>
      )}
    </Modal>
  );
}
