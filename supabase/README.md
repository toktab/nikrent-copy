# Backend setup

Postgres, auth and staff accounts for the Du formwork editor, on Supabase.

The app is a static site with no server of its own. Everything below runs in
your Supabase project.

---

## 1. Migrations

Run these in order in **Dashboard → SQL Editor**. Both are idempotent, so
re-running one is safe.

| file | what it does |
| --- | --- |
| `migrations/0001_init.sql` | tables, roles, row-level security, stock ledger |
| `migrations/0002_last_admin_guard.sql` | stops the company deleting its last admin |

### What the schema assumes

- **One company.** Everyone shares one catalog, one stock pool and one set of
  drawings, so there is no tenant column. Roles control access instead.
- **Three roles.** `admin` manages the catalog, stock and staff; `editor`
  draws; `viewer` reads. New accounts default to `viewer`.
- **Stock cannot be written directly.** The `stock` table has a read policy and
  no write policy. The only way to change a quantity is `adjust_stock()` or
  `set_stock()`, which write an entry to `stock_movements` in the same
  transaction. Every change therefore has a who and a when.
- **Drawings carry a `version`.** Saves are conditional on the version that was
  read, so two people editing the same drawing produces a visible conflict
  rather than one silently overwriting the other.

## 2. Project settings

**Authentication → Sign In / Providers**

- Email provider: **on** (login depends on it)
- Allow new users to sign up: **off** — accounts are created by an admin
- Secure email change: **on**
- Secure password change: **on**
- Minimum password length: **12**

Check it took effect:

```bash
curl -s "https://<project-ref>.supabase.co/auth/v1/settings" -H "apikey: <anon-key>" | grep -o '"disable_signup":[a-z]*'
```

You want `"disable_signup":true`.

## 3. The first admin

New profiles default to `viewer`, and there is no code path that grants admin
automatically — so the first one is set by hand, once:

```sql
update public.profiles set role = 'admin' where email = 'you@example.com';
```

After that, admins add everyone else from inside the app.

## 4. Edge Function — `admin-users`

Creating and deleting accounts needs Supabase's Admin API, which needs the
`service_role` key. That key bypasses every security rule, so it must never
reach a browser. This function is the only place it lives: the browser makes an
ordinary signed-in request, the function checks the caller is really an admin,
and only then uses the privileged client.

Listing the team and changing roles are **not** in the function — the database
can police those on its own through row-level security, so they go straight
from the client.

### Deploy — dashboard

**Edge Functions → Deploy a new function**, name it exactly `admin-users`, and
paste the contents of `functions/admin-users/index.ts`.

### Deploy — CLI

```bash
npx supabase login
```

```bash
npx supabase functions deploy admin-users --project-ref <project-ref>
```

`SUPABASE_URL`, `SUPABASE_ANON_KEY` and `SUPABASE_SERVICE_ROLE_KEY` are
injected by the platform. Do not add them as secrets, and do not put them in
the app's `.env.local`.

## 5. Connect the app

Copy `.env.example` to `.env.local` and fill in **Settings → API**:

```
VITE_SUPABASE_URL=https://<project-ref>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon key>
```

Both are safe in the browser bundle — the anon key acts as an unauthenticated
visitor and row-level security does the real work. `.env.local` is gitignored.

If these are absent the app falls back to its original localStorage-only mode,
which is what keeps it usable while the backend is being set up.

---

## Data migration

The app stored everything under the localStorage key `du-formwork-v2`. On first
sign-in, if the server is empty and that key holds real work, the app offers to
upload it.

The local copy is **never deleted**. Preferences are written to a different key
(`du-formwork-prefs`), so the old one stays untouched as a backup.

## Free tier caveats

- **Email is throttled to roughly 2/hour.** The built-in mailer is for
  development. This is why admin-created accounts get a generated password
  shown once on screen rather than an invitation email.
- **Free projects pause after about a week idle**, and backups are minimal.
  Before real inventory data lives here, the paid tier is what buys
  point-in-time recovery.
