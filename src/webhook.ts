import http from "node:http";
import { URL } from "node:url";
import type { OpenClawConfig } from "openclaw/plugin-sdk/config-types";
import { resolveConfiguredCapabilityProvider } from "openclaw/plugin-sdk/provider-selection-runtime";
// TalkEvent type inlined since it may not be exported from the current SDK version
type TalkEvent = {
  type: string;
  timestamp: number;
  sessionId?: string;
  turnId?: string;
  [key: string]: unknown;
};
import { normalizeOptionalString } from "openclaw/plugin-sdk/text-runtime";
import {
  createWebhookInFlightLimiter,
  WEBHOOK_BODY_READ_DEFAULTS,
} from "openclaw/plugin-sdk/webhook-ingress";
import {
  isRequestBodyLimitError,
  readRequestBodyWithLimit,
  requestBodyErrorToText,
} from "../api.js";
import { isAllowlistedCaller, normalizePhoneNumber } from "./allowlist.js";
import {
  normalizeVoiceCallConfig,
  resolveVoiceCallEffectiveConfig,
  type VoiceCallConfig,
} from "./config.js";
import type { CoreAgentDeps, CoreConfig } from "./core-bridge.js";
import { getHeader } from "./http-headers.js";
import type { CallManager } from "./manager.js";
import type { VoiceCallProvider } from "./providers/base.js";

import type { CallRecord, NormalizedEvent, WebhookContext } from "./types.js";
import type { WebhookResponsePayload } from "./webhook.types.js";
import type { RealtimeCallHandler } from "./webhook/realtime-handler.js";
import { startStaleCallReaper } from "./webhook/stale-call-reaper.js";

const MAX_WEBHOOK_BODY_BYTES = WEBHOOK_BODY_READ_DEFAULTS.preAuth.maxBytes;
const WEBHOOK_BODY_TIMEOUT_MS = WEBHOOK_BODY_READ_DEFAULTS.preAuth.timeoutMs;
const MISSING_REMOTE_ADDRESS_IN_FLIGHT_KEY = "__voice_call_no_remote__";
const STREAM_DISCONNECT_HANGUP_GRACE_MS = 2000;
const TRANSCRIPT_LOG_MAX_CHARS = 200;

type RealtimeTranscriptionRuntime =
  typeof import("./realtime-transcription.runtime.js");
type ResponseGeneratorModule = typeof import("./response-generator.js");
type Logger = {
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
  debug?: (message: string) => void;
};

let realtimeTranscriptionRuntimePromise:
  | Promise<RealtimeTranscriptionRuntime>
  | undefined;
let responseGeneratorModulePromise:
  | Promise<ResponseGeneratorModule>
  | undefined;

function loadRealtimeTranscriptionRuntime(): Promise<RealtimeTranscriptionRuntime> {
  realtimeTranscriptionRuntimePromise ??=
    import("./realtime-transcription.runtime.js");
  return realtimeTranscriptionRuntimePromise;
}

function loadResponseGeneratorModule(): Promise<ResponseGeneratorModule> {
  responseGeneratorModulePromise ??= import("./response-generator.js");
  return responseGeneratorModulePromise;
}

type WebhookHeaderGateResult =
  | { ok: true }
  | {
      ok: false;
      reason: string;
    };

