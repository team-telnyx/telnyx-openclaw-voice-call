import crypto from "node:crypto";
import { describe, expect, it } from "vitest";
import { verifyTelnyxWebhook } from "./webhook-security.js";

function createSignedTelnyxWebhookRequest() {
  const { publicKey, privateKey } = crypto.generateKeyPairSync("ed25519");
  const pemPublicKey = publicKey
    .export({ format: "pem", type: "spki" })
    .toString();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const rawBody = JSON.stringify({
    data: {
      event_type: "call.initiated",
      payload: { call_control_id: "call-1" },
    },
    nonce: crypto.randomUUID(),
  });
  const signedPayload = `${timestamp}|${rawBody}`;
  const signature = crypto
    .sign(null, Buffer.from(signedPayload), privateKey)
    .toString("base64");

  return {
    pemPublicKey,
    timestamp,
    rawBody,
    signature,
    makeCtx(signatureValue = signature) {
      return {
        headers: {
          "telnyx-signature-ed25519": signatureValue,
          "telnyx-timestamp": timestamp,
        },
        rawBody,
        url: "https://example.com/voice/webhook",
        method: "POST" as const,
      };
    },
  };
}

describe("verifyTelnyxWebhook", () => {
  it("treats Base64 and Base64URL signatures as the same replayed request", () => {
    const request = createSignedTelnyxWebhookRequest();
    const urlSafeSignature = request.signature
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/g, "");

    const first = verifyTelnyxWebhook(request.makeCtx(), request.pemPublicKey);
    const second = verifyTelnyxWebhook(
      request.makeCtx(urlSafeSignature),
      request.pemPublicKey,
    );

    expect(first).toMatchObject({ ok: true });
    expect(second).toMatchObject({ ok: true, isReplay: true });
    expect(second.verifiedRequestKey).toBe(first.verifiedRequestKey);
  });
});
