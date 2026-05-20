---
name: telnyx-openclaw-voice-call
description: Telnyx Voice AI plugin for OpenClaw — enables realtime voice agents via Telnyx Call Control v2.
---

# Telnyx OpenClaw Voice Call

This plugin packages the OpenClaw `voice-call` extension as a purpose-built Telnyx Voice AI plugin. Enable it and your OpenClaw agent becomes a Telnyx Voice AI phone number.

**Provider support:** Telnyx (production) + Mock (dev/no-network).

## Current status

> This plugin requires OpenClaw SDK exports not yet in npm `openclaw@2026.5.7`.
> See [openclaw/openclaw#79378](https://github.com/openclaw/openclaw/pull/79378).

**Expected results (against a checkout with SDK exports available):**

| Command              | Status                           |
| -------------------- | -------------------------------- |
| `npm ci`             | ✅                               |
| `npm run check:sdk`  | ✅ (if SDK exports are present)  |
| `npm run build`      | ✅ (runs check:sdk first)        |
| `npm run test:smoke` | ✅                               |
| `npm test`           | ✅ (runs check:sdk first)        |

**Against npm `openclaw@2026.5.7` (no SDK exports yet):**

| Command              | Status                           |
| -------------------- | -------------------------------- |
| `npm ci`             | ✅                               |
| `npm run check:sdk`  | ❌ (missing realtime-voice/security-runtime exports) |
| `npm run build`      | ❌ (runs check:sdk first)        |
| `npm run test:smoke` | ✅                               |
| `npm test`           | ❌ (runs check:sdk first)        |

## Local development

```bash
npm ci
npm run check:sdk          # verify SDK compatibility
npm run build
npm test
npm run test:smoke         # safe mock-only subset (always works)
```

If `check:sdk` fails, link a compatible OpenClaw checkout:

```bash
git clone https://github.com/openclaw/openclaw.git ../openclaw
cd ../openclaw && pnpm install && pnpm build && cd -
npm install --no-save ../openclaw
npm run build
npm test
```

## OpenClaw install

```bash
openclaw plugins install .
```

Requires `dist/` to exist (run `npm run build` first).

Configure the plugin under `plugins.entries.voice-call.config` with your Telnyx Call Control credentials (`apiKey`, `connectionId`, `publicKey`), a public webhook URL, and optional realtime voice provider settings.
