# DUPR integration — status and next steps

**Status (October 2026): the live DUPR integration is not active.** The platform runs against a provider adapter. A development/demo-only mock provider is implemented and tested; the official DUPR provider is a documented stub that reports itself as not ready.

No part of the app scrapes DUPR, asks for a member's DUPR password, or accepts a typed-in rating or DUPR ID.

## What DUPR offers (researched October 2026)

- DUPR runs a **partner API** authenticated with a **client key + client secret** exchanged for a bearer token.
- Environments: **UAT** `https://uat.mydupr.com/api` and **production** `https://api.dupr.com/api`. A Swagger UI exists for UAT (`/api/swagger-ui/index.html`).
- Capabilities relevant here: rating lookup by DUPR ID, rating history (paged), and **webhook subscriptions for the `RATING` topic**.
- Club platforms (e.g. CourtReserve, Playbypoint, pickleball.com) let members "Connect DUPR": the member logs in on DUPR's side and approves a session. That partner login/consent flow is **only documented to approved partners**.
- DUPR's club resources describe API access through **integrated API partners**; credentials are issued by DUPR, not self-service.

Sources: DUPR club resources (dupr.com/club-resources-new), a community PHP client for the partner API (github.com/Info-Esportes/dupr-partner-api) describing auth, environments and endpoints, Playbypoint and pickleball.com help articles on linking DUPR.

## Club status (25 Oct 2026)

- The club exists on DUPR: **Pickleball Denmark**, Copenhagen, club ID **4826145949** (dashboard.dupr.com/dashboard/browse/clubs/4826145949). Director: Rikke Flygenring Gantzel.
- A DUPR club gives a member roster, leaderboard, match upload (manual/CSV) and use of DUPR's *existing* integrated software partners. It does **not** by itself issue API credentials to the club's own software.
- DUPR's club team: **clubs@mydupr.com** (support: support@mydupr.com). This is the route to request partner/API access, quoting the club ID.
- From a public open-source integration (GitHub, relandpigte/sports-booking PR #51): partner credentials need DUPR's `USER::DETAIL` permission; DUPR provides a per-client-key **consent page URL** ("SSO URL") that opens in a popup and reports the member's DUPR ID back (postMessage); ratings are then fetched server-side by DUPR ID with the client key/secret, and DUPR only returns players who consented. Ask DUPR to confirm the exact flow.

## Automatic level access — what it needs from DUPR (Oct 2026)

The club structure (Level 1–3 and Kamphold, see README) moves members between levels automatically, so the app needs each member's *current* rating reliably. The app already refreshes a rating in three ways, so the question for DUPR is which of them partners may use and how often:

| Mechanism | In the app | Ask DUPR |
| --- | --- | --- |
| Webhook (`RATING` topic) | `/api/dupr/webhook` → re-fetch that member's rating at once | Is the RATING webhook available to us? Signature scheme? Typical delay after a match is processed? |
| Scheduled refresh | background job, every `syncIntervalHours` (default 24 h) per member | Rate limits per client key — is a daily (or hourly) refresh of every linked member acceptable? |
| Member's "Synkronisér nu" | rate-limited per member | Same rate limits |

A rating older than `staleAfterDays` (default 14) stops counting until refreshed, so a broken connection never leaves members on the wrong level indefinitely. Ratings change only when DUPR processes new matches; training sessions never affect them.

Also ask: whether partners receive the doubles and singles rating and a reliability/provisional indicator (useful to decide how new players enter Level 1), and the terms for storing rating history.

## What Copenhagen Pickleball Collective needs to do

1. Contact DUPR (partnerships / club team) and request partner API access for a club training platform. Ask specifically for:
   - client key/secret for **UAT** first, then production;
   - documentation of the **member SSO / "Connect DUPR" flow** (authorize URL, callback parameters, how to obtain the verified DUPR ID);
   - rating endpoints (doubles + singles), rating history endpoint, rate limits;
   - webhook registration for `RATING` and the **webhook signature scheme**;
   - terms: permitted data storage/retention and display of ratings.
2. Confirm whether DUPR requires the club to be a registered DUPR club, and any commercial terms.

## How to enable it in code

All changes are confined to `src/server/dupr/partner.ts`:

| Method | Implement |
| --- | --- |
| `authorizeUrl` | Build DUPR's partner SSO URL with `state` and `redirectUri` (`$APP_URL/api/dupr/callback`). |
| `completeLink` | Exchange callback params for the verified DUPR ID + display name. |
| `getRating` | Cached token from key/secret; fetch doubles/singles. Map 429 → `RATE_LIMITED` (with `Retry-After`), revoked consent → `REVOKED`, 404 → `NOT_FOUND`. |
| `getHistory` | Page the history endpoint (optional — imported once at link time as `PROVIDER_HISTORY`). |
| `parseWebhook` | Verify DUPR's signature with `DUPR_WEBHOOK_SECRET`; return the event id and DUPR IDs. Ratings are always re-fetched, never read from the payload. |
| `revoke` (optional) | Tell DUPR the member unlinked. |

Then set `IMPLEMENTED = true`, configure `DUPR_PROVIDER=dupr`, `DUPR_API_BASE_URL`, `DUPR_CLIENT_KEY`, `DUPR_CLIENT_SECRET`, `DUPR_WEBHOOK_SECRET`, register the webhook URL `$APP_URL/api/dupr/webhook` with DUPR, and test against UAT before switching to production. Add tests that stub DUPR's HTTP responses (see `tests/dupr.test.ts` for the behaviours each method must satisfy).

## Behaviour already in place (provider-independent)

- Linking uses a single-use, 10-minute `state` bound to the logged-in member; one DUPR profile can only be linked to one account.
- Ratings are refreshed by webhook, by the scheduled job (`/api/cron/tick`, default every 24 h per member), and by the member's rate-limited "Synkronisér nu".
- Failures back off exponentially (1 h → 24 h); rate limits defer the next attempt without marking the link failed; revoked access marks the link `REVOKED` and notifies the member.
- Every attempt is written to `dupr_sync_log`; every observed rating change to `rating_snapshot`.
- Mock-provider data (`provider = MOCK`) never counts for eligibility unless the mock provider is the active provider, which is impossible in production without `DEMO_MODE=true`. Switching to the live provider therefore makes all mock links show as "not verifiable" until members link their real DUPR profile.
