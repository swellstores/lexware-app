/**
 * Creates documents in Lexware, one stage at a time, with the ledger record as the state.
 *
 *   claim the record → create in Lexware → read number and status → store the PDF → e-mail
 *
 * Every stage is saved before the next begins, so any caller (a store event, a dashboard
 * action, the bulk workflow, a retry of any of them) can pick a record up where the last
 * attempt stopped. The one stage that must never run twice is the create call:
 * - a record that is being worked on is locked for half a minute, and of several attempts
 *   that start at the same moment only one gets it
 * - before the call the record is marked as submitted, and the mark is removed only when
 *   Lexware answers. A record still marked on a later attempt means the answer never came,
 *   so the document is looked for in Lexware before anything is created.
 */

import { raiseAlert, settleAlerts } from "./alerts";
import { buildCreditNote } from "./credit-note";
import { berlinDay } from "./dates";
import { claim, creditNoteKey, describe, findByKey, invoiceKey, provisionalName, save, take } from "./documents";
import type { DocumentRecord } from "./documents";
import { Problem, buildInvoice, checkOrder } from "./invoice";
import type { BuiltInvoice, ContactDraft, SwellRecord } from "./invoice";
import {
  LexwareError,
  createContact,
  createVoucher,
  getProfile,
  getVoucher,
  getVoucherFile,
  listVouchersCreated,
  voucherLink,
} from "./lexware";
import type { Profile, VoucherKind, VoucherPayload } from "./lexware";
import { toCents } from "./money";
import { creditNotesEnabled, finalizes } from "./settings";
import type { Settings, StoreClient } from "./settings";

const LOCK_MS = 30 * 1000;
// Lexware may finish a request after the app stopped waiting for it
const SETTLE_MS = 60 * 1000;
// Where a document of an unanswered request is looked for: created from one minute before
// the mark (clocks differ) to two minutes after it, on at most four pages of Lexware's
// list, reading at most eight documents with the right total
const LOOKUP_BEFORE_MS = 60 * 1000;
const LOOKUP_AFTER_MS = 2 * 60 * 1000;
const LOOKUP_PAGES = 4;
const LOOKUP_READS = 8;

export interface Context {
  swell: StoreClient;
  settings: Settings;
  /** The Lexware profile, read once per context */
  profile?: Profile;
  /** Records read ahead of the work, so that reads can run side by side: orders by id, invoice records by order id */
  orders?: Record<string, SwellRecord>;
  invoices?: Record<string, DocumentRecord>;
  now?: () => Date;
}

export type Result =
  /** The document exists in Lexware and everything after it is done */
  | "created"
  /** It was complete already */
  | "exists"
  /** Another attempt is working on it right now */
  | "busy"
  /** It needs the merchant. The record says why */
  | "failed"
  /** The app does not handle this order */
  | "skipped"
  /** Lexware could not be reached or is busy. The same attempt can succeed later */
  | "retry";

export interface Outcome {
  doc: DocumentRecord;
  result: Result;
  message: string;
}

function lock(from: Date): Partial<DocumentRecord> {
  return { locked_until: new Date(from.getTime() + LOCK_MS).toISOString(), date_attempted: from.toISOString() };
}

function now(ctx: Context): Date {
  return ctx.now ? ctx.now() : new Date();
}

function apiKey(ctx: Context): string {
  return (ctx.settings.connection?.api_key || "").trim();
}

function kindOf(doc: DocumentRecord): VoucherKind {
  return doc.type === "invoice" ? "invoices" : "credit-notes";
}

function isComplete(ctx: Context, doc: DocumentRecord): boolean {
  if (doc.status !== "created" || !doc.lexware_id || !doc.number) {
    return false;
  }
  // A draft is read again each time: the merchant may have finalized it in Lexware
  if (doc.lexware_status === "draft") {
    return false;
  }
  return Boolean(doc.pdf) && (!wantsEmail(ctx, doc) || doc.notify_customer === true);
}

function wantsEmail(ctx: Context, doc: DocumentRecord): boolean {
  return ctx.settings.documents?.send_email === true && Boolean(doc.customer_email);
}

function toBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  }
  return btoa(binary);
}

/** Lexware no longer has the document: a draft deleted there, or a key that now belongs to another account */
function isGone(err: unknown): boolean {
  return err instanceof LexwareError && err.status === 404;
}

function hasToken(text: string | undefined, token: string): boolean {
  if (!text || !token) {
    return false;
  }
  const escaped = token.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^0-9A-Za-z])${escaped}([^0-9A-Za-z]|$)`).test(text);
}

/**
 * Looks in Lexware for the document of an attempt that got no answer. It is recognised by
 * when it was created, by its total, and by the line that names the order or the refund.
 *
 * The request left within seconds of the mark and Lexware gives up on a request after half
 * a minute, so only documents created around the mark can be the one. That keeps the search
 * short however late it runs, also in a store whose orders all have the same total.
 */
async function findSubmitted(
  ctx: Context,
  doc: DocumentRecord,
  totalCents: number,
  token: string,
): Promise<string | undefined> {
  const kind = kindOf(doc);
  const marked = new Date(doc.date_submitted as string).getTime();
  const from = marked - LOOKUP_BEFORE_MS;
  const to = marked + LOOKUP_AFTER_MS;
  let read = 0;

  for (let page = 0; page < LOOKUP_PAGES; page++) {
    const { entries, last } = await listVouchersCreated(apiKey(ctx), kind, berlinDay(new Date(from)), berlinDay(new Date(to)), page);
    for (const entry of entries) {
      const created = entry.createdDate ? new Date(entry.createdDate).getTime() : marked;
      if (created < from) {
        // Newest first: everything further down is older still
        return undefined;
      }
      if (created > to || toCents(entry.totalAmount) !== totalCents) {
        continue;
      }
      if (++read > LOOKUP_READS) {
        return undefined;
      }
      const voucher = await getVoucher(apiKey(ctx), kind, entry.id);
      if ((voucher.lineItems || []).some((line) => line.type === "text" && hasToken(line.name, token))) {
        return voucher.id;
      }
    }
    if (last) {
      break;
    }
  }
  return undefined;
}

async function submit(
  ctx: Context,
  doc: DocumentRecord,
  payload: VoucherPayload,
  totalCents: number,
  token: string,
  details: Partial<DocumentRecord>,
  fresh: boolean,
): Promise<void> {
  const kind = kindOf(doc);
  // A record created a moment ago by this very call may carry the mark already
  const markedEarlier = Boolean(doc.date_submitted) && !fresh;
  let id: string | undefined;

  if (markedEarlier) {
    id = await findSubmitted(ctx, doc, totalCents, token);
    if (!id && now(ctx).getTime() - new Date(doc.date_submitted as string).getTime() < SETTLE_MS) {
      throw new LexwareError("unavailable", 0, "Lexware has not confirmed the last attempt yet. Try again in a minute.");
    }
  }

  if (!id) {
    if (markedEarlier || !doc.date_submitted) {
      await save(ctx.swell, doc, { ...details, date_submitted: now(ctx).toISOString() });
    }
    try {
      id = await createVoucher(apiKey(ctx), kind, payload, finalizes(ctx.settings));
    } catch (err) {
      if (err instanceof LexwareError && !err.uncertain) {
        // Lexware answered and did not create anything
        await save(ctx.swell, doc, { date_submitted: null });
      }
      throw err;
    }
  }

  await save(ctx.swell, doc, { lexware_id: id, lexware_url: voucherLink(kind, id), date_submitted: null });
}

/** The Lexware contact for an order that cannot be invoiced to a one-time address */
async function ensureContact(ctx: Context, doc: DocumentRecord, contact: ContactDraft): Promise<string> {
  if (doc.contact_id && doc.contact_key === contact.key) {
    return doc.contact_id;
  }
  const earlier = (await ctx.swell.get("/documents", {
    where: { contact_key: contact.key, contact_id: { $ne: null } },
    sort: "date_created desc",
    limit: 1,
  })) as { results?: DocumentRecord[] };
  const id = earlier?.results?.[0]?.contact_id || (await createContact(apiKey(ctx), contact.payload));
  await save(ctx.swell, doc, { contact_id: id, contact_key: contact.key });
  return id;
}

function invoiceDetails(order: SwellRecord, built: BuiltInvoice): Partial<DocumentRecord> {
  return {
    name: provisionalName("invoice", String(order.number || "")),
    order_number: String(order.number || ""),
    account_id: order.account_id,
    customer_name: built.customerName,
    customer_email: built.customerEmail,
    language: built.language,
    amount: built.totalCents / 100,
    currency: "EUR",
    tax_type: [built.payload.taxConditions.taxType, built.payload.taxConditions.taxSubType].filter(Boolean).join(" / "),
  };
}

/** What the documents list shows about an order, known before any invoice can be built */
function orderDetails(order: SwellRecord): Partial<DocumentRecord> {
  const euro = String(order.currency || "").toUpperCase() === "EUR";
  return {
    name: provisionalName("invoice", String(order.number || "")),
    order_number: String(order.number || ""),
    account_id: order.account_id,
    // The total column is in EUR. An order in another currency is listed without one
    ...(euro ? { amount: order.grand_total } : {}),
    currency: order.currency,
    customer_name: order.billing?.name || order.shipping?.name || order.account?.name,
    customer_email: order.account?.email,
  };
}

function readOrder(ctx: Context, orderId: string): Promise<SwellRecord> {
  return ctx.swell.get(`/orders/${orderId}`, { expand: ["account"] }) as Promise<SwellRecord>;
}

async function createInvoice(ctx: Context, doc: DocumentRecord, fresh: boolean): Promise<void> {
  const orderId = doc.order_id as string;
  const [order, profile] = await Promise.all([
    ctx.orders?.[orderId] || readOrder(ctx, orderId),
    // Held back until the order is known to need Lexware at all
    ctx.profile || getProfile(apiKey(ctx)).catch((err: unknown) => err as Error),
  ]);
  if (!order?.id) {
    throw new Problem("failed", "no_order", "The order no longer exists.");
  }

  let built: BuiltInvoice;
  try {
    checkOrder(order);
    if (profile instanceof Error) {
      throw profile;
    }
    ctx.profile = profile;
    built = buildInvoice(order, { profile, language: ctx.settings.documents?.language, now: now(ctx) });
  } catch (err) {
    // What is known about the order is kept even when no invoice can be built for it
    if (!doc.order_number) {
      await save(ctx.swell, doc, orderDetails(order));
    }
    throw err;
  }

  if (built.contact) {
    built.payload.address = { ...built.payload.address, contactId: await ensureContact(ctx, doc, built.contact) };
  }
  try {
    const token = String(order.number || order.id);
    await submit(ctx, doc, built.payload, built.totalCents, token, invoiceDetails(order, built), fresh);
  } catch (err) {
    if (err instanceof LexwareError && err.kind === "rejected") {
      err.hint = explainRejection(err.message, built.payload);
    }
    throw err;
  }
}

async function createCreditNote(ctx: Context, doc: DocumentRecord, fresh: boolean): Promise<void> {
  const orderId = doc.order_id as string;
  const invoiceDoc = ctx.invoices?.[orderId] || (await findByKey(ctx.swell, invoiceKey(orderId)));
  if (invoiceDoc?.status === "resolved") {
    throw new Problem(
      "failed",
      "invoice_by_hand",
      "The invoice for this order was resolved by hand, so the app does not know it in Lexware. Create this credit note in Lexware by hand, then mark it as resolved.",
    );
  }
  if (!invoiceDoc?.lexware_id) {
    throw new Problem(
      "failed",
      "no_invoice",
      "The invoice for this order has not been created in Lexware yet. Create it first, then retry this credit note.",
    );
  }

  const [invoice, earlier] = await Promise.all([
    getVoucher(apiKey(ctx), "invoices", invoiceDoc.lexware_id).catch((err: unknown) => {
      if (isGone(err)) {
        throw new Problem(
          "failed",
          "invoice_gone",
          `${describe(invoiceDoc)} no longer exists in the connected Lexware account, so the credit note cannot be built from it. Create this credit note in Lexware by hand, then mark it as resolved.`,
        );
      }
      throw err;
    }),
    ctx.swell.get("/documents", {
      where: { order_id: orderId, type: "credit_note", lexware_id: { $ne: null }, id: { $ne: doc.id } },
      limit: 100,
    }) as Promise<{ results?: DocumentRecord[] }>,
  ]);
  const creditedCents = (earlier?.results || []).reduce((sum, credit) => sum + toCents(credit.amount), 0);

  const reference = doc.reference || String(doc.refund_id || doc.id).slice(-8).toUpperCase();
  const built = buildCreditNote({
    invoice,
    refundCents: toCents(doc.amount),
    creditedCents,
    orderNumber: doc.order_number || invoiceDoc.order_number || "",
    reference,
    now: now(ctx),
  });

  const details: Partial<DocumentRecord> = {
    reference,
    invoice_number: invoice.voucherNumber || null,
    language: built.language,
    tax_type: [built.payload.taxConditions.taxType, built.payload.taxConditions.taxSubType].filter(Boolean).join(" / "),
    contact_id: invoice.address?.contactId || null,
  };
  await submit(ctx, doc, built.payload, built.totalCents, reference, details, fresh);
}

/**
 * Everything after the document exists: its number and status, the PDF, the customer's
 * e-mail. Returns the changes for the caller to save in one write with the final status.
 */
async function complete(ctx: Context, doc: DocumentRecord, justCreated: boolean): Promise<Partial<DocumentRecord>> {
  const kind = kindOf(doc);
  const id = doc.lexware_id as string;
  const changes: Partial<DocumentRecord> = {};
  let status = doc.lexware_status;
  let number = doc.number;
  let file: ArrayBuffer | undefined;

  if (!number || !status || status === "draft") {
    // A document just created as finalized has its PDF already, so both are read together
    const [voucher, early] = await Promise.all([
      getVoucher(apiKey(ctx), kind, id),
      justCreated && finalizes(ctx.settings) ? getVoucherFile(apiKey(ctx), kind, id).catch(() => undefined) : undefined,
    ]).catch(async (err: unknown) => {
      // Only a document that was read before is known to have existed
      if (!isGone(err) || !doc.number) {
        throw err;
      }
      const gone = describe(doc);
      await save(ctx.swell, doc, {
        lexware_id: null,
        lexware_url: null,
        lexware_status: null,
        number: null,
        date_issued: null,
        name: provisionalName(doc.type, doc.order_number),
      });
      throw new Problem(
        "failed",
        "gone",
        `${gone} no longer exists in the connected Lexware account: the draft was deleted in Lexware, or the API key now belongs to another account. Retry to create the document again, or mark it as resolved.`,
      );
    });
    file = early;
    status = voucher.voucherStatus || null;
    number = voucher.voucherNumber || null;
    Object.assign(changes, {
      number,
      ...(number ? { name: number } : {}),
      lexware_status: status,
      amount: voucher.totalPrice?.totalGrossAmount ?? doc.amount,
      date_issued: voucher.voucherDate ? new Date(voucher.voucherDate).toISOString() : now(ctx).toISOString(),
    });
  }

  // Lexware renders the PDF when a document is finalized. A draft has none
  let hasPdf = Boolean(doc.pdf);
  if (status && status !== "draft" && !hasPdf) {
    try {
      file = file || (await getVoucherFile(apiKey(ctx), kind, id));
    } catch (err) {
      // Keep what was read before the failure is reported
      await save(ctx.swell, doc, changes);
      throw err;
    }
    changes.pdf = {
      filename: `${number || id}.pdf`,
      content_type: "application/pdf",
      data: { $base64: toBase64(file) },
    } as DocumentRecord["pdf"];
    hasPdf = true;
  }

  if (hasPdf && wantsEmail(ctx, doc) && !doc.notify_customer) {
    // The notification is bound to this change (see models/documents.json)
    changes.notify_customer = true;
  }
  return changes;
}

/** Lexware's German validation messages, with what the merchant can do about the common ones */
function explainRejection(message: string, payload: VoucherPayload): string | undefined {
  if (/taxRatePercentage/i.test(message)) {
    const rates = [...new Set(payload.lineItems.map((line) => line.unitPrice?.taxRatePercentage))]
      .filter((rate) => rate !== undefined)
      .join(" %, ");
    return `The order's tax rates (${rates} %) are not valid in Lexware for a customer in ${payload.address.countryCode}. Check the store's tax rules, and for EU consumers whether Lexware is set to charge VAT of the destination country. (Lexware: ${message})`;
  }
  if (/USt-IdNr/i.test(message)) {
    return `Lexware needs your company's own VAT ID for a tax-free invoice to another country. Enter it in Lexware under Settings → Company data, then retry. (Lexware: ${message})`;
  }
  return undefined;
}

