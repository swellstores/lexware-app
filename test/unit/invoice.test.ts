import { describe, expect, it } from "vitest";
import { Problem, buildInvoice, simulate } from "../../functions/lib/invoice";
import type { BuiltInvoice } from "../../functions/lib/invoice";
import * as orders from "../fixtures/orders";

const profile = { taxType: "net" as const, smallBusiness: false, distanceSalesPrinciple: "DESTINATION" as const };
const now = new Date("2026-10-10T07:00:00.000Z");

function build(order: Record<string, any>, options: Record<string, any> = {}): BuiltInvoice {
  return buildInvoice(order, { profile, now, ...options });
}

/** The priced lines as [quantity, name, unit price, rate] */
function lines(built: BuiltInvoice) {
  return built.payload.lineItems
    .filter((line) => line.type === "custom")
    .map((line) => [
      line.quantity,
      line.name,
      line.unitPrice?.netAmount ?? line.unitPrice?.grossAmount,
      line.unitPrice?.taxRatePercentage,
    ]);
}

function problem(run: () => unknown): Problem {
  try {
    run();
  } catch (err) {
    return err as Problem;
  }
  throw new Error("Expected a Problem");
}

/** A store with prices that include tax: 3 shirts at 24.99 (19 %), a book at 12.99 (7 %), shipping 4.90 */
function taxIncluded(overrides: Record<string, any> = {}) {
  return {
    ...orders.mixedRates,
    item_tax_included: true,
    shipment_tax_included: true,
    paid: true,
    grand_total: 92.86,
    shipment_tax: 0.7824,
    items: [
      { ...orders.mixedRates.items[0], tax_total: 11.97, taxes: [{ id: "vat_standard", amount: 11.97 }] },
      { ...orders.mixedRates.items[1], tax_total: 0.8498, taxes: [{ id: "vat_reduced", amount: 0.8498 }] },
    ],
    ...overrides,
  };
}

describe("invoice for a store with prices before tax", () => {
  it("is a net invoice with the store's prices when Lexware's total is the order's total", () => {
    const built = build(orders.singleRate);
    expect(built.payload.taxConditions).toEqual({ taxType: "net" });
    expect(lines(built)).toEqual([
      [2, "Lexware Test T-Shirt", 24.99, 19],
      [1, "Lexware Test E-Book", 9.5, 19],
      [1, "Versand (DHL Paket)", 4.9, 19],
    ]);
    expect(built.totalCents).toBe(7661);
  });

  it("shows a coupon as one negative line per tax rate (invoice RE0008 in the test account)", () => {
    const built = build(orders.withCoupon);
    expect(built.payload.taxConditions.taxType).toBe("net");
    expect(lines(built)).toEqual([
      [3, "Lexware Test T-Shirt", 24.99, 19],
      [1, "Lexware Test Buch", 12.99, 7],
      [1, "Versand (DHL Paket)", 4.9, 19],
      [1, "Rabatt (LEXTEST10, 19 % USt)", -7.5, 19],
      [1, "Rabatt (LEXTEST10, 7 % USt)", -1.3, 7],
    ]);
    expect(built.totalCents).toBe(9863);
    expect(built.taxCents).toBe(1457);
  });

  it("switches to gross amounts when the net calculation would be a cent off (invoice RE0007)", () => {
    // Net lines give 108.95 in Lexware: 15.18 + 0.91 of tax per rate. The customer paid 108.94
    const built = build(orders.mixedRates);
    expect(built.payload.taxConditions.taxType).toBe("gross");
    expect(lines(built)).toEqual([
      [3, "Lexware Test T-Shirt", 29.7367, 19],
      [1, "Lexware Test Buch", 13.9, 7],
      [1, "Versand (DHL Paket)", 5.83, 19],
    ]);
    expect(built.totalCents).toBe(10894);
    expect(built.taxCents).toBe(1608);
  });

  it("names the order in a text line, which also finds the invoice again after a lost answer", () => {
    const built = build(orders.mixedRates);
    expect(built.payload.lineItems[0]).toEqual({ type: "text", name: "Bestellung Nr. 100302 vom 10.10.2026" });
  });

  it("says the invoice is paid only when the order is", () => {
    expect(build(orders.mixedRates).payload.paymentConditions).toBeUndefined();
    expect(build(orders.withCoupon).payload.paymentConditions).toEqual({
      paymentTermLabel: "Der Rechnungsbetrag wurde bereits per Barzahlung beglichen.",
      paymentTermDuration: 0,
    });
    const card = { ...orders.withCoupon, billing: { ...orders.withCoupon.billing, method: "card" } };
    expect(build(card).payload.paymentConditions?.paymentTermLabel).toContain("per Kreditkarte");
    const other = { ...orders.withCoupon, billing: { ...orders.withCoupon.billing, method: "something_new" } };
    expect(build(other).payload.paymentConditions?.paymentTermLabel).toBe("Der Rechnungsbetrag wurde bereits beglichen.");
  });

  it("uses the billing address as a one-time address in Germany", () => {
    const built = build(orders.mixedRates);
    expect(built.payload.address).toEqual({
      name: "Erika Musterfrau",
      supplement: "2. OG",
      street: "Hauptstr. 5",
      zip: "80331",
      city: "München",
      countryCode: "DE",
    });
    expect(built.contact).toBeUndefined();
    expect(built.customerEmail).toBe("lexware-test-de@example.com");
  });

  it("dates the invoice today and the delivery on the day of the order, in German time", () => {
    const built = build(orders.mixedRates);
    expect(built.payload.voucherDate).toBe("2026-10-10T09:00:00.000+02:00");
    expect(built.payload.shippingConditions).toEqual({
      shippingType: "delivery",
      shippingDate: "2026-10-10T08:47:52.000+02:00",
    });
  });
});

