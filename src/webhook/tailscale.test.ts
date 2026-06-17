import { describe, expect, it } from "vitest";

import {
  cleanupTailscaleExposure,
  cleanupTailscaleExposureRoute,
  getTailscaleDnsName,
  getTailscaleSelfInfo,
  setupTailscaleExposure,
  setupTailscaleExposureRoute,
} from "./tailscale.js";

describe("voice-call tailscale helpers", () => {
  it("does not inspect or auto-configure the local Tailscale CLI", async () => {
    await expect(getTailscaleSelfInfo()).resolves.toBeNull();
    await expect(getTailscaleDnsName()).resolves.toBeNull();
  });

  it("returns null for automatic exposure setup", async () => {
    await expect(
      setupTailscaleExposureRoute({
        mode: "serve",
        path: "/voice",
        localUrl: "http://127.0.0.1:8787/webhook",
      }),
    ).resolves.toBeNull();

    await expect(
      setupTailscaleExposure({
        tailscale: { mode: "funnel", path: "/voice" },
        serve: { port: 8787, path: "/webhook" },
      } as never),
    ).resolves.toBeNull();
  });

  it("treats cleanup as a no-op", async () => {
    await expect(
      cleanupTailscaleExposureRoute({ mode: "serve", path: "/voice" }),
    ).resolves.toBeUndefined();

    await expect(
      cleanupTailscaleExposure({
        tailscale: { mode: "serve", path: "/voice" },
        serve: { port: 8787, path: "/webhook" },
      } as never),
    ).resolves.toBeUndefined();
  });
});
