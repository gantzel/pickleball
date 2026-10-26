# Pickleball København — træningsplatform

Member platform where Pickleball København members book training sessions that match their verified DUPR rating. Member-facing UI is Danish; code and docs are English.

> **DUPR status:** the official DUPR integration is **not active yet** — it needs DUPR partner credentials. The app ships with a provider adapter, a development/demo-only mock provider, and a documented stub for the live provider. See [docs/DUPR_INTEGRATION.md](docs/DUPR_INTEGRATION.md).

## Stack

| Concern | Choice | Why |
| --- | --- | --- |
| App | Next.js 15 (App Router, server actions), React 19, TypeScript | One deployable unit; server-side rendering keeps rules on the server |
| Database | PostgreSQL + Drizzle ORM (pure JS, SQL migrations) | Row locks for safe booking; no native engine to ship |
| Auth | Better Auth (email/password, DB sessions, password reset, DB-backed rate limiting) | Reputable, self-hosted, no vendor lock-in |
| Validation | Zod on every server input | |
| Images | sharp (re-encodes uploads to WebP) | Strips metadata and payloads |
| Styling | Tailwind CSS v4, self-hosted fonts (Bricolage Grotesque, Figtree) | No third-party font requests (GDPR) |
| Tests | Vitest integration tests on real Postgres; Puppeteer e2e smoke test | |

## Quick start (local development)

Requires Node 20+ and PostgreSQL 14+.

```bash
npm install
cp .env.example .env          # then edit: DATABASE_URL, BETTER_AUTH_SECRET
# for local development with fake ratings set: DUPR_PROVIDER="mock" and DUPR_WEBHOOK_SECRET="any-dev-secret"
npm run db:migrate            # apply SQL migrations
npm run db:seed               # optional demo data (refuses to run in production)
npm run dev                   # http://localhost:3000
```

Demo logins after seeding (password `demo-pickleball-2026`): `admin@demo.pbk.local`, `anna@demo.pbk.local` (3.412), `mads@demo.pbk.local` (2.874), `sofie@demo.pbk.local` (3.968).

Without `SMTP_URL`, emails (sign-up verification, password reset, notifications) land in the **dev mailbox at /dev/mail** instead of being sent.

To simulate DUPR locally, open **/dev/mock-dupr**: change a test player's rating or make DUPR fail (server error, rate limit, revoked, no rating), then "Send rating-webhook". This page and its actions return 404 in production unless `DEMO_MODE=true`.

### Scripts

| Command | Does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js |
| `npm run db:generate` | Generate a new SQL migration after editing `src/db/schema.ts` |
| `npm run db:migrate` | Apply migrations (also creates the settings row) |
| `npm run db:seed` | Demo levels, mock players, users and sessions (`is_demo = true`) |
| `npm run admin:grant -- email [--revoke]` | Grant/revoke admin. The only way to create the first admin |
| `npm run tick` | Run background jobs once (offer expiry, due DUPR syncs, retention) |
| `npm run storage:copy` | Copy profile photos between storages (see docs/DEPLOY.md) |
| `npm run lint` / `typecheck` / `test` / `e2e` | Quality checks |

## Environment variables

See [.env.example](.env.example) (placeholders only). Key ones:

- `DATABASE_URL`, `BETTER_AUTH_SECRET` (≥ 32 chars), `APP_URL` — required.
- `DUPR_PROVIDER` — `none` (production default until DUPR access exists), `mock` (dev/demo), `dupr` (live, once implemented).
- `DEMO_MODE=true` — allows the mock provider in a production build and shows a permanent "demo, not real DUPR data" banner. Never set it on the real member site.
- `CRON_SECRET` — bearer token for `/api/cron/tick`.
- `UPLOAD_DIR` — persistent disk for profile photos.
- `SMTP_URL`, `MAIL_FROM` — email delivery; without SMTP, emails are logged (dev) or a warning is logged (prod). In-app notifications always work.

## Authentication & roles

- Email + password (min. 10 characters), DB sessions (30 days, sliding), password reset by emailed link (1 hour, revokes other sessions). Sign-in, sign-up, reset and resend-verification endpoints are rate limited in Postgres.
- **Email verification is required.** Sign-up sends a link (valid 24 hours); the account can't log in until it's clicked. The link signs the member in and lands on `/bekraeftet` → `/profil` to link DUPR. Logging in unverified re-sends the link. Sign-up never reveals whether an email is already registered. Demo-seeded accounts are pre-verified.
- Roles: `MEMBER` and `ADMIN`. The `role` column is not exposed to the auth library, so it can't be set through sign-up or profile updates. Create the first admin with `npm run admin:grant -- email`; after that admins grant/revoke the role under **Admin → Medlemmer → member**. Admins can't change their own role, and the club always keeps at least one admin (enforced with row locks). Every change is audited and the member is notified.
- Every page, server action and API route resolves the user server-side; services take an `actor` and enforce ownership/role themselves. The middleware redirect is only a convenience.
- Account deletion (Profil → Slet konto, password + "SLET" confirmation): removes name, email, photo, credentials, sessions, DUPR link, rating snapshots, notifications and achievements immediately; cancels upcoming bookings (places go to the waitlist); keeps past bookings anonymised for attendance statistics.

