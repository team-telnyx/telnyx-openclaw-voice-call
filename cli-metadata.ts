import { definePluginEntry } from "openclaw/plugin-sdk/plugin-entry";
import { registerVoiceCallCli } from "./src/cli.js";
import {
  resolveVoiceCallConfig,
  VoiceCallConfigSchema,
} from "./src/config.js";

export default definePluginEntry({
  id: "telnyx-voice-call",
  name: "Voice Call",
  description: "Voice call channel plugin",
  register(api) {
    api.registerCli(
      ({ program, config }) => {
        const pluginConfig =
          config.plugins?.entries?.["telnyx-voice-call"]?.config ??
          config.plugins?.entries?.["voice-call"]?.config;
        const voiceConfig = resolveVoiceCallConfig(
          VoiceCallConfigSchema.parse(pluginConfig),
        );

        registerVoiceCallCli({
          program,
          config: voiceConfig,
          ensureRuntime: async () => {
            throw new Error("Voice Call runtime is unavailable from CLI setup");
          },
          logger: api.logger,
        });
      },
      {
        descriptors: [
          {
            name: "voicecall",
            description: "Voice call utilities",
            hasSubcommands: true,
          },
        ],
      },
    );
  },
});
