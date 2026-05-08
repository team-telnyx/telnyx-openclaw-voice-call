---
name: telnyx-openclaw-voice-call
description: Telnyx-first OpenClaw Voice Call plugin for realtime voice AI agents.
---

# Telnyx OpenClaw Voice Call

This repository packages the OpenClaw `voice-call` extension as a standalone Telnyx-first plugin.

## Local development

```bash
npm install
npm run build
npm test
```

## OpenClaw install

```bash
openclaw plugins install .
```

Configure the plugin under `plugins.entries.voice-call.config` with Telnyx Call Control credentials, a public webhook URL, and optional realtime voice provider settings.
