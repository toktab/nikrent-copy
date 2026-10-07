import { useEffect, useRef, useState } from 'react';
import { useEditorStore } from '../store/useEditorStore';

/**
 * Typing a leg's length while drawing: digits, then Enter to lay it towards
 * the pointer, or an arrow key to lay it that way. The number shows beside the
 * pen until it is used.
 *
 * A drawing is specified leg by leg - "the north wall is 4.27 m" - and dragging
 * cannot land on 427 however carefully it is done. The leg list lets a length
 * be corrected after the fact; this lets it be right the first time.
 *
 * It listens before the canvas does, and only takes a key while a number is
 * being typed (or to start one), so Enter still finishes a line and Backspace
 * still takes a point back whenever nothing is typed.
 */
export function PenTyping() {
  const tool = useEditorStore((s) => s.tool);
  const penPoints = useEditorStore((s) => s.penPoints);
  const zoom = useEditorStore((s) => s.zoom);
  const panX = useEditorStore((s) => s.panX);
  const panY = useEditorStore((s) => s.panY);

  const [typed, setTyped] = useState('');
  const typedRef = useRef('');
  const pointer = useRef<{ x: number; y: number } | null>(null);

  const setBuffer = (value: string) => {
    typedRef.current = value;
    setTyped(value);
  };

  useEffect(() => {
    const onMove = (e: PointerEvent) => {
      pointer.current = { x: e.clientX, y: e.clientY };
    };
    window.addEventListener('pointermove', onMove);
    return () => window.removeEventListener('pointermove', onMove);
  }, []);

  // Putting the pen down, or finishing a line, drops a half-typed number.
  useEffect(() => {
    if (tool !== 'pen' || !penPoints.length) setBuffer('');
  }, [tool, penPoints.length]);

  useEffect(() => {
    if (tool !== 'pen') return;

    const onKeyDown = (e: KeyboardEvent) => {
      const el = e.target as HTMLElement | null;
      if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable)) {
        return;
      }
      const s = useEditorStore.getState();
      if (s.dialog || s.tool !== 'pen' || e.metaKey || e.ctrlKey || e.altKey) return;
      const last = s.penPoints[s.penPoints.length - 1];
      if (!last) return; // nothing to measure a leg from yet

      const take = () => {
        e.preventDefault();
        e.stopPropagation();
      };
      const buffer = typedRef.current;

      if (/^[0-9]$/.test(e.key) || ((e.key === '.' || e.key === ',') && !buffer.includes('.'))) {
        take();
        setBuffer((buffer + (e.key === ',' ? '.' : e.key)).slice(0, 8));
        return;
      }
      if (!buffer) return;

      if (e.key === 'Backspace') {
        take();
        setBuffer(buffer.slice(0, -1));
        return;
      }
      if (e.key === 'Escape') {
        take();
        setBuffer('');
        return;
      }

      const length = Math.round(Number(buffer) * 10) / 10;
      if (!(length > 0)) return;

      const arrows: Record<string, { x: number; y: number }> = {
        ArrowRight: { x: 1, y: 0 },
        ArrowLeft: { x: -1, y: 0 },
        ArrowUp: { x: 0, y: -1 },
        ArrowDown: { x: 0, y: 1 },
      };
      let dir = arrows[e.key];
      if (!dir && e.key === 'Enter') dir = towardsPointer(last, s.penPoints, s.zoom, s.panX, s.panY, pointer.current);
      if (!dir) return;

      take();
      s.penAddPoint(last.x + dir.x * length, last.y + dir.y * length);
      setBuffer('');
    };

    // Capture: the canvas's own handler would otherwise read Enter as "finish".
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [tool]);

  const last = penPoints[penPoints.length - 1];
  if (tool !== 'pen' || !typed || !last) return null;
  const stage = document.querySelector('.stage')?.getBoundingClientRect();
  if (!stage) return null;

  return (
    <div
      className="pen-typed"
      style={{ left: stage.left + last.x * zoom + panX + 14, top: stage.top + last.y * zoom + panY - 34 }}
    >
      {typed} სმ <small>Enter · ←↑→↓</small>
    </div>
  );
}

/**
 * Along the axis the pointer is furthest out on - the pen draws square, so a
 * typed leg goes square too. Where the pointer gives nothing to go on, the way
 * the last leg went.
 */
function towardsPointer(
  last: { x: number; y: number },
  points: Array<{ x: number; y: number }>,
  zoom: number,
  panX: number,
  panY: number,
  client: { x: number; y: number } | null,
): { x: number; y: number } {
  const stage = document.querySelector('.stage')?.getBoundingClientRect();
  if (client && stage) {
    const dx = (client.x - stage.left - panX) / zoom - last.x;
    const dy = (client.y - stage.top - panY) / zoom - last.y;
    if (Math.abs(dx) > 0.5 || Math.abs(dy) > 0.5) {
      return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx), y: 0 } : { x: 0, y: Math.sign(dy) };
    }
  }
  const before = points[points.length - 2];
  if (before) {
    const dx = last.x - before.x;
    const dy = last.y - before.y;
    return Math.abs(dx) >= Math.abs(dy) ? { x: Math.sign(dx) || 1, y: 0 } : { x: 0, y: Math.sign(dy) };
  }
  return { x: 1, y: 0 };
}
