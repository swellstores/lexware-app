import { describe, expect, it } from "vitest";
import { classify } from "../../functions/lib/tax";
import type { TaxInput } from "../../functions/lib/tax";

const regular = { taxType: "net" as const, smallBusiness: false, distanceSalesPrinciple: "DESTINATION" as const };

function input(overrides: Partial<TaxInput>): TaxInput {
  return { country: "DE", taxCharged: true, goods: true, taxExempt: false, profile: regular, ...overrides };
}

describe("tax type", () => {
  it("is an ordinary invoice to a one-time address in Germany", () => {
    expect(classify(input({}))).toEqual({ kind: "standard", contact: false });
  });

  it("holds a German order without tax, unless nothing on it is taxable", () => {
    expect(classify(input({ taxCharged: false }))).toMatchObject({ code: "no_tax" });
    expect(classify(input({ taxCharged: false, taxExempt: true }))).toEqual({ kind: "standard", contact: false });
  });

  it("marks a taxed sale to another EU country as a distance sale when VAT is due there", () => {
    expect(classify(input({ country: "FR" }))).toEqual({ kind: "standard", subType: "distanceSales", contact: true });
    expect(classify(input({ country: "FR", goods: false }))).toMatchObject({ subType: "electronicServices" });
    expect(classify(input({ country: "AT", vatNumber: "ATU12345678" }))).toMatchObject({ subType: "distanceSales" });
  });

  it("leaves the mark out when the account charges German VAT on EU sales", () => {
    const origin = { ...regular, distanceSalesPrinciple: "ORIGIN" as const };
    expect(classify(input({ country: "FR", profile: origin }))).toEqual({ kind: "standard", subType: undefined, contact: true });
    expect(classify(input({ country: "FR", profile: { taxType: "net" } }))).toMatchObject({ subType: undefined });
  });

  it("is an intra-community supply for an untaxed sale to an EU business with a VAT ID", () => {
    expect(classify(input({ country: "BE", taxCharged: false, vatNumber: " be 0123 456 789 " }))).toEqual({
      kind: "intraCommunitySupply",
      contact: true,
      vatNumber: "BE0123456789",
    });
  });

  it("holds an untaxed sale to an EU consumer", () => {
    expect(classify(input({ country: "NL", taxCharged: false }))).toMatchObject({ code: "no_tax" });
  });

  it("is an export outside the EU: goods as a delivery, anything else as a service", () => {
    expect(classify(input({ country: "CH", taxCharged: false }))).toEqual({ kind: "thirdPartyCountryDelivery", contact: true });
    expect(classify(input({ country: "US", taxCharged: false, goods: false }))).toEqual({
      kind: "thirdPartyCountryService",
      contact: true,
    });
    expect(classify(input({ country: "CH", taxCharged: true }))).toEqual({ kind: "standard", contact: true });
  });

  it("issues invoices without VAT for a small business or a tax-exempt account", () => {
    const small = { taxType: "net" as const, smallBusiness: true };
    expect(classify(input({ taxCharged: false, profile: small }))).toEqual({ kind: "vatfree", contact: false });
    expect(classify(input({ taxCharged: false, profile: { taxType: "vatfree" } }))).toEqual({ kind: "vatfree", contact: false });
    expect(classify(input({ taxCharged: true, profile: small }))).toMatchObject({ code: "tax_unexpected" });
  });

  it("needs a contact whenever the address on the document is not German", () => {
    expect(classify(input({ country: "DE", addressCountry: "AT" }))).toEqual({ kind: "standard", contact: true });
    expect(classify(input({ country: undefined }))).toMatchObject({ code: "no_country" });
  });
});
