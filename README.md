# @ocplatform/voice-call

**Telnyx Voice AI plugin for OpenClaw.**

Enable this plugin and your OpenClaw agent becomes a Telnyx Voice AI phone number — inbound and outbound calls, realtime voice streaming, and full Call Control v2 integration out of the box.

**Prerequisites:** A [Telnyx account](https://portal.telnyx.com/) (free to create) and an API key from [Mission Control → API Keys](https://portal.telnyx.com/#/app/api-keys).

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

If `npm run check:sdk` reports missing `openclaw/plugin-sdk/realtime-voice` or `openclaw/plugin-sdk/security-runtime` exports, validate against an OpenClaw checkout that includes [openclaw/openclaw#79378](https://github.com/openclaw/openclaw/pull/79378) or a newer OpenClaw release:

```bash
# Clone and build OpenClaw (requires pnpm)
git clone https://github.com/openclaw/openclaw.git /path/to/openclaw
cd /path/to/openclaw && pnpm install && pnpm build
cd -  # back to this plugin
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
  // Optional: if omitted with autoProvision enabled, Voice Call orders and assigns one.
  fromNumber: "+15550001234",
  toNumber: "+15550005678",
  sessionScope: "per-phone", // or "per-call"

  telnyx: {
    apiKey: "KEYxxxx",
    // Optional: if omitted with autoProvision enabled, Voice Call creates a Call Control app.
    // Find existing apps at https://portal.telnyx.com/#/app/call-control/applications
    connectionId: "CONNxxxx",
    // Telnyx webhook public key from the Telnyx Mission Control Portal
    // https://portal.telnyx.com/#/app/call-control/applications
    // (Base64 string; can also be set via TELNYX_PUBLIC_KEY).
    publicKey: "...",
  },

  // Default true for Telnyx: creates/reuses a Call Control app + phone number when missing.
  // Set false when using pre-provisioned Telnyx resources only.
  autoProvision: true,

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

  // Inbound call control
  inboundPolicy: "allowlist", // "disabled" | "allowlist" | "pairing" | "open"
  allowFrom: ["+15550001234"], // E.164 numbers allowed when inboundPolicy is "allowlist"
  // inboundGreeting: "Hello, how can I help?", // spoken on inbound answer

  // Per-number routing overrides (keyed by dialed E.164 number)
  // numbers: {
  //   "+15550009999": { inboundGreeting: "Sales line", agentId: "sales" },
  // },

  // Call limits & timeouts
  // maxDurationSeconds: 3600,     // max call duration
  // maxConcurrentCalls: 10,        // max simultaneous calls
  // ringTimeoutMs: 30000,          // how long to let outbound ring
  // silenceTimeoutMs: 10000,       // auto-hangup on silence
  // transcriptTimeoutMs: 30000,    // transcript completion deadline
  // staleCallReaperSeconds: 600,   // reap zombie calls

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

  // Realtime voice AI (bidirectional voice conversation)
  // realtime: {
  //   enabled: true,
  //   provider: "<realtime-voice-provider-id>",
  //   instructions: "You are a helpful phone assistant.",
  //   toolPolicy: "safe-read-only", // "safe-read-only" | "owner" | "none"
  //   consultPolicy: "auto",         // "auto" | "substantive" | "always"
  //   fastContext: { enabled: true, timeoutMs: 2000, sources: ["memory", "sessions"] },
  //   agentContext: { enabled: true, includeIdentity: true },
  //   providers: {
  //     "<realtime-voice-provider-id>": { /* provider-owned options */ },
  //   },
  // },

  // TTS for calls (deep-merges with messages.tts)
  // tts: {
  //   auto: "inbound",      // "off" | "always" | "inbound" | "tagged"
  //   provider: "elevenlabs", // or "openai", etc.
  //   providers: {
  //     elevenlabs: { voiceId: "21m00Tcm4TlvDq8ikWAM" },
  //   },
  // },

  // Webhook security
  // webhookSecurity: {
  //   allowedHosts: ["example.ngrok.app"],
  //   trustForwardingHeaders: false,
  //   trustedProxyIPs: ["10.0.0.1"],
  // },
}
```

Environment variables:

- `TELNYX_API_KEY` — Telnyx API key
- `TELNYX_CONNECTION_ID` — Telnyx Call Control connection ID (optional when `autoProvision` creates one)
- `TELNYX_PUBLIC_KEY` — Telnyx webhook signature public key (Base64)

Notes:

- Telnyx requires a **publicly reachable** webhook URL. With `autoProvision: true`, this URL is registered on the generated Call Control app.
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
# Outbound calls
openclaw voicecall call --to "+15555550123" --message "Hello from OpenClaw"
openclaw voicecall call --to "+15555550123" --message "Hello" --mode conversation
openclaw voicecall start --to "+15555550123" --message "Hello"    # alias for 'call'

# In-call interaction
openclaw voicecall continue --call-id <id> --message "Any questions?"
openclaw voicecall speak --call-id <id> --message "One moment"
openclaw voicecall dtmf --call-id <id> --digits "1234"
openclaw voicecall end --call-id <id>

# Status & diagnostics
openclaw voicecall status --json                         # all calls
openclaw voicecall status --call-id <id>                  # specific call
openclaw voicecall setup --json                           # provider/webhook readiness
openclaw voicecall smoke                                  # readiness check + optional test call
openclaw voicecall tail                                    # tail voice-call JSONL logs
openclaw voicecall latency                                # summarize turn latency from logs

# Webhook exposure
openclaw voicecall expose --mode funnel                   # Tailscale funnel
openclaw voicecall expose --mode serve                    # Tailscale serve
openclaw voicecall expose --mode off                     # disable exposure
```

## Tool

Tool name: `voice_call`

Actions:

- `initiate_call` (message, to?, mode?)
- `start_call` (to, message?, mode?)
- `continue_call` (callId, message)
- `speak_to_user` (callId, message)
- `send_dtmf` (callId, digits)
- `end_call` (callId)
- `get_status` (callId)
- `continue_call` (callId, message)
- `speak_to_user` (callId, message)
- `end_call` (callId)
- `get_status` (callId)

## Gateway RPC

- `voicecall.initiate` (to?, message, mode?)
- `voicecall.start` (to, message?, mode?)
- `voicecall.continue` (callId, message)
- `voicecall.speak` (callId, message)
- `voicecall.dtmf` (callId, digits)
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
