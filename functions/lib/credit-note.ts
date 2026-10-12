/**
 * Turns a Swell refund into a Lexware credit note.
 *
 * A refund in Swell is an amount on a payment. It names no items. The credit note is
 * therefore built from the invoice as Lexware holds it:
 * - a refund of the whole invoice repeats the invoice's lines
 * - a partial refund becomes one line per tax rate, split in the proportion the rates
 *   have on the invoice, as gross amounts that add up to exactly the refunded amount
 *
 * The credit note is not linked to the invoice in Lexware. Lexware allows one linked
 * credit note per invoice and means it for invoices that were never paid; for a refund of
 * a paid invoice its guidance is a credit note that names the invoice in its text.
 */

import { lexwareDate } from "./dates";
import { Problem } from "./invoice";
import type { LineItem, Voucher, VoucherPayload } from "./lexware";
import { allocate, formatCents, toCents } from "./money";
import { formatRate, texts } from "./texts";
import type { Language } from "./texts";

export interface CreditNoteInput {
  /** The invoice as read from Lexware */
  invoice: Voucher;
  refundCents: number;
  /** What earlier credit notes for the same invoice add up to */
  creditedCents: number;
  orderNumber: string;
  /** Identifies the refund on the document, and finds the document again after an unanswered request */
  reference: string;
  now?: Date;
}

export interface BuiltCreditNote {
  payload: VoucherPayload;
  totalCents: number;
  language: Language;
}

export function buildCreditNote(input: CreditNoteInput): BuiltCreditNote {
  const { invoice, refundCents, creditedCents } = input;
  const invoiceCents = toCents(invoice.totalPrice?.totalGrossAmount);
  const invoiceNumber = invoice.voucherNumber || "";
  const language: Language = invoice.language === "en" ? "en" : "de";
  const t = texts(language);

  if (refundCents <= 0) {
    throw new Problem("failed", "no_amount", "The refund has no amount.");
  }
  if (creditedCents + refundCents > invoiceCents) {
    throw new Problem(
      "failed",
      "refund_exceeds",
      `Refunds of ${formatCents(creditedCents + refundCents)} EUR are more than invoice ${invoiceNumber} of ${formatCents(invoiceCents)} EUR. Create this credit note in Lexware by hand.`,
    );
  }

  const taxType = invoice.taxConditions?.taxType || "gross";
  const taxed = taxType === "net" || taxType === "gross";
  const marker: LineItem = { type: "text", name: t.refund(invoiceNumber, input.orderNumber, input.reference) };
  let lineItems: LineItem[];
  let creditType = taxType;

  if (refundCents === invoiceCents && creditedCents === 0) {
    const amountField = taxType === "gross" ? "grossAmount" : "netAmount";
    lineItems = (invoice.lineItems || [])
      .filter((line) => line.type !== "text" && line.unitPrice)
      .map((line) => ({
        type: "custom",
        name: line.name,
        ...(line.description ? { description: line.description } : {}),
        quantity: line.quantity,
        unitName: line.unitName,
        unitPrice: {
          currency: "EUR",
          [amountField]: line.unitPrice?.[amountField],
          taxRatePercentage: line.unitPrice?.taxRatePercentage ?? 0,
        },
      }));
  } else {
    const rates = (invoice.taxAmounts || [])
      .map((entry) => ({ rate: entry.taxRatePercentage, gross: toCents(entry.netAmount) + toCents(entry.taxAmount) }))
      .filter((entry) => entry.gross > 0)
      .sort((a, b) => b.rate - a.rate);
    if (rates.length === 0) {
      rates.push({ rate: 0, gross: invoiceCents });
    }
    const parts = allocate(refundCents, rates.map((entry) => entry.gross));
    // Gross amounts add up to the refund exactly. Net amounts would leave the last cent to Lexware's rounding
    creditType = taxed ? "gross" : taxType;
    const amountField = taxed ? "grossAmount" : "netAmount";
    lineItems = rates
      .map((entry, index) => ({ ...entry, cents: parts[index] }))
      .filter((entry) => entry.cents > 0)
      .map((entry) => ({
        type: "custom",
        name: t.refundLine(rates.length > 1 ? formatRate(entry.rate, language) : undefined),
        quantity: 1,
        unitName: t.flat,
        unitPrice: { currency: "EUR", [amountField]: entry.cents / 100, taxRatePercentage: taxed ? entry.rate : 0 },
      }));
  }

  const { contactId, name, supplement, street, zip, city, countryCode } = invoice.address || {};
  const address = Object.fromEntries(
    Object.entries({ contactId, name, supplement, street, zip, city, countryCode }).filter(([, value]) => value),
  );

  return {
    payload: {
      voucherDate: lexwareDate(input.now),
      language,
      address,
      lineItems: [marker, ...lineItems],
      totalPrice: { currency: "EUR" },
      taxConditions: {
        taxType: creditType,
        ...(invoice.taxConditions?.taxSubType ? { taxSubType: invoice.taxConditions.taxSubType } : {}),
      },
    },
    totalCents: refundCents,
    language,
  };
}
