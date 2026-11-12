# Slickly Mobile

Native Expo / React Native app for Android and iOS.

## Implemented in this milestone

- Phone-first native chat using Slickly's existing hosted Gemini endpoint.
- Tap-to-speak voice input on Android and iOS using native speech recognition; users can review and edit the transcript before sending it into the same context-retaining conversation.
- Screenshot-based Screen AI on Android and iOS, with follow-up context retained in the conversation.
- Android draggable system-wide floating assistant bubble, expandable chat panel, and hosted AI chat.
- Android overlay permission is requested through Android Settings; the foreground service runs only after the user enables it and can be stopped from Slickly.
- iOS ReplayKit Broadcast Upload Extension target. The user starts a system broadcast using Apple's picker; the extension analyzes the first video frame and stores the result in a shared App Group for Slickly to load on return.
- The iOS broadcast flow does not create an overlay above other apps. iOS does not allow third-party apps to draw arbitrary persistent overlays over other apps.

## Voice input, conversation context, and privacy

- Mobile voice input is opt-in: the microphone and speech-recognition permissions are requested only after the user taps the microphone button.
- Speech is transcribed by the platform's native speech-recognition service. Slickly displays the transcript for review; only after the user sends it is the text added to the chat and sent to the hosted AI endpoint.
- Voice transcripts and assistant replies remain in the current conversation so follow-up questions can refer to earlier turns. The Android floating panel keeps its own recent chat history while the service is running.
- Speech recognition requires a native development or release build; it is not available in Expo Go.

## Screen AI behavior and privacy

- Android Screen AI supports a system MediaProjection capture started by the user from Slickly. Android shows its screen-sharing consent prompt; after approval, Slickly waits five seconds for the user to switch to the target app, captures one frame, sends it for analysis, and stops capture. The photo-library screenshot picker remains available as an alternative.
- iOS ReplayKit requires the user to start the system broadcast. The extension waits five seconds for the user to switch apps, then submits one frame per broadcast session to Screen AI, not a continuous stream; stop and restart the broadcast to capture a new frame.
- The user should stop screen broadcast after the capture. Screen content is sent over HTTPS to Slickly's hosted Gemini endpoint for analysis. Do not share passwords, private messages, or sensitive information.
- The broadcast extension and app share capture results through `group.ai.slickly.mobile`.

## Native build requirements

- Android overlay uses `SYSTEM_ALERT_WINDOW` plus a foreground service with the Android `specialUse` foreground-service type. The user must explicitly grant display-over-other-apps permission in Android Settings. Screen AI uses Android's separate MediaProjection permission prompt and a `mediaProjection` foreground-service type.
- iOS ReplayKit requires an Apple Developer team, provisioning profiles, and the App Group entitlement `group.ai.slickly.mobile`. Register that App Group for the app and extension bundle identifiers before creating signed device builds.
- Android preview builds produce APKs through EAS. iOS distribution uses TestFlight/App Store or properly provisioned internal distribution; an IPA is not generally installable like an Android APK.

## Signed iOS IPA builds (GitHub Actions)

The mobile workflow can additionally produce a signed **Ad Hoc IPA** when all five repository Actions secrets below are configured. The unsigned simulator build remains available when signing secrets are absent; the workflow reports that the signed IPA step was skipped.

Configure these under **GitHub → Settings → Secrets and variables → Actions → New repository secret**:

- `IOS_CERTIFICATE_P12_BASE64`: Base64-encoded Apple Distribution `.p12` certificate (including its private key).
- `IOS_CERTIFICATE_PASSWORD`: Password used to protect that `.p12` file.
- `IOS_APP_PROVISIONING_PROFILE_BASE64`: Base64-encoded Ad Hoc provisioning profile for `ai.slickly.mobile`.
- `IOS_EXTENSION_PROVISIONING_PROFILE_BASE64`: Base64-encoded Ad Hoc provisioning profile for `ai.slickly.mobile.SlicklyScreenBroadcast`.
- `IOS_TEAM_ID`: The 10-character Apple Developer Team ID.

Both profiles must:
- Be Ad Hoc distribution profiles for the same Apple Developer team.
- Match their respective bundle identifiers exactly.
- Include the App Group entitlement `group.ai.slickly.mobile`.
- Include the same Apple Distribution certificate used in the P12.
- Include the UDIDs of every iPhone/iPad on which the Ad Hoc IPA should be installed.

The workflow validates the team, explicit application identifier, and App Group entitlement before archiving. It then archives the Release iOS device app, exports an Ad Hoc IPA using the two profile names, verifies the app and ReplayKit extension code signatures, and uploads `slickly-ios-adhoc-ipa` as a workflow artifact.

For a P12 file, create the Base64 value locally on macOS with `base64 -i distribution.p12 | tr -d '\\n'`. For each provisioning profile, use `base64 -i profile.mobileprovision | tr -d '\\n'`. Paste those outputs directly into the matching GitHub secret fields. **Do not commit certificates, private keys, provisioning profiles, or passwords to Git, and do not paste them into ChatGPT or issue comments.** Keep the P12 password in its own secret.

An Ad Hoc IPA installs only on devices registered in the included provisioning profile. For wider beta distribution, use TestFlight/App Store Connect signing instead; this workflow is specifically configured for Ad Hoc device installation.

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
