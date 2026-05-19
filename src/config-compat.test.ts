import { describe, expect, it } from "vitest";
import {
  collectVoiceCallLegacyConfigIssues,
  formatVoiceCallLegacyConfigWarnings,
  migrateVoiceCallLegacyConfigInput,
  normalizeVoiceCallLegacyConfigInput,
} from "./config-compat.js";

describe("voice-call config compatibility", () => {
  it("maps legacy log provider and streaming fields into canonical config", () => {
    const migrated = migrateVoiceCallLegacyConfigInput({
      value: {
        provider: "log",
        streaming: {
          sttProvider: "openai",
          openaiApiKey: "sk-test",
          sttModel: "gpt-4o-mini-transcribe",
          silenceDurationMs: 700,
          vadThreshold: 0.45,
        },
      },
    });

    expect(migrated.config).toMatchObject({
      provider: "mock",
      streaming: {
        provider: "openai",
        providers: {
          openai: {
            apiKey: "sk-test",
            model: "gpt-4o-mini-transcribe",
            silenceDurationMs: 700,
            vadThreshold: 0.45,
          },
        },
      },
    });
    expect(migrated.changes).toEqual(
      expect.arrayContaining([
        expect.stringContaining('provider "log" → "mock"'),
        expect.stringContaining("streaming.sttProvider"),
        expect.stringContaining("streaming.openaiApiKey"),
      ]),
    );
  });

  it("reports doctor-oriented legacy issues and warnings", () => {
    const value = {
      provider: "log",
      streaming: { sttProvider: "openai", openaiApiKey: "sk-test" },
    };

    expect(collectVoiceCallLegacyConfigIssues(value)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ path: "provider" }),
        expect.objectContaining({ path: "streaming.sttProvider" }),
        expect.objectContaining({ path: "streaming.openaiApiKey" }),
      ]),
    );
    expect(
      formatVoiceCallLegacyConfigWarnings({
        value,
        configPathPrefix: "plugins.entries.voice-call.config",
        doctorFixCommand: "voicecall doctor --fix",
      }),
    ).toEqual(
      expect.arrayContaining([
        expect.stringContaining("legacy config keys detected"),
        expect.stringContaining("voicecall doctor --fix"),
      ]),
    );
  });

  it("normalizes legacy input directly", () => {
    expect(
      normalizeVoiceCallLegacyConfigInput({ provider: "log" }),
    ).toMatchObject({ provider: "mock" });
  });
});
