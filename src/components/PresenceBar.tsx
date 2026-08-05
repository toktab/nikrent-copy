import { initialsFor, usePresence } from '../lib/presence';
import { useEditorStore } from '../store/useEditorStore';

/**
 * Avatars of the other people who have this drawing open, beside the drawing
 * picker so it reads as "who is in here", not "who is online".
 *
 * Renders nothing when you are alone, which is almost always — a permanent
 * empty slot would be noise, and its sudden appearance is the signal.
 */
export function PresenceBar() {
  const activeDocId = useEditorStore((s) => s.activeDocId);
  const peers = usePresence(activeDocId);

  if (peers.length === 0) return null;

  // Beyond four the row starts crowding the toolbar; the rest become "+n",
  // and every name is still reachable through the group tooltip.
  const shown = peers.slice(0, 4);
  const extra = peers.length - shown.length;
  const allNames = peers.map((p) => p.name).join(', ');

  return (
    <div
      className="presence"
      title={`ამ ნახაზს ხსნის: ${allNames}`}
      aria-label={`ამ ნახაზზე ასევე მუშაობს: ${allNames}`}
    >
      {shown.map((peer) => (
        <span
          key={peer.userId}
          className="presence-dot"
          style={{ background: peer.color }}
          title={`${peer.name} (${peer.email})`}
        >
          {initialsFor(peer.name)}
        </span>
      ))}
      {extra > 0 && <span className="presence-dot more">+{extra}</span>}
    </div>
  );
}
