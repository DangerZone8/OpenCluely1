# Slickly Pro, accounts and credits

This change introduces the server-side foundation. It is deliberately NOT live billing and does not activate Pro until deployment prerequisites and desktop/mobile account flows are completed.

## Free daily credits

The proposed free-tier limits reset at 00:00 UTC:

| Feature | Free daily uses |
|---|---:|
| Screen Aware AI / live screen analysis | 2 |
| Voice AI attempts | 2 |
| Screenshot analysis | 3 |
| Chat messages | 7 |

Each successful server-authorized invocation costs one credit. Failed requests should be refunded only through a server-side, idempotent refund path; clients must never edit balances. The SQL RPC serializes concurrent usage updates per user/feature/day.

Pro limits in this foundation are 60 Screen Aware, 60 Voice, 100 Screenshot and 200 Chat uses per UTC day. These are launch guardrails, not unlimited usage, and should be adjusted after measuring model cost.

## Account identity

Use Supabase Auth for Google OAuth and verified email sign-in. Native desktop integration must use OAuth 2.0 / OIDC Authorization Code + PKCE through the system browser, with a registered slickly:// callback (or a one-time local callback), strict state/nonce validation, and tokens stored in the OS credential vault. Do not put a service-role key in a client or renderer. The current credit API verifies the bearer token against Supabase Auth before it calls the database.

## Supabase setup

1. An eligible adult/business representative creates and owns the Supabase project.
2. Enable Google provider and configure its OAuth client, redirect URI and allowed redirect URLs.
3. Enable email OTP/magic-link sign-in and configure verified email requirements.
4. Apply supabase/migrations/202611140001_slickly_accounts_credits_billing.sql.
5. Add server-only Vercel Production environment variables:
   - SUPABASE_URL
   - SUPABASE_SERVICE_ROLE_KEY (never expose to clients)
6. Deploy and test in a staging Supabase project before production.

## Razorpay sandbox setup

1. The adult/business representative owns the Razorpay account and completes provider onboarding.
2. Create a recurring ₹399 INR/month plan in Razorpay and set its plan ID as RAZORPAY_PRO_PLAN_ID.
3. Set server-only Vercel variables RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET.
4. Configure the webhook URL /api/billing/webhook for subscription lifecycle events.
5. Test activation, renewal, cancellation, failed payment, duplicate delivery and out-of-order delivery in sandbox. Live checkout must remain disabled until legal, tax, privacy, refund and support terms are reviewed.

The checkout endpoint never accepts a client-supplied amount or plan. Entitlements are granted only from a signature-verified webhook. Webhook event IDs are idempotent and older events cannot overwrite newer subscription state.

## API contracts

- POST /api/credits with Authorization: Bearer <Supabase access token> and JSON { "feature": "screen_aware" | "voice" | "screenshot" | "chat" }. The server atomically consumes one daily credit and returns remaining balance or HTTP 429.
- POST /api/billing/checkout with a valid bearer token. Creates a Razorpay subscription checkout URL for the configured Pro plan.
- POST /api/billing/webhook accepts Razorpay's raw signed webhook body. It must be configured with request body parsing disabled so signature verification uses the exact provider bytes.

## Remaining integration before release

- Complete desktop/mobile Google + verified-email sign-in and secure cross-device session restoration.
- Store tokens in OS secure storage; add sign-out, session revocation, account recovery, export and deletion.
- Attach the account access token to every hosted AI request.
- Consume credits before Screen Aware, voice, screenshot and chat operations; prevent direct bypass of the credit gate.
- Add a server-side idempotent credit refund for provider failures/timeouts.
- Add account UI showing daily balances, plan, billing status and subscription management.
- Run real staging integration tests on Windows, macOS, Linux and supported mobile devices.

Until those items pass, the API foundation should not be advertised as a complete sign-in or paid product.