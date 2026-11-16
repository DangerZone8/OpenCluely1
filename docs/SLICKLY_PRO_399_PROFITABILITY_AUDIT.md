# Slickly Pro ₹399/month profitability audit

**Status: not safe to promise the current maximum quotas as guaranteed monthly capacity.** This is a modeled audit, not a measurement of production consumption. The hosted Gemini endpoint currently selects `gemini-3.1-flash-lite`.

## Published daily Pro limits

| Feature | Daily limit | 30-day maximum |
|---|---:|---:|
| Screen-aware AI | 60 | 1,800 |
| Voice | 60 | 1,800 |
| Screenshots | 100 | 3,000 |
| Chat | 200 | 6,000 |
| **Total** | **420** | **12,600** |

## Model-price assumptions

Google's Gemini API pricing page lists Gemini 3.1 Flash-Lite paid standard rates of:
- $0.25 per 1 million text/image/video input tokens;
- $0.50 per 1 million audio input tokens;
- $1.50 per 1 million output tokens.

The scenario below assumes per successful feature request:
- Screen-aware: 1,000 input + 250 output tokens.
- Voice: 1,600 audio input + 250 output tokens.
- Screenshot: 2,000 input + 400 output tokens.
- Chat: 1,500 text input + 400 output tokens.

These are explicit modeling assumptions, not measured Slickly averages. In particular, prompt history, image resolution/crops, audio duration, output length, retries and provider-side reasoning can change actual usage. Use provider usage metadata to replace the assumptions before setting production limits.

For currency conversion, this example uses ₹94.08 per USD as a rounded 16 November 2026 reference rate.

## Estimated variable AI cost at 100% daily quota use

| Feature | Estimated daily AI cost | Estimated 30-day AI cost |
|---|---:|---:|
| Screen-aware | ₹3.53 | ₹105.84 |
| Voice | ₹6.63 | ₹198.98 |
| Screenshot | ₹10.35 | ₹310.46 |
| Chat | ₹18.35 | ₹550.37 |
| **Total** | **₹38.86** | **₹1,165.65** |

At full use, estimated model spend alone is about 2.9× the ₹399 subscription price.

## Payment-fee sensitivity

Razorpay's public standard pricing describes a 2% platform fee plus 18% GST on that fee. This gives an illustrative cost of ₹9.42 on a ₹399 payment. Razorpay's subscription-pricing material also gives a 0.9% subscription product component example; if that component applies in addition to the gateway charge for this merchant's chosen payment method, the combined illustrative fees are about ₹13.65 including GST.

The merchant's actual pricing agreement, method mix, recurring billing product charges, refunds and tax treatment must be checked in the merchant dashboard and invoices. Do not assume this example is a quote.

## Contribution sensitivity

Using the higher illustrative payment-fee estimate of ₹13.65:

| Average share of every daily quota used | Estimated AI cost/month | Remaining from ₹399 after modeled AI + payment fees |
|---:|---:|---:|
| 10% | ₹116.57 | ₹268.78 |
| 20% | ₹233.13 | ₹152.22 |
| 25% | ₹291.41 | ₹93.93 |
| 30% | ₹349.70 | ₹35.65 |
| 100% | ₹1,165.65 | **−₹780.30** |

This remaining amount is before hosting, database, observability, customer support, refunds/chargebacks, tax on the subscription sale, and other overhead. If ₹399 is tax-inclusive, the amount retained before costs may be lower depending on applicable tax obligations.

## Recommendation

1. Do not enable public Pro billing while actual token usage and merchant fees are unknown.
2. Instrument per-request provider usage metadata (input, output, audio and cached tokens) without logging prompts, screenshots, audio or secrets.
3. Aggregate cost by feature and account, including failed/retried requests and provider fallbacks.
4. Set server-side monthly spend budgets in addition to per-feature request caps. A request-count cap alone is not a reliable cost cap.
5. Run a representative staging cohort and measure median, p90 and p99 monthly cost per paid account.
6. Only then choose either lower per-feature limits, a fair-use monthly compute allowance, or a higher price. Do not silently change the published quotas.

**Decision:** ₹399 can work only if average usage is materially below the published maximum, or if a hard compute budget prevents high-cost accounts from consuming the full theoretical allowance. Current caps are not a profitability guarantee.
