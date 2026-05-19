import * as fs from "node:fs";
import * as path from "node:path";
import { guardedJsonApiRequest } from "./providers/shared/guarded-json-api.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const TELNYX_API_BASE = "https://api.telnyx.com/v2";
const TELNYX_ALLOWED_HOSTNAMES = ["api.telnyx.com"];
const PROVISIONED_STATE_FILE = "provisioned.json";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ProvisioningResult = {
  /** Telnyx Call Control Application ID */
  applicationId: string;
  /** Connection/app ID for use as `connectionId` in the provider config */
  connectionId: string;
  /** Purchased E.164 phone number */
  fromNumber: string;
  /** Number order ID (for cleanup) */
  numberOrderId: string;
};

export type ProvisionedState = ProvisioningResult & {
  /** ISO timestamp when provisioning occurred */
  provisionedAt: string;
};

// ---------------------------------------------------------------------------
// Telnyx API response shapes (minimal)
// ---------------------------------------------------------------------------

type TelnyxCCAResponse = {
  data: {
    id: string;
    connection_id?: string;
    outbound?: {
      channel_limit: number;
      outbound_voice_profile_id: string | null;
    };
  };
};

type TelnyxAvailableNumbersResponse = {
  data: Array<{
    phone_number: string;
    region_information?: unknown;
    cost?: unknown;
  }>;
};

type TelnyxNumberOrderResponse = {
  data: {
    id: string;
    phone_numbers: Array<{ id: string; phone_number: string }>;
    connection_id?: string;
    status: string;
  };
};

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function authHeaders(apiKey: string): Record<string, string> {
  return {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
  };
}

function resolveStorePath(storePath: string | undefined): string {
  return storePath ?? process.cwd();
}

function provisionedStatePath(storePath: string | undefined): string {
  return path.join(resolveStorePath(storePath), PROVISIONED_STATE_FILE);
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

/**
 * Load previously provisioned state from disk. Returns null if not found.
 */
export function loadProvisionedState(
  storePath: string | undefined,
): ProvisionedState | null {
  const filePath = provisionedStatePath(storePath);
  try {
    const raw = fs.readFileSync(filePath, "utf8");
    return JSON.parse(raw) as ProvisionedState;
  } catch {
    return null;
  }
}

function saveProvisionedState(
  storePath: string | undefined,
  state: ProvisionedState,
): void {
  const filePath = provisionedStatePath(storePath);
  const dir = path.dirname(filePath);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(state, null, 2), "utf8");
}

function deleteProvisionedState(storePath: string | undefined): void {
  const filePath = provisionedStatePath(storePath);
  try {
    fs.unlinkSync(filePath);
  } catch {
    // Ignore — file may not exist
  }
}

// ---------------------------------------------------------------------------
// Provisioning steps
// ---------------------------------------------------------------------------

async function createCallControlApplication(params: {
  apiKey: string;
  webhookUrl: string;
}): Promise<{ applicationId: string; connectionId: string }> {
  const response = await guardedJsonApiRequest<TelnyxCCAResponse>({
    url: `${TELNYX_API_BASE}/call_control_applications`,
    method: "POST",
    headers: authHeaders(params.apiKey),
    body: {
      application_name: "OpenClaw Voice AI Agent",
      webhook_event_url: params.webhookUrl,
      webhook_event_failover_url: "",
      dtmf_type: "RFC 2833",
      first_command_timeout: true,
      first_command_timeout_secs: 30,
    },
    allowedHostnames: TELNYX_ALLOWED_HOSTNAMES,
    auditContext: "voice-call:provisioning:create-cca",
    errorPrefix: "[voice-call:provisioning] Failed to create Call Control Application",
  });

  const applicationId = response.data.id;
  // The connection_id is the same as the application id for CC apps
  const connectionId = response.data.connection_id ?? applicationId;

  return { applicationId, connectionId };
}

async function searchAvailablePhoneNumber(params: {
  apiKey: string;
}): Promise<string> {
  const url =
    `${TELNYX_API_BASE}/available_phone_numbers` +
    `?filter[country_code]=US&filter[features][]=voice&filter[limit]=1`;

  const response = await guardedJsonApiRequest<TelnyxAvailableNumbersResponse>(
    {
      url,
      method: "GET",
      headers: authHeaders(params.apiKey),
      allowedHostnames: TELNYX_ALLOWED_HOSTNAMES,
      auditContext: "voice-call:provisioning:search-numbers",
      errorPrefix:
        "[voice-call:provisioning] Failed to search available phone numbers",
    },
  );

  const first = response.data?.[0];
  if (!first?.phone_number) {
    throw new Error(
      "[voice-call:provisioning] No available US voice phone numbers found",
    );
  }

  return first.phone_number;
}

async function orderPhoneNumber(params: {
  apiKey: string;
  phoneNumber: string;
  connectionId: string;
}): Promise<{ numberOrderId: string; fromNumber: string }> {
  const response = await guardedJsonApiRequest<TelnyxNumberOrderResponse>({
    url: `${TELNYX_API_BASE}/number_orders`,
    method: "POST",
    headers: authHeaders(params.apiKey),
    body: {
      phone_numbers: [{ phone_number: params.phoneNumber }],
      connection_id: params.connectionId,
    },
    allowedHostnames: TELNYX_ALLOWED_HOSTNAMES,
    auditContext: "voice-call:provisioning:order-number",
    errorPrefix: "[voice-call:provisioning] Failed to order phone number",
  });

  const numberOrderId = response.data.id;
  const fromNumber =
    response.data.phone_numbers?.[0]?.phone_number ?? params.phoneNumber;

  return { numberOrderId, fromNumber };
}

// ---------------------------------------------------------------------------
// Deprovision
// ---------------------------------------------------------------------------

