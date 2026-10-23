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

## What Pickleball København needs to do

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
