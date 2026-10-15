import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { findBolts } from '../lib/bolts';

/**
 * How many ჭანჭიკი the drawing needs, in the top bar beside ნაშთი, so the
 * number is there from every view. Clicking it shows or hides the marks on the
 * plan - the same switch as in ზომების ჩვენება.
 */
export function BoltsButton() {
  const pieces = useEditorStore((s) => s.pieces);
  const materials = useEditorStore((s) => s.materials);
  const showBolts = useEditorStore((s) => s.showBolts);
  const setShowBolts = useEditorStore((s) => s.setShowBolts);
  const count = useMemo(
    () => findBolts(pieces, new Map(materials.map((m) => [m.id, m]))).length,
    [pieces, materials],
  );

  return (
    <button
      className={`btn bolts-btn${showBolts ? ' on' : ''}`}
      aria-pressed={showBolts}
      onClick={() => setShowBolts(!showBolts)}
      title={`ჭანჭიკები - ${count} ც. (T-შეერთება, შიდა კუთხე ჩაკერებასთან). ${
        showBolts ? 'დააჭირე ნახაზზე დასამალად' : 'დააჭირე ნახაზზე საჩვენებლად'
      }`}
    >
      <svg className="bolts-btn-mark" width="14" height="14" viewBox="-7 -7 14 14" aria-hidden="true">
        <circle r="6" />
        <line className="bolt-bar" x1="-4" y1="0" x2="4" y2="0" />
        <line className="bolt-slash" x1="-2.5" y1="-4" x2="2.5" y2="4" />
      </svg>
      <span className="bolts-label">ჭანჭიკი</span> <span className="bolts-count">{count}</span>
    </button>
  );
}
