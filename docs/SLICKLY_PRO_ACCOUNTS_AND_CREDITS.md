# Slickly Pro, accounts and credits

This change introduces the server-side foundation. It is deliberately NOT live billing and does not activate Pro until deployment prerequisites and desktop/mobile account flows are completed.

## Free daily credits

The Free-tier limits reset at 00:00 UTC:

| Feature | Free daily requests |
|---|---:|
| Screen Aware AI / live screen analysis | 2 |
| Voice AI attempts | 2 |
| Screenshot analysis | 3 |
| Chat messages | 7 |

Each authenticated invocation consumes one daily feature credit. Credits are reserved before the AI request, so a failed provider request can currently consume a credit; do not advertise automatic refunds.

## Pro ₹399/month fair-use credits

Pro uses daily burst ceilings plus one shared, atomic monthly credit balance:

| Feature | Pro daily request ceiling | Monthly credits per request |
|---|---:|---:|
| Screen-aware AI | 20 | 3 |
| Voice | 6 | 4 |
| Screenshot | 10 | 3 |
| Chat | 40 | 1 |

Every Pro account receives **1,500 weighted AI credits per calendar month**. All four features draw from the same allowance; reaching the monthly allowance pauses hosted AI until the next month. The database transaction locks the monthly and daily rows and increments both atomically. The client cannot select the feature weight or monthly allowance. The new migration is `supabase/migrations/202611180001_slickly_monthly_pro_budget.sql`; apply it after the existing accounts/credits, referral and cloud-config migrations.

These are conservative request weights, not exact token-dollar billing. The hosted Gemini 3.1 Flash-Lite paid standard price is currently listed by Google as $0.25/1M text/image/video input tokens, $0.50/1M audio input tokens and $1.50/1M output tokens. Real costs depend on prompt history, media resolution/duration, output and retries. The 1,500-credit cap is a cost-control guardrail, not a guarantee of profit. Keep billing disabled until actual staging usage, provider invoices, tax treatment, payment fees, hosting and support costs are measured. Review `docs/SLICKLY_PRO_399_PROFITABILITY_AUDIT.md` before enabling paid subscriptions.

## Account identity and sign-in

The account page supports:
- Google OAuth using Supabase Authorization Code + PKCE;
- email/password sign-in and account creation (magic-link sign-in is removed);
- desktop Google OAuth in the system browser, returning to the desktop app through `slickly://auth/callback`;
- encrypted desktop refresh-token storage and single-owner refresh in the Electron main process.

**No verification email:** in the Supabase project, open **Authentication → Providers → Email** and turn **Confirm email** off. Keep the Email provider enabled. New email/password accounts then sign in immediately rather than waiting for a confirmation link. This also means the email address is not proven to belong to the user; do not treat an unverified email as strong identity proof or rely on it for sensitive account recovery. Google sign-in remains a separate OAuth identity check.

## Supabase and Google setup

An authorised project owner should complete these settings:

1. In Supabase, open **Project Settings → API**. Copy the Project URL and the public anon/publishable key.
2. In Vercel, set these Production environment variables:
   - `SUPABASE_URL` — Supabase Project URL.
   - `SUPABASE_ANON_KEY` — public anon/publishable key; this is returned to the browser by `/api/public-config`.
   - `SUPABASE_SERVICE_ROLE_KEY` — server-only secret; never expose it to the browser, desktop renderer, repository or chat.
3. In Supabase, open **Authentication → URL Configuration**:
   - Site URL: `https://slicklyai.vercel.app`.
   - Add redirect URL: `https://slicklyai.vercel.app/**`.
   - Add redirect URL: `slickly://auth/callback` for desktop Google OAuth.
