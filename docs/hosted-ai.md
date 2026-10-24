# Hosted AI service configuration

Cleverly's desktop app can use the hosted Gemini proxy at:

`https://opencluely-iota.vercel.app/api/gemini`

The desktop app does not contain the shared Gemini API key. The proxy reads the key from the Vercel server environment at request time.

## Required Vercel environment variable

Set `GEMINI_API_KEY` in the Vercel project that owns `opencluely-iota.vercel.app`, for **Production** and any Preview environment used for testing. Redeploy after changing the variable. A GitHub Actions repository secret is not automatically available to Vercel Functions.

Without this variable, the endpoint returns HTTP 503 and the app reports that the hosted AI service is not configured; it must not ask users to paste a provider key.

## Endpoint behavior

- Accepts POST requests containing Gemini text, image, or audio content.
- Allows only the model IDs configured in `api/gemini.js`.
- Limits JSON payloads to 4 MiB and applies per-IP/per-installation request limits.
- Never returns the provider key to the desktop client.
- Sends request content to the Cleverly-hosted endpoint and Google Gemini. Users should not submit passwords or other sensitive information.

The current in-memory rate limits are best-effort protection for a small deployment, not durable abuse prevention: serverless instances can restart or scale independently. Before promoting the proxy to a broad public release, use a durable rate-limit store and stronger account/device authentication, and configure spending quotas/alerts in Google AI Studio or Google Cloud.
