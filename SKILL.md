---
name: telnyx-openclaw-voice-call
description: Telnyx-first OpenClaw Voice Call plugin for realtime voice AI agents.
---

# Telnyx OpenClaw Voice Call

This repository packages the OpenClaw `voice-call` extension as a standalone Telnyx-first plugin.

## Current status

> This plugin requires OpenClaw SDK exports not yet in npm `openclaw@2026.5.7`.
> See [openclaw/openclaw#79378](https://github.com/openclaw/openclaw/pull/79378).

**Expected results today:**

| Command              | Status                           |
| -------------------- | -------------------------------- |
| `npm ci`             | ✅                               |
| `npm run check:sdk`  | ❌ (until next OpenClaw release) |
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

Configure the plugin under `plugins.entries.voice-call.config` with Telnyx Call Control credentials, a public webhook URL, and optional realtime voice provider settings.