/**
 * Clean up provisioned resources: delete the number order and the CC application.
 * Errors are caught and logged but do not throw.
 */
export async function deprovision(params: {
  apiKey: string;
  storePath?: string;
  state?: ProvisionedState;
  logger?: { warn: (msg: string) => void; info: (msg: string) => void };
}): Promise<void> {
  const log = params.logger ?? {
    info: console.log,
    warn: console.warn,
  };

  const state = params.state ?? loadProvisionedState(params.storePath);
  if (!state) {
    log.warn("[voice-call:provisioning] No provisioned state found — nothing to deprovision");
    return;
  }

  // Delete number order
  try {
    await guardedJsonApiRequest({
      url: `${TELNYX_API_BASE}/number_orders/${state.numberOrderId}`,
      method: "DELETE",
      headers: authHeaders(params.apiKey),
      allowNotFound: true,
      allowedHostnames: TELNYX_ALLOWED_HOSTNAMES,
      auditContext: "voice-call:provisioning:delete-number-order",
      errorPrefix: "[voice-call:provisioning] Failed to delete number order",
    });
    log.info(
      `[voice-call:provisioning] Deleted number order: ${state.numberOrderId}`,
    );
  } catch (err) {
    log.warn(
      `[voice-call:provisioning] Could not delete number order ${state.numberOrderId}: ${String(err)}`,
    );
  }

  // Delete CC application
  try {
    await guardedJsonApiRequest({
      url: `${TELNYX_API_BASE}/call_control_applications/${state.applicationId}`,
      method: "DELETE",
      headers: authHeaders(params.apiKey),
      allowNotFound: true,
      allowedHostnames: TELNYX_ALLOWED_HOSTNAMES,
      auditContext: "voice-call:provisioning:delete-cca",
      errorPrefix:
        "[voice-call:provisioning] Failed to delete Call Control Application",
    });
    log.info(
      `[voice-call:provisioning] Deleted CC application: ${state.applicationId}`,
    );
  } catch (err) {
    log.warn(
      `[voice-call:provisioning] Could not delete CC application ${state.applicationId}: ${String(err)}`,
    );
  }

  deleteProvisionedState(params.storePath);
  log.info("[voice-call:provisioning] Deprovisioned successfully");
}

// ---------------------------------------------------------------------------
// Main provision() entry point
// ---------------------------------------------------------------------------

/**
 * Auto-provision a Telnyx Call Control Application + phone number.
 *
 * Idempotent: if `storePath/provisioned.json` already exists the persisted
 * result is returned without making any API calls.
 *
 * Skips provisioning if both `connectionId` and `fromNumber` are already
 * present in the supplied arguments.
 */
export async function provision(params: {
  apiKey: string;
  /** Existing connection ID — if set, skip CC app creation */
  connectionId?: string;
  /** Existing from-number — if set, skip phone number ordering */
  fromNumber?: string;
  /** Public webhook URL to register on the CC application */
  webhookUrl: string;
  /** Directory where provisioned.json is stored */
  storePath?: string;
  logger?: {
    info: (msg: string) => void;
    warn: (msg: string) => void;
  };
}): Promise<ProvisioningResult> {
  const log = params.logger ?? { info: console.log, warn: console.warn };

  // 1. Already fully configured — nothing to do
  if (params.connectionId && params.fromNumber) {
    log.info(
      "[voice-call:provisioning] connectionId and fromNumber already set — skipping auto-provision",
    );
    return {
      applicationId: params.connectionId,
      connectionId: params.connectionId,
      fromNumber: params.fromNumber,
      numberOrderId: "",
    };
  }

  // 2. Check persisted state from a previous run
  const persisted = loadProvisionedState(params.storePath);
  if (persisted) {
    log.info(
      `[voice-call:provisioning] Loaded persisted state — fromNumber: ${persisted.fromNumber}, connectionId: ${persisted.connectionId}`,
    );
    return persisted;
  }

  log.info("[voice-call:provisioning] Starting auto-provisioning…");

  // 3. Create Call Control Application (unless connectionId already supplied)
  let { connectionId, applicationId } = {
    connectionId: params.connectionId ?? "",
    applicationId: params.connectionId ?? "",
  };

  if (!connectionId) {
    const cca = await createCallControlApplication({
      apiKey: params.apiKey,
      webhookUrl: params.webhookUrl,
    });
    connectionId = cca.connectionId;
    applicationId = cca.applicationId;
    log.info(
      `[voice-call:provisioning] Created CC application: ${applicationId} (connectionId: ${connectionId})`,
    );
  }

  // 4 & 5. Search + order phone number (unless fromNumber already supplied)
  let fromNumber = params.fromNumber ?? "";
  let numberOrderId = "";

  if (!fromNumber) {
    const available = await searchAvailablePhoneNumber({
      apiKey: params.apiKey,
    });
    log.info(`[voice-call:provisioning] Found available number: ${available}`);

    const order = await orderPhoneNumber({
      apiKey: params.apiKey,
      phoneNumber: available,
      connectionId,
    });
    fromNumber = order.fromNumber;
    numberOrderId = order.numberOrderId;
    log.info(
      `[voice-call:provisioning] Ordered number: ${fromNumber} (orderId: ${numberOrderId})`,
    );
  }

  // 6. Persist state
  const result: ProvisioningResult = {
    applicationId,
    connectionId,
    fromNumber,
    numberOrderId,
  };
  const state: ProvisionedState = {
    ...result,
    provisionedAt: new Date().toISOString(),
  };
  saveProvisionedState(params.storePath, state);
  log.info(
    `[voice-call:provisioning] Provisioning complete — fromNumber: ${fromNumber}`,
  );

  return result;
}
