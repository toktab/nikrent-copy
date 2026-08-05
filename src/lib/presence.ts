import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { useAuthStore } from '../store/useAuthStore';

/**
 * Who else has the current drawing open.
 *
 * Uses Supabase Realtime presence, which is a plain websocket channel — no
 * tables, no row-level security, nothing to migrate. Membership is held by the
 * Realtime server and dropped automatically when a socket closes, so a closed
 * laptop or a dropped connection clears itself without a heartbeat or a
 * cleanup job.
 *
 * This is awareness, not locking. Two people editing at once is still allowed;
 * the version check on save is what stops one silently overwriting the other.
 * Seeing a face beside the drawing name is how you avoid reaching that point.
 */

export interface Peer {
  userId: string;
  name: string;
  email: string;
  /** stable colour derived from the id, so a person looks the same to everyone */
  color: string;
  avatarUrl: string;
}

interface PresenceMeta {
  name: string;
  email: string;
  avatarUrl: string;
}

/** Distinct, readable-on-dark hues. Picked by hash so it never shifts. */
const COLORS = [
  '#e0a33c',
  '#4a90e2',
  '#7fc08a',
  '#d9738f',
  '#9b8ad6',
  '#4fb3ab',
  '#dd8149',
  '#8fb339',
];

export function colorFor(id: string): string {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return COLORS[hash % COLORS.length];
}

/** Initials for the avatar circle: two letters at most. */
export function initialsFor(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return (words[0][0] + words[1][0]).toUpperCase();
}

export function usePresence(docId: string | null): Peer[] {
  const me = useAuthStore((s) => s.profile);
  const [peers, setPeers] = useState<Peer[]>([]);

  useEffect(() => {
    if (!supabase || !docId || !me) {
      setPeers([]);
      return;
    }
    // Captured so the cleanup below still has a non-null client; narrowing
    // does not survive into the returned closure.
    const client = supabase;

    // Keying the channel by user id means two tabs from the same person
    // collapse into one entry rather than looking like two colleagues.
    const channel = client.channel(`doc:${docId}`, {
      config: { presence: { key: me.id } },
    });

    channel
      .on('presence', { event: 'sync' }, () => {
        const state = channel.presenceState<PresenceMeta>();
        const others: Peer[] = [];
        for (const [userId, entries] of Object.entries(state)) {
          if (userId === me.id) continue; // you know you are here
          const meta = entries[0];
          if (!meta) continue;
          others.push({
            userId,
            name: meta.name || meta.email,
            email: meta.email,
            color: colorFor(userId),
            avatarUrl: meta.avatarUrl ?? '',
          });
        }
        others.sort((a, b) => a.name.localeCompare(b.name));
        setPeers(others);
      })
      .subscribe((status) => {
        if (status !== 'SUBSCRIBED') return;
        void channel.track({
          name: me.full_name?.trim() || me.email,
          email: me.email,
          avatarUrl: me.avatar_url ?? '',
        } satisfies PresenceMeta);
      });

    return () => {
      void client.removeChannel(channel);
      setPeers([]);
    };
    // Re-subscribing on a drawing switch is the point: presence is per drawing.
  }, [docId, me]);

  return peers;
}
