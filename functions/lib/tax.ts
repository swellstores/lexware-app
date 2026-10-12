/**
 * Chooses the Lexware tax type for an order.
 *
 * The app does not decide what tax is due. It takes the tax Swell charged and finds the
 * Lexware tax type that says the same thing. An order that fits none of them is not sent:
 * a wrong tax type on a finalized invoice cannot be corrected through the API.
 *
 * Checked against a Lexware account on 2026-10-10:
 * - a one-time address is accepted only for German addresses; any other country needs a contact
 * - "distanceSales" on an account that reports VAT in the destination country takes that
 *   country's rates and refuses German ones
 * - export invoices are accepted for a private person
 * - intra-community supply needs the merchant's own VAT ID in Lexware
 */

import type { Profile } from "./lexware";

export const EU_COUNTRIES = [
  "AT", "BE", "BG", "CY", "CZ", "DE", "DK", "EE", "ES", "FI", "FR", "GR", "HR", "HU",
  "IE", "IT", "LT", "LU", "LV", "MT", "NL", "PL", "PT", "RO", "SE", "SI", "SK",
];

export type TaxKind =
  /** Tax as charged, on a net or gross invoice */
  | "standard"
  /** The merchant charges no VAT at all: small business (§19 UStG) or tax-exempt */
  | "vatfree"
  /** Tax-free delivery to a business in another EU country */
  | "intraCommunitySupply"
  /** Tax-free export of goods */
  | "thirdPartyCountryDelivery"
  /** Services to a customer outside the EU */
  | "thirdPartyCountryService";

export interface TaxDecision {
  kind: TaxKind;
  /** Marks a sale to a consumer in another EU country, which Lexware books separately */
  subType?: "distanceSales" | "electronicServices";
  /** Lexware accepts this document only for a saved contact, not for a one-time address */
  contact: boolean;
  /** The contact must be a company with this VAT ID */
  vatNumber?: string;
}

export interface TaxProblem {
  code: "no_tax" | "tax_unexpected" | "no_country";
  message: string;
}

export interface TaxInput {
  /** Where the goods go, or where the customer is for an order that ships nothing */
  country?: string;
  /** The country of the address printed on the document */
  addressCountry?: string;
  taxCharged: boolean;
  vatNumber?: string;
  /** The order ships goods */
  goods: boolean;
  /** Everything on the order is a gift card or free, so no tax is expected anywhere */
  taxExempt: boolean;
  profile: Profile;
}

export function isProblem(result: TaxDecision | TaxProblem): result is TaxProblem {
  return "code" in result;
}

export function classify(input: TaxInput): TaxDecision | TaxProblem {
  const country = (input.country || "").toUpperCase();
  const addressCountry = (input.addressCountry || country).toUpperCase();
  const vatNumber = (input.vatNumber || "").replace(/\s+/g, "").toUpperCase() || undefined;
  const foreignAddress = addressCountry !== "DE";

  if (!country) {
    return {
      code: "no_country",
      message: "The order has no country in its billing or shipping address, so the tax type cannot be chosen.",
    };
  }

  if (input.profile.smallBusiness || input.profile.taxType === "vatfree") {
    if (input.taxCharged) {
      return {
        code: "tax_unexpected",
        message:
          "The order was charged tax, but the Lexware account is set up to issue invoices without VAT (small business or tax-exempt). Correct the tax settings in Swell or in Lexware.",
      };
    }
    return { kind: "vatfree", contact: foreignAddress };
  }

  const noTax: TaxProblem = {
    code: "no_tax",
    message:
      "The order was charged no tax, and nothing shows why: it is not an export and not a sale to an EU business with a VAT ID. Check the store's tax rules. If no tax is correct, create this invoice in Lexware by hand.",
  };

  if (country === "DE") {
    if (!input.taxCharged && !input.taxExempt) {
      return noTax;
    }
    return { kind: "standard", contact: foreignAddress };
  }

  if (EU_COUNTRIES.includes(country)) {
    if (input.taxCharged) {
      // Tax was charged, so the sale is booked the way a sale to a consumer is, whoever
      // bought. Under the destination principle Lexware then expects that country's rates
      return {
        kind: "standard",
        subType:
          input.profile.distanceSalesPrinciple === "DESTINATION"
            ? input.goods
              ? "distanceSales"
              : "electronicServices"
            : undefined,
        contact: true,
      };
    }
    if (vatNumber) {
      return { kind: "intraCommunitySupply", contact: true, vatNumber };
    }
    return input.taxExempt ? { kind: "standard", contact: true } : noTax;
  }

  if (input.taxCharged) {
    return { kind: "standard", contact: true };
  }
  return { kind: input.goods ? "thirdPartyCountryDelivery" : "thirdPartyCountryService", contact: true };
}
