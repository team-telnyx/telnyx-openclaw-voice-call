import { describe, expect, it } from "vitest";

import {
  isNgrokAvailable,
  startNgrokTunnel,
  startTailscaleTunnel,
  startTunnel,
} from "./tunnel.js";

describe("voice-call tunnels", () => {
  it("does not auto-start ngrok from the plugin runtime", async () => {
    await expect(isNgrokAvailable()).resolves.toBe(false);
    await expect(
      startNgrokTunnel({ port: 3334, path: "/voice/webhook" }),
    ).rejects.toThrow("Automatic ngrok startup is disabled");
  });

  it("does not auto-start Tailscale from the plugin runtime", async () => {
    await expect(
      startTailscaleTunnel({ mode: "serve", port: 3334, path: "/voice" }),
    ).rejects.toThrow("Automatic Tailscale exposure is disabled");
  });

  it("returns null when no tunnel provider is selected", async () => {
    await expect(
      startTunnel({ provider: "none", port: 3334, path: "/hook" }),
    ).resolves.toBeNull();
  });

  it("surfaces a setup error when an automatic tunnel provider is selected", async () => {
    await expect(
      startTunnel({ provider: "ngrok", port: 3334, path: "/hook" }),
    ).rejects.toThrow("Automatic ngrok startup is disabled");

    await expect(
      startTunnel({ provider: "tailscale-funnel", port: 3334, path: "/hook" }),
    ).rejects.toThrow("Automatic Tailscale exposure is disabled");
  });
});
