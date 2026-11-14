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
## Referral and discount-code administration

The second migration, `supabase/migrations/202611140002_slickly_referral_codes.sql`, creates the referral code and redemption tables. Apply it after the accounts/credits migration.

An authorised adult/business account administrator can manage codes from the account portal at `/account.html`. Configure the server-only Vercel environment variable `SLICKLY_REFERRAL_ADMIN_EMAILS` as a comma-separated allowlist of administrator email addresses. Only those verified Supabase accounts can view or change codes. Do not put this list or any payment credentials in client-side code.

The admin page supports:
- percentage discounts from 1% to 90%, or fixed discounts from ₹1 to ₹398;
- optional maximum redemption count and expiry date;
- enabling/disabling existing codes;
- redemption counts and the resulting recurring monthly Pro price.

Each code creates a Razorpay monthly plan at the discounted price. Razorpay plans are immutable, so changing a code's discount means disabling the old code and creating a new one. The discount applies to every recurring cycle of that subscription. A code can be used once per customer account; a customer cannot stack codes. Referral discounts are only effective after the verified subscription webhook confirms activation.

This is still a staging implementation until an adult/business representative configures the Supabase and Razorpay projects, applies both migrations, configures the admin allowlist and webhook, and completes sandbox tests. The account portal and referral endpoints must be deployed together.

## Slickly Cloud Admin

The admin dashboard is served at `/admin` (the static source is `web/admin.html`). It requires a verified Supabase account whose email appears in the server-side `SLICKLY_ADMIN_EMAILS` allowlist. The referral manager also accepts `SLICKLY_REFERRAL_ADMIN_EMAILS`; keep these allowlists server-side and restrict them to authorised adult/business operators.

Apply the third migration after the accounts and referral migrations:
3. `supabase/migrations/202611140003_slickly_cloud_config.sql`

The dashboard stores a validated cloud configuration snapshot in `slickly_cloud_config`. Compatible desktop clients already poll `/api/cloud-config`; changes to feature flags, rollout percentage, minimum supported version, polling interval and announcements therefore propagate without reinstalling. This is declarative configuration only: it does not download or execute arbitrary JavaScript/native code. Desktop binary releases continue through electron-updater and the GitHub release feed.

Automated offline checks include `scripts/test-slickly-cloud-admin.js` and `scripts/test-slickly-referral-e2e.js`. The referral E2E test simulates code creation, price-plan creation, customer validation, checkout reservation and a signed activation webhook against mocked provider/database responses. It is not a live Razorpay/Supabase sandbox test; real sandbox credentials and the three applied migrations are still required before enabling production billing.

The requested hostname `admin.vercel.app` is not a path this repository can claim or provision. The admin page is deployed with the Slickly project at `https://slicklyai.vercel.app/admin`. A custom hostname requires a domain owned/verified by the Vercel team and DNS configuration.

## Desktop Pro integration status

The desktop Settings window now opens the trusted Slickly Account page in a dedicated Electron window with a minimal preload bridge. After sign-in, the account page sends the Supabase session to the main process; the desktop encrypts the refresh token/session with Electron safeStorage in the OS user-data directory and refreshes access tokens server-side from the main process. Sign-out clears that encrypted session. The account page only syncs a desktop session when opened from the desktop app.

The desktop LLM service now requests an atomic account credit before invoking hosted Gemini or configured BYOK providers. Request classification is: typed chat → `chat`, audio payload → `voice`, live screen/image analysis → `screen_aware`, screenshot hotkey workflow → `screenshot`. Provider connection checks do not consume credits. The credit gate is applied at the common request methods so local/BYOK provider paths are metered too. A signed-in account is required in packaged desktop builds.

The account page supports scheduling Razorpay Pro cancellation at the end of the current billing period. Entitlement remains active until the provider webhook updates the subscription status.

Offline regression coverage now includes:
- `scripts/test-slickly-desktop-account.js` for trusted desktop account handoff, encrypted storage, refresh-token plumbing and feature credit gating;
- `scripts/test-slickly-cloud-admin.js` for admin allowlisting, config validation and propagation;
- `scripts/test-slickly-referral-e2e.js` for the mocked referral-to-activation journey.

These are code-level/mock tests. They do not replace a live staging run with the real Supabase schema, Google OAuth configuration, Razorpay test credentials, webhook delivery and installed desktop builds. Do not enable live checkout until an authorised adult/business operator has completed those checks.