describe("invoice for a store with prices including tax", () => {
  it("is a gross invoice with the prices the customer saw", () => {
    const built = build(taxIncluded());
    expect(built.payload.taxConditions.taxType).toBe("gross");
    expect(lines(built)).toEqual([
      [3, "Lexware Test T-Shirt", 24.99, 19],
      [1, "Lexware Test Buch", 12.99, 7],
      [1, "Versand (DHL Paket)", 4.9, 19],
    ]);
    expect(built.totalCents).toBe(9286);
  });

  it("keeps the listed prices and shows the discount per rate, settling fractions of a cent", () => {
    const order = taxIncluded({
      grand_total: 84.06,
      coupon_code: "LEXTEST10",
      items: [
        { ...orders.mixedRates.items[0], discount_total: 7.497, tax_total: 10.773, taxes: [{ id: "vat_standard", amount: 10.773 }] },
        { ...orders.mixedRates.items[1], discount_total: 1.299, tax_total: 0.7648, taxes: [{ id: "vat_reduced", amount: 0.7648 }] },
      ],
    });
    const built = build(order);
    expect(lines(built)).toEqual([
      [3, "Lexware Test T-Shirt", 24.99, 19],
      [1, "Lexware Test Buch", 12.99, 7],
      [1, "Versand (DHL Paket)", 4.9, 19],
      [1, "Rabatt (LEXTEST10, 19 % USt)", -7.5, 19],
      [1, "Rabatt (LEXTEST10, 7 % USt)", -1.3, 7],
    ]);
    expect(built.totalCents).toBe(8406);
  });

  it("names the coupon on a single discount line", () => {
    const order = taxIncluded({
      grand_total: 80.36,
      coupon_code: "WELCOME",
      shipment_price: 0,
      shipment_tax: 0,
      items: [
        { ...orders.mixedRates.items[0], discount_total: 7.6, tax_total: 10.7566, taxes: [{ id: "vat_standard", amount: 10.7566 }] },
        orders.mixedRates.items[1] && { ...orders.mixedRates.items[1], tax_total: 0.8498, taxes: [{ id: "vat_reduced", amount: 0.8498 }] },
      ],
    });
    expect(lines(build(order))).toContainEqual([1, "Rabatt (WELCOME)", -7.6, 19]);
  });
});