function successMessage(doc: DocumentRecord): string {
  const draft = doc.lexware_status === "draft";
  return `${describe(doc)} ${draft ? "is a draft in Lexware. Finalize it there to give it a PDF" : "is in Lexware"}.`;
}

function alertSubject(doc: DocumentRecord): string {
  return `${doc.type === "invoice" ? "Invoice" : "Credit note"} for order ${doc.order_number || doc.order_id || ""}`.trim();
}

/**
 * Works on one record until it is complete or something stops it. Never throws for a
 * Lexware or data problem. `fresh` says the caller created the record a moment ago,
 * with the lock already on it.
 */
export async function run(ctx: Context, doc: DocumentRecord, fresh = false): Promise<Outcome> {
  if (doc.status === "resolved") {
    return { doc, result: "exists", message: `${describe(doc)} was marked as resolved.` };
  }
  if (isComplete(ctx, doc)) {
    return { doc, result: "exists", message: `${describe(doc)} is in Lexware already.` };
  }
  if (!fresh) {
    const started = now(ctx);
    const held = doc.locked_until && new Date(doc.locked_until).getTime() > started.getTime();
    if (held || !(await take(ctx.swell, doc, lock(started)))) {
      return { doc, result: "busy", message: `${describe(doc)} is being worked on right now. Try again in a moment.` };
    }
  }

  try {
    const create = !doc.lexware_id;
    if (create) {
      await (doc.type === "invoice" ? createInvoice(ctx, doc, fresh) : createCreditNote(ctx, doc, fresh));
    }
    // Lexware has the document, so the alerts can be settled while the rest is read.
    // The record still says "failed" at this point if it did before, hence the flag
    const [changes] = await Promise.all([complete(ctx, doc, create), settleAlerts(ctx.swell, doc.status === "failed")]);
    await save(ctx.swell, doc, { ...changes, status: "created", problem: null, problem_code: null, locked_until: null });
    return { doc, result: "created", message: successMessage(doc) };
  } catch (err) {
    if (err instanceof Problem) {
      await save(ctx.swell, doc, { status: err.status, problem: err.message, problem_code: err.code, locked_until: null });
      if (err.status === "failed") {
        await raiseAlert(ctx.swell, "documents", err.message, alertSubject(doc));
      }
      return { doc, result: err.status, message: err.message };
    }

    if (err instanceof LexwareError) {
      if (err.temporary) {
        // The record keeps what it has. With a Lexware id it only needs finishing
        await save(ctx.swell, doc, {
          status: doc.status === "created" ? "created" : "pending",
          problem: err.message,
          problem_code: "temporary",
          locked_until: null,
        });
        return { doc, result: "retry", message: err.message };
      }
      // Also for a document that exists in Lexware and could not be read: it needs the
      // merchant, and Retry finishes it without creating anything
      const message = err.connection ? err.message : err.hint || `Lexware refused the ${doc.lexware_id ? "request" : "document"}: ${err.message}`;
      await save(ctx.swell, doc, {
        status: "failed",
        problem: message,
        problem_code: err.connection ? "connection" : "rejected",
        locked_until: null,
      });
      await raiseAlert(ctx.swell, err.connection ? "connection" : "documents", message, alertSubject(doc));
      return { doc, result: "failed", message };
    }

    // A fault of the store API or of the app itself. Release the record and let the caller see it
    try {
      await save(ctx.swell, doc, { locked_until: null, problem: String((err as Error)?.message || err), problem_code: "internal" });
    } catch {
      // The lock ends by itself
    }
    throw err;
  }
}

