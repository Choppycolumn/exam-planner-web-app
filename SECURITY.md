# Security notes

## Seat features

The repository contains two separate implementations:

- ExamPlanner's internal `server/modules/seat-assistant-*` provider is read-only.
- The standalone [`seatbot/`](./seatbot) service can create and cancel reservations and
  change check-in state. Its `/seat/` UI and `/seat-api/` API must never be exposed
  without the main application's authenticated `seat_assistant.manage` capability check.

Use `seatbot/scripts/nginx-seatbot.conf.example` as the baseline reverse-proxy policy.
Keep port `8766` bound to loopback, and never commit `config.yaml`, `accounts.json`,
`jobs*.json`, `session*.json`, `bark.env`, or service logs.

### Internal read-only assistant

- The only production provider is the reviewed HUST integration for area `101`. It may issue `GET /v3areadays/101` and `GET /spaces_old` with the fixed query keys; redirects are not followed and no provider exposes `execute` or any reservation/cancellation/locking write path.
- Seat assistant APIs are capability-gated and additionally require an authenticated `owner`/`admin` write session. Visitors, read sessions and learner accounts cannot read Cookie session metadata, profiles, history or observations, and cannot start a refresh.
- Pairing accepts only the configured ExamPlanner origin (`https://8.130.68.9`, with a loopback development exception) and one exact `chrome-extension://` origin. The extension uses a two-step Cookie preview/confirmation flow. Cookie values are not returned in API responses or logs.
- Cookie bundles are validated for the exact HTTPS HUST domain, encrypted at rest with AES-256-GCM using a purpose-separated key derived from `COOKIE_SECRET`, and capped at eight hours and the earliest Cookie expiry. A changed `COOKIE_SECRET` invalidates existing bundles.
- Local and cross-process query throttling uses a persistent atomic claim and a minimum 60-second interval. 403/429, redirects, captcha, login expiry, risk blocks and three consecutive failures stop the scheduler and queue a deduplicated warning. Bark availability notifications are limited to configured seats 17–28 and persist their episode/count state.
- The owner/admin “delete local history” action clears observations, pairings, encrypted sessions, audit records and notification state, marks the session `disconnected`, and requires a new pairing before another read-only query.

Do not commit `COOKIE_SECRET`, `SETTINGS_ENCRYPTION_KEY`, extension IDs used in deployment, pairing codes, Cookie values or production runtime environment files. Do not deploy this change without reviewing the exact extension ID and origin allowlist.
