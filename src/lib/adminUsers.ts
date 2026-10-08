import type { Profile, Role } from '../store/useAuthStore';
import { requireSupabase } from './supabase';

/**
 * Team management.
 *
 * Split by what the database can police on its own: listing the team and
 * changing a role go straight to Postgres, where the row-level policies and
 * the last-admin trigger already enforce the rules. Only creating and deleting
 * an *account* needs the Admin API, and that goes through the Edge Function so
 * the service_role key stays off the browser.
 */

export async function listProfiles(): Promise<Profile[]> {
  const supabase = requireSupabase();
  const { data, error } = await supabase
    .from('profiles')
    .select('*')
    .order('email');
  if (error) throw new Error(error.message);
  return ((data ?? []) as Profile[]).map((r) => ({ ...r, avatar_url: r.avatar_url ?? '' }));
}

export async function setRole(id: string, role: Role): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.from('profiles').update({ role }).eq('id', id);
  if (error) throw new Error(error.message);
}

/**
 * Call the Edge Function and turn its failures into something actionable.
 *
 * supabase-js reports every non-2xx as "Failed to send a request to the Edge
 * Function", which is the same text whether the function is missing, the
 * caller lacks permission, or the email is already taken. The real reason is
 * in the response body, so it is dug out here.
 */
async function callAdminFunction<T>(body: Record<string, unknown>): Promise<T> {
  const supabase = requireSupabase();
  const { data, error } = await supabase.functions.invoke('admin-users', { body });

  if (error) {
    const response = (error as { context?: Response }).context;

    if (response) {
      // A missing function is by far the most likely cause the first time, and
      // the fix is a deployment, not anything inside the app.
      if (response.status === 404) {
        throw new Error(
          'სერვერზე ფუნქცია "admin-users" არ არის განთავსებული. ' +
            'იხილე supabase/README.md - განთავსების ინსტრუქცია.',
        );
      }
      try {
        const detail = (await response.clone().json()) as { error?: string };
        if (detail?.error) throw new Error(detail.error);
      } catch (parseError) {
        if (parseError instanceof Error && parseError.message) throw parseError;
      }
      if (response.status === 403) {
        throw new Error('ამ მოქმედებისთვის საჭიროა ადმინისტრატორის უფლება.');
      }
    }

    const detail = (data as { error?: string } | null)?.error;
    throw new Error(detail || error.message);
  }

  if (data && typeof data === 'object' && 'error' in data) {
    throw new Error(String((data as { error: string }).error));
  }
  return data as T;
}

/**
 * A strong initial password, generated in the browser so nobody has to invent
 * one. It is shown to the admin exactly once to pass on, and the new user is
 * expected to change it.
 *
 * The alphabet leaves out characters that are easy to confuse when a password
 * is read aloud or copied off a screen on site — O/0, l/1/I.
 */
export function generatePassword(length = 16): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint32Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) out += alphabet[bytes[i] % alphabet.length];
  return out;
}

export interface NewUser {
  email: string;
  fullName: string;
  role: Role;
  password: string;
}

export async function createUser(user: NewUser): Promise<void> {
  await callAdminFunction({
    action: 'create',
    email: user.email,
    password: user.password,
    fullName: user.fullName,
    role: user.role,
  });
}

export async function deleteUser(userId: string): Promise<void> {
  await callAdminFunction({ action: 'delete', userId });
}

/**
 * Issue a new password for someone who is locked out, and hand it back so the
 * admin can pass it on. Returns the generated password — it is never
 * retrievable afterwards, since only a hash is stored.
 */
export async function resetPassword(userId: string): Promise<string> {
  const password = generatePassword();
  await callAdminFunction({ action: 'reset-password', userId, password });
  return password;
}

/** Change your own password. Available to every role. */
export async function changeOwnPassword(password: string): Promise<void> {
  const supabase = requireSupabase();
  const { error } = await supabase.auth.updateUser({ password });
  if (error) throw new Error(error.message);
}