function sanitizeTranscriptForLog(value: string): string {
  const sanitized = value
    .replace(/\p{Cc}/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (sanitized.length <= TRANSCRIPT_LOG_MAX_CHARS) {
    return sanitized;
  }
  return `${sanitized.slice(0, TRANSCRIPT_LOG_MAX_CHARS)}...`;
}

function appendRecentTalkEventMetadata(
  call: CallRecord,
  event: TalkEvent,
): void {
  const metadata = call.metadata ?? {};
  const recent = Array.isArray(metadata.recentTalkEvents)
    ? metadata.recentTalkEvents.filter(
        (
          entry,
        ): entry is {
          at: number;
          type: string;
          sessionId?: string;
          turnId?: string;
        } => !!entry && typeof entry === "object" && !Array.isArray(entry),
      )
    : [];
  recent.push({
    at: event.timestamp,
    type: event.type,
    sessionId: event.sessionId,
    turnId: event.turnId,
  });
  call.metadata = {
    ...metadata,
    lastTalkEventAt: event.timestamp,
    lastTalkEventType: event.type,
    recentTalkEvents: recent.slice(-10),
  };
}

function buildRequestUrl(
  requestUrl: string | undefined,
  requestHost: string | undefined,
  fallbackHost = "localhost",
): URL {
  return new URL(requestUrl ?? "/", `http://${requestHost ?? fallbackHost}`);
}

function normalizeProxyIp(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) {
    return undefined;
  }
  const unwrapped =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;
  const normalized = unwrapped.toLowerCase();
  const mappedIpv4Prefix = "::ffff:";
  if (normalized.startsWith(mappedIpv4Prefix)) {
    const mappedIpv4 = normalized.slice(mappedIpv4Prefix.length);
    if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(mappedIpv4)) {
      return mappedIpv4;
    }
  }
  return normalized;
}

function resolveForwardedClientIp(
  request: http.IncomingMessage,
  trustedProxyIPs: readonly string[],
): string | undefined {
  const normalizedTrustedProxyIps = new Set(
    trustedProxyIPs
      .map((ip) => normalizeProxyIp(ip))
      .filter((ip): ip is string => Boolean(ip)),
  );
  const forwardedFor = getHeader(request.headers, "x-forwarded-for");
  if (forwardedFor) {
    const forwardedIps = forwardedFor
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean);
    if (forwardedIps.length > 0) {
      if (normalizedTrustedProxyIps.size === 0) {
        return forwardedIps[0];
      }
      for (let index = forwardedIps.length - 1; index >= 0; index -= 1) {
        const hop = forwardedIps[index];
        if (!normalizedTrustedProxyIps.has(normalizeProxyIp(hop) ?? "")) {
          return hop;
        }
      }
      return forwardedIps[0];
    }
  }

  const realIp = getHeader(request.headers, "x-real-ip")?.trim();
  return realIp || undefined;
}

function normalizeWebhookResponse(parsed: {
  statusCode?: number;
  providerResponseHeaders?: Record<string, string>;
  providerResponseBody?: string;
}): WebhookResponsePayload {
  return {
    statusCode: parsed.statusCode ?? 200,
    headers: parsed.providerResponseHeaders,
    body: parsed.providerResponseBody ?? "OK",
  };
}

/**
 * HTTP server for receiving voice call webhooks from providers.
 * Supports WebSocket upgrades for media streams when streaming is enabled.
 */
export class VoiceCallWebhookServer {
  private server: http.Server | null = null;
  private listeningUrl: string | null = null;
  private startPromise: Promise<string> | null = null;
  private config: VoiceCallConfig;
  private manager: CallManager;
  private provider: VoiceCallProvider;
  private coreConfig: CoreConfig | null;
  private fullConfig: OpenClawConfig | null;
  private agentRuntime: CoreAgentDeps | null;
  private logger: Logger;
  private stopStaleCallReaper: (() => void) | null = null;
  private readonly webhookInFlightLimiter = createWebhookInFlightLimiter();

  /** Delayed auto-hangup timers keyed by provider call ID after stream disconnect. */
  private pendingDisconnectHangups = new Map<
    string,
    ReturnType<typeof setTimeout>
  >();
  /** Realtime voice handler for duplex provider bridges. */
  private realtimeHandler: RealtimeCallHandler | null = null;

