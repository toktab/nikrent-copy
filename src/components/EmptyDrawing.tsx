import { useEditorStore } from '../store/useEditorStore';
import { useCanManageCatalog } from '../store/useAuthStore';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

/**
 * An empty drawing.
 *
 * It used to say "the surface is empty — drag a material from the left panel",
 * which is a description plus one instruction, and the least likely way anyone
 * actually starts. The two wizards build a whole column or a whole wall from a
 * few numbers; they are the reason to use this app rather than graph paper,
 * and they were reachable only from a toolbar button with no label explaining
 * what it does. So the empty drawing offers them first.
 *
 * A brand-new company hits four empty states at once — no catalog, no stock,
 * no drawings, no templates — so this also has to work as a first screen, not
 * only as the gap between two drawings.
 */
export function EmptyDrawing() {
  const openDialog = useEditorStore((s) => s.openDialog);
  const materialCount = useEditorStore((s) => s.materials.length);
  const canManage = useCanManageCatalog();

  // Nothing in the catalog is a different problem with a different first step:
  // no wizard can run, so pointing at them would be a dead end.
  const noCatalog = materialCount === 0;

  return (
    <div className="empty-drawing">
      <div className="empty-card">
        <BrandMark size={40} className="empty-mark" />

        {noCatalog ? (
          <>
            <div className="empty-title">კატალოგი ცარიელია</div>
            <div className="empty-sub">
              ჯერ დაამატე კომპონენტები - პანელები, ვოლერები, სამაგრები - მერე ნახაზზე გადავალთ.
            </div>
            <div className="empty-actions">
              <button
                className="btn primary lg"
                disabled={!canManage}
                onClick={() => openDialog({ kind: 'sheet-import' })}
              >
                <Icon name="sheet" size={16} /> იმპორტი ცხრილიდან
              </button>
              <button
                className="btn lg"
                disabled={!canManage}
                onClick={() => openDialog({ kind: 'material' })}
              >
                <Icon name="plus" size={16} /> ახალი კომპონენტი
              </button>
            </div>
          </>
        ) : (
          <>
            <div className="empty-title">ნახაზი ცარიელია</div>
            <div className="empty-sub">
              დაიწყე ოსტატით - ის თვითონ ითვლის რამდენი პანელი და ვოლერი დასჭირდება.
            </div>
            <div className="empty-actions">
              <button
                className="btn primary lg"
                onClick={() => openDialog({ kind: 'column-wizard' })}
              >
                <Icon name="column" size={16} /> კოლონა
              </button>
              <button className="btn raised lg" onClick={() => openDialog({ kind: 'wall-wizard' })}>
                <Icon name="wall" size={16} /> კედელი
              </button>
            </div>
            <div className="empty-alt">
              ან <button className="link-button" onClick={() => openDialog({ kind: 'templates' })}>
                ჩასვი შაბლონი
              </button>{' '}
              - ან გადმოათრიე მასალა მარცხენა პანელიდან.
            </div>
          </>
        )}
      </div>
    </div>
  );
}
