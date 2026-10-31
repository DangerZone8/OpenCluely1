# Slickly AI Direct Strategic Playbook

This document turns the strategy sketch into explicit product requirements and release gates. It is an implementation plan, not a claim that every item is already shipped.

## Product principles
- Keep the desktop app responsive on ordinary hardware.
- Let users bring their own provider credentials; keys remain local and are never embedded in releases or sent to Slickly's hosted proxy.
- Make mixed Hindi-English speech a first-class input scenario.
- Keep the overlay transparent, user-controlled, and compatible with OS privacy controls. Do not hide the process, bypass endpoint security, or conceal activity from a meeting host or device owner.
- Never expose an update to stable users until required checks pass and matching platform artifacts and update manifests exist.

## Technical edge

### Transparent overlay (safe replacement for kernel stealth)
- Use a normal, discoverable Slickly AI process identity and visible controls.
- Provide explicit always-on-top, minimize, hide/show, and screen-share visibility controls.
- Respect OS screen-capture permissions and platform privacy indicators.
- Do not inject into the kernel, evade endpoint security, disguise the process, or bypass screen-sharing/capture controls.

### Frame compression
- Keep screenshot capture in the capture service.
- Downscale large frames while preserving enough resolution for readable UI text.
- Encode frames as JPEG and record original/output dimensions, quality, byte size, and processing time.
- Keep compression bounded and test image payload shape and maximum request size.

### BYO API keys
- Support Gemini, OpenAI, xAI/Grok, and Anthropic/Claude.
- Persist provider, model override, and provider-specific keys in the user's local configuration only.
- Never log or display key values; redact them in diagnostics.
- Test provider selection, model override, authentication headers, text requests, image/vision requests, audio capability handling, missing keys, API errors, and settings persistence.
- Live authentication checks require per-provider credentials in CI secrets. Without a provider secret, report that provider as not live-verified rather than claiming it passed.

## Market capture

### Hinglish speech
- Keep local Whisper as a speech option and support automatic language detection for Hindi-English code-switching.
- Include test utterances mixing Hindi and English, technical terms, names, and numbers.
- Preserve the original transcript and let users choose auto, hi, or en when the installed speech model supports it.
- Do not silently translate Hinglish into English unless requested.

## Auto-update release contract
1. Run the full offline regression suite.
2. Run live production chat and screen-vision checks, real desktop Screen AI E2E, and the stability gate.
3. Build every supported platform artifact.
4. Install/launch smoke-test each installable artifact and verify manifests, hashes, and blockmaps.
5. Verify the Vercel update-feed route and redirects against actual release asset names.
6. Publish only after all required gates succeed; any failed or missing required gate blocks publication.
7. After publishing, verify the public feed resolves the expected version and each platform asset. Keep a rollback path and never silently downgrade.

PR-only jobs may skip release publication and tag-only packaging. Platform-specific steps may skip on nonmatching OS runners. These are conditional skips, not substitutes for the corresponding platform matrix job. Live provider checks for BYOK providers must be reported separately from deterministic mocked contract tests.

## Current implementation status
- Frame downscaling and JPEG compression are implemented in src/services/capture.service.js.
- BYOK provider routing and settings fields exist for Gemini, OpenAI, xAI, and Anthropic. The deterministic adapter test covers vision and OpenAI audio transcription contracts.
- Whisper language setting supports auto; true Hinglish accuracy still needs a real audio fixture and end-to-end transcription test on supported environments.
- Auto-update client and Vercel feed routing exist. A PR artifact is not a published update; stable availability must remain tied to a successful release pipeline.