## Rules (policies)

All admin-configurable under **Admin → Regler**; changes are audited.

**Club structure (programmes / "hold")**
Every session belongs to a programme, and the programme decides who may book:

| Programme | Type | Access |
| --- | --- | --- |
| Novice | rating level | DUPR under 3.0 (also linked players without a rating yet) |
| Intermediate | rating level | 3.000 – under 3.500 |
| Advanced | rating level | 3.500 – under 4.000 |
| Competition | rating level | 4.000+ |
| Børnehold – Junior Pickleball | roster | members an admin has put on the roster |
| Social Play | open | every member, no DUPR needed (a session may set its own limits) |
| DUPR-events – Rated Play | event | linked DUPR profile + the event's own limits (inclusive) |

Rating levels are half-open `[min, max)` and may not overlap, so every rating maps to exactly one level. Sessions on a rating level take the level's band (never their own limits), so adjusting a band applies to all its sessions at once, and members move between levels automatically as their DUPR rating changes — no manual assessment. Admin → Hold creates this structure with one click ("Opret klubbens hold") and edits it. Training sessions don't record results or affect ratings.

**Membership approval**
New accounts are *pending* until an admin approves them (bylaws § 3: membership is valid once the fee is paid). Pending, ended or lapsed members can browse but not book, join waitlists or accept offers — for themselves or their children — and waitlist offers skip them without losing their place. Admin → Medlemmer lists pending members (admins are notified of each new account) with a one-click "Godkend" that sets the fee as paid through the end of the current half-year; each member page can set the status and an optional "paid through" date, after which booking stops until it is extended. Admins can always book. Demo deployments (`DEMO_MODE=true`) approve new accounts automatically.

**Children**
Children (11–17) have no login. A parent adds them under Profil → Mine børn (name and birth year only) and books on their behalf; each booking/roster entry carries the child, so a parent and several children can hold separate places on the same session. Children can book roster programmes they are on (Børnehold) and open sessions, not rating programmes. Rosters and participant lists show the child's name with the label "Barn" and the parent as contact. Removing a child or deleting the parent's account releases the child's upcoming places and deletes the child's data.

**Eligibility policy**
- Only ratings from the *active* provider count. Mock ratings never count in production.
- A rating is *verified* if the last successful sync is within `staleAfterDays` (default 14). A failed sync inside that window keeps the rating usable, with a warning. After it, the rating is *stale* → "Rating skal verificeres" → cannot book.
- For rating-based access: not linked, no DUPR rating yet (except levels that allow unrated beginners), revoked access, or integration unavailable → cannot book.
- Doubles rating by default (switchable to singles).
- Per-session limits (social, events, sessions without a programme) are inclusive (`min ≤ rating ≤ max`). Sessions without a programme and without limits are open to all members.
- Eligibility is computed from the current verified rating on every read and every booking attempt, so a rating change takes effect immediately.

**Booking & capacity**
- Every booking mutation locks the session row (`SELECT … FOR UPDATE`) in a transaction; held places = confirmed + unexpired offers. A unique `(session_id, user_id)` index makes duplicate bookings impossible.
- Booking windows: optional open time; closes at the optional close time or session start.
- Members can cancel until `cancellationCutoffHours` (default 2) before start.

**Waitlist (fair rule)**
- Only eligible members can join, and only when the session is full.
- When a place frees up it is offered to the **earliest-joined waitlisted member who is currently eligible**. Ineligible members are skipped but keep their position.
- The place is held for `offerWindowHours` (default 12) or until booking closes, whichever is sooner. The member is notified (in-app + email). Unaccepted offers expire (`/api/cron/tick`, and lazily on any booking action for that session) and move to the next in line.

**Rating changes**
- Increase: new sessions unlock immediately; reaching a new level awards a milestone and sends a notification that eligibility ≠ a guaranteed place.
- Decrease below a booked session's range — `ratingDropPolicy`:
  - `KEEP_AND_FLAG` (default): booking kept, flagged for admins, member and admins notified. Flag clears if the rating recovers.
  - `RELEASE_AND_NOTIFY`: booking released to the waitlist, member notified with the reason.
  - Bookings are never cancelled silently. A pending waitlist offer that becomes ineligible returns to the queue.
- Admins editing a session's rating range flag (never cancel) bookings that fall outside.

**Progress & achievements** use only provider-synced ratings and admin-recorded attendance. Rating history starts at link time unless the provider supplies history; nothing is fabricated, and the UI says so.

## Background jobs

