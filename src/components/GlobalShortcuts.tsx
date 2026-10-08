import { useEffect } from 'react';
import { useEditorStore } from '../store/useEditorStore';

/**
 * The keys that belong to the whole app rather than the drawing: `?` for the
 * key sheet and Ctrl/⌘ + K for the search box. And the first-visit tour.
 *
 * Kept out of the canvas's own handler, which is about what a key does to the
 * drawing - these open windows, and should work wherever the focus is short of
 * a text field.
 */
export function GlobalShortcuts() {
  const dataLoaded = useEditorStore((s) => s.dataLoaded);
  const tourSeen = useEditorStore((s) => s.tourSeen);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return;
      }
      const s = useEditorStore.getState();
      if ((e.metaKey || e.ctrlKey) && e.code === 'KeyK') {
        e.preventDefault();
        s.openDialog({ kind: 'command' });
        return;
      }
      if (s.dialog) return;
      if (e.key === '?') {
        e.preventDefault();
        s.openDialog({ kind: 'shortcuts' });
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Once, the first time the app is open with its data in - not over a dialog
  // somebody is already in the middle of.
  useEffect(() => {
    if (!dataLoaded || tourSeen) return;
    const s = useEditorStore.getState();
    if (!s.dialog) s.openDialog({ kind: 'tour' });
  }, [dataLoaded, tourSeen]);

  return null;
}
