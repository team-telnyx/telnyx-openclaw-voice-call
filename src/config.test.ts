import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  VoiceCallConfigSchema,
  resolveVoiceCallEffectiveConfig,
  resolveVoiceCallNumberRouteKey,
  resolveVoiceCallSessionKey,
  validateProviderConfig,
  normalizeVoiceCallConfig,
  resolveVoiceCallConfig,
  type VoiceCallConfig,
} from "./config.js";
import { createVoiceCallBaseConfig } from "./test-fixtures.js";

function createBaseConfig(provider: "telnyx" | "mock"): VoiceCallConfig {
  return createVoiceCallBaseConfig({ provider });
}

function envRef(id: string) {
  return { source: "env" as const, provider: "default", id };
}

function requireElevenLabsTtsConfig(config: Pick<VoiceCallConfig, "tts">) {
  const tts = config.tts;
  const elevenlabs = tts?.providers?.elevenlabs;
  if (!elevenlabs || typeof elevenlabs !== "object") {
    throw new Error(
      "voice-call config did not preserve nested elevenlabs TTS config",
    );
  }
  return { tts, elevenlabs };
}

describe("validateProviderConfig", () => {
  const originalEnv = { ...process.env };
  const clearProviderEnv = () => {
    delete process.env.TELNYX_API_KEY;
    delete process.env.TELNYX_CONNECTION_ID;
    delete process.env.TELNYX_PUBLIC_KEY;
  };

  beforeEach(() => {
    clearProviderEnv();
  });

  afterEach(() => {
    // Restore original env
    process.env = { ...originalEnv };
  });

  describe("provider credential sources", () => {
    it("passes validation when credentials come from config or environment", () => {
      for (const provider of ["telnyx", "mock"] as const) {
        clearProviderEnv();
        const fromConfig = createBaseConfig(provider);
        if (provider === "telnyx") {
          fromConfig.telnyx = {
            apiKey: "KEY123",
            connectionId: "CONN456",
            publicKey: "public-key",
          };
        }
        expect(validateProviderConfig(fromConfig)).toMatchObject({
          valid: true,
          errors: [],
        });

        clearProviderEnv();
        if (provider === "telnyx") {
          process.env.TELNYX_API_KEY = "KEY123";
          process.env.TELNYX_CONNECTION_ID = "CONN456";
          process.env.TELNYX_PUBLIC_KEY = "public-key";
        }
        const fromEnv = resolveVoiceCallConfig(createBaseConfig(provider));
        expect(validateProviderConfig(fromEnv)).toMatchObject({
          valid: true,
          errors: [],
        });
      }
    });
  });

  describe("telnyx provider", () => {
    it("fails validation when apiKey is missing everywhere", () => {
      process.env.TELNYX_CONNECTION_ID = "CONN456";
      let config = createBaseConfig("telnyx");
      config = resolveVoiceCallConfig(config);

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.telnyx-voice-call.config.telnyx.apiKey is required (or set TELNYX_API_KEY env)",
      );
    });

    it("requires a public key unless signature verification is skipped", () => {
      const missingPublicKey = createBaseConfig("telnyx");
      missingPublicKey.inboundPolicy = "allowlist";
      missingPublicKey.telnyx = { apiKey: "KEY123", connectionId: "CONN456" };
      const missingPublicKeyResult = validateProviderConfig(missingPublicKey);
      expect(missingPublicKeyResult.valid).toBe(false);
      expect(missingPublicKeyResult.errors).toContain(
        "plugins.entries.telnyx-voice-call.config.telnyx.publicKey is required (or set TELNYX_PUBLIC_KEY env)",
      );

      const withPublicKey = createBaseConfig("telnyx");
      withPublicKey.inboundPolicy = "allowlist";
      withPublicKey.telnyx = {
        apiKey: "KEY123",
        connectionId: "CONN456",
        publicKey: "public-key",
      };
      expect(validateProviderConfig(withPublicKey)).toMatchObject({
        valid: true,
        errors: [],
      });

      const skippedVerification = createBaseConfig("telnyx");
      skippedVerification.skipSignatureVerification = true;
      skippedVerification.telnyx = {
        apiKey: "KEY123",
        connectionId: "CONN456",
      };
      expect(validateProviderConfig(skippedVerification)).toMatchObject({
        valid: true,
        errors: [],
      });
    });
  });

  describe("disabled config", () => {
    it("skips validation when enabled is false", () => {
      const config = createBaseConfig("telnyx");
      config.enabled = false;

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });
  });

  describe("realtime config", () => {
    it("rejects disabled inbound policy for realtime mode", () => {
      const config = createBaseConfig("telnyx");
      config.realtime.enabled = true;
      config.inboundPolicy = "disabled";

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        'plugins.entries.telnyx-voice-call.config.inboundPolicy must not be "disabled" when realtime.enabled is true',
      );
    });

    it("rejects enabling realtime and streaming together", () => {
      const config = createBaseConfig("telnyx");
      config.realtime.enabled = true;
      config.streaming.enabled = true;
      config.inboundPolicy = "allowlist";

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
      expect(result.errors).toContain(
        "plugins.entries.telnyx-voice-call.config.realtime.enabled and plugins.entries.telnyx-voice-call.config.streaming.enabled cannot both be true",
      );
    });

    it("allows Telnyx realtime mode", () => {
      const config = createBaseConfig("telnyx");
      config.realtime.enabled = true;
      config.inboundPolicy = "allowlist";
      config.telnyx = {
        apiKey: "KEY123",
        connectionId: "CONN456",
        publicKey: "public-key",
      };

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(true);
      expect(result.errors).toEqual([]);
    });

    it("rejects realtime mode for providers without realtime bridges", () => {
      const config = createBaseConfig("mock");
      config.realtime.enabled = true;
      config.inboundPolicy = "allowlist";

      const result = validateProviderConfig(config);

      expect(result.valid).toBe(false);
    });
  });
});

