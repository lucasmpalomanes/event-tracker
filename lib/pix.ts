import "server-only";
import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "crypto";

// Thin Mercado Pago adapter (specs/pix-payments.md §5) — every PSP-specific
// detail lives here so switching PSPs is a one-file change. Uses the Orders
// API (POST /v1/orders), MP's current-generation API; the legacy Payments API
// is deprecated for new integrations.

const MP_BASE = "https://api.mercadopago.com";

// 7 days, as an ISO-8601 duration for MP and in ms for our local mirror
// (specs/pix-payments.md §5 "Charge parameters").
const EXPIRATION_ISO = "P7D";
const EXPIRATION_MS = 7 * 24 * 60 * 60 * 1000;

function accessToken(): string {
  const token = process.env.MP_ACCESS_TOKEN;
  if (!token) throw new Error("Missing MP_ACCESS_TOKEN environment variable");
  return token;
}

// The reconciliation key we generate and carry in MP's external_reference
// (26–35 alphanumeric chars, per the BCB txid convention the spec follows).
export function generateTxid(): string {
  return `gg${randomBytes(15).toString("hex")}`; // 32 chars
}

export type CreatedCharge = {
  brcode: string;
  pspChargeId: string;
  expiresAt: string;
};

type MpOrder = {
  id: string;
  status: string;
  last_updated_date?: string;
  transactions?: {
    payments?: {
      id: string;
      status: string;
      payment_method?: { qr_code?: string };
    }[];
  };
};

async function mpFetch(path: string, init?: RequestInit): Promise<Response> {
  return fetch(`${MP_BASE}${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${accessToken()}`,
      "Content-Type": "application/json",
      ...init?.headers,
    },
  });
}

// Creates an immediate dynamic Pix charge. MP requires the payer's email;
// no CPF/devedor is ever sent (specs/pix-payments.md §9).
export async function createCharge({
  txid,
  amountCents,
  payerEmail,
}: {
  txid: string;
  amountCents: number;
  payerEmail: string;
}): Promise<CreatedCharge> {
  const amount = (amountCents / 100).toFixed(2);
  const response = await mpFetch("/v1/orders", {
    method: "POST",
    headers: { "X-Idempotency-Key": randomUUID() },
    body: JSON.stringify({
      type: "online",
      processing_mode: "automatic",
      total_amount: amount,
      external_reference: txid,
      // Sandbox payers must be @testuser.com addresses (real emails are
      // rejected), and naming them APRO makes the test environment
      // auto-approve the Pix payment — the only way to exercise the paid
      // flow without real money. Production sends the real payer email.
      payer:
        process.env.NODE_ENV !== "production"
          ? { email: "test_user_br@testuser.com", first_name: "APRO" }
          : { email: payerEmail },
      transactions: {
        payments: [
          {
            amount,
            payment_method: { id: "pix", type: "bank_transfer" },
            expiration_time: EXPIRATION_ISO,
          },
        ],
      },
    }),
  });

  const body = (await response.json()) as MpOrder & { message?: string };
  if (!response.ok) {
    throw new Error(
      `Mercado Pago charge creation failed (${response.status}): ${
        body?.message ?? JSON.stringify(body)
      }`
    );
  }

  const brcode = body.transactions?.payments?.[0]?.payment_method?.qr_code;
  if (!brcode || !body.id) {
    throw new Error("Mercado Pago response missing qr_code or order id");
  }

  return {
    brcode,
    pspChargeId: body.id,
    expiresAt: new Date(Date.now() + EXPIRATION_MS).toISOString(),
  };
}

// Best-effort PSP-side cancelation (specs/pix-payments.md §5): the local row
// is canceled regardless, so failures here are logged and swallowed.
export async function cancelCharge(pspChargeId: string): Promise<void> {
  try {
    const response = await mpFetch(`/v1/orders/${pspChargeId}/cancel`, {
      method: "POST",
      headers: { "X-Idempotency-Key": randomUUID() },
    });
    if (!response.ok) {
      console.warn(
        `Pix: PSP-side cancel of ${pspChargeId} returned ${response.status}`
      );
    }
  } catch (error) {
    console.warn(`Pix: PSP-side cancel of ${pspChargeId} failed:`, error);
  }
}

export type ChargeStatus = {
  paid: boolean;
  status: string;
  paidAt: string | null;
};

// The webhook only carries the order id — the truth about the payment comes
// from this follow-up query (MP's recommended flow).
export async function getChargeStatus(
  pspChargeId: string
): Promise<ChargeStatus | null> {
  const response = await mpFetch(`/v1/orders/${pspChargeId}`);
  if (response.status === 404) return null;
  if (!response.ok) {
    throw new Error(`Mercado Pago order lookup failed (${response.status})`);
  }
  const order = (await response.json()) as MpOrder;
  const paid = order.status === "processed";
  return {
    paid,
    status: order.status,
    paidAt: paid ? (order.last_updated_date ?? new Date().toISOString()) : null,
  };
}

// Authenticates an incoming webhook call (specs/pix-payments.md §5): MP signs
// `id:{data.id, lowercased};request-id:{x-request-id};ts:{ts};` with the
// webhook secret (HMAC-SHA256, hex) and sends it as `v1` in x-signature.
export function verifyWebhook(request: Request): { orderId: string } | null {
  const secret = process.env.MP_WEBHOOK_SECRET;
  if (!secret) throw new Error("Missing MP_WEBHOOK_SECRET environment variable");

  const url = new URL(request.url);
  const dataId = url.searchParams.get("data.id") ?? "";
  const requestId = request.headers.get("x-request-id") ?? "";
  const signature = request.headers.get("x-signature") ?? "";

  let ts = "";
  let hash = "";
  for (const part of signature.split(",")) {
    const eq = part.indexOf("=");
    if (eq === -1) continue;
    const key = part.slice(0, eq).trim();
    const value = part.slice(eq + 1).trim();
    if (key === "ts") ts = value;
    if (key === "v1") hash = value;
  }
  if (!dataId || !ts || !hash) return null;

  const parts = [`id:${dataId.toLowerCase()}`];
  if (requestId) parts.push(`request-id:${requestId}`);
  parts.push(`ts:${ts}`);
  const manifest = parts.join(";") + ";";

  const computed = createHmac("sha256", secret).update(manifest).digest("hex");
  const a = Buffer.from(computed);
  const b = Buffer.from(hash);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  return { orderId: dataId };
}
