# Go-live checklist

About 15 minutes of clicking, then the app is live for the whole brewery.
Do the steps in order — each one is a couple of minutes.

> **Phase 1 update (Oct 23, 2026):** invoice intake + ingredient costs are built.
> To activate on the live site: (1) run `supabase/phase1-invoices.sql` in the
> Supabase SQL Editor, (2) upload the latest code, (3) add `OPENAI_API_KEY` in
> Vercel (powers automatic invoice reading and voice commands; invoices can be
> entered manually without it) and redeploy.

> **Status note (Oct 23, 2026):** app is live at
> https://highway71-ops.vercel.app. Email login is TEMPORARILY disabled
> (`AUTH_DISABLED = true` in `lib/config.ts` + `supabase/temp-open-access.sql`
> applied) because Supabase's built-in email hit its rate limit. To turn login
> back on: connect a real email sender (Supabase → Authentication → SMTP,
> e.g. Resend), run `supabase/reenable-auth.sql`, set `AUTH_DISABLED = false`,
> and redeploy. While login is off, anyone with the URL can use the app —
> don't post the URL publicly.

## 1. Database (Supabase) — ~5 min

1. Go to https://supabase.com and sign up (free tier is plenty).
2. Create a new project (name it `highway71-ops`). Save the database password
   it shows you — you won't need it again, but keep it somewhere safe.
3. Once the project is ready, open **SQL Editor → New query**.
4. Paste the entire contents of `supabase/schema.sql` and press **Run**.
5. New query again, paste `supabase/seed.sql`, press **Run**.
   This loads your opening inventory (650 lbs grain, 26 kegs).
6. Go to **Project Settings → API** and copy:
   - Project URL → `NEXT_PUBLIC_SUPABASE_URL`
   - `anon public` key → `NEXT_PUBLIC_SUPABASE_ANON_KEY`
   - `service_role` key → `SUPABASE_SERVICE_ROLE_KEY` (keep secret)

## 2. Put the code on GitHub — ~3 min

1. Create a free GitHub account if needed, then a new **private** repository.
2. Push this folder to it (`git init`, `git add .`, `git commit`, `git push`).
   (Or say the word and I'll walk you through it line by line.)

## 3. Host the app (Vercel) — ~5 min

1. Go to https://vercel.com, sign up with your GitHub account.
2. **Add New → Project → Import** the repository you just pushed.
3. In **Environment Variables**, add every line from `.env.example`:
   - The three Supabase values from step 1.
   - `CRON_SECRET` — any long random string (e.g. from a password generator).
   - Leave Brewfather/OpenAI blank for now; add them in steps 4–5.
4. Press **Deploy**. You'll get a URL like `highway71-ops.vercel.app`.

## 4. Brewfather key — ~2 min

1. In the Brewfather app → **Settings → API → GENERATE**.
2. Enable **all five scopes** (Read Recipes, Read Batches, Edit Batches,
   Read Inventory, Edit Inventory).
3. Copy the **User ID** and **API key** into Vercel's environment variables
   as `BREWFATHER_USER_ID` and `BREWFATHER_API_KEY`, then **Redeploy**.
4. Open the app → Settings → "Sync from Brewfather" to pull your batches
   immediately. (The automatic 15-minute sync starts after step 6.)

## 5. Voice commands (optional)

Voice *dictation* (the 🎤 button in notes fields) works with nothing extra —
it's built into the browser and free. For full voice *commands*
("used one bag of Pilsner" → confirm → logged), add an `OPENAI_API_KEY`
from https://platform.openai.com (costs pennies a day at brewery volume).

## 6. Automatic Brewfather sync — ~2 min

In your GitHub repo → **Settings → Secrets and variables → Actions**,
add two secrets:
- `APP_URL` — your Vercel URL (e.g. `https://highway71-ops.vercel.app`)
- `CRON_SECRET` — the same value as in Vercel

The workflow in `.github/workflows/sync-brewfather.yml` then pulls
Brewfather batches every 15 minutes automatically.

## 7. Invite the brewery

1. In Supabase → **Authentication → URL Configuration**, set the **Site URL**
   and add a **Redirect URL** for your Vercel URL
   (e.g. `https://highway71-ops.vercel.app`). This makes magic-link sign-in work.
2. In Supabase → **Authentication → Users → Invite user**, add each person's
   email. They'll get a magic sign-in link — no passwords to manage.
3. On everyone's phone: open the app URL in the browser → **Add to Home
   Screen**. It installs like a native app.

## Daily use

- **Brew day:** Brew tab → fill the form → grain deducts automatically.
- **Fermentation:** Batches → tap the batch → add readings (dictate notes).
- **Keg moves:** Kegs tab, or just 🎤 "sold two kegs of La Brisa to retail".
- **Low stock:** the Home tab flags anything under its threshold.

## v2 (tax reporting)

The ledger already records everything TABC/TTB need (gallons packaged,
gallons sold by channel, brand/package counts, destructions). v2 adds the
month-end close: Schedule 1/2/4 CSVs for AIMS upload and the TTB 5130.9
worksheet.
