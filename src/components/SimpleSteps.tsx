import { useDeferredValue, useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { findProblems } from '../lib/problems';
import { runFillAll } from './FillAllButton';

/**
 * The whole job as four steps along the top of simple mode, with the one you
 * are on lit: draw, fill, check, send. Read off the drawing itself - nothing
 * drawn yet, lines still bare, something still wrong, or ready - so it is never
 * a checklist somebody has to tick.
 */
export function SimpleSteps() {
  const materials = useEditorStore((s) => s.materials);
  const pieces = useDeferredValue(useEditorStore((s) => s.pieces));
  const sketch = useDeferredValue(useEditorStore((s) => s.sketch));

  const current = useMemo(() => {
    if (!sketch.length && !pieces.length) return 0;
    const report = findProblems({ materials, pieces, sketch });
    if ([...report.lines.values()].includes('empty')) return 1;
    if (report.errors) return 2;
    return 3;
  }, [materials, pieces, sketch]);

  const steps: Array<{ label: string; run?: () => void }> = [
    { label: 'ხაზვა', run: () => useEditorStore.getState().setTool('pen') },
    { label: 'შევსება', run: runFillAll },
    { label: 'შემოწმება' },
    { label: 'ნაშთი და ფაილები', run: () => useEditorStore.getState().openDialog({ kind: 'remaining' }) },
  ];

  return (
    <div className="simple-steps" aria-label="ნაბიჯები">
      {steps.map((step, i) => (
        <button
          key={step.label}
          type="button"
          className={`simple-step${i === current ? ' on' : ''}${i < current ? ' done' : ''}`}
          onClick={step.run}
          disabled={!step.run}
          aria-current={i === current ? 'step' : undefined}
        >
          <b>{i + 1}</b> {step.label}
        </button>
      ))}
    </div>
  );
}
