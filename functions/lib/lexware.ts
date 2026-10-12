/**
 * Client for the Lexware Office Public API (https://developers.lexware.io/docs/).
 *
 * What shapes it:
 * - 2 requests per second for the whole account. Over the limit Lexware answers 429 without
 *   performing the call, so a short wait and a repeat is always safe.
 * - No idempotency key. When a create call ends without an answer (timeout, 5xx), the
 *   document may or may not exist. Such errors are marked `uncertain` and the caller looks
 *   the document up before it creates again.
 * - Error bodies come in two shapes and their messages are German.
 */

const BASE_URL = "https://api.lexware.io/v1";

// A function has 10 seconds in total. One call is cut off before that, so the function
// still has time to record what happened
const TIMEOUT_MS = 7000;

/**
 * Lexware allows two requests per second for the whole account. Calls made by one run of a
 * function or workflow step are spaced to stay under that. Calls of separate runs are not
 * coordinated; when they collide Lexware answers 429 without performing the call, and the
 * call is repeated after a wait. Tests set these to zero.
 */
export const pacing = { spacingMs: 500, rateLimitWaitsMs: [600, 1200] };
let lastCallAt = 0;

export type LexwareErrorKind =
  /** 401: the key is wrong, deleted or expired */
  | "credentials"
  /** 402: no active Lexware plan, or a plan without the Public API */
  | "contract"
  /** 403: the key lacks a permission */
  | "permission"
  /** 400, 404, 406, 409 and the like: Lexware refuses this data. Sending it again cannot help */
  | "rejected"
  /** 429 after the waits: the account is busy */
  | "rate_limit"
  /** Network failure, timeout or 5xx */
  | "unavailable";

export class LexwareError extends Error {
  kind: LexwareErrorKind;
  status: number;
  /** True when a write may have been performed although no answer arrived */
  uncertain: boolean;
  /** The refusal in the merchant's terms, when the app knows what it means */
  hint?: string;

  constructor(kind: LexwareErrorKind, status: number, message: string, uncertain = false) {
    super(message);
    this.name = "LexwareError";
    this.kind = kind;
    this.status = status;
    this.uncertain = uncertain;
  }

  /** True for failures of the connection as a whole, which no single document can fix */
  get connection(): boolean {
    return this.kind === "credentials" || this.kind === "contract" || this.kind === "permission";
  }

  /** True when the same call can succeed later without anybody changing anything */
  get temporary(): boolean {
    return this.kind === "rate_limit" || this.kind === "unavailable";
  }
}

export type VoucherKind = "invoices" | "credit-notes";

export interface Profile {
  organizationId?: string;
  companyName?: string;
  taxType?: "net" | "gross" | "vatfree";
  smallBusiness?: boolean;
  distanceSalesPrinciple?: "ORIGIN" | "DESTINATION";
  businessFeatures?: string[];
}

export interface UnitPrice {
  currency: "EUR";
  netAmount?: number;
  grossAmount?: number;
  taxRatePercentage: number;
}

export interface LineItem {
  type: "custom" | "text";
  name: string;
  description?: string;
  quantity?: number;
  unitName?: string;
  unitPrice?: UnitPrice;
  lineItemAmount?: number;
}

export interface VoucherAddress {
  contactId?: string;
  name?: string;
  supplement?: string;
  street?: string;
  zip?: string;
  city?: string;
  countryCode?: string;
}

export interface TaxConditions {
  taxType: string;
  taxSubType?: string;
  taxTypeNote?: string;
}

export interface VoucherPayload {
  voucherDate: string;
  language?: "de" | "en";
  address: VoucherAddress;
  lineItems: LineItem[];
  totalPrice: { currency: "EUR" };
  taxConditions: TaxConditions;
  paymentConditions?: { paymentTermLabel: string; paymentTermDuration: number };
  shippingConditions?: { shippingType: string; shippingDate?: string };
}

export interface Voucher extends Omit<VoucherPayload, "totalPrice"> {
  id: string;
  voucherNumber?: string;
  voucherStatus?: string;
  totalPrice?: { currency: string; totalNetAmount?: number; totalGrossAmount?: number; totalTaxAmount?: number };
  taxAmounts?: { taxRatePercentage: number; taxAmount: number; netAmount: number }[];
}

