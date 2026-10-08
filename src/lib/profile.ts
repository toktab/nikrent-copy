import { requireSupabase } from './supabase';

/**
 * The signed-in user's own profile: display name and picture.
 *
 * Separate from `adminUsers` because none of this needs the admin role — the
 * row-level policy lets anyone edit their own row, and the storage policies
 * confine writes to a folder named after their own id.
 */

const BUCKET = 'avatars';

/** Bigger than this and a headshot is just wasted bandwidth on site. */
export const MAX_AVATAR_BYTES = 2 * 1024 * 1024;

const ALLOWED = ['image/jpeg', 'image/png', 'image/webp', 'image/gif'];

export function validateAvatar(file: File): string | null {
  if (!ALLOWED.includes(file.type)) return 'დასაშვებია მხოლოდ JPG, PNG, WebP ან GIF.';
  if (file.size > MAX_AVATAR_BYTES) return 'ფაილი 2 MB-ზე დიდია.';
  return null;
}

/**
 * Upload a picture and record its URL on the profile.
 *
 * Stored at a fixed path per user so a new upload replaces the old one rather
 * than accumulating orphaned files nobody will ever clean up. Because the path
 * is stable, a cache-busting query is appended — otherwise the browser keeps
 * showing the previous picture at the same URL.
 */
export async function uploadAvatar(userId: string, file: File): Promise<string> {
  const supabase = requireSupabase();
  const ext = file.type === 'image/png' ? 'png' : file.type === 'image/webp' ? 'webp' : file.type === 'image/gif' ? 'gif' : 'jpg';
  const path = `${userId}/avatar.${ext}`;

  const { error: uploadError } = await supabase.storage
    .from(BUCKET)
    .upload(path, file, { upsert: true, contentType: file.type });
  if (uploadError) throw new Error(uploadError.message);

  const { data } = supabase.storage.from(BUCKET).getPublicUrl(path);
  const url = `${data.publicUrl}?v=${Date.now()}`;

  const { error } = await supabase.from('profiles').update({ avatar_url: url }).eq('id', userId);
  if (error) throw new Error(error.message);
  return url;
}

export async function removeAvatar(userId: string, currentUrl: string): Promise<void> {
  const supabase = requireSupabase();

  // Derive the stored path from the public URL rather than guessing the
  // extension, so the right file is removed whatever was uploaded.
  const match = currentUrl.match(/\/avatars\/(.+?)(\?|$)/);
  if (match) await supabase.storage.from(BUCKET).remove([decodeURIComponent(match[1])]);

  const { error } = await supabase.from('profiles').update({ avatar_url: '' }).eq('id', userId);
  if (error) throw new Error(error.message);
}

export async function updateDisplayName(userId: string, fullName: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase
    .from('profiles')
    .update({ full_name: fullName.trim() })
    .eq('id', userId);
  if (error) throw new Error(error.message);
}
