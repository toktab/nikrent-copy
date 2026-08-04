// Supabase Edge Function — create and delete staff accounts.
//
// Creating or deleting an account needs the Admin API, which needs the
// service_role key. That key bypasses every row-level security rule, so it can
// never be shipped to a browser. This function is the only place it exists:
// the browser sends an ordinary signed-in request, the function checks that the
// caller really is an admin, and only then uses the privileged client.
//
// Everything an admin can already do safely under RLS — listing the team,
// changing someone's role — is deliberately NOT here. It belongs in the client,
// where the database enforces the rules directly.
//
// Deploy:
//   supabase functions deploy admin-users
// or paste this file into Dashboard → Edge Functions → new function.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.47.10';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
};

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  const url = Deno.env.get('SUPABASE_URL');
  const anonKey = Deno.env.get('SUPABASE_ANON_KEY');
  const serviceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !anonKey || !serviceKey) {
    return json({ error: 'function is not configured' }, 500);
  }

  const authHeader = req.headers.get('Authorization') ?? '';
  if (!authHeader.startsWith('Bearer ')) return json({ error: 'not signed in' }, 401);

  // Identify the caller using their own token and no special privileges.
  const caller = createClient(url, anonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: userData, error: userError } = await caller.auth.getUser();
  if (userError || !userData?.user) return json({ error: 'not signed in' }, 401);
  const callerId = userData.user.id;

  const admin = createClient(url, serviceKey, { auth: { persistSession: false } });

  // Authorisation is decided from the database, never from anything the client
  // sent. A caller could otherwise simply claim to be an admin.
  const { data: profile, error: profileError } = await admin
    .from('profiles')
    .select('role')
    .eq('id', callerId)
    .maybeSingle();

  if (profileError) return json({ error: profileError.message }, 500);
  if (!profile || profile.role !== 'admin') {
    return json({ error: 'ამ მოქმედებისთვის საჭიროა ადმინისტრატორის უფლება' }, 403);
  }

  let body: { action?: string; email?: string; password?: string; fullName?: string; role?: string; userId?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid JSON body' }, 400);
  }

  if (body.action === 'create') {
    const email = (body.email ?? '').trim().toLowerCase();
    const password = body.password ?? '';
    const fullName = (body.fullName ?? '').trim();
    const role = body.role === 'admin' || body.role === 'editor' ? body.role : 'viewer';

    if (!email || !password) return json({ error: 'ელფოსტა და პაროლი აუცილებელია' }, 400);
    if (password.length < 12) return json({ error: 'პაროლი ძალიან მოკლეა' }, 400);

    // Confirmed on creation: the account is made by an admin who already knows
    // the address, and the built-in mailer is rate limited to a couple of
    // messages an hour, so waiting on a confirmation email would strand people.
    const { data: created, error: createError } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName },
    });

    if (createError) return json({ error: createError.message }, 400);
    const newId = created.user?.id;
    if (!newId) return json({ error: 'account was not created' }, 500);

    // The trigger on auth.users has already inserted the profile; this sets
    // the role and name the admin chose.
    const { error: roleError } = await admin
      .from('profiles')
      .update({ role, full_name: fullName, email })
      .eq('id', newId);

    if (roleError) {
      // Don't leave an account nobody can administer behind.
      await admin.auth.admin.deleteUser(newId);
      return json({ error: roleError.message }, 500);
    }

    return json({ ok: true, id: newId });
  }

  if (body.action === 'delete') {
    const userId = body.userId ?? '';
    if (!userId) return json({ error: 'userId is required' }, 400);
    if (userId === callerId) return json({ error: 'საკუთარი ანგარიშის წაშლა შეუძლებელია' }, 400);

    // Deleting the profile first lets the last-admin trigger veto it, so the
    // company cannot delete its way out of having an administrator.
    const { error: profileDeleteError } = await admin.from('profiles').delete().eq('id', userId);
    if (profileDeleteError) return json({ error: profileDeleteError.message }, 400);

    const { error: deleteError } = await admin.auth.admin.deleteUser(userId);
    if (deleteError) return json({ error: deleteError.message }, 400);

    return json({ ok: true });
  }

  return json({ error: 'unknown action' }, 400);
});