export interface VoucherListEntry {
  id: string;
  voucherType: string;
  voucherStatus: string;
  voucherNumber: string;
  totalAmount: number;
  contactName?: string;
  createdDate?: string;
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Lexware's own words about a refused request, from either of its two error shapes */
function describe(body: any, fallback: string): string {
  if (!body || typeof body !== "object") {
    return fallback;
  }
  const parts: string[] = [];
  if (typeof body.message === "string" && body.message) {
    parts.push(body.message);
  }
  if (Array.isArray(body.details)) {
    for (const detail of body.details) {
      const text = [detail?.field, detail?.violation, detail?.message].filter(Boolean).join(": ");
      if (text) {
        parts.push(text);
      }
    }
  }
  if (Array.isArray(body.IssueList)) {
    for (const issue of body.IssueList) {
      const text = [issue?.source, issue?.i18nKey, issue?.type].filter(Boolean).join(": ");
      if (text) {
        parts.push(text);
      }
    }
  }
  return parts.length > 0 ? parts.join(" · ") : fallback;
}

function toError(status: number, body: any, write: boolean): LexwareError {
  switch (status) {
    case 401:
      return new LexwareError("credentials", status, "Lexware did not accept the API key.");
    case 402:
      return new LexwareError(
        "contract",
        status,
        "The Lexware account has no active plan with API access. The Public API needs the plan XL.",
      );
    case 403:
      return new LexwareError(
        "permission",
        status,
        "The API key is not allowed to do this. Create a key with all permissions, or with the permissions listed in the app's description.",
      );
    case 429:
      return new LexwareError("rate_limit", status, "Lexware is receiving too many requests from this account.");
    default:
      if (status >= 500) {
        // 504 is documented as "possibly processed"; the others are treated the same way
        return new LexwareError("unavailable", status, `Lexware is not available (${status}).`, write);
      }
      return new LexwareError("rejected", status, describe(body, `Lexware refused the request (${status}).`));
  }
}

async function send(apiKey: string, method: string, path: string, payload?: unknown, binary = false): Promise<any> {
  const key = (apiKey || "").trim();
  if (!key) {
    throw new LexwareError("credentials", 401, "The Lexware API key is missing in the app's settings.");
  }
  const write = method !== "GET";

  for (let attempt = 0; ; attempt++) {
    const sinceLast = Date.now() - lastCallAt;
    if (sinceLast >= 0 && sinceLast < pacing.spacingMs) {
      await wait(pacing.spacingMs - sinceLast);
    }
    lastCallAt = Date.now();

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let response: Response;
    try {
      response = await fetch(`${BASE_URL}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${key}`,
          Accept: binary ? "application/pdf" : "application/json",
          ...(payload === undefined ? {} : { "Content-Type": "application/json" }),
        },
        body: payload === undefined ? undefined : JSON.stringify(payload),
        signal: controller.signal,
      });
    } catch (err) {
      throw new LexwareError("unavailable", 0, "Lexware did not answer in time.", write);
    } finally {
      clearTimeout(timer);
    }

    if (response.status === 429 && attempt < pacing.rateLimitWaitsMs.length) {
      await wait(pacing.rateLimitWaitsMs[attempt]);
      continue;
    }

    if (response.ok) {
      if (binary) {
        return response.arrayBuffer();
      }
      const text = await response.text();
      return text ? JSON.parse(text) : {};
    }

    let body: any;
    try {
      body = JSON.parse(await response.text());
    } catch {
      body = undefined;
    }
    throw toError(response.status, body, write);
  }
}

export function getProfile(apiKey: string): Promise<Profile> {
  return send(apiKey, "GET", "/profile");
}

/** Creates an invoice or a credit note, as a draft or finalized. Returns its Lexware id */
export async function createVoucher(
  apiKey: string,
  kind: VoucherKind,
  payload: VoucherPayload,
  finalize: boolean,
): Promise<string> {
  const created = await send(apiKey, "POST", `/${kind}${finalize ? "?finalize=true" : ""}`, payload);
  return created.id as string;
}

export function getVoucher(apiKey: string, kind: VoucherKind, id: string): Promise<Voucher> {
  return send(apiKey, "GET", `/${kind}/${encodeURIComponent(id)}`);
}

/** The PDF of a finalized document. A draft has none: Lexware answers 409 */
export function getVoucherFile(apiKey: string, kind: VoucherKind, id: string): Promise<ArrayBuffer> {
  return send(apiKey, "GET", `/${kind}/${encodeURIComponent(id)}/file`, undefined, true);
}

export async function createContact(apiKey: string, payload: unknown): Promise<string> {
  const created = await send(apiKey, "POST", "/contacts", payload);
  return created.id as string;
}

/**
 * One page of the invoices or credit notes created from one day to another (yyyy-MM-dd,
 * both included), newest first. `last` says there are no further pages
 */
export async function listVouchersCreated(
  apiKey: string,
  kind: VoucherKind,
  fromDay: string,
  toDay: string,
  page = 0,
): Promise<{ entries: VoucherListEntry[]; last: boolean }> {
  const type = kind === "invoices" ? "invoice" : "creditnote";
  const query = `voucherType=${type}&voucherStatus=any&createdDateFrom=${fromDay}&createdDateTo=${toDay}&size=250&page=${page}&sort=createdDate,DESC`;
  const list = await send(apiKey, "GET", `/voucherlist?${query}`);
  return { entries: (list?.content || []) as VoucherListEntry[], last: list?.last !== false };
}

/** The address of a document in the Lexware app, for the merchant */
export function voucherLink(kind: VoucherKind, id: string): string {
  return `https://app.lexware.de/permalink/${kind}/view/${id}`;
}