describe("resolveVoiceCallConfig session routing", () => {
  it("defaults Telnyx auto-provisioning on so enabling the plugin can create the phone-number agent", () => {
    const config = resolveVoiceCallConfig({
      enabled: true,
      provider: "telnyx",
      telnyx: { apiKey: "KEY123", publicKey: "public-key" },
    });

    expect(config.autoProvision).toBe(true);
    expect(config.fromNumber).toBeUndefined();
    expect(config.telnyx?.connectionId).toBeUndefined();
    expect(validateProviderConfig(config)).toEqual({ valid: true, errors: [] });
  });

  it("enables the pre-answer stale call reaper by default", () => {
    const config = resolveVoiceCallConfig({ enabled: true, provider: "mock" });

    expect(config.staleCallReaperSeconds).toBe(120);
  });

  it("keeps voice sessions scoped by phone by default", () => {
    const config = resolveVoiceCallConfig({ enabled: true, provider: "mock" });

    expect(config.sessionScope).toBe("per-phone");
    expect(
      resolveVoiceCallSessionKey({
        config,
        callId: "call-123",
        phone: "+1 (555) 000-1111",
      }),
    ).toBe("voice:15550001111");
  });

  it("can scope voice sessions to each call", () => {
    const config = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
      sessionScope: "per-call",
    });

    expect(config.sessionScope).toBe("per-call");
    expect(
      resolveVoiceCallSessionKey({
        config,
        callId: "call-123",
        phone: "+1 (555) 000-1111",
      }),
    ).toBe("voice:call:call-123");
  });

  it("preserves explicit voice session keys", () => {
    const config = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
      sessionScope: "per-call",
    });

    expect(
      resolveVoiceCallSessionKey({
        config,
        callId: "call-123",
        phone: "+1 (555) 000-1111",
        explicitSessionKey: "meet-room-1",
      }),
    ).toBe("meet-room-1");
  });

  it("resolves per-number inbound route overrides over global voice settings", () => {
    const config = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
      inboundGreeting: "Hello from global.",
      agentId: "main",
      responseModel: "openai/gpt-5.4-mini",
      responseSystemPrompt: "Global voice assistant.",
      responseTimeoutMs: 10000,
      tts: {
        provider: "openai",
        providers: {
          openai: { voice: "coral", speed: 1 },
        },
      },
      numbers: {
        "+15550001111": {
          inboundGreeting: "Silver Fox Cards, how can I help?",
          agentId: "cards",
          responseModel: "openai/gpt-5.5",
          responseSystemPrompt: "You are a baseball card expert.",
          responseTimeoutMs: 20000,
          tts: {
            providers: {
              openai: { voice: "alloy" },
            },
          },
        },
      },
    });

    expect(resolveVoiceCallNumberRouteKey(config, "+1 (555) 000-1111")).toBe(
      "+15550001111",
    );
    const effective = resolveVoiceCallEffectiveConfig(
      config,
      "+1 (555) 000-1111",
    );

    expect(effective.numberRouteKey).toBe("+15550001111");
    expect(effective.config.inboundGreeting).toBe(
      "Silver Fox Cards, how can I help?",
    );
    expect(effective.config.agentId).toBe("cards");
    expect(effective.config.responseModel).toBe("openai/gpt-5.5");
    expect(effective.config.responseSystemPrompt).toBe(
      "You are a baseball card expert.",
    );
    expect(effective.config.responseTimeoutMs).toBe(20000);
    expect(effective.config.tts?.provider).toBe("openai");
    expect(effective.config.tts?.providers?.openai).toEqual({
      voice: "alloy",
      speed: 1,
    });
  });

  it("falls back to global voice settings when no per-number route matches", () => {
    const config = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
      inboundGreeting: "Hello from global.",
      numbers: {
        "+15550001111": {
          inboundGreeting: "Hello from route.",
        },
      },
    });

    const effective = resolveVoiceCallEffectiveConfig(config, "+15550002222");

    expect(effective.numberRouteKey).toBeUndefined();
    expect(effective.config).toBe(config);
    expect(effective.config.inboundGreeting).toBe("Hello from global.");
  });
});

