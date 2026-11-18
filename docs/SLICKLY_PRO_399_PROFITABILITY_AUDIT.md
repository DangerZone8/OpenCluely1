# Slickly Pro ₹399/month profitability and fair-use audit

**Decision: ₹399/month is plausible only as a bounded fair-use plan. It is not unlimited AI usage, and profitability is not yet proven.**

## Enforced Pro allowance

| Feature | Daily ceiling | Monthly units per request | Maximum if used alone |
|---|---:|---:|---:|
| Screen-aware AI | 10 | 3 | 166 calls |
| Voice | 3 | 4 | 125 calls |
| Screenshots | 5 | 3 | 166 calls |
| Chat | 20 | 1 | 500 calls |
| **Shared monthly allowance** | — | **500 units** | — |

The allowance is shared across features and resets on the first day of each UTC calendar month. The database RPC enforces daily and monthly limits atomically. The hosted Gemini endpoint now independently authenticates the Supabase access token and reserves credits before contacting the AI provider; the desktop-only credit check is not treated as a security boundary.

All image requests are charged at 3 units, including live screen requests. Voice requests cost 4 units and text chat costs 1. These weights are conservative relative request weights, not exact token-dollar metering.

The migration is `supabase/migrations/202611180001_slickly_monthly_pro_budget.sql`. Apply it after the existing account, referral and cloud-config migrations.

## Provider price reference

Google's published Gemini 3.1 Flash-Lite Standard paid pricing lists:
- Text/image/video input: $0.25 per 1 million tokens.
- Audio input: $0.50 per 1 million tokens.
- Output, including thinking tokens: $1.50 per 1 million tokens.

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

The hosted endpoint caps text/image output at 512 tokens and audio-request output at 2,048 tokens. Request bodies are limited to 4 MB; inline media is separately bounded. These caps reduce runaway payloads but do not replace provider-side spending alerts or real token accounting.

## Illustrative variable AI cost

These are modeling assumptions, not measured production telemetry:
- Screen-aware request: 1,000 text/image input tokens + 512 output tokens.
- Voice request: 1,600 audio input tokens + 2,048 output tokens.
- Screenshot request: 2,000 text/image input tokens + 512 output tokens.
- Chat request: 1,500 text input tokens + 512 output tokens.
- Illustrative conversion: ₹94.08 per USD.

| Feature | Estimated model cost/call | Calls at 500-unit cap | Estimated model cost if all units go to this feature |
|---|---:|---:|---:|
| Screen-aware AI | ₹0.096 | 166 | ₹15.94 |
| Voice | ₹0.364 | 125 | ₹45.50 |
| Screenshots | ₹0.119 | 166 | ₹19.75 |
| Chat | ₹0.108 | 500 | ₹54.00 |

A 2× planning buffer would put this illustrative model-only range at roughly ₹32–₹108/month. This is not a guaranteed cost ceiling: prompt length, media duration/resolution, provider retries, hidden reasoning tokens, model changes and request patterns can materially change actual charges. The shared weighted budget is a product-use guardrail, not a rupee-denominated provider-spend cap.

## What ₹399 needs to cover

The ₹399 subscription price is gross revenue, not net contribution. Before describing Pro as profitable, subtract:
- AI provider usage from real usage metadata and invoices.
- Payment gateway fees, applicable taxes and refunds/chargebacks.
- Hosting, database, storage, monitoring and update-delivery costs.
- Customer support and operational overhead.

The customer mix also matters: a large share of voice or image usage costs more than chat-heavy usage under these assumptions.

## Release gates

1. Apply all Supabase migrations in order, including the monthly Pro budget migration.
2. Configure the Supabase URL, public key and server-only service-role key in the Slickly Vercel Production environment.
3. Disable email confirmation in Supabase only after accepting that password-only accounts will not prove control of their email address. Google OAuth identity is required for allowlisted admin access.
4. Complete Google OAuth provider setup and redirect allowlisting with the project owner's Google credentials.
5. Run a staging cohort and compare provider-reported token usage and actual invoices with the weighted allowance.
6. Add durable per-account/per-feature token and cost aggregation, without storing prompts, screenshots, audio or secrets.
7. Set provider-side spend alerts/quotas and an operational monthly spend ceiling. Alerts are not a hard spend cap.
8. Complete live tests for sign-in, session refresh, purchase, renewal, cancellation, refunds and credit concurrency before enabling live billing.

**Conclusion:** ₹399 may work with the 500-unit shared fair-use plan, but the modeled cost is not proof of profit. Keep live billing disabled until the external setup, staging telemetry and real cost review are complete.
