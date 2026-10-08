import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { checkPath, type FaceCheck } from '../lib/lengthCheck';
import type { SketchPath } from '../types';

/**
 * The architect's აწყობა sheet for the selected lines: on each leg, what is
 * standing on it against how long it is, and the ცდომილება between them.
 *
 * Only a reading - it changes nothing. Everything the fill lays reads 0; the
 * point is what was placed, moved or deleted by hand since.
 */
export function LengthCheckPanel({ paths }: { paths: SketchPath[] }) {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const sketch = useEditorStore((s) => s.sketch);

  const checks = useMemo(() => {
    const byId = new Map(materials.map((m) => [m.id, m]));
    return paths.map((path) => ({ path, check: checkPath(path, sketch, pieces, byId) }));
  }, [paths, sketch, pieces, materials]);

  const checked = checks.filter((c) => c.check.courses.length > 0);
  const bad = checked.flatMap((c) => c.check.courses.flatMap((k) => k.faces)).filter((f) => !f.ok).length;

  return (
    <div className="length-check">
      <div className="lc-head">
        <b>აწყობის შემოწმება</b>
        {checked.length > 0 && (
          <span className={bad ? 'lc-bad' : 'lc-ok'}>
            {bad ? `${bad} მონაკვეთი არ ემთხვევა` : 'ცდომილება 0 ✓'}
          </span>
        )}
      </div>

      {checks.map(({ path, check }, i) => {
        const title = paths.length > 1 ? `ხაზი ${i + 1}` : null;
        if (!check.orthogonal) {
          return (
            <p className="hint-note" key={path.id}>
              {title && `${title}: `}დახრილი ხაზი - შემოწმება მხოლოდ 90° ხაზებზე.
            </p>
          );
        }
        if (!check.courses.length) {
          return (
            <p className="hint-note" key={path.id}>
              {title && `${title}: `}ამ ხაზზე ელემენტი არ დგას.
            </p>
          );
        }
        return (
          <div key={path.id}>
            {check.courses.map((course, c) => (
              <div key={course.z}>
                {(title || check.courses.length > 1) && (
                  <div className="lc-course">
                    {[title, check.courses.length > 1 ? `რიგი ${c + 1} (${course.z} სმ-დან)` : null]
                      .filter(Boolean)
                      .join(' · ')}
                  </div>
                )}
                {course.faces.map((face) => (
                  <FaceRow key={face.leg} face={face} />
                ))}
              </div>
            ))}
          </div>
        );
      })}
    </div>
  );
}

function FaceRow({ face }: { face: FaceCheck }) {
  const open = face.openCorners.length ? `გარე კუთხე ღია: ${face.openCorners.join(' + ')} სმ` : null;

  // A leg with nothing to cover - the end of a pour, a nib its corners ate -
  // is one quiet line, not a card of zeros.
  if (!face.parts.length && face.ok) {
    return (
      <div className="lc-face ok compact">
        <span className="k">მონაკვეთი {face.leg + 1}</span>
        <span className="lc-note">{open ?? 'ღია'}</span>
      </div>
    );
  }

  const parts = face.parts.map((p) => (p.count > 1 ? `${p.count}×${p.label}` : p.label)).join(' · ');
  const result =
    face.error === 0
      ? face.ok
        ? '0 ✓'
        : '0'
      : face.error > 0
        ? `+${face.error} სმ ზედმეტი`
        : `−${-face.error} სმ აკლია`;

  return (
    <div className={`lc-face ${face.ok ? 'ok' : 'bad'}`}>
      <div className="kv">
        <span className="k">მონაკვეთი {face.leg + 1}</span>
        <b>{face.required} სმ</b>
      </div>
      <div className="lc-parts">
        {parts || '-'} = {face.sum} სმ
      </div>
      {open && <div className="lc-note">{open}</div>}
      <div className="lc-result">ცდომილება: {result}</div>
      {face.gaps.map((g, i) => (
        <div className="lc-note" key={`g${i}`}>
          ღრიჭო {g.cm} სმ - {g.at} სმ-ზე
        </div>
      ))}
      {face.overlaps.map((o, i) => (
        <div className="lc-note" key={`o${i}`}>
          გადაფარვა {o.cm} სმ - {o.at} სმ-ზე
        </div>
      ))}
    </div>
  );
}
