import { useRef, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';
import { placeUnderlay, MAX_OPACITY } from '../lib/underlay';
import { Icon } from './Icon';
import { Menu } from './Menu';

/**
 * Putting the architect's PDF behind the drawing, and getting it out of the
 * way again.
 *
 * Everything here is one of four questions a person actually has while
 * tracing over a sheet: which page, how faint, is it in the right place, and
 * how big is it really. The last two are the same answer in different words -
 * drag it, then type the width of something you know.
 */

/**
 * The page as an image. Rendered at about twice its own size so it is still
 * readable zoomed in, and no further: this sits in memory for the session.
 */
async function renderPage(doc: unknown, pageNumber: number) {
  const page = await (doc as { page(n: number): Promise<unknown> }).page(pageNumber);
  const base = (page as { getViewport(o: { scale: number }): { width: number; height: number } })
    .getViewport({ scale: 1 });
  const scale = Math.min(2.5, 2200 / Math.max(base.width, base.height));
  const viewport = (page as { getViewport(o: { scale: number }): { width: number; height: number } })
    .getViewport({ scale });

  const canvas = document.createElement('canvas');
  canvas.width = Math.ceil(viewport.width);
  canvas.height = Math.ceil(viewport.height);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas unavailable');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  await (page as { render(o: unknown): { promise: Promise<void> } }).render({
    canvasContext: ctx,
    viewport,
  }).promise;

  return { src: canvas.toDataURL('image/png'), ptW: base.width, ptH: base.height };
}

export function UnderlayControls() {
  const underlay = useEditorStore((s) => s.underlay);
  const setUnderlay = useEditorStore((s) => s.setUnderlay);
  const changeUnderlay = useEditorStore((s) => s.changeUnderlay);
  const setToast = useEditorStore((s) => s.setToast);
  const [busy, setBusy] = useState(false);
  const docRef = useRef<{ page(n: number): Promise<unknown>; pageCount: number } | null>(null);

  const open = async (file: File) => {
    setBusy(true);
    try {
      const { initPdfJs, openPdf } = await import('../lib/detection/pdf');
      initPdfJs();
      const doc = await openPdf(await file.arrayBuffer(), file.name);
      docRef.current = doc as unknown as { page(n: number): Promise<unknown>; pageCount: number };
      const rendered = await renderPage(doc, 1);
      setUnderlay(
        placeUnderlay({ ...rendered, fileName: file.name, page: 1, pageCount: doc.pageCount }),
      );
      setToast('PDF ფონად ჩაიდო. გადმოათრიე ადგილზე, მერე ჩაკეტე და დახაზე ზემოდან.');
    } catch (e) {
      setToast(`PDF ვერ გაიხსნა: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const turnTo = async (pageNumber: number) => {
    const doc = docRef.current;
    if (!doc || !underlay) return;
    setBusy(true);
    try {
      const rendered = await renderPage(doc, pageNumber);
      changeUnderlay({ ...rendered, page: pageNumber });
    } catch (e) {
      setToast(`გვერდი ვერ დაიხატა: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const picker = (label: string, primary = false) => (
    <label className={`btn small${primary ? ' primary' : ''}`}>
      <input
        type="file"
        accept="application/pdf,.pdf"
        hidden
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void open(file);
          e.target.value = '';
        }}
      />
      {label}
    </label>
  );

  return (
    <Menu
      trigger={(isOpen) => (
        <button
          className={`btn${isOpen ? ' active' : ''}${underlay?.visible ? ' engaged' : ''}`}
          title="არქიტექტორის PDF ნახაზის ქვეშ - ზემოდან ხაზვისთვის"
        >
          <Icon name="sheet" /> <span className="btn-label">PDF ფონი</span>
          {underlay?.visible && <span className="snap-step">{Math.round(underlay.opacity * 100)}%</span>}
        </button>
      )}
    >
      {() => (
        <div className="underlay-menu">
          {!underlay ? (
            <>
              <p className="trace-hint">
                ჩადე არქიტექტორის PDF ნახაზის ქვეშ და ზემოდან დახაზე - გამჭვირვალობას შენ ირჩევ.
              </p>
              {picker(busy ? 'იხსნება…' : 'PDF-ის არჩევა…', true)}
            </>
          ) : (
            <>
              <div className="underlay-file" title={underlay.fileName}>
                {underlay.fileName}
              </div>

              <label className="vis-check">
                <input
                  type="checkbox"
                  checked={underlay.visible}
                  onChange={(e) => changeUnderlay({ visible: e.target.checked })}
                />
                <span>ჩანს</span>
              </label>

              <label className="underlay-row">
                <span>გამჭვირვალობა</span>
                <input
                  type="range"
                  min={0.05}
                  max={MAX_OPACITY}
                  step={0.05}
                  value={underlay.opacity}
                  onChange={(e) => changeUnderlay({ opacity: Number(e.target.value) })}
                />
                <b>{Math.round(underlay.opacity * 100)}%</b>
              </label>

              {underlay.pageCount > 1 && (
                <div className="underlay-row">
                  <span>გვერდი</span>
                  <div className="seg">
                    <button
                      disabled={busy || underlay.page <= 1}
                      onClick={() => void turnTo(underlay.page - 1)}
                    >
                      ‹
                    </button>
                    <span className="trace-page">
                      {underlay.page} / {underlay.pageCount}
                    </span>
                    <button
                      disabled={busy || underlay.page >= underlay.pageCount}
                      onClick={() => void turnTo(underlay.page + 1)}
                    >
                      ›
                    </button>
                  </div>
                </div>
              )}

              <label className="underlay-row">
                <span>სიგანე (სმ)</span>
                <input
                  type="number"
                  min={20}
                  step="any"
                  value={Math.round(underlay.widthCm)}
                  onChange={(e) => changeUnderlay({ widthCm: Number(e.target.value) })}
                />
              </label>
              <p className="trace-hint">
                ეს არის მასშტაბი: ჩაწერე, რამდენი სანტიმეტრია მთელი ფურცლის სიგანე სინამდვილეში.
              </p>

              <label className="vis-check">
                <input
                  type="checkbox"
                  checked={underlay.locked}
                  onChange={(e) => changeUnderlay({ locked: e.target.checked })}
                />
                <span>
                  ჩაკეტილი
                  <small className="underlay-note">
                    {underlay.locked
                      ? 'ფონი ადგილზეა - მაუსი პირდაპირ ნახაზზე მუშაობს.'
                      : 'ახლა ფონს გადმოათრევ; ჩაკეტე, რომ ხაზვა შეძლო.'}
                  </small>
                </span>
              </label>

              <div className="underlay-actions">
                {picker('სხვა PDF…')}
                <button className="btn small" onClick={() => setUnderlay(null)}>
                  მოხსნა
                </button>
              </div>
            </>
          )}
        </div>
      )}
    </Menu>
  );
}
