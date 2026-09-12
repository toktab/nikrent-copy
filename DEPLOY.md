# Going live

The order matters. The app is deployed last, because putting it in front of
people before the database matches the code ships them broken features.

---

## 1. Run the outstanding migrations

The live database is at `0003`. Everything from `0004` on is waiting.

Supabase → SQL Editor → paste each file whole, in order, and run it:

| File | What it does | What is broken until it runs |
| --- | --- | --- |
| `0004_avatars.sql` | `profiles.avatar_url` + the `avatars` storage bucket | profile pictures |
| `0005_drop_price.sql` | drops the unused `price` column | nothing — it has a default and is simply ignored |
| `0006_error_log.sql` | the `error_log` table | crash reporting, silently |
| `0007_templates.sql` | the `templates` table | saved assemblies |
| `0008_keepalive.sql` | `public.keepalive()` | the keepalive job below |
| `0009_sketch.sql` | `documents.sketch` - the drawn layout | ხაზვა lines do not reach the server |
| `0010_custom_algorithms.sql` | the `custom_algorithms` table | saved detection algorithms stay on one device |
| `0011_measures.sql` | `documents.measures` - measured check lines | measured lines stay on this screen; the app warns once and still saves the rest |

All of them are safe to re-run. `0005` is the only destructive one, and only
of prices, which nothing reads any more.

Check it took:

```sql
select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'profiles' and column_name = 'avatar_url';

select to_regclass('public.error_log'), to_regclass('public.templates');
select public.keepalive();

select column_name from information_schema.columns
where table_schema = 'public' and table_name = 'documents' and column_name in ('sketch', 'measures');
```

Non-null answers, a timestamp, and both `sketch` and `measures` listed means
they are all in.

---

## 2. Turn on backups

**This is the one that matters.** Right now there is no copy of the catalog,
the stock ledger or any drawing anywhere. One mistaken delete is permanent.

1. Supabase dashboard → **Connect** (top bar, beside the project name; it is
   no longer under Settings → Database) → **Session pooler**. Paste your
   database password in place of `[YOUR-PASSWORD]`.

   It must be the pooler, and it must be port 5432:

   | | |
   | --- | --- |
   | **Session pooler**, 5432 | what to use |
   | Transaction pooler, 6543 | `pg_dump` cannot work through it |
   | Direct connection | `db.<ref>.supabase.co` resolves to **IPv6 only**, and GitHub runners are IPv4-only — the job fails with "network unreachable" |

   The host should read `…pooler.supabase.com`, never `db.….supabase.co`.

2. GitHub → repo → Settings → Secrets and variables → Actions → New secret:
   - `SUPABASE_DB_URL` — that URI

Then run it once by hand: Actions → **Database backup** → Run workflow. It
should finish green with a `db-backup-…` artifact attached.

After that it runs 03:00 UTC every Sunday and keeps 90 days.

> **Restore the first one into a scratch project before you trust it.**
> A backup nobody has restored is a guess. The command is in the workflow
> header. Ten minutes now, or finding out during the emergency.

---

## 3. Turn on the keepalive

A free project pauses after a week idle and has to be woken by hand from the
dashboard — which will happen on the day someone needs it on site.

Add two more Actions secrets:

- `SUPABASE_URL` — `https://<project-ref>.supabase.co`
- `SUPABASE_ANON_KEY` — Project Settings → API → anon / publishable key

The anon key is public by design; it ships inside the browser bundle and
row-level security is what protects the data. It goes in a secret only to keep
it out of the logs. **The `service_role` key is never used here, or anywhere
outside the Edge Function.**

Run **Keepalive** once by hand. A 404 means migration `0008` has not been run.

---

## 4. Deploy the app

Configs for both hosts are committed; the unused one is ignored.

**Vercel** — import the GitHub repo, or:

```bash
npx vercel --prod
```

**Netlify** — connect the repo, or:

```bash
npx netlify deploy --prod
```

Build settings are already in `vercel.json` / `netlify.toml`: `npm run build`
into `dist`, with an SPA rewrite so a password-recovery link does not land on
the host's 404.

Set two environment variables on the host, same values as `.env.local`:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`

`.env.local` itself is gitignored and must stay that way — the host gets these
through its own settings, not through the repo.

---

## 5. Close the Edge Function's door

Once the deployed URL exists:

```bash
npx supabase secrets set ALLOWED_ORIGINS="https://<your-app>,http://localhost:5173"
npx supabase functions deploy admin-users
```

Honest about what this buys: CORS stops a *browser* on another site from
reading the response. It is not what protects the function — every call must
carry a valid signed-in token and be an admin according to the database, and a
token lives in localStorage where no other origin can read it. This closes a
door that has no reason to be open. Left unset, the function stays open to any
origin exactly as it is today.

---

## 6. Before anyone relies on it

- [ ] **Load the real inventory.** The catalog ships 41 Du materials with zero
      stock. Until real quantities are in, every shortage warning is noise.
      Use Inventory → import, or type them.
- [ ] **Test the viewer role with a second account.** Make one, sign in as it,
      confirm the catalog and stock controls are disabled and a drawing edit is
      refused with a reason rather than silently dropped.
- [ ] **Test the conflict banner with two people.** Both open the same drawing,
      both edit, and confirm the second one to save is offered the choice
      rather than losing the work.
- [ ] **Draw one real column or wall end to end — someone who is not you.**
      Empty drawing to printed PDF to a materials order. Whatever breaks in
      that hour is the real backlog, and it outranks anything on the wish list.
