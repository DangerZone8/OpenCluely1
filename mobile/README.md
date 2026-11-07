# Slickly Mobile

Native Expo / React Native app for Android and iOS.

## Implemented in this milestone

- Phone-first native chat using Slickly's existing hosted Gemini endpoint.
- Screenshot-based Screen AI on Android and iOS, with follow-up context retained in the conversation.
- Android draggable system-wide floating assistant bubble, expandable chat panel, and hosted AI chat.
- Android overlay permission is requested through Android Settings; the foreground service runs only after the user enables it and can be stopped from Slickly.
- iOS ReplayKit Broadcast Upload Extension target. The user starts a system broadcast using Apple's picker; the extension analyzes the first video frame and stores the result in a shared App Group for Slickly to load on return.
- The iOS broadcast flow does not create an overlay above other apps. iOS does not allow third-party apps to draw arbitrary persistent overlays over other apps.

## Screen AI behavior and privacy

- Android's current Screen AI path analyzes a screenshot explicitly selected by the user from the photo library. It does not silently capture other apps.
- iOS ReplayKit requires the user to start the system broadcast. The extension submits one frame per broadcast session to Screen AI, not a continuous stream; stop and restart the broadcast to capture a new frame.
- The user should stop screen broadcast after the capture. Screen content is sent over HTTPS to Slickly's hosted Gemini endpoint for analysis. Do not share passwords, private messages, or sensitive information.
- The broadcast extension and app share capture results through `group.ai.slickly.mobile`.

## Native build requirements

- Android overlay uses `SYSTEM_ALERT_WINDOW` plus a foreground service with the Android `specialUse` foreground-service type. The user must explicitly grant display-over-other-apps permission in Android Settings.
- iOS ReplayKit requires an Apple Developer team, provisioning profiles, and the App Group entitlement `group.ai.slickly.mobile`. Register that App Group for the app and extension bundle identifiers before creating signed device builds.
- Android preview builds produce APKs through EAS. iOS distribution uses TestFlight/App Store or properly provisioned internal distribution; an IPA is not generally installable like an Android APK.

## Local development

Requires Node.js 20+.

```bash
cd mobile
npm install
npm test
npx expo prebuild --clean
npx expo run:android
npx expo run:ios
```

The iOS build requires macOS and Xcode. Android requires Android SDK tooling. EAS cloud builds also require the correct signing credentials and registered App Group for iOS.

## Current release status

Source and CI configuration only. This does not publish a Play Store/App Store release or create signed APK/IPA files. CI bundle exports and static native-integration checks are not substitutes for on-device overlay permission, ReplayKit broadcast, or native signing tests.