4. In Google Cloud Console, configure the OAuth consent screen (request only the basic OpenID, email and profile identity scopes; add your account as a test user while the app is in testing), then create an OAuth Client ID of type **Web application**. Under **Authorised redirect URIs**, add the exact Supabase callback shown in **Supabase → Authentication → Providers → Google**. It has the form `https://<your-project-ref>.supabase.co/auth/v1/callback`. Do not use the Slickly website URL as Google's redirect URI.
5. Copy the Google OAuth Client ID and Client Secret into the Supabase Google provider settings and enable the provider. Save the changes.
6. In Supabase **Authentication → Providers → Email**, keep Email enabled and turn **Confirm email** off to avoid verification emails for password sign-up.
7. Apply the database migrations in order: `202611140001_slickly_accounts_credits_billing.sql`, `202611140002_slickly_referral_codes.sql`, `202611140003_slickly_cloud_config.sql`, then `202611180001_slickly_monthly_pro_budget.sql`, then `202611180002_slickly_provider_usage_telemetry.sql`.
8. Redeploy the Vercel project after adding environment variables. Open `https://slicklyai.vercel.app/api/public-config`; it should return the Supabase URL and public key (never the service-role key), not HTTP 503.
9. Test email/password sign-up, sign-in, browser Google sign-in, and desktop Google sign-in in a staging project before using production accounts.

The Google OAuth redirect URI at Google must be the Supabase callback URL. The Slickly site and desktop custom-scheme URLs belong in Supabase's redirect allowlist. Native desktop sign-in uses PKCE; do not put a service-role key in any client or renderer. The credit API verifies each bearer token against Supabase Auth before calling the database.

## Razorpay sandbox setup

1. The adult/business representative owns the Razorpay account and completes provider onboarding.
2. Create a recurring ₹399 INR/month plan in Razorpay and set its plan ID as RAZORPAY_PRO_PLAN_ID.
3. Set server-only Vercel variables RAZORPAY_KEY_ID, RAZORPAY_KEY_SECRET, and RAZORPAY_WEBHOOK_SECRET.
4. Configure the webhook URL /api/billing/webhook for subscription lifecycle events.
5. Test activation, renewal, cancellation, failed payment, duplicate delivery and out-of-order delivery in sandbox. Live checkout must remain disabled until legal, tax, privacy, refund and support terms are reviewed.
6. From a protected operator environment, run `npm run test:razorpay-sandbox` with Razorpay **test-mode** `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET` and `RAZORPAY_PRO_PLAN_ID`. This read-only check verifies API authentication and that the plan is ₹399 INR/month; it does not create a subscription or charge a customer. It refuses non-test key IDs. Do not place credentials in source control, chat, or client-side settings.

The checkout endpoint never accepts a client-supplied amount or plan. Entitlements are granted only from a signature-verified webhook. Webhook event IDs are idempotent and older events cannot overwrite newer subscription state.

## API contracts

- POST /api/credits with Authorization: Bearer <Supabase access token> and JSON { "feature": "screen_aware" | "voice" | "screenshot" | "chat" }. The server atomically consumes one daily credit and returns remaining balance or HTTP 429.
- POST /api/billing/checkout with a valid bearer token. Creates a Razorpay subscription checkout URL for the configured Pro plan.
- POST /api/billing/webhook accepts Razorpay's raw signed webhook body. It must be configured with request body parsing disabled so signature verification uses the exact provider bytes.

## Remaining integration before release

- An authorised project owner must add `SUPABASE_URL`, either `SUPABASE_ANON_KEY` or `SUPABASE_PUBLISHABLE_KEY`, and server-only `SUPABASE_SERVICE_ROLE_KEY` to the Slickly Vercel project.
- Configure Supabase Email confirmation off and complete Google OAuth provider setup and redirect allowlisting as described above.
- Apply the monthly Pro budget and provider-usage telemetry migrations after the existing account, referral and cloud-config migrations.
- Complete live Google OAuth tests in the browser and installed desktop app using the project owner's OAuth credentials.
- Mobile-native account integration remains deferred; this branch covers the shared website account and desktop app.
- Implement idempotent credit refunds for hosted provider failures/timeouts; successful Gemini token counts are now stored by account and feature without retaining prompt or media content.
- Complete live staging verification of hosted AI authorization and monthly usage enforcement against direct API requests.
- Run real staging tests for sign-up/sign-in, refresh, sign-out, subscription activation/renewal/cancellation and monthly budget concurrency.

