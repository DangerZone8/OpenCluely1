# Slickly Pro ₹399/month fair-use and profitability audit

**Decision: keep ₹399/month as a controlled fair-use plan, not an unlimited-use promise.** The previous daily quota design (60 screen, 60 voice, 100 screenshot and 200 chat calls every day) could exceed subscription revenue if a customer used the full allowance. Those quotas have been replaced in code with daily burst ceilings and a shared monthly weighted allowance.

## Enforced Pro allowance

| Feature | Daily ceiling | Monthly units per request | Maximum if used alone |
|---|---:|---:|---:|
| Screen-aware AI | 10 | 2 | 250 calls |
| Voice | 3 | 4 | 125 calls |
| Screenshots | 5 | 3 | 166 calls |
| Chat | 20 | 1 | 500 calls |
| **Shared monthly budget** | — | — | **500 weighted units** |

The 500-unit budget is shared across features, resets on the first day of each UTC calendar month, and is enforced by a Postgres transaction alongside per-feature daily limits. The server chooses feature weights and the monthly allowance; the client cannot request a cheaper weight. The account page displays the remaining monthly allowance. The database migration is `supabase/migrations/202611180001_slickly_monthly_pro_budget.sql`.

These units are intentionally not called tokens or rupees. They are conservative relative request weights. A screen frame costs 2 units, voice 4, a screenshot 3 and text chat 1.

## Provider price reference and scenario assumptions

The hosted endpoint selects Google Gemini 3.1 Flash-Lite. Google's published paid Standard pricing currently lists:
- Text/image/video input: $0.25 per 1 million tokens.
- Audio input: $0.50 per 1 million tokens.
- Output (including thinking tokens): $1.50 per 1 million tokens.

Source: [Google Gemini API pricing](https://ai.google.dev/gemini-api/docs/pricing).

Illustrative per-call token assumptions (not measured Slickly telemetry):
- Screen-aware: 1,000 input + 250 output tokens.
- Voice: 1,600 audio input + 250 output tokens.
- Screenshot: 2,000 input + 400 output tokens.
- Chat: 1,500 text input + 400 output tokens.

At an illustrative ₹94.08/USD conversion, the modeled costs are approximately:
- Screen-aware: ₹0.059 per call (2 units).
- Voice: ₹0.111 per call (4 units).
- Screenshot: ₹0.104 per call (3 units).
- Chat: ₹0.092 per call (1 unit).

If a customer spent the entire 500-unit budget on only one feature, the model-only scenario would be approximately ₹14–₹46/month depending on the feature mix. A 2× planning buffer gives approximately ₹28–₹92/month. This is a planning sensitivity, not a bill estimate or guaranteed maximum: long prompts, large images, audio duration, retries, provider-side reasoning and alternate providers can materially change costs.

## What this changes financially

The old plan exposed 12,600 daily-quota calls over 30 days, with a modeled worst-case AI cost of about ₹1,166/month under the prior assumptions. That was not sustainable at ₹399.

The new design:
1. Reduces per-feature daily burst ceilings.
2. Adds a shared 500-unit monthly cap, preventing customers from independently exhausting every feature's daily pool throughout the month.
3. Uses higher weights for multimodal requests than text chat.
4. Shows the remaining allowance to customers before they hit the cap.

This materially reduces exposure, but does **not** prove the subscription is profitable. The request weights are proxies rather than true dollar metering. A fixed token ceiling and provider-reported usage accounting are still needed before claiming a guaranteed gross margin.

## Launch gates

1. Apply all Supabase migrations, including the monthly budget migration, in order.
2. Confirm the deployed Vercel Production environment has the correct Supabase URL, public key and server-only service-role key.
3. Keep `SLICKLY_BILLING_ENABLED` disabled while testing.
4. Run a staging cohort and compare Gemini usage metadata and provider invoices against per-account weighted units.
5. Add durable token/cost aggregation by feature and account, without storing prompts, screenshots, audio or secrets.
6. Set provider-side quotas/alerts and an operational monthly spend ceiling. Billing alerts alone are notifications, not a hard spend cap.
7. Include hosting, payment processing, taxes, refunds, chargebacks and support before declaring net profitability.

**Conclusion:** ₹399 is a plausible price for a bounded fair-use plan, not an unlimited plan. The new 500-unit budget is a substantial safety improvement, but the product should not be marketed as guaranteed profitable until real provider invoices and customer usage distributions validate the model.