  constructor(
    config: VoiceCallConfig,
    manager: CallManager,
    provider: VoiceCallProvider,
    coreConfig?: CoreConfig,
    fullConfig?: OpenClawConfig,
    agentRuntime?: CoreAgentDeps,
    logger?: Logger,
  ) {
    this.config = normalizeVoiceCallConfig(config);
    this.manager = manager;
    this.provider = provider;
    this.coreConfig = coreConfig ?? null;
    this.fullConfig = fullConfig ?? null;
    this.agentRuntime = agentRuntime ?? null;
    this.logger = logger ?? {
      info: console.log,
      warn: console.warn,
      error: console.error,
      debug: console.debug,
    };
  }

  /**
   * Get the media stream handler (for wiring to provider).
   */
  getMediaStreamHandler(): unknown {
    return null;
  }

  getRealtimeHandler(): RealtimeCallHandler | null {
    return this.realtimeHandler;
  }

  speakRealtime(
    callId: string,
    instructions: string,
  ): { success: boolean; error?: string } {
    if (!this.realtimeHandler) {
      return {
        success: false,
        error: "Realtime voice handler is not configured",
      };
    }
    return this.realtimeHandler.speak(callId, instructions);
  }

  setRealtimeHandler(handler: RealtimeCallHandler): void {
    this.realtimeHandler = handler;
  }

  private clearPendingDisconnectHangup(providerCallId: string): void {
    const existing = this.pendingDisconnectHangups.get(providerCallId);
    if (!existing) {
      return;
    }
    clearTimeout(existing);
    this.pendingDisconnectHangups.delete(providerCallId);
  }

  private resolveMediaStreamClientIp(
    request: http.IncomingMessage,
  ): string | undefined {
    const remoteIp = request.socket.remoteAddress ?? undefined;
    const trustedProxyIPs =
      this.config.webhookSecurity.trustedProxyIPs.filter(Boolean);
    const normalizedTrustedProxyIps = new Set(
      trustedProxyIPs
        .map((ip) => normalizeProxyIp(ip))
        .filter((ip): ip is string => Boolean(ip)),
    );
    const normalizedRemoteIp = normalizeProxyIp(remoteIp);
    const fromTrustedProxy =
      normalizedTrustedProxyIps.size > 0 &&
      normalizedRemoteIp !== undefined &&
      normalizedTrustedProxyIps.has(normalizedRemoteIp);
    const shouldTrustForwardingHeaders =
      this.config.webhookSecurity.trustForwardingHeaders && fromTrustedProxy;

    if (shouldTrustForwardingHeaders) {
      const forwardedIp = resolveForwardedClientIp(request, trustedProxyIPs);
      if (forwardedIp) {
        return forwardedIp;
      }
    }

    return remoteIp;
  }

  private shouldSuppressBargeInForInitialMessage(
    call: CallRecord | undefined,
  ): boolean {
    if (!call || call.direction !== "outbound") {
      return false;
    }

    // Suppress only while the initial greeting is actively being played.
    // If playback fails and the call leaves "speaking", do not block auto-response.
    if (call.state !== "speaking") {
      return false;
    }

    const mode = (call.metadata?.mode as string | undefined) ?? "conversation";
    if (mode !== "conversation") {
      return false;
    }

    const initialMessage =
      normalizeOptionalString(call.metadata?.initialMessage) ?? "";
    return initialMessage.length > 0;
  }

  /**
   * Initialize media streaming with the selected realtime transcription provider.
   */
  /**
   * Initialize media streaming.
   * Note: Legacy media streaming (non-realtime STT) is not supported in this
   * Telnyx-only plugin. Use realtime mode for bidirectional voice AI.
   */
  private async initializeMediaStreaming(): Promise<void> {
    console.warn(
      "[voice-call] Legacy media streaming is not available in the Telnyx-only plugin. Use realtime mode instead.",
    );
  }