Do not advertise Pro as a complete paid product until the staging gates pass. Live Razorpay billing remains disabled.

## Referral and discount-code administration

The second migration, `supabase/migrations/202611140002_slickly_referral_codes.sql`, creates the referral code and redemption tables. Apply it after the accounts/credits migration.

An authorised adult/business account administrator can manage codes from the account portal at `/account.html`. Configure the server-only Vercel environment variable `SLICKLY_REFERRAL_ADMIN_EMAILS` as a comma-separated allowlist of administrator email addresses. Only accounts with a Google OAuth identity and an email on this allowlist can view or change codes. Email/password accounts cannot administer discounts because email confirmation is disabled for ordinary sign-up. Do not put this list or any payment credentials in client-side code.

The admin page supports:
- percentage discounts from 1% to 90%, or fixed discounts from ₹1 to ₹398;
- optional maximum redemption count and expiry date;
- enabling/disabling existing codes;
- redemption counts and the resulting recurring monthly Pro price.

Each code creates a Razorpay monthly plan at the discounted price. Razorpay plans are immutable, so changing a code's discount means disabling the old code and creating a new one. The discount applies to every recurring cycle of that subscription. A code can be used once per customer account; a customer cannot stack codes. Referral discounts are only effective after the verified subscription webhook confirms activation.

This is still a staging implementation until an adult/business representative configures the Supabase and Razorpay projects, applies both migrations, configures the admin allowlist and webhook, and completes sandbox tests. The account portal and referral endpoints must be deployed together.

## Slickly Cloud Admin

The admin dashboard is served at `/admin` (the static source is `web/admin.html`). It requires a Google-authenticated Supabase account whose email appears in the server-side `SLICKLY_ADMIN_EMAILS` allowlist. Email/password-only accounts are deliberately not trusted for admin access because email confirmation is disabled. The referral manager also accepts `SLICKLY_REFERRAL_ADMIN_EMAILS`; keep these allowlists server-side and restrict them to authorised adult/business operators.

Apply the third migration after the accounts and referral migrations:
3. `supabase/migrations/202611140003_slickly_cloud_config.sql`

The dashboard stores a validated cloud configuration snapshot in `slickly_cloud_config`. Compatible desktop clients already poll `/api/cloud-config`; changes to feature flags, rollout percentage, minimum supported version, polling interval and announcements therefore propagate without reinstalling. This is declarative configuration only: it does not download or execute arbitrary JavaScript/native code. Desktop binary releases continue through electron-updater and the GitHub release feed.

Automated offline checks include `scripts/test-slickly-cloud-admin.js` and `scripts/test-slickly-referral-e2e.js`. The referral E2E test simulates code creation, price-plan creation, customer validation, checkout reservation and a signed activation webhook against mocked provider/database responses. It is not a live Razorpay/Supabase sandbox test; real sandbox credentials and the three applied migrations are still required before enabling production billing.

The requested hostname `admin.vercel.app` is not a path this repository can claim or provision. The admin page is deployed with the Slickly project at `https://slicklyai.vercel.app/admin`. A custom hostname requires a domain owned/verified by the Vercel team and DNS configuration.

## Desktop Pro integration status

The desktop Settings window now opens the trusted Slickly Account page in a dedicated Electron window with a minimal preload bridge. After sign-in, the account page sends the Supabase session to the main process; the desktop encrypts the refresh token/session with Electron safeStorage in the OS user-data directory and refreshes access tokens server-side from the main process. Sign-out clears that encrypted session. The account page only syncs a desktop session when opened from the desktop app. In desktop mode, the embedded Supabase client has automatic refresh disabled: the Electron main process is the single owner of refresh-token rotation. The trusted account preload exposes only a fresh access-token request; account API calls obtain the current token through that IPC bridge. Concurrent AI requests share one in-flight refresh, rotated refresh tokens are atomically persisted, transient network/Auth failures retain the encrypted session, confirmed invalid-refresh responses clear it, and sign-out wins over any refresh already in flight. Regular browser sessions continue using Supabase's normal client refresh.