describe("invoice across borders", () => {
  it("is a distance sale with French rates for a consumer in France, on a contact", () => {
    const built = build(orders.frenchConsumer);
    expect(built.payload.taxConditions).toEqual({ taxType: "net", taxSubType: "distanceSales" });
    expect(lines(built).map((line) => line[3])).toEqual([20, 5.5, 20]);
    expect(built.totalCents).toBe(8556);
    expect(built.contact?.payload).toMatchObject({
      version: 0,
      roles: { customer: {} },
      person: { firstName: "Jean", lastName: "Dupont" },
      addresses: { billing: [{ street: "1 Rue de Rivoli", zip: "75001", city: "Paris", countryCode: "FR" }] },
      emailAddresses: { business: ["lexware-test-fr@example.com"] },
    });
    expect(built.contact?.key).toBe(`${orders.frenchConsumer.account_id}|person||FR`);
  });

  it("does not share a contact between orders without an account", () => {
    const { account_id, account, ...guest } = orders.frenchConsumer;
    const key = (order: Record<string, any>) => build(order).contact?.key;
    expect(key({ ...guest, account_email: "Jean@Example.com" })).toBe("guest:jean@example.com|person||FR");
    expect(key({ ...guest, account_email: "marie@example.com" })).toBe("guest:marie@example.com|person||FR");
    expect(key(guest)).toBe(`guest:${guest.id}|person||FR`);
  });

  it("is a tax-free export for a customer in Switzerland", () => {
    const built = build(orders.swissExport);
    expect(built.payload.taxConditions).toEqual({ taxType: "thirdPartyCountryDelivery" });
    expect(lines(built)).toEqual([
      [2, "Lexware Test T-Shirt", 24.99, 0],
      [1, "Lexware Test Buch", 12.99, 0],
      [1, "Versand (DHL Paket International)", 9.9, 0],
    ]);
    expect(built.payload.lineItems[1].unitPrice).toHaveProperty("netAmount", 24.99);
    expect(built.contact?.payload).toHaveProperty("person");
  });

  it("is an intra-community supply for a business with a VAT ID, on a company contact", () => {
    const built = build(orders.belgianBusiness);
    expect(built.payload.taxConditions).toEqual({ taxType: "intraCommunitySupply" });
    expect(built.payload.address).toMatchObject({ name: "Peeters BV", supplement: "Anna Peeters", countryCode: "BE" });
    expect(built.contact?.payload.company).toEqual({
      name: "Peeters BV",
      vatRegistrationId: "BE0123456789",
      allowTaxFreeInvoices: true,
      contactPersons: [{ firstName: "Anna", lastName: "Peeters", emailAddress: "lexware-test-be@example.com" }],
    });
    expect(built.contact?.key).toContain("|company|BE0123456789|BE");
  });

  it("writes in English when asked, or by the customer's country", () => {
    const english = build(orders.swissExport, { language: "en" });
    expect(english.payload.language).toBe("en");
    expect(english.payload.lineItems[0].name).toBe("Order no. 100308 of 10 Oct 2026");
    expect(lines(english)[2][1]).toBe("Shipping (DHL Paket International)");
    expect(english.payload.paymentConditions?.paymentTermLabel).toBe("The invoice amount has been paid by cash.");

    expect(build(orders.swissExport, { language: "auto" }).language).toBe("de");
    expect(build(orders.frenchConsumer, { language: "auto" }).language).toBe("en");
    expect(build(orders.mixedRates, { language: "auto" }).language).toBe("de");
  });
});

describe("orders that get no invoice", () => {
  it("skips other currencies, which Lexware cannot invoice", () => {
    const found = problem(() => build({ ...orders.singleRate, currency: "USD" }));
    expect(found).toBeInstanceOf(Problem);
    expect(found).toMatchObject({ status: "skipped", code: "currency" });
  });

  it("holds an order that was charged no tax where tax is due", () => {
    const untaxed = {
      ...orders.singleRate,
      taxes: [],
      shipment_tax: 0,
      tax_total: 0,
      grand_total: 64.38,
      items: orders.singleRate.items.map((item) => ({ ...item, tax_total: 0, taxes: [] })),
    };
    expect(problem(() => build(untaxed))).toMatchObject({ status: "failed", code: "no_tax" });
  });

  it("holds an order whose tax is not what its rates give", () => {
    // Tax computed on the price before the discount: the discount lines would understate it
    const order = {
      ...orders.withCoupon,
      items: [
        { ...orders.withCoupon.items[0], tax_total: 24.2443, taxes: [{ id: "vat_standard", amount: 24.2443 }] },
        orders.withCoupon.items[1],
      ],
      grand_total: 109.23,
    };
    const found = problem(() => build(order));
    expect(found.status).toBe("failed");
    expect(["tax_mismatch", "total_mismatch"]).toContain(found.code);
  });

  it("holds an order whose parts do not add up to its total", () => {
    expect(problem(() => build({ ...orders.singleRate, grand_total: 80 }))).toMatchObject({ code: "total_mismatch" });
  });

  it("holds an order without a billing name or without items", () => {
    const nameless = { ...orders.singleRate, billing: { country: "DE" }, shipping: { country: "DE" }, account: {} };
    expect(problem(() => build(nameless))).toMatchObject({ code: "no_address" });
    expect(problem(() => build({ ...orders.singleRate, items: [] }))).toMatchObject({ code: "no_items" });
  });

  it("refuses tax on an account that issues invoices without VAT", () => {
    const small = { taxType: "net" as const, smallBusiness: true };
    expect(problem(() => build(orders.singleRate, { profile: small }))).toMatchObject({ code: "tax_unexpected" });
  });
});

