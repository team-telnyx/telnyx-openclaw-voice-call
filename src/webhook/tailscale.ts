import type { VoiceCallConfig } from "../config.js";

type TailscaleSelfInfo = {
  dnsName: string | null;
  nodeId: string | null;
};

export async function getTailscaleSelfInfo(): Promise<TailscaleSelfInfo | null> {
  return null;
}

export async function getTailscaleDnsName(): Promise<string | null> {
  const info = await getTailscaleSelfInfo();
  return info?.dnsName ?? null;
}

export async function setupTailscaleExposureRoute(opts: {
  mode: "serve" | "funnel";
  path: string;
  localUrl: string;
}): Promise<string | null> {
  void opts;
  console.warn(
    "[voice-call] Automatic Tailscale exposure is disabled for install-safe OpenClaw plugins. " +
      "Configure Tailscale separately and set publicUrl in the voice-call config.",
  );
  return null;
}

export async function cleanupTailscaleExposureRoute(opts: {
  mode: "serve" | "funnel";
  path: string;
}): Promise<void> {
  void opts;
  return;
}

export async function setupTailscaleExposure(
  config: VoiceCallConfig,
): Promise<string | null> {
  if (config.tailscale.mode === "off") {
    return null;
  }

  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  const localUrl = `http://127.0.0.1:${config.serve.port}${config.serve.path}`;
  return setupTailscaleExposureRoute({
    mode,
    path: config.tailscale.path,
    localUrl,
  });
}

export async function cleanupTailscaleExposure(
  config: VoiceCallConfig,
): Promise<void> {
  if (config.tailscale.mode === "off") {
    return;
  }

  const mode = config.tailscale.mode === "funnel" ? "funnel" : "serve";
  await cleanupTailscaleExposureRoute({ mode, path: config.tailscale.path });
}
