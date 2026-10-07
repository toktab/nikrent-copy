import { useEditorStore } from '../store/useEditorStore';
import { planFillAll } from '../lib/fillAll';
import { normalizeFillDefaults } from '../lib/fillDefaults';
import { Tooltip } from './Tooltip';
import { Icon } from './Icon';

/**
 * Fill every still-empty line - the selected ones, or all of them - with its
 * best recommendation, as one undo step, then a one-line account of what was
 * placed and what was left alone. At the job's remembered pour height and
 * corner setting (see `FillDefaults`).
 *
 * A function as well as a button, so the search box can run it too.
 */
export function runFillAll(): void {
  const s = useEditorStore.getState();
  const spec = normalizeFillDefaults(s.fillDefaults);
  const plan = planFillAll({
    sketch: s.sketch,
    pathIds: s.selectedSketchIds,
    spec,
    materials: s.materials,
    pieces: s.pieces,
  });
  if (!plan.pathIds.length) {
    s.setToast(
      plan.skippedPathIds.length
        ? 'ყველა ხაზზე ელემენტები უკვე დგას - შესავსები არაფერი დარჩა.'
        : 'შესავსები ხაზი არ არის.',
    );
    return;
  }
  const result = s.applyFillVariants(plan.pathIds, spec, plan.picks);
  const report = [`შეივსა ${plan.pathIds.length} ხაზი - ${result.added} ელემენტი, ${spec.height} სმ`];
  if (plan.skippedPathIds.length) {
    report.push(`${plan.skippedPathIds.length} ხაზზე ელემენტები უკვე დგას, გამოტოვდა`);
  }
  if (plan.unmatched.length) report.push(`${plan.unmatched.length} კედელი აიწყო ავტომატურად`);
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
      reason={`${selected ? 'მონიშნული ცარიელი ხაზები' : 'ყველა ცარიელი ხაზი'} - თითო კედელი საუკეთესო რეკომენდაციით, ${height} სმ`}
    >
      <button className="btn" onClick={runFillAll} disabled={!hasLines}>
        <Icon name="wall" /> <span className="btn-label">ყველას შევსება</span>
      </button>
    </Tooltip>
  );
}
