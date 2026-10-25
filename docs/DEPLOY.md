# Deploying — and moving later

The app is a standard Next.js server + PostgreSQL + an S3-compatible bucket + SMTP. Nothing is tied to one provider: every piece is configured with environment variables, so moving means copying data and changing variables, never code.

Recommended free setup (Oct 2026): **Vercel** (app) + **Neon** (database) + **Cloudflare R2** (profile photos) + **Brevo** (email) + **GitHub Actions** (5-minute background job) + your own domain. Check each provider's current free-plan terms; Vercel's Hobby plan is limited to non-commercial use.

## 0. Before you start

- A GitHub account with the code in a **private** repository (Vercel deploys from it, and the background job runs there).
- Generate two secrets (e.g. `openssl rand -base64 48`): one for `BETTER_AUTH_SECRET`, one for `CRON_SECRET`.

## 1. Database — Neon

1. Create a project at neon.com. Choose an EU region (Frankfurt if offered).
2. Copy two connection strings: the **pooled** one (host contains `-pooler`) → `DATABASE_URL`, and the **direct** one → `DATABASE_URL_UNPOOLED`. Both must include `sslmode=require`.

Migrations run automatically on every Vercel deploy (`vercel.json` → `buildCommand`).

## 2. Profile photos — Cloudflare R2

1. In Cloudflare, enable R2 (Cloudflare may ask for a payment method even on the free tier) and create a bucket, e.g. `pbk-avatars`. Keep it **private** (no public access) — the app serves photos itself, only to logged-in members.
2. Create an R2 API token with *Object Read & Write* on that bucket.
3. Variables: `STORAGE_DRIVER=s3`, `S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com`, `S3_REGION=auto`, `S3_BUCKET=pbk-avatars`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY`.

Any other S3-compatible store works the same way (AWS S3: leave `S3_ENDPOINT` empty and set the region).

## 3. Email — Brevo

1. Create a Brevo account and **authenticate your domain** (Brevo shows DNS records to add at your domain host) so mail isn't flagged as spam.
2. Under SMTP & API, create an SMTP key. Brevo shows an SMTP login (an email-like address).
3. Variables: `SMTP_HOST=smtp-relay.brevo.com`, `SMTP_PORT=587`, `SMTP_USER=<the SMTP login>`, `SMTP_PASS=<the SMTP key>` (mark it Secret), and `MAIL_FROM="Pickleball København <admin@yourdomain.dk>"` using a sender added and verified in Brevo on the authenticated domain. (A single `SMTP_URL` also works; URL-encode `@` in the login as `%40`.)

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
   | `STORAGE_DRIVER`, `S3_*` | from step 2 |
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

## 7. First admin

Register on the live site and confirm your email, then run once from your computer with the production database URL:

```bash
DATABASE_URL="<direct Neon URL>" npm run admin:grant -- you@example.com
```

After that, admins promote others under Admin → Medlemmer.

## Launch checklist

- [ ] Fill in the [bracketed] fields in the privacy policy (`src/app/privatliv/page.tsx`).
- [ ] Data processing agreements with Vercel, Neon, Cloudflare and Brevo (all offer standard DPAs).
- [ ] `/api/health` OK, sign-up email arrives, photo upload works, background job runs.
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

**Profile photos** (any combination of local disk and S3-compatible stores):
```bash
FROM_STORAGE_DRIVER=s3 FROM_S3_ENDPOINT=... FROM_S3_BUCKET=... FROM_S3_ACCESS_KEY_ID=... FROM_S3_SECRET_ACCESS_KEY=... \
TO_STORAGE_DRIVER=s3   TO_S3_ENDPOINT=...   TO_S3_BUCKET=...   TO_S3_ACCESS_KEY_ID=...   TO_S3_SECRET_ACCESS_KEY=... \
npm run storage:copy
```
Re-running is safe (files already present are skipped). Then switch the app's `S3_*` variables. On a host with a persistent disk you can also use `STORAGE_DRIVER=local`.

**App** (Render, Railway, Fly.io, a VPS…): any Node.js 20+ host. Build `npm ci && npm run db:migrate && npm run build`, start `npm start` (port from `PORT`, default 3000), copy the environment variables, point the domain's DNS at the new host. If the host has no scheduler, keep the GitHub Actions job (just update its `APP_URL` if it changed).

**Email:** change `SMTP_URL` and `MAIL_FROM`.

**Nothing else is provider-specific.** `vercel.json` is simply ignored elsewhere.
