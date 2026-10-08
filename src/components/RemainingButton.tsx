import { useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { remainingRows } from '../lib/remaining';
import { Icon } from './Icon';

/**
 * ნაშთი in the top bar, beside the views: how the open drawing stands against
 * stock is asked from every view, so it is not tucked into a side-panel tab.
 * Carries the shortage count, so a drawing that cannot be served says so
 * before anybody opens anything.
 */
export function RemainingButton() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useEditorStore((s) => s.pieces);
  const openDialog = useEditorStore((s) => s.openDialog);
  const shortages = useMemo(
    () => remainingRows(materials, pieces, { show: 'short' }).shortages,
    [materials, pieces],
  );

  return (
    <button
      className={`btn remaining-btn${shortages ? ' short' : ''}`}
      onClick={() => openDialog({ kind: 'remaining' })}
      title={shortages ? `ნაშთი - ${shortages} კომპონენტს მარაგი არ ჰყოფნის` : 'ნაშთი - მარაგი ამ ნახაზის შემდეგ'}
    >
      <Icon name="sheet" /> ნაშთი
      {shortages > 0 && <span className="tab-badge">{shortages}</span>}
    </button>
  );
}
