import { describe, expect, it } from "vitest";
import { buildCreditNote } from "../../functions/lib/credit-note";
import { Problem } from "../../functions/lib/invoice";
import type { Voucher } from "../../functions/lib/lexware";

/** Invoice RE0011 of the test account, as Lexware returns it: 98.63 with two tax rates */
const invoice: Voucher = {
  id: "inv-1",
  voucherNumber: "RE0011",
  voucherStatus: "open",
  voucherDate: "2026-10-10T09:08:50.000+02:00",
  language: "de",
  address: { name: "Erika Musterfrau", supplement: "2. OG", street: "Hauptstr. 5", zip: "80331", city: "München", countryCode: "DE" },
  lineItems: [
    { type: "text", name: "Bestellung Nr. 100306 vom 10.10.2026" },
    { type: "custom", name: "Lexware Test T-Shirt", quantity: 3, unitName: "Stück", unitPrice: { currency: "EUR", netAmount: 24.99, grossAmount: 29.74, taxRatePercentage: 19 }, lineItemAmount: 74.97 },
    { type: "custom", name: "Lexware Test Buch", quantity: 1, unitName: "Stück", unitPrice: { currency: "EUR", netAmount: 12.99, grossAmount: 13.9, taxRatePercentage: 7 }, lineItemAmount: 12.99 },
    { type: "custom", name: "Versand (DHL Paket)", quantity: 1, unitName: "pauschal", unitPrice: { currency: "EUR", netAmount: 4.9, grossAmount: 5.83, taxRatePercentage: 19 }, lineItemAmount: 4.9 },
    { type: "custom", name: "Rabatt (19 % USt)", quantity: 1, unitName: "pauschal", unitPrice: { currency: "EUR", netAmount: -7.5, grossAmount: -8.93, taxRatePercentage: 19 }, lineItemAmount: -7.5 },
    { type: "custom", name: "Rabatt (7 % USt)", quantity: 1, unitName: "pauschal", unitPrice: { currency: "EUR", netAmount: -1.3, grossAmount: -1.39, taxRatePercentage: 7 }, lineItemAmount: -1.3 },
  ],
  totalPrice: { currency: "EUR", totalNetAmount: 84.06, totalGrossAmount: 98.63, totalTaxAmount: 14.57 },
  taxAmounts: [
    { taxRatePercentage: 7, taxAmount: 0.82, netAmount: 11.69 },
    { taxRatePercentage: 19, taxAmount: 13.75, netAmount: 72.37 },
  ],
  taxConditions: { taxType: "net" },
};

const base = { invoice, creditedCents: 0, orderNumber: "100306", reference: "100019", now: new Date("2026-10-10T07:09:36.000Z") };

function priced(payload: { lineItems: any[] }) {
  return payload.lineItems
    .filter((line) => line.type === "custom")
    .map((line) => [line.quantity, line.name, line.unitPrice.netAmount ?? line.unitPrice.grossAmount, line.unitPrice.taxRatePercentage]);
}

describe("credit note", () => {
  it("splits a partial refund over the invoice's tax rates, as gross amounts (GS0002 in the test account)", () => {
    const built = buildCreditNote({ ...base, refundCents: 1000 });
    expect(built.payload.taxConditions).toEqual({ taxType: "gross" });
    expect(priced(built.payload)).toEqual([
      [1, "Erstattung (19 % USt)", 8.73, 19],
      [1, "Erstattung (7 % USt)", 1.27, 7],
    ]);
    expect(built.payload.lineItems[1].unitPrice).toHaveProperty("grossAmount", 8.73);
    expect(built.totalCents).toBe(1000);
  });

  it("names the invoice, the order and the refund in its first line", () => {
    const built = buildCreditNote({ ...base, refundCents: 1000 });
    expect(built.payload.lineItems[0]).toEqual({
      type: "text",
      name: "Erstattung zu Rechnung RE0011, Bestellung Nr. 100306 (Ref. 100019)",
    });
  });

  it("repeats the invoice's lines for a refund of the whole invoice", () => {
    const built = buildCreditNote({ ...base, refundCents: 9863 });
    expect(built.payload.taxConditions).toEqual({ taxType: "net" });
    expect(priced(built.payload)).toEqual([
      [3, "Lexware Test T-Shirt", 24.99, 19],
      [1, "Lexware Test Buch", 12.99, 7],
      [1, "Versand (DHL Paket)", 4.9, 19],
      [1, "Rabatt (19 % USt)", -7.5, 19],
      [1, "Rabatt (7 % USt)", -1.3, 7],
    ]);
    expect(built.payload.lineItems[1].unitPrice).not.toHaveProperty("grossAmount");
  });

  it("treats the rest of an invoice that was partly refunded before as a partial refund", () => {
    const built = buildCreditNote({ ...base, refundCents: 8863, creditedCents: 1000 });
    expect(priced(built.payload)).toEqual([
      [1, "Erstattung (19 % USt)", 77.39, 19],
      [1, "Erstattung (7 % USt)", 11.24, 7],
    ]);
  });

  it("goes to the invoice's address, in its language, without payment or delivery terms", () => {
    const built = buildCreditNote({ ...base, refundCents: 1000 });
    expect(built.payload.address).toEqual(invoice.address);
    expect(built.payload.language).toBe("de");
    expect(built.payload.voucherDate).toBe("2026-10-10T09:09:36.000+02:00");
    expect(built.payload).not.toHaveProperty("paymentConditions");
    expect(built.payload).not.toHaveProperty("shippingConditions");
  });

  it("keeps the tax type and the contact of a tax-free invoice", () => {
    const exportInvoice: Voucher = {
      ...invoice,
      language: "en",
      address: { contactId: "contact-1", name: "Hans Muster", countryCode: "CH" },
      taxConditions: { taxType: "thirdPartyCountryDelivery", taxTypeNote: "Steuerfreie Ausfuhrlieferung" },
      taxAmounts: [],
      totalPrice: { currency: "EUR", totalNetAmount: 72.87, totalGrossAmount: 72.87, totalTaxAmount: 0 },
    };
    const built = buildCreditNote({ ...base, invoice: exportInvoice, refundCents: 2000 });
    expect(built.payload.taxConditions).toEqual({ taxType: "thirdPartyCountryDelivery" });
    expect(built.payload.address).toEqual({ contactId: "contact-1", name: "Hans Muster", countryCode: "CH" });
    expect(built.payload.lineItems[0].name).toBe("Refund for invoice RE0011, order no. 100306 (ref. 100019)");
    expect(priced(built.payload)).toEqual([[1, "Refund", 20, 0]]);
    expect(built.payload.lineItems[1].unitPrice).toHaveProperty("netAmount", 20);
  });

  it("keeps the distance-sale mark of the invoice", () => {
    const french = { ...invoice, taxConditions: { taxType: "net", taxSubType: "distanceSales" } };
    const built = buildCreditNote({ ...base, invoice: french, refundCents: 500 });
    expect(built.payload.taxConditions).toEqual({ taxType: "gross", taxSubType: "distanceSales" });
  });

  it("refuses refunds that add up to more than the invoice", () => {
    expect(() => buildCreditNote({ ...base, refundCents: 9000, creditedCents: 1000 })).toThrow(Problem);
    try {
      buildCreditNote({ ...base, refundCents: 9864 });
    } catch (err) {
      expect(err).toMatchObject({ status: "failed", code: "refund_exceeds" });
    }
    expect(() => buildCreditNote({ ...base, refundCents: 0 })).toThrow(Problem);
  });
});
