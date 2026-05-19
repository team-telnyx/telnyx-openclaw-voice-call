import crypto from "node:crypto";
import { formatErrorMessage } from "openclaw/plugin-sdk/error-runtime";
import { getHeader } from "./http-headers.js";
import type { WebhookContext } from "./types.js";

const REPLAY_WINDOW_MS = 10 * 60 * 1000;
const REPLAY_CACHE_MAX_ENTRIES = 10_000;
const REPLAY_CACHE_PRUNE_INTERVAL = 64;

type ReplayCache = {
  seenUntil: Map<string, number>;
  calls: number;
};

const telnyxReplayCache: ReplayCache = {
  seenUntil: new Map<string, number>(),
  calls: 0,
};

function sha256Hex(input: string): string {
  return crypto.createHash("sha256").update(input).digest("hex");
}

function createSkippedVerificationReplayKey(
  provider: string,
  ctx: WebhookContext,
): string {
  return `${provider}:skip:${sha256Hex(`${ctx.method}\n${ctx.url}\n${ctx.rawBody}`)}`;
}

function pruneReplayCache(cache: ReplayCache, now: number): void {
  for (const [key, expiresAt] of cache.seenUntil) {
    if (expiresAt <= now) {
      cache.seenUntil.delete(key);
    }
  }
  while (cache.seenUntil.size > REPLAY_CACHE_MAX_ENTRIES) {
    const oldest = cache.seenUntil.keys().next().value;
    if (!oldest) {
      break;
    }
    cache.seenUntil.delete(oldest);
  }
}

function markReplay(cache: ReplayCache, replayKey: string): boolean {
  const now = Date.now();
  cache.calls += 1;
  if (cache.calls % REPLAY_CACHE_PRUNE_INTERVAL === 0) {
    pruneReplayCache(cache, now);
  }

  const existing = cache.seenUntil.get(replayKey);
  if (existing && existing > now) {
    return true;
  }

  cache.seenUntil.set(replayKey, now + REPLAY_WINDOW_MS);
  if (cache.seenUntil.size > REPLAY_CACHE_MAX_ENTRIES) {
    pruneReplayCache(cache, now);
  }
  return false;
}

function decodeBase64OrBase64Url(input: string): Buffer {
  // Telnyx docs say Base64; some tooling emits Base64URL. Accept both.
  const normalized = input.replace(/-/g, "+").replace(/_/g, "/");
  const padLen = (4 - (normalized.length % 4)) % 4;
  const padded = normalized + "=".repeat(padLen);
  return Buffer.from(padded, "base64");
}

function base64UrlEncode(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function importEd25519PublicKey(publicKey: string): crypto.KeyObject | string {
  const trimmed = publicKey.trim();

  // PEM (spki) support.
  if (trimmed.startsWith("-----BEGIN")) {
    return trimmed;
  }

  // Base64-encoded raw Ed25519 key (32 bytes) or Base64-encoded DER SPKI key.
  const decoded = decodeBase64OrBase64Url(trimmed);
  if (decoded.length === 32) {
    // JWK is the easiest portable way to import raw Ed25519 keys in Node crypto.
    return crypto.createPublicKey({
      key: { kty: "OKP", crv: "Ed25519", x: base64UrlEncode(decoded) },
      format: "jwk",
    });
  }

  return crypto.createPublicKey({
    key: decoded,
    format: "der",
    type: "spki",
  });
}

type TelnyxVerificationResult =
  | { ok: true; reason?: string; isReplay: boolean; verifiedRequestKey: string }
  | { ok: false; reason: string; isReplay?: undefined; verifiedRequestKey?: undefined };

/**
 * Verify Telnyx webhook signature using Ed25519.
 *
 * Telnyx signs `timestamp|payload` and provides:
 * - `telnyx-signature-ed25519` (Base64 signature)
 * - `telnyx-timestamp` (Unix seconds)
 */
export function verifyTelnyxWebhook(
  ctx: WebhookContext,
  publicKey: string | undefined,
  options?: {
    /** Skip verification entirely (only for development) */
    skipVerification?: boolean;
    /** Maximum allowed clock skew (ms). Defaults to 5 minutes. */
    maxSkewMs?: number;
  },
): TelnyxVerificationResult {
  if (options?.skipVerification) {
    const replayKey = createSkippedVerificationReplayKey("telnyx", ctx);
    const isReplay = markReplay(telnyxReplayCache, replayKey);
    return {
      ok: true,
      reason: "verification skipped (dev mode)",
      isReplay,
      verifiedRequestKey: replayKey,
    };
  }

  if (!publicKey) {
    return {
      ok: false,
      reason: "Missing telnyx.publicKey (configure to verify webhooks)",
    };
  }

  const signature = getHeader(ctx.headers, "telnyx-signature-ed25519");
  const timestamp = getHeader(ctx.headers, "telnyx-timestamp");

  if (!signature || !timestamp) {
    return { ok: false, reason: "Missing signature or timestamp header" };
  }

  const eventTimeSec = Number.parseInt(timestamp, 10);
  if (!Number.isFinite(eventTimeSec)) {
    return { ok: false, reason: "Invalid timestamp header" };
  }

  try {
    const signedPayload = `${timestamp}|${ctx.rawBody}`;
    const signatureBuffer = decodeBase64OrBase64Url(signature);
    // Canonicalize equivalent Base64/Base64URL encodings before replay hashing.
    const canonicalSignature = signatureBuffer.toString("base64");
    const key = importEd25519PublicKey(publicKey);

    const isValid = crypto.verify(
      null,
      Buffer.from(signedPayload),
      key,
      signatureBuffer,
    );
    if (!isValid) {
      return { ok: false, reason: "Invalid signature" };
    }

    const maxSkewMs = options?.maxSkewMs ?? 5 * 60 * 1000;
    const eventTimeMs = eventTimeSec * 1000;
    const now = Date.now();
    if (Math.abs(now - eventTimeMs) > maxSkewMs) {
      return { ok: false, reason: "Timestamp too old" };
    }

    const replayKey = `telnyx:${sha256Hex(`${timestamp}\n${canonicalSignature}\n${ctx.rawBody}`)}`;
    const isReplay = markReplay(telnyxReplayCache, replayKey);
    return { ok: true, isReplay, verifiedRequestKey: replayKey };
  } catch (err) {
    return {
      ok: false,
      reason: `Verification error: ${formatErrorMessage(err)}`,
    };
  }
}