/** Marks a record that could not be completed in time as needing attention */
export async function giveUp(ctx: Context, doc: DocumentRecord, message: string): Promise<void> {
  await save(ctx.swell, doc, {
    status: "failed",
    problem: message,
    problem_code: "unavailable",
    locked_until: null,
  });
  await raiseAlert(ctx.swell, "documents", message, alertSubject(doc));
}

/** The invoice for an order: created now, or found as it is */
export async function invoiceOrder(ctx: Context, orderId: string, source: string): Promise<Outcome> {
  const key = invoiceKey(orderId);
  // Read side by side: the record if there is one, the order, and the Lexware profile.
  // A failure here is met again, and reported, when the record is worked on
  const [existing, order, profile] = await Promise.all([
    findByKey(ctx.swell, key),
    readOrder(ctx, orderId).catch(() => undefined),
    ctx.profile || getProfile(apiKey(ctx)).catch(() => undefined),
  ]);
  if (order?.id) {
    ctx.orders = { ...ctx.orders, [orderId]: order };
  }
  ctx.profile = profile || ctx.profile;
  if (existing) {
    return run(ctx, existing);
  }

  const started = now(ctx);
  let seed: Partial<DocumentRecord> = {
    type: "invoice",
    order_id: orderId,
    source,
    ...(order?.id ? orderDetails(order) : {}),
    ...lock(started),
  };
  if (order?.id && profile) {
    try {
      const built = buildInvoice(order, { profile, language: ctx.settings.documents?.language, now: started });
      if (!built.contact) {
        // Ready to send: the record is written once, with its details and the submitted mark
        seed = { ...seed, ...invoiceDetails(order, built), date_submitted: started.toISOString() };
      }
    } catch {
      // No invoice can be built. The record is created without details and says why
    }
  }
  const { doc, created } = await claim(ctx.swell, key, seed, true);
  return run(ctx, doc, created);
}

