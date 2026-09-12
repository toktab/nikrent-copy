import { useDeferredValue, useMemo } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { findProblems, type Problem } from '../lib/problems';
import { Menu } from './Menu';
import { Icon } from './Icon';

/**
 * პრობლემები in the top bar: how many things are wrong with the open drawing,
 * and a list that takes you to each one.
 *
 * The count is the architect's ცდომილება rule made into one number for the
 * whole job - 0 means every line adds up, nothing sits on anything, no hole is
 * unaccounted for and the yard can serve it.
 */
export function ProblemsButton() {
  const materials = useEditorStore((s) => s.materials);
  // Deferred: a drag moves pieces every frame, and the count can follow a beat
  // behind rather than slow the drag down.
  const pieces = useDeferredValue(useEditorStore((s) => s.pieces));
  const sketch = useDeferredValue(useEditorStore((s) => s.sketch));

  const report = useMemo(() => findProblems({ materials, pieces, sketch }), [materials, pieces, sketch]);
  const count = report.problems.length;
  const tone = report.errors ? 'bad' : count ? 'warn' : 'ok';

  /** Show it: the plan, centred on it, with the line or pieces selected. */
  const goTo = (problem: Problem) => {
    const s = useEditorStore.getState();
    if (problem.kind === 'shortage') {
      s.openDialog({ kind: 'remaining' });
      return;
    }
    if (s.viewMode !== '2d') s.setViewMode('2d');
    if (s.surfaceView !== 'plan') s.setSurfaceView('plan');
    if (problem.at) {
      const now = useEditorStore.getState();
      now.setPan(now.stageW / 2 - problem.at.x * now.zoom, now.stageH / 2 - problem.at.y * now.zoom);
    }
    if (problem.pathId) {
      s.setSelection([]);
      s.selectSketchMany([problem.pathId]);
      s.setInspectorOpen(true);
      s.setInspectorTab('recommend');
    } else if (problem.pieceIds) {
      s.selectSketchMany([]);
      s.setSelection(problem.pieceIds);
    }
  };

  return (
    <Menu
      align="right"
      trigger={(open) => (
        <button
          className={`btn problems-btn ${tone}${open ? ' active' : ''}`}
          title={
            count
              ? `${report.errors} შეცდომა, ${report.warnings} შენიშვნა - დააჭირე სიის სანახავად`
              : 'ნახაზზე პრობლემა არ მოიძებნა'
          }
        >
          <Icon name={count ? 'warning' : 'check'} size={15} /> პრობლემები
          <span className="problems-count">{count}</span>
        </button>
      )}
    >
      {(close) => (
        <div className="problems-menu">
          {count === 0 ? (
            <div className="problems-empty">
              ყველაფერი რიგზეა ✓
              <br />
              ცდომილება 0, გადაფარვა და ნაპრალი არ არის.
            </div>
          ) : (
            <>
              <div className="menu-label">
                {report.errors ? `${report.errors} შეცდომა` : 'შეცდომა არ არის'}
                {report.warnings ? ` · ${report.warnings} შენიშვნა` : ''}
              </div>
              {report.problems.map((problem) => (
                <button
                  key={problem.id}
                  type="button"
                  className={`menu-item problem-item ${problem.severity}`}
                  onClick={() => {
                    close();
                    goTo(problem);
                  }}
                >
                  <span className="problem-dot" />
                  <span>
                    <b>{problem.title}</b>
                    <small>{problem.detail}</small>
                  </span>
                </button>
              ))}
            </>
          )}
        </div>
      )}
    </Menu>
  );
}
