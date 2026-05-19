# @ocplatform/voice-call

**Telnyx Voice AI plugin for OpenClaw.**

Enable this plugin and your OpenClaw agent becomes a Telnyx Voice AI phone number — inbound and outbound calls, realtime voice streaming, and full Call Control v2 integration out of the box.

Providers:

- **Telnyx** (Call Control v2) — production voice AI
- **Mock** (dev/no network)

Docs: `https://docs.openclaw.ai/plugins/voice-call`
Plugin system: `https://docs.openclaw.ai/plugin`

## Install (local dev)

> **AIF-126 status:** this standalone checkout requires OpenClaw SDK exports that are present on OpenClaw `main` and guarded by `openclaw/openclaw#79378`, but are not yet in npm `openclaw@2026.5.7`. Until the next OpenClaw release containing those exports, clean installs against npm will fail `npm run check:sdk` with a clear compatibility message.

### First-time validation from this checkout

Use npm for this repo. A `package-lock.json` is committed; there is no `pnpm-lock.yaml`.

```bash
npm ci
npm run check:sdk
npm run build
npm test
```

If `npm run check:sdk` reports missing `openclaw/plugin-sdk/realtime-voice` or `openclaw/plugin-sdk/security-runtime` exports, validate against an OpenClaw checkout that includes `openclaw/openclaw#79378` or a newer OpenClaw release:

```bash
npm install --no-save /path/to/openclaw
npm run build
npm test
```

Safe mock-only smoke test:

```bash
npm run test:smoke
```

### Option A: install via OpenClaw (recommended after SDK release)

```bash
openclaw plugins install @openclaw/voice-call
```

Restart the Gateway afterwards.

### Option B: copy into your global extensions folder (dev)

```bash
PLUGIN_HOME=~/.openclaw/extensions
mkdir -p "$PLUGIN_HOME"
cp -R <local-plugin-checkout> "$PLUGIN_HOME/voice-call"
cd "$PLUGIN_HOME/voice-call" && npm ci
npm install --no-save /path/to/openclaw # until SDK exports are released
npm run build
```

Then add the plugin load path to your OpenClaw config so the standalone copy takes priority over any bundled version:

```json
{
  "plugins": {
    "load": {
      "paths": ["~/.openclaw/extensions/voice-call"]
    }
  }
}
```

## Config

Put under `plugins.entries.voice-call.config`:

```json5
{
  provider: "telnyx", // or "mock" for dev/no-network
  fromNumber: "+15550001234",
  toNumber: "+15550005678",
  sessionScope: "per-phone", // or "per-call"

  telnyx: {
    apiKey: "KEYxxxx",
    connectionId: "CONNxxxx",
    // Telnyx webhook public key from the Telnyx Mission Control Portal
    // (Base64 string; can also be set via TELNYX_PUBLIC_KEY).
    publicKey: "...",
  },

  // Webhook server
  serve: {
    port: 3334,
    path: "/voice/webhook",
  },

  // Public exposure (pick one):
  // publicUrl: "https://example.ngrok.app/voice/webhook",
  // tunnel: { provider: "ngrok" },
  // tailscale: { mode: "funnel", path: "/voice/webhook" }

  outbound: {
    defaultMode: "notify", // or "conversation"
  },

  // Optional response agent workspace. Defaults to "main".
  agentId: "main",

  streaming: {
    enabled: true,
    // optional; if omitted, Voice Call picks the first registered
    // realtime-transcription provider by autoSelectOrder
    provider: "<realtime-transcription-provider-id>",
    streamPath: "/voice/stream",
    providers: {
      "<realtime-transcription-provider-id>": {
        // provider-owned options
      },
    },
    preStartTimeoutMs: 5000,
    maxPendingConnections: 32,
    maxPendingConnectionsPerIp: 4,
    maxConnections: 128,
  },
}
```

Environment variables:

- `TELNYX_API_KEY` — Telnyx API key
- `TELNYX_CONNECTION_ID` — Telnyx Call Control connection ID
- `TELNYX_PUBLIC_KEY` — Telnyx webhook signature public key (Base64)

Notes:

- Telnyx requires a **publicly reachable** webhook URL.
- `mock` is a local dev provider (no network calls).
- For safe local validation, set `provider: "mock"` and skip Telnyx credentials.
- Telnyx requires `telnyx.publicKey` (or `TELNYX_PUBLIC_KEY`) unless `skipSignatureVerification` is true.
- If older configs reference `provider: "log"` or legacy `streaming.*` OpenAI keys, run `openclaw doctor --fix` to rewrite them.
- advanced webhook, streaming, and tunnel notes: `https://docs.openclaw.ai/plugins/voice-call`
- `responseModel` is optional. When unset, voice responses use the runtime default model.
- `sessionScope` defaults to `per-phone`, preserving caller memory across calls. Use `per-call` for reception, booking, IVR, and bridge flows where each carrier call should start fresh.

## Stale call reaper

See the plugin docs for recommended ranges and production examples:
`https://docs.openclaw.ai/plugins/voice-call#stale-call-reaper`

## TTS for calls

Voice Call uses the core `messages.tts` configuration for
streaming speech on calls. Override examples and provider caveats live here:
`https://docs.openclaw.ai/plugins/voice-call#tts-for-calls`

## CLI

```bash
openclaw voicecall call --to "+15555550123" --message "Hello from OpenClaw"
openclaw voicecall continue --call-id <id> --message "Any questions?"
openclaw voicecall speak --call-id <id> --message "One moment"
openclaw voicecall end --call-id <id>
ocplatform voicecall status --json
openclaw voicecall status --call-id <id>
openclaw voicecall tail
openclaw voicecall expose --mode funnel
```

## Tool

Tool name: `voice_call`

Actions:

- `initiate_call` (message, to?, mode?)
- `continue_call` (callId, message)
- `speak_to_user` (callId, message)
- `end_call` (callId)
- `get_status` (callId)

## Gateway RPC

- `voicecall.initiate` (to?, message, mode?)
- `voicecall.continue` (callId, message)
- `voicecall.speak` (callId, message)
- `voicecall.end` (callId)
- `voicecall.status` (callId)

## Notes

- Uses Telnyx webhook signature verification (Ed25519). Set `telnyx.publicKey` or `TELNYX_PUBLIC_KEY`.
- `responseModel` / `responseSystemPrompt` control AI auto-responses.
- Voice-call auto-responses enforce a spoken JSON contract (`{"spoken":"..."}`) and filter reasoning/meta output before playback.
- Telnyx realtime uses bidirectional PCMU/RTP streaming into the realtime voice bridge via Telnyx Call Control `streaming_start`.
- Realtime provider selection is generic. Configure `streaming.provider` / `realtime.provider` and put provider-owned options under `providers.<id>`.
- Outbound conversation calls suppress barge-in only while the initial greeting is actively speaking, then re-enable normal interruption.
- Runtime fallback still accepts old voice-call keys for now, but migration is a doctor step and the compat shim is scheduled to go away in a future release.
