# Deploying — and moving later

The app is a standard Next.js server + PostgreSQL + SMTP (profile photos live in the database by default, or optionally in an S3-compatible bucket). Nothing is tied to one provider: every piece is configured with environment variables, so moving means copying data and changing variables, never code.

Recommended free setup (Oct 2026), no payment card needed: **Vercel** (app) + **Neon** (database, also holds profile photos) + **Brevo** (email) + **GitHub Actions** (5-minute background job) + your own domain. Check each provider's current free-plan terms; Vercel's Hobby plan is limited to non-commercial use.

## 0. Before you start

- A GitHub account with the code in a **private** repository (Vercel deploys from it, and the background job runs there).
- Generate two secrets (e.g. `openssl rand -base64 48`): one for `BETTER_AUTH_SECRET`, one for `CRON_SECRET`.

## 1. Database — Neon

1. Create a project at neon.com. Choose an EU region (Frankfurt if offered).
2. Copy two connection strings: the **pooled** one (host contains `-pooler`) → `DATABASE_URL`, and the **direct** one → `DATABASE_URL_UNPOOLED`. Both must include `sslmode=require`.

Migrations run automatically on every Vercel deploy (`vercel.json` → `buildCommand`).

## 2. Profile photos — in the database

Set `STORAGE_DRIVER=db`. Photos are re-encoded to ~512 px WebP (typically 20–50 KB), so 1,000 members use around 30–50 MB of Neon's free storage. They are backed up and moved together with the database (`pg_dump`), and only served to logged-in members.

Optional, for many thousands of photos: an S3-compatible bucket (Cloudflare R2, AWS S3, Backblaze B2…) — `STORAGE_DRIVER=s3`, `S3_ENDPOINT`, `S3_REGION`, `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`. Keep the bucket private. Several of these providers ask for a payment method even on their free tier. Move existing photos across with `npm run storage:copy` (below).

## 3. Email — Brevo

1. Create a Brevo account and **authenticate your domain** (Brevo shows DNS records to add at your domain host) so mail isn't flagged as spam.
2. Under SMTP & API, create an SMTP key. Brevo shows an SMTP login (an email-like address).
3. Variables: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<the SMTP login>`, `SMTP_PASS=<the SMTP key>` (mark it Secret), and `MAIL_FROM="Copenhagen Pickleball Collective <admin@yourdomain.dk>"` using a sender added and verified in Brevo on the authenticated domain. The sender address doesn't need a mailbox; set `MAIL_REPLY_TO` to a mailbox you read so members' replies arrive. (A single `SMTP_URL` also works; URL-encode `@` in the login as `%40`.)

## 4. App — Vercel

1. *Add New Project* → import the GitHub repository. Framework is detected as Next.js; `vercel.json` sets the region to Frankfurt (`fra1`) and runs migrations before each build.
2. Add environment variables (Production):

   | Variable | Value |
   | --- | --- |
   | `DATABASE_URL`, `DATABASE_URL_UNPOOLED` | from step 1 |
   | `BETTER_AUTH_SECRET` | generated secret |
   | `APP_URL`, `BETTER_AUTH_URL` | `https://traening.yourdomain.dk` (your final address) |
   | `DUPR_PROVIDER` | `none` until the DUPR integration exists |
   | `DEMO_MODE` | `false` |
   | `CRON_SECRET` | generated secret |
   | `STORAGE_DRIVER` | `db` (step 2) |
   | `SMTP_URL`, `MAIL_FROM` | from step 3 |

3. Deploy. Check `https://<project>.vercel.app/api/health` returns `{"ok":true}`.

## 5. Your domain

