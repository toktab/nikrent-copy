import { useEditorStore } from '../store/useEditorStore';
import { useCanManageCatalog } from '../store/useAuthStore';
import { BrandMark } from './BrandMark';
import { Icon } from './Icon';

/**
 * An empty drawing.
 *
 * It used to say "the surface is empty — drag a material from the left panel",
 * which is a description plus one instruction, and the least likely way anyone
 * actually starts. Drawing the building's lines and filling them is how a job
 * is done, so that comes first; the two wizards, which build a column or a wall
 * from a few numbers, are right beside it.
 *
 * A brand-new company hits four empty states at once — no catalog, no stock,
 * no drawings, no templates — so this also has to work as a first screen, not
 * only as the gap between two drawings.
 */
export function EmptyDrawing() {
  const openDialog = useEditorStore((s) => s.openDialog);
  const setTool = useEditorStore((s) => s.setTool);
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
              დახაზე ბეტონის ხაზები და შეავსე - ან ოსტატი თვითონ ააწყობს კოლონას ან კედელს.
            </div>
            <div className="empty-actions">
              <button className="btn primary lg" onClick={() => setTool('pen')}>
                <Icon name="pen" size={16} /> ხაზვა
              </button>
              <button className="btn raised lg" onClick={() => openDialog({ kind: 'column-wizard' })}>
                <Icon name="column" size={16} /> კოლონა
              </button>
              <button className="btn raised lg" onClick={() => openDialog({ kind: 'wall-wizard' })}>
                <Icon name="wall" size={16} /> კედელი
              </button>
            </div>
            <div className="empty-alt">
              ხაზვის დროს სიგრძე აკრიფე: <kbd>490</kbd> + <kbd>Enter</kbd>. ან{' '}
              <button className="link-button" onClick={() => openDialog({ kind: 'templates' })}>
                ჩასვი შაბლონი
              </button>{' '}
              ·{' '}
              <button className="link-button" onClick={() => openDialog({ kind: 'tour' })}>
                როგორ მუშავს
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
