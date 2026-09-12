import { useEditorStore } from '../store/useEditorStore';
import { planFillAll } from '../lib/fillAll';
import type { SketchFillSpec } from '../lib/sketchFill';
import { Tooltip } from './Tooltip';
import { Icon } from './Icon';

/**
 * The pour height and corner treatment a one-press fill uses: the defaults the
 * recommendation tab opens with. A wall that needs something else is filled
 * from that tab, where both can be changed.
 */
const FILL_ALL_SPEC: SketchFillSpec = { height: 300, includeCorners: true };

/**
 * "Fill every wall": each still-empty line - the selected ones, or all of
 * them - with its best recommendation, as one undo step, then a one-line
 * account of what was placed and what was left alone.
 */
export function FillAllButton() {
  const hasLines = useEditorStore((s) => s.sketch.length > 0);
  const selected = useEditorStore((s) => s.selectedSketchIds.length);

  const run = () => {
    const s = useEditorStore.getState();
    const plan = planFillAll({
      sketch: s.sketch,
      pathIds: s.selectedSketchIds,
      spec: FILL_ALL_SPEC,
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
    const result = s.applyFillVariants(plan.pathIds, FILL_ALL_SPEC, plan.picks);
    const report = [`შეივსა ${plan.pathIds.length} ხაზი - ${result.added} ელემენტი`];
    if (plan.skippedPathIds.length) {
      report.push(`${plan.skippedPathIds.length} ხაზზე ელემენტები უკვე დგას, გამოტოვდა`);
    }
    if (plan.unmatched.length) report.push(`${plan.unmatched.length} კედელი აიწყო ავტომატურად`);
    if (result.warnings.length) report.push(`${result.warnings.length} გაფრთხილება`);
    s.setToast(report.join(' · '));
  };

  return (
    <Tooltip
      label="ყველას შევსება"
      reason={
        selected
          ? 'მონიშნული ცარიელი ხაზები - თითო კედელი საუკეთესო რეკომენდაციით, 300 სმ'
          : 'ყველა ცარიელი ხაზი - თითო კედელი საუკეთესო რეკომენდაციით, 300 სმ'
      }
    >
      <button className="btn" onClick={run} disabled={!hasLines}>
        <Icon name="wall" /> <span className="btn-label">ყველას შევსება</span>
      </button>
    </Tooltip>
  );
}
