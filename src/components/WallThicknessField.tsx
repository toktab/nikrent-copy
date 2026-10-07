import { useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { MIN_WALL_CM, normalizeWallThickness } from '../lib/wallPen';
import { MAX_WALL_CM } from '../lib/sketchFill';
import { keepWheelOffNumber } from '../lib/numberField';

/** What the switch turns on with when no thickness has been typed yet. */
const DEFAULT_WALL_CM = 20;

/**
 * Beside the pen: draw a whole wall from one line. On, every line the pen
 * finishes gets its other face a wall's thickness away - see `wallPartner`.
 */
export function WallThicknessField() {
  const thickness = useEditorStore((s) => normalizeWallThickness(s.wallThickness));
  const setWallThickness = useEditorStore((s) => s.setWallThickness);
  const [draft, setDraft] = useState<string | null>(null);
  const on = thickness !== null;

  return (
    <span className="wall-thickness">
      <button
        className={`btn small${on ? ' engaged' : ''}`}
        aria-pressed={on}
        onClick={() => setWallThickness(on ? null : DEFAULT_WALL_CM)}
        title={
          on
            ? `კედლის ხაზვა: მეორე მხარე ${thickness} სმ-ზე ავტომატურად - დააჭირე ერთი ხაზისთვის`
            : 'კედლის ხაზვა: ერთი ხაზი დახაზე, მეორე მხარე სისქის მიხედვით თვითონ დაიხაზება'
        }
      >
        კედელი
      </button>
      {on && (
        <>
          <input
            type="number"
            min={MIN_WALL_CM}
            max={MAX_WALL_CM}
            step={5}
            value={draft ?? String(thickness)}
            onWheel={keepWheelOffNumber}
            onChange={(e) => {
              setDraft(e.target.value);
              const next = normalizeWallThickness(e.target.value);
              if (next !== null) setWallThickness(next);
            }}
            onBlur={() => setDraft(null)}
            title={`კედლის სისქე, ${MIN_WALL_CM}-${MAX_WALL_CM} სმ`}
            aria-label="კედლის სისქე"
          />
          <span className="deg">სმ</span>
        </>
      )}
    </span>
  );
}
