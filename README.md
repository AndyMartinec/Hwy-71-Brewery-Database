# Highway 71 Brewing — Ops

Cloud brewery management for Highway 71 Brewing (Spicewood, TX).

**What it does (v1)**
- 🌾 Grain & adjunct inventory — append-only ledger, low-stock alerts
- 🛢️ Finished beer (kegs) — packaged, sold, destroyed, returned, by channel
- 📝 Brew-day logs — batch record + grain bill deducted in one shot
- ⚗️ Fermentation sheets — gravity/temp/pH readings per batch
- 🎤 Voice — dictate into any notes field free; speak full log entries
  ("used one bag of Pilsner") and confirm them as structured actions
- 🔄 Brewfather sync — batches pulled every 15 min via the Brewfather API;
  batch status can optionally push back
- 📱 Installable PWA — add to home screen, works on any phone or PC

**Stack:** Next.js 16 · Supabase (Postgres + Auth + Realtime) · Vercel ·
Brewfather REST API · OpenAI (voice parsing, optional)

**Docs**
- `DEPLOY.md` — go-live checklist (Supabase → Vercel → keys → users)
- `supabase/schema.sql` — database schema (run once)
- `supabase/seed.sql` — opening inventory, Oct 19 2026 count

**Planned for v2:** packaging/removal rollups, TABC Schedule 1/2/4 CSV exports
for AIMS upload, TTB Form 5130.9 worksheet.
