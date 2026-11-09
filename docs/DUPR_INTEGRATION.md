# DUPR integration — status and next steps

**Status (6 November 2026):** DUPR has approved Pickleball Denmark as a partner and issued **UAT (test) keys**. The official provider is implemented (`src/server/dupr/partner.ts`) against DUPR's partner docs (dupr.gitbook.io/dupr-raas) and OpenAPI specs, and tested with stubbed DUPR responses. It has **not yet been run against DUPR's real UAT servers**: that happens once the keys are set on a deployment (below). Production keys come after DUPR's integration review.

No part of the app scrapes DUPR, asks for a member's DUPR password, or accepts a typed-in rating or DUPR ID.

## How it works

| Step | DUPR API | In the app |
| --- | --- | --- |
| Partner token | `POST {partner}/auth/v1.0/token`, header `x-authorization: base64(clientKey:clientSecret)`; valid ~1 h | cached in memory, refreshed on 401 |
| Member login (SSO) | iframe `{sso}/login-external-app/{base64(clientKey)}`; DUPR posts `userToken`, `refreshToken`, `duprId` to the parent window | `/dupr/forbind` hosts the frame, accepts messages only from DUPR's origin, posts them to `/api/dupr/callback` with the single-use `state` |
| Identity check | `GET {public}/public/user/info` with the member's token | the linked DUPR ID is the one DUPR returns, never the posted one |
| User gating | `POST {public}/subscription/active`; `BASIC_L1` required | checked at link time and again at most every 24 h (refresh rotates both tokens). No `BASIC_L1` → status `RESTRICTED`: rated sessions and DUPR events blocked, open sessions allowed |
| Rating | `GET {partner}/user/v1.0/{duprId}`; ratings are strings, `"NR"` = not rated | daily scheduled sync, member's "Synkronisér nu", webhooks |
| Rating webhook | `POST {partner}/v1.0/webhook` (register), `POST/DELETE {partner}/user/v1.0/subscribe/webhook-event` (per member) | Admin › DUPR-synk › "Registrér webhook hos DUPR"; members are subscribed on link and unsubscribed on unlink |

Hosts: UAT partner `https://uat.mydupr.com/api`, public `https://api.uat.dupr.gg`, SSO `https://uat.dupr.gg`. Production partner `https://prod.mydupr.com/api`, public `https://api.dupr.gg`, SSO `https://dashboard.dupr.com`. Chosen by `DUPR_ENV`.

**Webhooks are not signed by DUPR.** The URL we register carries our own secret as its last path segment (`/api/dupr/webhook/<DUPR_WEBHOOK_SECRET>`; `?key=` also works), answers DUPR’s registration handshake (GET or POST) with 200, webhooks for another `clientId` are rejected, and the rating in the payload is never used: it only tells us whose rating to fetch again.

Member tokens are read-only and stored AES-256-GCM encrypted (`src/lib/secretbox.ts`, key derived from `BETTER_AUTH_SECRET`). Our own failing keys never revoke members (401 on partner calls → retry later); a 403 on a member's rating, or dead member tokens, mark the link `REVOKED` and ask the member to connect again.

## Configuration (Vercel → Settings → Environment Variables)

| Variable | Value |
| --- | --- |
| `DUPR_PROVIDER` | `dupr` |
| `DUPR_ENV` | `uat` now; `production` with production keys |
| `DUPR_CLIENT_ID` | from DUPR |
| `DUPR_CLIENT_KEY` | from DUPR |
| `DUPR_CLIENT_SECRET` | from DUPR (mark as Sensitive) |
| `DUPR_WEBHOOK_SECRET` | a long random string (mark as Sensitive) |
| `SUPPORT_EMAIL` | the club's support mailbox, shown on `/kontakt` |

Then redeploy, and as admin press **Registrér webhook hos DUPR** under Admin › DUPR-synk.

Switching from mock to live makes mock links show as "not verifiable" until members link their real DUPR profile. UAT accounts exist only in UAT: real members can link only after the switch to production keys.

## DUPR requirements checklist (for the review)

- [x] SSO login is the only way to connect; no manual DUPR ID entry.
- [x] DUPR rating shown on the profile and kept updated (webhooks + daily sync).
- [x] User gating on `BASIC_L1`, cached at most 24 h.
- [x] Support contact for members: `/kontakt`, linked in the footer and the DUPR section of the profile.
- [ ] Match upload: not used (training platform, no match results).
- [ ] Club integration: not used yet.
- [ ] Tested end to end on UAT with DUPR's 4 test accounts.
- [ ] Review request to tech@mydupr.com (Client ID in the subject): platform URL, test accounts, compliance summary with test steps. Review takes up to 10 business days.

## Club

DUPR club **Pickleball Denmark**, Copenhagen, club ID **4826145949**. DUPR contacts: tech@mydupr.com (API), clubs@mydupr.com, support@mydupr.com.