describe("unusual orders", () => {
  it("adds up an item taxed by two rules, and leaves the verdict on the rate to Lexware", () => {
    const built = build(orders.doubleTaxed);
    expect(lines(built).map((line) => line[3])).toContain(26);
    expect(built.totalCents).toBe(11141);
  });

  it("finds the rate from the tax charged when the order carries no rates, as imported orders do", () => {
    const imported = {
      ...orders.singleRate,
      taxes: [],
      items: orders.singleRate.items.map((item) => ({ ...item, taxes: undefined })),
    };
    expect(lines(build(imported)).map((line) => line[3])).toEqual([19, 19, 19]);
  });

  it("puts a quantity on one line when no unit price multiplies back to its total", () => {
    // 7 units for 100.00 including tax: 14.2857 × 7 = 99.9999, which Lexware rounds to 100.00
    const order = taxIncluded({
      grand_total: 100,
      shipment_price: 0,
      shipment_tax: 0,
      items: [{ ...orders.mixedRates.items[0], quantity: 7, price: 14.2857, price_total: 100, tax_total: 15.9664, taxes: [{ id: "vat_standard", amount: 15.9664 }] }],
    });
    expect(lines(build(order))).toEqual([[7, "Lexware Test T-Shirt", 14.2857, 19]]);

    // 300 units for 100.01: no four-decimal unit price gives that total
    const awkward = taxIncluded({
      grand_total: 100.01,
      shipment_price: 0,
      shipment_tax: 0,
      items: [{ ...orders.mixedRates.items[0], quantity: 300, price: 0.3334, price_total: 100.01, tax_total: 15.968, taxes: [{ id: "vat_standard", amount: 15.968 }] }],
    });
    expect(lines(build(awkward))).toEqual([[1, "300 × Lexware Test T-Shirt", 100.01, 19]]);
  });

  it("invoices a gift card without tax on an ordinary German invoice", () => {
    const giftcard = {
      ...orders.singleRate,
      taxes: [],
      shipment_price: 0,
      shipment_tax: 0,
      tax_total: 0,
      grand_total: 50,
      items: [{ id: "1", product_name: "Geschenkgutschein", quantity: 1, price: 50, price_total: 50, discount_total: 0, tax_total: 0, delivery: "giftcard" }],
    };
    const built = build(giftcard);
    expect(built.payload.taxConditions.taxType).toBe("net");
    expect(lines(built)).toEqual([[1, "Geschenkgutschein", 50, 0]]);
    expect(built.payload.shippingConditions?.shippingType).toBe("service");
  });

  it("names the variant and lists options", () => {
    const order = {
      ...orders.singleRate,
      items: [
        { ...orders.singleRate.items[0], variant_name: "Blau / M" },
        { ...orders.singleRate.items[1], options: [{ name: "Format", value: "EPUB" }] },
      ],
    };
    const built = build(order);
    expect(built.payload.lineItems[1].name).toBe("Lexware Test T-Shirt – Blau / M");
    expect(built.payload.lineItems[2].description).toBe("Format: EPUB");
  });
});

describe("Lexware's calculation", () => {
  it("is reproduced for net lines (draft RE0001 in the test account)", () => {
    const sent = [
      { quantity: 3, unit: 83950, rate: 19 },
      { quantity: 1, unit: 121400, rate: 7 },
      { quantity: 1, unit: -25200, rate: 19 },
      { quantity: 1, unit: 41200, rate: 19 },
    ];
    expect(simulate(sent, "net")).toEqual({ gross: 4487, tax: 594 });
  });

  it("is reproduced for gross lines (invoice RE0002 in the test account)", () => {
    const sent = [
      { quantity: 3, unit: 33333, rate: 19 },
      { quantity: 2, unit: 129900, rate: 7 },
      { quantity: 1, unit: 250000, rate: 0 },
      { quantity: 1, unit: -15000, rate: 7 },
      { quantity: 1, unit: 49000, rate: 19 },
    ];
    expect(simulate(sent, "gross")).toEqual({ gross: 6438, tax: 398 });
  });
});
