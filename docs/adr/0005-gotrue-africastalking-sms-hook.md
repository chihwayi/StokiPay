# ADR 0005 — GoTrue phone/OTP via a custom Africa's Talking Send SMS hook

## Status

`accepted` (design only — implementation is Sprint 1 scope)

## Context

ADR 0001 confirmed Africa's Talking as the SMS provider for phone/OTP auth, reusing the vendor already locked in for SMS fallback. `docs/runbooks/coolify-deployment.md` requires this integration path to be recorded (provider-validated approach or a custom-hook ADR) before Sprint 0 can exit.

The self-hosted Supabase stack deployed to Coolify (service `stockflow-zw-supabase`, `o11niv82f82abmmfm95kvy76`) uses `supabase/gotrue:v2.186.0`. Inspecting its deployed environment variables (`GET /services/{uuid}/envs`) confirms `ENABLE_PHONE_SIGNUP=true` is already set by Coolify's one-click template, but **no built-in SMS provider variables exist** (no `GOTRUE_SMS_PROVIDER`, `GOTRUE_SMS_TWILIO_*`, etc.) — the template ships phone signup enabled but no SMS backend wired. GoTrue's built-in SMS provider list (Twilio, Twilio Verify, MessageBird, Vonage/Nexmo, TextLocal) does **not** include Africa's Talking natively.

The template also currently has `ENABLE_PHONE_AUTOCONFIRM=true`, which auto-confirms phone signups **without** sending or verifying an OTP at all — this is a placeholder/insecure default that must not be treated as "OTP configured." It must be set to `false` once a real SMS path exists, or every account is unverified by construction.

## Options considered

1. **Use a GoTrue built-in provider as a relay, e.g. proxy through Twilio.** Defeats the purpose of standardizing on Africa's Talking (ADR 0001); adds a second SMS vendor and cost.
2. **GoTrue custom Send SMS Hook** — GoTrue supports an HTTP (or Postgres function) hook invoked at the moment it needs to send an OTP, letting the hook's own logic call any SMS API. Keeps GoTrue as the auth/session/JWT authority while delegating only "how do we actually send this text" to code we control.
3. **Bypass GoTrue's phone flow entirely and hand-roll OTP generation/storage/verification.** Throws away GoTrue's session, JWT and rate-limiting machinery for the sake of one provider swap — much larger surface to get right and audit ourselves.

## Decision

Adopt option 2: implement a GoTrue **Send SMS Hook** (HTTP hook, per Supabase/GoTrue's Auth Hooks mechanism) that GoTrue calls whenever it needs to deliver an OTP to a phone number. The hook is a small server-side handler in `lib/integrations/` (per `docs/architecture.md`'s provider-adapter boundary) that:

1. Receives the phone number and OTP code/token from GoTrue's hook payload.
2. Calls the Africa's Talking SMS API to send the OTP message.
3. Returns success/failure to GoTrue in the expected hook response shape so GoTrue can decide whether to report the OTP request as sent.

This is implemented and wired (hook URL registered on the GoTrue container's environment, `ENABLE_PHONE_AUTOCONFIRM` flipped to `false`, Africa's Talking sandbox credentials added to Coolify-managed secrets) in **Sprint 1**, which owns the auth implementation. This ADR only fixes the *design*, so Sprint 0's runbook requirement ("provider-validated GoTrue/Africa's Talking OTP approach... or record the chosen design in an ADR") is met without doing Sprint 1's work early.

## Consequences

- **Positive:** GoTrue remains the single source of truth for sessions/JWTs/rate-limiting; Africa's Talking integration is isolated to one small adapter, consistent with `lib/integrations/`'s isolation rule; no second SMS vendor needed.
- **Costs/risks:** Custom hooks are less battle-tested than GoTrue's built-in providers — the hook adapter itself needs its own error handling, retry/idempotency consideration (a dropped hook response must not silently leave a user unable to receive an OTP), and a sandbox-tested transcript before any real number is used, per the runbook's "Do not proceed if... the authentication SMS path is assumed rather than sandbox-tested" rule.
- **Migration or verification needed:** Sprint 1 must: implement the hook handler and register it on the GoTrue service config; set `ENABLE_PHONE_AUTOCONFIRM=false`; add Africa's Talking sandbox credentials as Coolify-managed secrets (never committed); produce a sandbox OTP send/verify transcript as evidence before this path is considered live, per `docs/runbooks/coolify-deployment.md`'s required evidence list.