  /**
   * Start the webhook server.
   * Idempotent: returns immediately if the server is already listening.
   */
  async start(): Promise<string> {
    const { port, bind, path: webhookPath } = this.config.serve;
    const streamPath = this.config.streaming.streamPath;

    // Guard: if a server is already listening, return the existing URL.
    // This prevents EADDRINUSE when start() is called more than once on the
    // same instance (e.g. during config hot-reload or concurrent ensureRuntime).
    if (this.server?.listening) {
      return this.listeningUrl ?? this.resolveListeningUrl(bind, webhookPath);
    }

    if (this.config.streaming.enabled) {
      await this.initializeMediaStreaming();
    }

    if (this.startPromise) {
      return this.startPromise;
    }

    this.startPromise = new Promise((resolve, reject) => {
      this.server = http.createServer((req, res) => {
        this.handleRequest(req, res, webhookPath).catch((err) => {
          console.error("[voice-call] Webhook error:", err);
          res.statusCode = 500;
          res.end("Internal Server Error");
        });
      });

      // Handle WebSocket upgrades for realtime voice and media streams.
      if (this.realtimeHandler) {
        this.server.on("upgrade", (request, socket, head) => {
          if (this.isRealtimeWebSocketUpgrade(request)) {
            this.realtimeHandler!.handleWebSocketUpgrade(request, socket, head);
            return;
          }
          socket.destroy();
        });
      }

      this.server.on("error", (err) => {
        this.server = null;
        this.listeningUrl = null;
        this.startPromise = null;
        reject(err);
      });

      this.server.listen(port, bind, () => {
        const url = this.resolveListeningUrl(bind, webhookPath);
        this.listeningUrl = url;
        this.startPromise = null;
        this.logger.info(`[voice-call] Webhook server listening on ${url}`);

        resolve(url);

        // Start the stale call reaper if configured
        this.stopStaleCallReaper = startStaleCallReaper({
          manager: this.manager,
          staleCallReaperSeconds: this.config.staleCallReaperSeconds,
        });
      });
    });

    return this.startPromise;
  }

  /**
   * Stop the webhook server.
   */
  async stop(): Promise<void> {
    for (const timer of this.pendingDisconnectHangups.values()) {
      clearTimeout(timer);
    }
    this.pendingDisconnectHangups.clear();
    this.webhookInFlightLimiter.clear();
    this.startPromise = null;

    if (this.stopStaleCallReaper) {
      this.stopStaleCallReaper();
      this.stopStaleCallReaper = null;
    }
    return new Promise((resolve) => {
      if (this.server) {
        this.server.close(() => {
          this.server = null;
          this.listeningUrl = null;
          resolve();
        });
      } else {
        this.listeningUrl = null;
        resolve();
      }
    });
  }

  private resolveListeningUrl(bind: string, webhookPath: string): string {
    const address = this.server?.address();
    if (address && typeof address === "object") {
      const host =
        address.address && address.address.length > 0 ? address.address : bind;
      const normalizedHost =
        host.includes(":") && !host.startsWith("[") ? `[${host}]` : host;
      return `http://${normalizedHost}:${address.port}${webhookPath}`;
    }
    return `http://${bind}:${this.config.serve.port}${webhookPath}`;
  }

  private getUpgradePathname(request: http.IncomingMessage): string | null {
    try {
      return buildRequestUrl(request.url, request.headers.host).pathname;
    } catch {
      return null;
    }
  }

  private normalizeWebhookPathForMatch(pathname: string): string {
    const trimmed = pathname.trim();
    if (!trimmed) {
      return "/";
    }
    const prefixed = trimmed.startsWith("/") ? trimmed : `/${trimmed}`;
    if (prefixed === "/") {
      return prefixed;
    }
    return prefixed.endsWith("/") ? prefixed.slice(0, -1) : prefixed;
  }

  private isWebhookPathMatch(
    requestPath: string,
    configuredPath: string,
  ): boolean {
    return (
      this.normalizeWebhookPathForMatch(requestPath) ===
      this.normalizeWebhookPathForMatch(configuredPath)
    );
  }

  /**
   * Handle incoming HTTP request.
   */
  private async handleRequest(
    req: http.IncomingMessage,
    res: http.ServerResponse,
    webhookPath: string,
  ): Promise<void> {
    const payload = await this.runWebhookPipeline(req, webhookPath);
    this.writeWebhookResponse(res, payload);
  }