describe("normalizeVoiceCallConfig", () => {
  it("fills nested runtime defaults from a partial config boundary", () => {
    const normalized = normalizeVoiceCallConfig({
      enabled: true,
      provider: "mock",
      streaming: {
        enabled: true,
        streamPath: "/custom-stream",
      },
    });

    expect(normalized.serve.path).toBe("/voice/webhook");
    expect(normalized.streaming.streamPath).toBe("/custom-stream");
    expect(normalized.streaming.provider).toBeUndefined();
    expect(normalized.streaming.providers).toEqual({});
    expect(normalized.realtime.streamPath).toBe("/voice/stream/realtime");
    expect(normalized.realtime.toolPolicy).toBe("safe-read-only");
    expect(normalized.realtime.consultPolicy).toBe("auto");
    expect(normalized.realtime.fastContext).toEqual({
      enabled: false,
      timeoutMs: 800,
      maxResults: 3,
      sources: ["memory", "sessions"],
      fallbackToConsult: false,
    });
    expect(normalized.realtime.agentContext).toEqual({
      enabled: false,
      maxChars: 6000,
      includeIdentity: true,
      includeSystemPrompt: true,
      includeWorkspaceFiles: true,
      files: ["SOUL.md", "IDENTITY.md", "USER.md"],
    });
    expect(normalized.realtime.instructions).toContain(
      "openclaw_agent_consult",
    );
    expect(normalized.tunnel.provider).toBe("none");
    expect(normalized.webhookSecurity.allowedHosts).toEqual([]);
  });

  it("derives the realtime stream path from a custom webhook path", () => {
    const normalized = normalizeVoiceCallConfig({
      enabled: true,
      provider: "telnyx",
      serve: {
        path: "/custom/webhook",
      },
    });

    expect(normalized.realtime.streamPath).toBe("/custom/stream/realtime");
  });

  it("accepts partial nested TTS overrides and preserves nested objects", () => {
    const normalized = normalizeVoiceCallConfig({
      tts: {
        provider: "elevenlabs",
        providers: {
          elevenlabs: {
            apiKey: {
              source: "env",
              provider: "elevenlabs",
              id: "ELEVENLABS_API_KEY",
            },
            voiceSettings: {
              speed: 1.1,
            },
          },
        },
      },
    });

    const { tts, elevenlabs } = requireElevenLabsTtsConfig(normalized);
    expect(tts.provider).toBe("elevenlabs");
    expect(elevenlabs.apiKey).toEqual({
      source: "env",
      provider: "elevenlabs",
      id: "ELEVENLABS_API_KEY",
    });
    expect(elevenlabs.voiceSettings).toEqual({ speed: 1.1 });
  });
});

describe("resolveVoiceCallConfig realtime settings", () => {
  it.skip("preserves configured realtime instructions without env indirection", () => {
    const resolved = resolveVoiceCallConfig({
      enabled: true,
      provider: "telnyx",
      realtime: {
        enabled: true,
        instructions: "Stay concise.",
      },
    });

    expect(resolved.realtime.instructions).toBe("Stay concise.");
    expect(resolved.realtime.toolPolicy).toBe("safe-read-only");
    expect(resolved.realtime.consultPolicy).toBe("auto");
    expect(resolved.realtime.provider).toBeUndefined();
  });

  it("leaves responseModel unset so voice responses can inherit runtime defaults", () => {
    const resolved = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
    });

    expect(resolved.responseModel).toBeUndefined();
  });

  it("preserves the configured voice response agent id", () => {
    const resolved = resolveVoiceCallConfig({
      enabled: true,
      provider: "mock",
      agentId: "voice",
    });

    expect(resolved.agentId).toBe("voice");
  });
});