Call `/api/cron/tick` every ~5 minutes with `Authorization: Bearer $CRON_SECRET` (any cron service), or run `npm run tick` from system cron. It expires waitlist offers, syncs ratings that are due (respecting backoff and rate limits) and runs the retention cleanup.

## Privacy (GDPR)

- **Privacy policy** at `/privatliv`. Text in [brackets] (legal entity, CVR, contact, processors, date) must be filled in by the club before launch.
- **Data export:** Profil → "Download mine data" (`/api/mig/eksport`) returns the member's own data as JSON: profile, DUPR link, rating history, bookings and attendance, achievements, notifications, sync log, login sessions. No secrets; rate limited.
- **Account deletion:** see Authentication & roles.
- **Data retention** (`src/lib/retention.ts`, shown in the policy, enforced by the tick): DUPR sync log 180 days; read notifications 180 days, all notifications 365 days; admin audit log 2 years; webhook ids 30 days; expired sessions, verification tokens, link requests and rate-limit counters as soon as they expire.
- Before launch: sign data processing agreements with the hosting and email providers.

## Deployment

Step-by-step guide (free setup: Vercel + Neon + Brevo + GitHub Actions, no payment card, your own domain) and how to move each piece to another provider later: **[docs/DEPLOY.md](docs/DEPLOY.md)**.

In short: any Node.js 20+ host works (`npm ci && npm run db:migrate && npm run build && npm start`). Profile photos use `STORAGE_DRIVER=db` (in PostgreSQL; works on serverless hosts), `local` (persistent disk) or `s3` (any S3-compatible bucket). `npm run storage:copy` moves photos between storages; `pg_dump`/`pg_restore` moves the database. `/api/health` reports whether the app can reach its database.

## Testing

```bash
createdb pbk_test            # or set TEST_DATABASE_URL
npm test                     # 73 integration tests against Postgres (schema rebuilt per run)
npm run lint && npm run typecheck && npm run build
# e2e: start the app with the mock provider + seed, then
CHROME_PATH=/path/to/chrome npm run e2e   # desktop + mobile flows, screenshots in e2e/screenshots
```

Coverage of the acceptance criteria:

| # | Criterion | Where |
| --- | --- | --- |
| 1 | Register (with email verification), log in, edit profile, upload photo | `tests/auth-profile.test.ts`, e2e |
| 2 | Member can't set own rating | `tests/dupr.test.ts` ("members cannot set their own rating"), `tests/auth-profile.test.ts`, e2e (no rating input) |
| 3 | Eligible member can book | `tests/booking.test.ts`, e2e |
| 4 | Out-of-range member can't book, even via the API | `tests/booking.test.ts` (calls services directly) |
| 5 | No overbooking under concurrency | `tests/booking.test.ts` (20 concurrent members, 4 places) |
| 6 | No duplicate bookings | `tests/booking.test.ts` (5 concurrent double-clicks) |
| 7 | Waitlist + freed place handling | `tests/booking.test.ts` (offer, accept, skip ineligible, expiry) |
| 8 | Rating up/down updates eligibility | `tests/dupr.test.ts` |
| 9 | Stale / missing / failed / revoked / rate-limited sync | `tests/dupr.test.ts`, `tests/eligibility.test.ts` |
| 10 | Non-admins blocked from admin functions | `tests/admin.test.ts` (every admin service), e2e (/admin redirect) |
| 11 | Admin manages sessions and views booking lists | `tests/admin.test.ts`, e2e |
| 12 | Core flows on mobile and desktop | `e2e/smoke.mjs` (390 px and 1366 px) |
| – | Admin roles, data export, retention | `tests/admin.test.ts`, `tests/privacy.test.ts`, e2e |

## Project layout

```
src/db/schema.ts          data model (single source of truth) → drizzle/*.sql migrations
src/server/               domain services (all rules live here)
  eligibility.ts          pure rating/availability/level rules
  bookings.ts             transactional booking, waitlist offers, cancellations
  rating-effects.ts       consequences of rating changes (flags, releases, milestones)
  dupr/                   provider boundary: provider.ts, mock.ts, partner.ts, sync.ts, link.ts
  sessions.ts admin.ts members.ts progress.ts achievements.ts uploads.ts
src/app/                  routes (Danish slugs), server actions, API routes
src/components/           UI components (rating court, session rows, charts…)
scripts/                  migrate, seed-demo, grant-admin, tick
tests/  e2e/  docs/
```

## Security notes

Server-side validation (Zod) everywhere; parameterised SQL via Drizzle; React escaping (no `dangerouslySetInnerHTML`); server actions are origin-checked by Next.js and the DUPR link route checks `Origin`; webhook signatures are verified and payload ratings ignored; uploads are magic-byte checked, size-limited and re-encoded, served only to logged-in members with `nosniff` and a restrictive CSP; security headers (frame-ancestors none, HSTS, referrer policy); secrets only in env; audit log for admin and system actions; sync log without secrets.
