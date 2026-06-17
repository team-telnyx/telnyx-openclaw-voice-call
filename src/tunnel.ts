/**
 * Tunnel configuration for exposing the webhook server.
 */
interface TunnelConfig {
  /** Tunnel provider: ngrok, tailscale-serve, or tailscale-funnel */
  provider: "ngrok" | "tailscale-serve" | "tailscale-funnel" | "none";
  /** Local port to tunnel */
  port: number;
  /** Path prefix for the tunnel (e.g., /voice/webhook) */
  path: string;
  /** ngrok auth token (optional, enables longer sessions) */
  ngrokAuthToken?: string;
  /** ngrok custom domain (paid feature) */
  ngrokDomain?: string;
}

/**
 * Result of starting a tunnel.
 */
export interface TunnelResult {
  /** The public URL */
  publicUrl: string;
  /** Function to stop the tunnel */
  stop: () => Promise<void>;
  /** Tunnel provider name */
  provider: string;
}

/**
 * Start an ngrok tunnel to expose the local webhook server.
 *
 * Uses the ngrok CLI which must be installed: https://ngrok.com/download
 *
 * @example
 * const tunnel = await startNgrokTunnel({ port: 3334, path: '/voice/webhook' });
 * console.log('Public URL:', tunnel.publicUrl);
 * // Later: await tunnel.stop();
 */
export async function startNgrokTunnel(config: {
  port: number;
  path: string;
  authToken?: string;
  domain?: string;
}): Promise<TunnelResult> {
  void config;
  throw new Error(
    "Automatic ngrok startup is disabled for install-safe OpenClaw plugins. " +
      "Start ngrok separately and set publicUrl in the voice-call config.",
  );
}

/**
 * Check if ngrok is installed and available.
 */
export async function isNgrokAvailable(): Promise<boolean> {
  return false;
}

/**
 * Start a Tailscale serve/funnel tunnel.
 */
export async function startTailscaleTunnel(config: {
  mode: "serve" | "funnel";
  port: number;
  path: string;
}): Promise<TunnelResult> {
  void config;
  throw new Error(
    "Automatic Tailscale exposure is disabled for install-safe OpenClaw plugins. " +
      "Configure Tailscale separately and set publicUrl in the voice-call config.",
  );
}

/**
 * Start a tunnel based on configuration.
 */
export async function startTunnel(
  config: TunnelConfig,
): Promise<TunnelResult | null> {
  switch (config.provider) {
    case "ngrok":
      return startNgrokTunnel({
        port: config.port,
        path: config.path,
        authToken: config.ngrokAuthToken,
        domain: config.ngrokDomain,
      });

    case "tailscale-serve":
      return startTailscaleTunnel({
        mode: "serve",
        port: config.port,
        path: config.path,
      });

    case "tailscale-funnel":
      return startTailscaleTunnel({
        mode: "funnel",
        port: config.port,
        path: config.path,
      });

    default:
      return null;
  }
}