Hosted Gemini independently authenticates the Supabase access token and reserves credits atomically on the server before provider execution. Local/BYOK provider requests continue to reserve through the account credit API. Request classification is: typed chat → `chat`, audio payload → `voice`, live screen/image analysis → `screen_aware`, screenshot hotkey workflow → `screenshot`. All image requests are charged at 3 monthly credits, including live screen frames, to avoid client-side under-reporting. Provider connection checks do not consume credits. The credit gate is applied at the common request methods so local/BYOK provider paths are metered too. A signed-in account is required in packaged desktop builds.

The account page supports scheduling Razorpay Pro cancellation at the end of the current billing period. Entitlement remains active until the provider webhook updates the subscription status.

Offline regression coverage now includes:
- `scripts/test-slickly-desktop-account.js` for trusted desktop account handoff, encrypted storage, refresh-token plumbing and feature credit gating;
- `scripts/test-slickly-cloud-admin.js` for admin allowlisting, config validation and propagation;
- `scripts/test-slickly-referral-e2e.js` for the mocked referral-to-activation journey.

These are code-level/mock tests. They do not replace a live staging run with the real Supabase schema, Google OAuth configuration, Razorpay test credentials, webhook delivery and installed desktop builds. Do not enable live checkout until an authorised adult/business operator has completed those checks.

## Payment methods and payout settlement

Razorpay Subscription payment methods are controlled in the merchant dashboard under **Subscriptions → Settings**. Depending on account activation, supported geography, bank and UPI eligibility, the merchant can enable Cards, UPI Autopay and eMandate (eNACH / netbanking). The hosted subscription checkout displays only methods enabled and eligible for that account; the app must not promise that every customer will see every method. Google Pay is accessed as a supported UPI app where UPI Autopay is available and enabled; it is not a separate card processor.

An authorised adult/business representative must complete merchant KYC and register/verify the business bank account in Razorpay's merchant dashboard. This repository cannot securely link a bank account or complete KYC through the public subscription API. After sandbox tests, verify settlement status and the destination account in the merchant dashboard before enabling live billing. Never put bank account details, Razorpay secrets, or Supabase service-role keys in source control or chat.

## Premium model routing and provider evaluation

The desktop BYOK adapter supports:
- Alibaba Cloud Model Studio (Qwen) OpenAI-compatible endpoint: `QWENCLOUD_API_KEY`, optional `QWENCLOUD_BASE_URL` (defaults to the official Singapore DashScope endpoint `https://dashscope-intl.aliyuncs.com/compatible-mode/v1`; a workspace-specific endpoint may be configured for production), `QWENCLOUD_MODEL` (default `qwen3.8-max`). The API key and endpoint must belong to the same region. Qwen3.8-Max supports image/video understanding on supported Model Studio regions.
- Direct Moonshot Kimi API: `MOONSHOT_API_KEY`, optional `MOONSHOT_BASE_URL` (default `https://api.moonshot.ai/v1`), `MOONSHOT_MODEL` (default `kimi-k3`; `kimi-k2.6` is another documented multimodal option).
- Direct DeepSeek API: `DEEPSEEK_API_KEY`, `DEEPSEEK_MODEL` (default `deepseek-flash`).

Use QwenCloud pay-as-you-go keys for a custom application backend. Some QwenCloud Token Plan credentials are restricted to approved programming tools and must not be used by a custom app. Provider model IDs and regions change; verify availability and pricing in the provider console before configuration.

