# Slickly Cloud Control

Slickly now has a first-stage remote configuration channel. It is intentionally separate from the Electron binary updater.

## What can change without reinstalling

The desktop client polls `https://slicklyai.vercel.app/api/cloud-config` on startup and every 15 minutes. It validates the schema and app compatibility, applies a deterministic installation cohort, stores a local cache under Electron userData, and broadcasts validated snapshots to renderer windows. The app continues with the last valid cache when offline.

Only declarative settings are accepted:
- allowlisted feature flags
- a short announcement string
- an announcement URL restricted to Slickly's website or this GitHub repository
- polling interval, rollout percentage, revision, and minimum supported app version

No downloaded JavaScript, native modules, shell commands, arbitrary URLs, or executable plug-ins are evaluated. The existing electron-updater remains responsible for Electron/runtime/native-code changes and continues using signed release artifacts and its existing platform manifests.

## Publishing a configuration change

Set the Vercel Production environment variable `SLICKLY_CLOUD_CONFIG_JSON` to a complete JSON object matching this example, then redeploy the Vercel project:

```json
{
  "schemaVersion": 1,
  "revision": "release-2",
  "minimumAppVersion": "1.0.0",
  "pollIntervalMs": 900000,
  "rolloutPercent": 25,
  "features": {
    "cloudConfig": true,
    "newSettingsExperience": true,
    "premiumAi": false,
    "advancedScreenAnalysis": false,
    "betaFeatures": false
  },
  "presentation": {
    "announcement": "The new settings experience is rolling out.",
    "announcementUrl": "https://slicklyai.vercel.app/"
  }
}
```

Use a monotonically increasing numeric suffix in revisions (for example `release-2`, then `release-3`). Invalid configuration returns HTTP 503 and clients retain their last known-good cache. Vercel caches a valid response for up to one minute.

This environment-variable workflow is an operational control plane, not yet a self-service admin dashboard. A durable dashboard requires a persistent database/KV store and authenticated admin identity; neither should be simulated with client-side secrets or a hard-coded password.

## Paid plans and entitlements

Paid plan flags are deliberately false by default. The client-side flag is a presentation/availability hint, never proof of payment. A production paid service must verify account identity and entitlements server-side on every protected API request, with webhook-backed subscription state in a durable database. Do not put payment-provider secrets in the desktop app or trust a plan name supplied by the renderer.

The repository currently has no account database, authenticated user identity, payment provider integration, or webhook persistence. Therefore live checkout/subscription activation is not enabled by this change. Before enabling payments, provision the database and provider accounts under an eligible adult/business representative, configure their secrets in Vercel's environment settings, and add webhook signature verification, cancellation/expiry handling, refund handling, and server-side usage enforcement. Keep security updates and essential bug fixes available to every user.

## Test

Run `npm run check`. The cloud-config suite covers schema rejection, safe defaults, stable rollout cohorts, offline cache, minimum-version compatibility, URL allowlisting, and API behavior.