/**
 * The credit note for a refund. Returns nothing when the refund is none of the app's
 * business: it belongs to no order, or to an order the app never invoiced.
 */
export async function creditRefund(ctx: Context, refund: SwellRecord, source: string): Promise<Outcome | undefined> {
  if (!creditNotesEnabled(ctx.settings) || !refund?.id || !refund.order_id) {
    return undefined;
  }
  const key = creditNoteKey(refund.id);
  const [invoiceDoc, existing] = await Promise.all([
    findByKey(ctx.swell, invoiceKey(refund.order_id)),
    findByKey(ctx.swell, key),
  ]);
  if (!invoiceDoc || invoiceDoc.status === "skipped") {
    return undefined;
  }
  ctx.invoices = { ...ctx.invoices, [refund.order_id]: invoiceDoc };
  if (existing) {
    return run(ctx, existing);
  }
  const { doc, created } = await claim(
    ctx.swell,
    key,
    {
      type: "credit_note",
      name: provisionalName("credit_note", invoiceDoc.order_number),
      source,
      order_id: refund.order_id,
      order_number: invoiceDoc.order_number,
      account_id: invoiceDoc.account_id,
      payment_id: refund.parent_id,
      refund_id: refund.id,
      reference: String(refund.number || refund.id).slice(-8).toUpperCase(),
      customer_name: invoiceDoc.customer_name,
      customer_email: invoiceDoc.customer_email,
      amount: refund.amount,
      currency: "EUR",
      ...lock(now(ctx)),
    },
    true,
  );
  return run(ctx, doc, created);
}