These adapters preserve image payloads for vision-capable models. Raw audio is not universally supported; Slickly's speech recognition/transcription pipeline remains separate. The adapters add a system-level instruction boundary against prompt injection, but this is defense-in-depth, not a guarantee that jailbreaks cannot succeed.

## Pro readiness gates

Do not advertise Pro quotas as guaranteed capacity until:
1. Provider benchmarks measure task success, screenshot understanding, latency, token cost and reliability for representative Free/Pro workflows.
2. Jailbreak/prompt-injection regression tests cover text, screenshots and document content.
3. Server-side durable usage accounting and provider spend limits are verified under concurrency.
4. Razorpay sandbox subscriptions, webhook signatures/idempotency, cancellations and settlement reconciliation pass.
5. The adult/business merchant owner confirms live KYC, payout-bank verification, applicable tax/refund/privacy/support terms and production environment configuration.

The repository tests can verify implementation and mocked integrations. They cannot independently verify a merchant's bank account, complete KYC, or prove real-world model quality without authorised provider credentials and representative test data.
## Hosted model selection (server-side)

Free accounts remain on the economical Gemini route. Pro accounts can use a separate premium model route. Set `SLICKLY_PRO_HOSTED_AI_PROVIDER=qwencloud` (default), `deepseek`, or `kimi` in Vercel Production and add the matching server-only key: `SLICKLY_QWENCLOUD_API_KEY`, `SLICKLY_DEEPSEEK_API_KEY`, or `SLICKLY_MOONSHOT_API_KEY`. If no premium key is configured, Pro safely falls back to Gemini. An explicit `SLICKLY_HOSTED_AI_PROVIDER` still overrides routing for controlled testing. Premium model quality and availability must be verified with live benchmarks before advertising a specific model.
- `SLICKLY_HOSTED_AI_PROVIDER=qwencloud` or `deepseek`.
- For QwenCloud: `SLICKLY_QWENCLOUD_API_KEY`, optional `SLICKLY_QWENCLOUD_MODEL` (default `qwen3.8-max`) and optional `SLICKLY_QWENCLOUD_BASE_URL` (default Singapore pay-as-you-go endpoint). To benchmark a compatible Kimi model, set the model ID only if it is available in the account's model list.
- For DeepSeek: `SLICKLY_DEEPSEEK_API_KEY` and optional `SLICKLY_DEEPSEEK_MODEL` (default `deepseek-flash`).

Keep provider credentials exclusively in the Vercel server environment. Never set these values in the browser or packaged desktop app. Test in a Preview deployment with approved test credentials before changing Production. The hosted router preserves the existing JSON response for vision and SSE framing for streamed chat. Raw audio is rejected for these providers and should be transcribed through Slickly's speech pipeline first. Reverting `SLICKLY_HOSTED_AI_PROVIDER` to `gemini` restores the existing Gemini route.

Automated mocked routing coverage is in `scripts/test-hosted-provider-routing.js`; it verifies request conversion and response contracts, not live provider availability, real-world quality, billing, or jailbreak resistance.

Run `npm run benchmark:providers` locally after configuring authorised provider API keys in your environment. The benchmark compares QwenCloud Qwen, Kimi (when enabled), and DeepSeek models on reasoning, simple coding, and a prompt-injection regression task. It records latency and provider-reported token usage. To add a screenshot task, set `SLICKLY_BENCHMARK_IMAGE_PATH` to a local PNG/JPEG/WebP/GIF and `SLICKLY_BENCHMARK_VISION_EXPECTED` to a short phrase visible in that screenshot. The script does not upload keys, and a small regression suite does not prove overall safety or vision quality.


Live checkout is additionally protected by the server-side feature flag `SLICKLY_BILLING_ENABLED`. It must remain unset/false while merchant onboarding, payout-bank verification, migrations and sandbox tests are incomplete. Only an authorised adult/business operator should set it to `true` after all readiness gates have passed. The checkout endpoint returns HTTP 503 and does not contact Razorpay while the flag is off. The automated guard test is `scripts/test-slickly-billing-guard.js`.
