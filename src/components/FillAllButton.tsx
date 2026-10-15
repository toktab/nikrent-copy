import { useEditorStore } from '../store/useEditorStore';
import { normalizeFillDefaults } from '../lib/fillDefaults';
import { freeStock, stockEntered } from '../lib/fillOptions';
import { stockView } from '../lib/inventory';
import { solveLayout } from '../lib/layoutSolver';
import { Tooltip } from './Tooltip';
import { Icon } from './Icon';

/**
 * Fill the selected lines - or all of them - with the layout solver's best
 * whole-layout variant, as one undo step, then a one-line account of what was
 * placed. At the job's remembered pour height and corner setting (see
 * `FillDefaults`) and with the recommendation tab's filters, so the button and
 * the tab's #1 are the same answer.
 *
 * With "keep placed pieces" on, what already stands on a line stays and the
 * rest is built around it, so a line filled before is not filled twice; with
 * it off, what stands on the lines is replaced.
 *
 * A function as well as a button, so the search box can run it too.
 */
export function runFillAll(): void {
  const s = useEditorStore.getState();
  const spec = normalizeFillDefaults(s.fillDefaults);
  const wanted = s.selectedSketchIds.length ? new Set(s.selectedSketchIds) : null;
  const paths = s.sketch.filter((p) => !wanted || wanted.has(p.id));
  if (!paths.length) {
    s.setToast('შესავსები ხაზი არ არის.');
    return;
  }
  const view = stockView(s.documents, s.activeDocId);
  const hasStock = stockEntered(s.materials) && !view.unlimited;
  const result = solveLayout({
    paths,
    height: spec.height,
    includeCorners: spec.includeCorners,
    materials: s.materials,
    pieces: s.pieces,
    free: hasStock ? freeStock(s.materials, s.pieces, view) : undefined,
    filters: { ...s.layoutFilters, useStock: s.layoutFilters.useStock && hasStock },
    limit: 1,
  });
  const best = result.variants[0];
  if (!best || (!best.add.length && !best.remove.length)) {
    s.setToast(
      result.warnings[0] ??
        (s.layoutFilters.keepPlaced ? 'ყველა ხაზზე ელემენტები უკვე დგას - შესავსები არაფერი დარჩა.' : 'ყალიბი ვერ აიწყო.'),
    );
    return;
  }
  const done = s.applyLayout(best.add, best.remove);
  const report = [`შეივსა ${paths.length} ხაზი - ${done.added} ელემენტი, ${spec.height} სმ`];
  if (done.removed) report.push(`შეიცვალა ${done.removed}`);
  if (best.overhang) report.push(`გადაცილება ${best.overhang} სმ`);
  if (best.nianguri) report.push(`ნიანგი: ${best.nianguri}`);
  if (result.warnings.length) report.push(`${result.warnings.length} გაფრთხილება`);
  s.setToast(report.join(' · '));
}

export function FillAllButton() {
  const hasLines = useEditorStore((s) => s.sketch.length > 0);
  const selected = useEditorStore((s) => s.selectedSketchIds.length);
  const height = useEditorStore((s) => normalizeFillDefaults(s.fillDefaults).height);

  return (
    <Tooltip
      label="ყველას შევსება"
      reason={`${selected ? 'მონიშნული ხაზები' : 'ყველა ხაზი'} - ერთად, საუკეთესო ვარიანტით, ${height} სმ`}
    >
      <button className="btn" onClick={runFillAll} disabled={!hasLines}>
        <Icon name="wall" /> <span className="btn-label">ყველას შევსება</span>
      </button>
    </Tooltip>
  );
}