1. In Vercel → Project → Settings → Domains, add e.g. `traening.yourdomain.dk`.
2. At your domain host, create the DNS record Vercel shows (for a subdomain usually a `CNAME` to Vercel's target). HTTPS is issued automatically.
3. Make sure `APP_URL`/`BETTER_AUTH_URL` match the domain exactly, then redeploy.

## 6. Background job (every 5 minutes)

Vercel's free plan only runs scheduled jobs once a day (`vercel.json` keeps a daily run as a fallback). The repository includes `.github/workflows/tick.yml`, which calls `/api/cron/tick` every 5 minutes:

1. GitHub → repository → Settings → Secrets and variables → Actions: add `APP_URL` and `CRON_SECRET` (same values as in Vercel).
2. Actions tab → *Background tick* → *Run workflow* once to test.

Alternative without GitHub: a free external scheduler (e.g. cron-job.org) calling `GET https://<domain>/api/cron/tick` with header `Authorization: Bearer <CRON_SECRET>`.

## 7. Backups (every night)

Neon's free plan only keeps a few hours of history, so `.github/workflows/backup.yml` dumps the database every night (02:17 UTC), checks that the dump restores into a fresh PostgreSQL, and keeps it for 35 days as a downloadable artifact.

1. GitHub → repository → Settings → Secrets and variables → Actions: add `BACKUP_DATABASE_URL` = the **direct** Neon connection string (the one *without* `-pooler`, same as `DATABASE_URL_UNPOOLED`).
2. Actions tab → *Database backup* → *Run workflow* once to test. The run shows the member count of the restored copy.

The dump contains members' personal data and password hashes: keep the repository private. Login sessions and verification tokens are not included.

**Restore** (into an empty database — e.g. a new Neon project or branch):
```bash
unzip pbk-db-123.zip            # downloaded from the run's Artifacts
pg_restore --no-owner --no-acl -d "$NEW_DIRECT_DATABASE_URL" pbk-*.dump
```
Use `pg_restore` version 18 or newer. Then point `DATABASE_URL`/`DATABASE_URL_UNPOOLED` at it and redeploy. Members must log in again.

## 8. First admin

Set `INITIAL_ADMIN_EMAIL=you@example.com` in Vercel, then register on the live site with that address and confirm it. The account becomes admin automatically — only while the club has no admin, so the setting is harmless afterwards (you can remove it). Alternatively run `DATABASE_URL="<direct Neon URL>" npm run admin:grant -- you@example.com` from your computer.

After that, admins promote others under Admin → Medlemmer.

## Demo site (optional)

A separate Vercel project from the same repository, with its **own** database, shows the app with test data (never connect the production database to it):

1. Vercel → Add New Project → import the repository, name it e.g. `pickleball-demo`, and add `DEMO_MODE=true` and `DUPR_PROVIDER=mock`.
2. Storage → Create Database → Neon (Free, Frankfurt), connect it to the demo project with the prefix `DATABASE`.
3. Deploy. The build migrates and seeds demo data (`npm run db:seed` runs only when `DEMO_MODE=true`); upcoming demo sessions are topped up automatically. No other variables are needed: the URL comes from Vercel and, in demo mode only, the auth secret is derived from the database URL. Demo sign-ups skip email verification.

Demo logins (password `demo-pickleball-2026`): `anna@demo.pbk.local` (member with rating history), `mads@demo.pbk.local` (parent with a child), `sofie@demo.pbk.local`, `admin@demo.pbk.local`. The site shows a permanent "Demo" banner; ratings come from the labelled test provider, not DUPR.

## Launch checklist

- [ ] Fill in the [bracketed] fields in the privacy policy (`src/app/privatliv/page.tsx`).
- [ ] Data processing agreements with Vercel, Neon and Brevo (all offer standard DPAs).
- [ ] `/api/health` OK, sign-up email arrives, photo upload works, background job runs, a backup run succeeded.
- [ ] `DUPR_PROVIDER=none` and `DEMO_MODE=false` in production. Never run `npm run db:seed` against production.

---

## Moving to another provider

Each piece moves independently. Members keep using the same address, because the domain is yours.

**Database** (to any PostgreSQL 14+ host):
```bash
pg_dump --no-owner --no-acl -Fc "$OLD_DATABASE_URL" > pbk.dump
pg_restore --no-owner --no-acl -d "$NEW_DATABASE_URL" pbk.dump
```
Then set the new `DATABASE_URL` (and `DATABASE_URL_UNPOOLED`). Briefly stop the old app (or accept a few minutes of read-only) to avoid writes during the copy.

**Profile photos** — with `STORAGE_DRIVER=db` they move with the database dump above; nothing else to do. To move them between drivers (database, local disk, S3-compatible store):
```bash
FROM_STORAGE_DRIVER=s3 FROM_S3_ENDPOINT=... FROM_S3_BUCKET=... FROM_S3_ACCESS_KEY_ID=... FROM_S3_SECRET_ACCESS_KEY=... \
TO_STORAGE_DRIVER=s3   TO_S3_ENDPOINT=...   TO_S3_BUCKET=...   TO_S3_ACCESS_KEY_ID=...   TO_S3_SECRET_ACCESS_KEY=... \
npm run storage:copy
```
Re-running is safe (files already present are skipped). For the database driver use `FROM_STORAGE_DRIVER=db FROM_DATABASE_URL=…` (or `TO_…`). Then switch the app's storage variables. On a host with a persistent disk you can also use `STORAGE_DRIVER=local`.

**App** (Render, Railway, Fly.io, a VPS…): any Node.js 20+ host. Build `npm ci && npm run db:migrate && npm run build`, start `npm start` (port from `PORT`, default 3000), copy the environment variables, point the domain's DNS at the new host. If the host has no scheduler, keep the GitHub Actions job (just update its `APP_URL` if it changed).

**Email:** change `SMTP_URL` and `MAIL_FROM`.

**Nothing else is provider-specific.** `vercel.json` is simply ignored elsewhere.