  private async runWebhookPipeline(
    req: http.IncomingMessage,
    webhookPath: string,
  ): Promise<WebhookResponsePayload> {
    const url = buildRequestUrl(req.url, req.headers.host);

    if (url.pathname === "/voice/hold-music") {
      return {
        statusCode: 200,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          status: "hold",
          message: "All agents are currently busy. Please hold.",
        }),
      };
    }

    if (!this.isWebhookPathMatch(url.pathname, webhookPath)) {
      return { statusCode: 404, body: "Not Found" };
    }

    if (req.method !== "POST") {
      return { statusCode: 405, body: "Method Not Allowed" };
    }

    const headerGate = this.verifyPreAuthWebhookHeaders(req.headers);
    if (!headerGate.ok) {
      console.warn(
        `[voice-call] Webhook rejected before body read: ${headerGate.reason}`,
      );
      return { statusCode: 401, body: "Unauthorized" };
    }

    // createWebhookInFlightLimiter intentionally treats an empty key as fail-open.
    // Missing socket metadata must still share one bucket instead of bypassing
    // the pre-auth limiter entirely.
    const remoteAddress = req.socket.remoteAddress;
    if (!remoteAddress) {
      console.warn(
        `[voice-call] Webhook accepted with no remote address; using shared fallback in-flight key`,
      );
    }
    const inFlightKey = remoteAddress || MISSING_REMOTE_ADDRESS_IN_FLIGHT_KEY;
    if (!this.webhookInFlightLimiter.tryAcquire(inFlightKey)) {
      console.warn(
        `[voice-call] Webhook rejected before body read: too many in-flight requests`,
      );
      return { statusCode: 429, body: "Too Many Requests" };
    }

    try {
      let body = "";
      try {
        body = await this.readBody(
          req,
          MAX_WEBHOOK_BODY_BYTES,
          WEBHOOK_BODY_TIMEOUT_MS,
        );
      } catch (err) {
        if (isRequestBodyLimitError(err, "PAYLOAD_TOO_LARGE")) {
          return { statusCode: 413, body: "Payload Too Large" };
        }
        if (isRequestBodyLimitError(err, "REQUEST_BODY_TIMEOUT")) {
          return {
            statusCode: 408,
            body: requestBodyErrorToText("REQUEST_BODY_TIMEOUT"),
          };
        }
        throw err;
      }

      const ctx: WebhookContext = {
        headers: req.headers as Record<string, string | string[] | undefined>,
        rawBody: body,
        url: url.toString(),
        method: "POST",
        query: Object.fromEntries(url.searchParams),
        remoteAddress: req.socket.remoteAddress ?? undefined,
      };

      const verification = this.provider.verifyWebhook(ctx);
      if (!verification.ok) {
        console.warn(
          `[voice-call] Webhook verification failed: ${verification.reason}`,
        );
        return { statusCode: 401, body: "Unauthorized" };
      }
      if (!verification.verifiedRequestKey) {
        console.warn(
          "[voice-call] Webhook verification succeeded without request identity key",
        );
        return { statusCode: 401, body: "Unauthorized" };
      }

      const parsed = this.provider.parseWebhookEvent(ctx, {
        verifiedRequestKey: verification.verifiedRequestKey,
      });

      if (verification.isReplay) {
        console.warn(
          "[voice-call] Replay detected; skipping event side effects",
        );
      } else {
        this.processParsedEvents(parsed.events);
      }

      return normalizeWebhookResponse(parsed);
    } finally {
      this.webhookInFlightLimiter.release(inFlightKey);
    }
  }

  private verifyPreAuthWebhookHeaders(
    headers: http.IncomingHttpHeaders,
  ): WebhookHeaderGateResult {
    if (this.config.skipSignatureVerification) {
      return { ok: true };
    }
    switch (this.provider.name) {
      case "telnyx": {
        const signature = getHeader(headers, "telnyx-signature-ed25519");
        const timestamp = getHeader(headers, "telnyx-timestamp");
        if (signature && timestamp) {
          return { ok: true };
        }
        return {
          ok: false,
          reason: "missing Telnyx signature or timestamp header",
        };
      }

      default:
        return { ok: true };
    }
  }

  private isRealtimeWebSocketUpgrade(req: http.IncomingMessage): boolean {
    try {
      const pathname = buildRequestUrl(req.url, req.headers.host).pathname;
      const pattern = this.realtimeHandler?.getStreamPathPattern();
      return Boolean(pattern && pathname.startsWith(pattern));
    } catch {
      return false;
    }
  }

  private shouldAcceptRealtimeInboundRequest(params: URLSearchParams): boolean {
    switch (this.config.inboundPolicy) {
      case "open":
        return true;
      case "allowlist":
      case "pairing":
        return isAllowlistedCaller(
          normalizePhoneNumber(params.get("From") ?? undefined),
          this.config.allowFrom,
        );
      case "disabled":
      default:
        return false;
    }
  }

  private processParsedEvents(events: NormalizedEvent[]): void {
    for (const event of events) {
      try {
        this.manager.processEvent(event);
      } catch (err) {
        console.error(
          `[voice-call] Error processing event ${event.type}:`,
          err,
        );
      }
    }
  }

  private writeWebhookResponse(
    res: http.ServerResponse,
    payload: WebhookResponsePayload,
  ): void {
    res.statusCode = payload.statusCode;
    if (payload.headers) {
      for (const [key, value] of Object.entries(payload.headers)) {
        res.setHeader(key, value);
      }
    }
    res.end(payload.body);
  }

  /**
   * Read request body as string with timeout protection.
   */
  private readBody(
    req: http.IncomingMessage,
    maxBytes: number,
    timeoutMs = WEBHOOK_BODY_TIMEOUT_MS,
  ): Promise<string> {
    return readRequestBodyWithLimit(req, { maxBytes, timeoutMs });
  }

  /**
   * Handle auto-response for inbound calls using the agent system.
   * Supports tool calling for richer voice interactions.
   */
  private async handleInboundResponse(
    callId: string,
    userMessage: string,
  ): Promise<void> {
    console.log(
      `[voice-call] Auto-responding to inbound call ${callId}: "${userMessage}"`,
    );

    // Get call context for conversation history
    const call = this.manager.getCall(callId);
    if (!call) {
      console.warn(`[voice-call] Call ${callId} not found for auto-response`);
      return;
    }

    if (!this.coreConfig) {
      console.warn("[voice-call] Core config missing; skipping auto-response");
      return;
    }
    if (!this.agentRuntime) {
      console.warn(
        "[voice-call] Agent runtime missing; skipping auto-response",
      );
      return;
    }

    try {
      const { generateVoiceResponse } = await loadResponseGeneratorModule();
      const numberRouteKey =
        typeof call.metadata?.numberRouteKey === "string"
          ? call.metadata.numberRouteKey
          : call.to;
      const effectiveConfig = resolveVoiceCallEffectiveConfig(
        this.config,
        numberRouteKey,
      ).config;

      const result = await generateVoiceResponse({
        voiceConfig: effectiveConfig,
        coreConfig: this.coreConfig,
        agentRuntime: this.agentRuntime,
        callId,
        sessionKey: call.sessionKey,
        from: call.from,
        transcript: call.transcript,
        userMessage,
      });

      if (result.error) {
        console.error(
          `[voice-call] Response generation error: ${result.error}`,
        );
        return;
      }

      if (result.text) {
        console.log(`[voice-call] AI response: "${result.text}"`);
        await this.manager.speak(callId, result.text);
      }
    } catch (err) {
      console.error(`[voice-call] Auto-response error:`, err);
    }
  }
}
