# Slickly for Android and iOS

This directory contains the first native mobile app project for Android and iPhone/iPad, built with Expo and React Native.

## Current mobile scope

The first mobile milestone is a native text-chat client backed by Slickly's existing hosted Gemini endpoint:

- Native Android and iOS application shells.
- Chat composer, conversation history during the current app session, and follow-up context.
- Persistent per-install identifier stored with the platform secure-storage API.
- Clear loading, network, rate-limit, and service-error states.
- No user-managed Gemini key required; requests use the Slickly hosted AI service.

## Important platform differences

This is not a mobile port of the desktop overlay. Android and iOS do not expose the same desktop windowing and screen-capture exclusion APIs used by Slickly on Windows/macOS. This first release does not claim an invisible overlay, hidden screen sharing, continuous screen capture, or background microphone recording. Those capabilities need separate platform-specific design, permission review, and store-policy review.

## Development

Requires Node.js 20+ and the Expo Go app for device preview.

```bash
cd mobile
npm install
npm test
npx expo start
```

For native simulator/device builds:

```bash
npx expo run:android
npx expo run:ios
```

An iOS simulator build requires macOS with Xcode. Android builds require Android Studio/Android SDK.

## Hosted API and privacy

The app sends the current conversation's most recent 20 messages to:

`https://slicklyai.vercel.app/api/gemini`

Requests are made over HTTPS and include a random installation identifier for the service's existing rate-limit controls. The shared provider key remains on the server and is not embedded in the mobile app. Do not submit passwords, private credentials, or other sensitive information.

## Store release requirements

This PR establishes the app source and CI export checks; it does not publish to Google Play or Apple's App Store. Store distribution still requires signing credentials, app-store metadata, privacy disclosures, review, and authorized release accounts.
