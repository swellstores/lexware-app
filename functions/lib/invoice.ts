/**
 * Turns a Swell order into a Lexware invoice.
 *
 * Lexware computes every total itself, from the lines it is given: each line is rounded
 * to cents, the lines are summed per tax rate, and tax is computed on each sum. Swell
 * computes tax per item with four decimals and rounds only the order total. The two agree
 * most of the time and differ by a cent some of the time, so nothing here is sent on trust:
 * Lexware's calculation is reproduced, and the invoice is built so that its total is the
 * order's total to the cent.
 *
 * - A store with prices before tax gets a net invoice when Lexware's net calculation gives
 *   the order total. When it would be a cent off, the same lines are sent as gross amounts,
 *   whose sum is the total by construction.
 * - A store with prices including tax gets a gross invoice.
 * - Discounts are shown as their own negative line per tax rate, so the unit prices on the
 *   invoice are the prices the customer saw.
 */

import { displayDate, lexwareDate } from "./dates";
import type { LineItem, Profile, VoucherAddress, VoucherPayload } from "./lexware";
import {
  divideRounded,
  formatCents,
  microsToCents,
  netOfGross,
  rateToBasisPoints,
  taxOnNet,
  toCents,
  toMicros,
} from "./money";
import { classify, isProblem } from "./tax";
import type { TaxDecision } from "./tax";
import { chooseLanguage, formatRate, paymentMethodName, texts } from "./texts";
import type { Language } from "./texts";

export type SwellRecord = Record<string, any>;

/** A reason not to create a document. `failed` needs the merchant; `skipped` is outside what the app does */
export class Problem extends Error {
  status: "failed" | "skipped";
  code: string;

  constructor(status: "failed" | "skipped", code: string, message: string) {
    super(message);
    this.name = "Problem";
    this.status = status;
    this.code = code;
  }
}

export interface ContactDraft {
  /** Orders with the same key share one Lexware contact */
  key: string;
  payload: Record<string, unknown>;
}

export interface BuiltInvoice {
  payload: VoucherPayload;
  decision: TaxDecision;
  language: Language;
  /** What Lexware will compute as the invoice total, in cents. Equal to the order total */
  totalCents: number;
  taxCents: number;
  /** The contact to reference, when Lexware does not take a one-time address for this invoice */
  contact?: ContactDraft;
  customerName: string;
  customerEmail?: string;
}

export interface BuildOptions {
  profile: Profile;
  /** "de", "en" or "auto" */
  language?: string | null;
  now?: Date;
}

interface Component {
  kind: "item" | "shipping";
  name: string;
  description?: string;
  quantity: number;
  rate: number;
  taxIncluded: boolean;
  /** Price before discount, as the store states it (with or without tax), in micros */
  before: number;
  discount: number;
  tax: number;
}

type AmountMode = "net" | "gross";

interface Layout {
  mode: AmountMode;
  lines: PricedLine[];
}

interface PricedLine {
  name: string;
  description?: string;
  quantity: number;
  unitName: string;
  /** Unit price in micros: Lexware takes up to four decimals */
  unit: number;
  rate: number;
}

/** A rate Lexware can hold has at most two decimals; rates within rounding of a half step are that step */
function tidyRate(rate: number): number {
  const half = Math.round(rate * 2) / 2;
  return Math.abs(rate - half) < 0.15 ? half : Math.round(rate * 100) / 100;
}

/**
 * The tax rate of an order line. Swell names the rule that taxed each item; the rate comes
 * from there and is checked against the tax actually charged. Imported orders carry no
 * rates, so the charged tax decides when the two disagree.
 */
function findRate(declared: number | undefined, component: Omit<Component, "rate">): number {
  const base = component.before - component.discount;
  if (base <= 0) {
    return declared ?? 0;
  }
  if (component.tax <= 0) {
    return 0;
  }
  const net = component.taxIncluded ? base - component.tax : base;
  const charged = net > 0 ? (component.tax / net) * 100 : 0;
  if (declared !== undefined && Math.abs(declared - charged) < 0.15) {
    return declared;
  }
  return tidyRate(charged);
}

function declaredRate(order: SwellRecord, ids: string[] | undefined, shipping: boolean): number | undefined {
  const taxes: SwellRecord[] = Array.isArray(order.taxes) ? order.taxes : [];
  const applied = shipping ? taxes.filter((tax) => tax.shipping) : taxes.filter((tax) => ids?.includes(tax.id));
  if (applied.length === 0 || applied.some((tax) => typeof tax.rate !== "number")) {
    return undefined;
  }
  return applied.reduce((sum, tax) => sum + tax.rate, 0);
}

function describeOptions(item: SwellRecord): string | undefined {
  if (item.variant_name || !Array.isArray(item.options)) {
    return undefined;
  }
  const parts = item.options
    .filter((option: SwellRecord) => option?.name && option?.value !== undefined && option?.value !== null)
    .map((option: SwellRecord) => `${option.name}: ${option.value}`);
  return parts.length > 0 ? parts.join(", ").slice(0, 2000) : undefined;
}

function readComponents(order: SwellRecord, language: Language): Component[] {
  const t = texts(language);
  const components: Component[] = [];

  for (const item of Array.isArray(order.items) ? order.items : []) {
    const quantity = Number(item.quantity) || 0;
    if (quantity <= 0) {
      continue;
    }
    const before = item.price_total !== undefined && item.price_total !== null
      ? toMicros(item.price_total)
      : toMicros(item.price) * quantity;
    const base = {
      kind: "item" as const,
      name: [item.product_name || "Artikel", item.variant_name].filter(Boolean).join(" – ").slice(0, 255),
      description: describeOptions(item),
      quantity,
      taxIncluded: Boolean(order.item_tax_included),
      before,
      discount: Math.min(toMicros(item.discount_total), before),
      tax: toMicros(item.tax_total),
    };
    const ids = Array.isArray(item.taxes) ? item.taxes.map((tax: SwellRecord) => tax.id) : undefined;
    components.push({ ...base, rate: findRate(declaredRate(order, ids, false), base) });
  }

  const shipmentPrice = toMicros(order.shipment_price);
  if (shipmentPrice > 0) {
    const base = {
      kind: "shipping" as const,
      name: t.shipping(order.shipping?.service_name || undefined).slice(0, 255),
      quantity: 1,
      taxIncluded: Boolean(order.shipment_tax_included),
      before: shipmentPrice,
      discount: Math.min(toMicros(order.shipment_discount), shipmentPrice),
      tax: toMicros(order.shipment_tax),
    };
    components.push({ ...base, rate: findRate(declaredRate(order, undefined, true), base) });
  }

  return components;
}

/** A line of `quantity` units that Lexware will round to exactly `cents` */
function pricedLine(
  component: { name: string; description?: string; quantity: number; rate: number },
  cents: number,
  unitName: string,
): PricedLine {
  const { quantity } = component;
  const unit = divideRounded(cents * 100, quantity);
  if (divideRounded(unit * quantity, 100) === cents) {
    return { name: component.name, description: component.description, quantity, unitName, unit, rate: component.rate };
  }
  // No unit price with four decimals multiplies back to the total: one line for the lot
  return {
    name: `${quantity} × ${component.name}`.slice(0, 255),
    description: component.description,
    quantity: 1,
    unitName,
    unit: cents * 100,
    rate: component.rate,
  };
}

function discountLines(byRate: Map<number, number>, language: Language, code: string | undefined): PricedLine[] {
  const t = texts(language);
  const rates = [...byRate.entries()].filter(([, cents]) => cents > 0).sort((a, b) => b[0] - a[0]);
  return rates.map(([rate, cents]) => ({
    name: rates.length > 1 ? t.discountAtRate(formatRate(rate, language), code) : t.discount(code),
    quantity: 1,
    unitName: t.flat,
    unit: -cents * 100,
    rate,
  }));
}

/** Lines with the store's own net prices. Lexware adds the tax, so the total has to be checked */
function layoutNet(components: Component[], language: Language, code: string | undefined): Layout {
  const t = texts(language);
  const lines: PricedLine[] = [];
  const discounts = new Map<number, number>();

  for (const component of components) {
    lines.push(pricedLine(component, microsToCents(component.before), component.kind === "item" ? t.unit : t.flat));
    discounts.set(component.rate, (discounts.get(component.rate) || 0) + component.discount);
  }
  for (const [rate, micros] of discounts) {
    discounts.set(rate, microsToCents(micros));
  }
  return { mode: "net", lines: [...lines, ...discountLines(discounts, language, code)] };
}

/**
 * Lines with amounts that include tax and add up to exactly `totalCents`. Each component's
 * share of the total is what the customer paid for it; the fractions of a cent that Swell
 * carries are settled between the components.
 */
function layoutGross(
  components: Component[],
  totalCents: number,
  language: Language,
  code: string | undefined,
): Layout | undefined {
  const t = texts(language);
  const exact = components.map((c) => c.before - c.discount + (c.taxIncluded ? 0 : c.tax));
  const after = exact.map((micros) => Math.floor(micros / 100));
  let left = totalCents - after.reduce((a, b) => a + b, 0);
  if (left < 0 || left > components.length) {
    return undefined;
  }
  const byLoss = exact
    .map((micros, index) => ({ index, lost: micros - Math.floor(micros / 100) * 100 }))
    .sort((a, b) => b.lost - a.lost || a.index - b.index);
  for (let i = 0; left > 0; i++, left--) {
    after[byLoss[i].index] += 1;
  }

  const lines: PricedLine[] = [];
  const discounts = new Map<number, number>();
  components.forEach((component, index) => {
    let before = after[index];
    if (component.discount > 0) {
      const listed = component.taxIncluded
        ? microsToCents(component.before)
        : divideRounded(component.before * (10000 + rateToBasisPoints(component.rate)), 1000000);
      before = Math.max(listed, after[index]);
    }
    lines.push(pricedLine(component, before, component.kind === "item" ? t.unit : t.flat));
    discounts.set(component.rate, (discounts.get(component.rate) || 0) + before - after[index]);
  });
  return { mode: "gross", lines: [...lines, ...discountLines(discounts, language, code)] };
}

/** Lexware's own calculation: lines rounded to cents, summed per rate, tax computed on each sum */
export function simulate(
  lines: { quantity: number; unit: number; rate: number }[],
  mode: AmountMode,
): { gross: number; tax: number } {
  const sums = new Map<number, number>();
  for (const line of lines) {
    sums.set(line.rate, (sums.get(line.rate) || 0) + divideRounded(line.unit * line.quantity, 100));
  }
  let gross = 0;
  let tax = 0;
  for (const [rate, sum] of sums) {
    if (mode === "net") {
      const rateTax = taxOnNet(sum, rate);
      gross += sum + rateTax;
      tax += rateTax;
    } else {
      gross += sum;
      tax += sum - netOfGross(sum, rate);
    }
  }
  return { gross, tax };
}

function splitName(name: string): { firstName?: string; lastName: string } {
  const words = name.trim().split(/\s+/);
  if (words.length < 2) {
    return { lastName: name.trim() };
  }
  return { firstName: words.slice(0, -1).join(" "), lastName: words[words.length - 1] };
}

function readRecipient(order: SwellRecord) {
  const billing: SwellRecord = order.billing || {};
  const shipping: SwellRecord = order.shipping || {};
  const source = billing.address1 || billing.country ? billing : shipping;
  const account: SwellRecord = order.account || {};

  const person = String(
    source.name ||
      [source.first_name, source.last_name].filter(Boolean).join(" ") ||
      billing.name ||
      shipping.name ||
      account.name ||
      [account.first_name, account.last_name].filter(Boolean).join(" ") ||
      "",
  ).trim();
  const company = String(source.company || "").trim();
  const country = String(source.country || "").toUpperCase();

  const address: VoucherAddress = {
    name: company || person,
    supplement: (company ? person : source.address2) || undefined,
    street: [source.address1, company ? source.address2 : undefined].filter(Boolean).join(", ") || undefined,
    zip: source.zip || undefined,
    city: source.city || undefined,
    countryCode: country,
  };
  return { address, person, company, country, email: (account.email || order.account_email || undefined) as string | undefined };
}

/** What rules an order out before Lexware is asked anything */
export function checkOrder(order: SwellRecord): void {
  if (String(order.currency || "").toUpperCase() !== "EUR") {
    throw new Problem(
      "skipped",
      "currency",
      `The order is in ${order.currency || "an unknown currency"}. Lexware Office issues invoices in EUR only.`,
    );
  }
  if (order.draft) {
    throw new Problem("failed", "draft", "The order is a draft. Place it first.");
  }
}

/**
 * Builds the invoice for an order, or throws a Problem that says why there is none.
 * The order needs its `account` expanded for the customer's e-mail and VAT ID.
 */
export function buildInvoice(order: SwellRecord, options: BuildOptions): BuiltInvoice {
  checkOrder(order);

  const recipient = readRecipient(order);
  if (!recipient.address.name) {
    throw new Problem("failed", "no_address", "The order has no name in its billing address.");
  }

  const language = chooseLanguage(options.language, recipient.country);
  const components = readComponents(order, language);
  if (!components.some((component) => component.kind === "item")) {
    throw new Problem("failed", "no_items", "The order has no items.");
  }

  const totalCents = toCents(order.grand_total);
  const taxMicros = components.reduce((sum, component) => sum + component.tax, 0);
  const goods = (order.items || []).some((item: SwellRecord) => item.delivery === "shipment" && item.quantity > 0);
  const shippingCountry = String(order.shipping?.country || "").toUpperCase();
  const taxExempt = (order.items || []).every(
    (item: SwellRecord) => item.delivery === "giftcard" || toMicros(item.price_total) - toMicros(item.discount_total) <= 0,
  );

  const decision = classify({
    country: goods ? shippingCountry || recipient.country : recipient.country || shippingCountry,
    addressCountry: recipient.country,
    taxCharged: taxMicros > 0,
    vatNumber: order.billing?.vat_number || order.account?.vat_number,
    goods,
    taxExempt,
    profile: options.profile,
  });
  if (isProblem(decision)) {
    throw new Problem("failed", decision.code, decision.message);
  }

  const code: string | undefined = order.coupon_code || undefined;
  let layout: Layout | undefined;
  let taxType: string = decision.kind;

  if (decision.kind === "standard") {
    if (components.every((component) => !component.taxIncluded)) {
      const net = layoutNet(components, language, code);
      if (simulate(net.lines, "net").gross === totalCents) {
        layout = net;
      }
    }
    layout = layout || layoutGross(components, totalCents, language, code);
    taxType = layout?.mode || "gross";
  } else {
    // No tax on the document: what the customer paid is the net amount
    const untaxed = components.map((component) => ({ ...component, rate: 0, tax: 0 }));
    const gross = layoutGross(untaxed, totalCents, language, code);
    layout = gross && { mode: "net", lines: gross.lines };
  }

  const simulated = layout && simulate(layout.lines, layout.mode);
  if (!layout || !simulated || simulated.gross !== totalCents) {
    throw new Problem(
      "failed",
      "total_mismatch",
      `The order's items, shipping, discounts and tax do not add up to its total of ${formatCents(totalCents)} EUR, so an invoice for exactly that amount cannot be built. Create this invoice in Lexware by hand.`,
    );
  }

  const chargedCents = microsToCents(taxMicros);
  const rates = new Set(layout.lines.map((line) => line.rate));
  if (Math.abs(simulated.tax - chargedCents) > 2 + rates.size) {
    throw new Problem(
      "failed",
      "tax_mismatch",
      `The tax charged on the order (${formatCents(chargedCents)} EUR) is not what its tax rates give (${formatCents(simulated.tax)} EUR). Check the store's tax settings: tax has to be calculated on the price after discounts. Create this invoice in Lexware by hand.`,
    );
  }

  const t = texts(language);
  const amountField = layout.mode === "gross" ? "grossAmount" : "netAmount";
  const lineItems: LineItem[] = [
    { type: "text", name: t.order(String(order.number || order.id), displayDate(order.date_created, language)) },
    ...layout.lines.map(
      (line): LineItem => ({
        type: "custom",
        name: line.name,
        ...(line.description ? { description: line.description } : {}),
        quantity: line.quantity,
        unitName: line.unitName,
        unitPrice: { currency: "EUR", [amountField]: line.unit / 10000, taxRatePercentage: line.rate },
      }),
    ),
  ];

  const payload: VoucherPayload = {
    voucherDate: lexwareDate(options.now),
    language,
    address: recipient.address,
    lineItems,
    totalPrice: { currency: "EUR" },
    taxConditions: { taxType, ...(decision.subType ? { taxSubType: decision.subType } : {}) },
    shippingConditions: {
      shippingType: goods ? "delivery" : "service",
      shippingDate: lexwareDate(order.date_created),
    },
  };
  if (order.paid) {
    payload.paymentConditions = {
      paymentTermLabel: t.paid(paymentMethodName(order.billing?.method, language)),
      paymentTermDuration: 0,
    };
  }

  return {
    payload,
    decision,
    language,
    totalCents,
    taxCents: simulated.tax,
    contact: decision.contact ? draftContact(order, recipient, decision) : undefined,
    customerName: recipient.address.name as string,
    customerEmail: recipient.email,
  };
}

function draftContact(
  order: SwellRecord,
  recipient: ReturnType<typeof readRecipient>,
  decision: TaxDecision,
): ContactDraft {
  const asCompany = Boolean(recipient.company || decision.vatNumber);
  const personName = recipient.person ? splitName(recipient.person) : undefined;
  const { address, email } = recipient;

  const payload: Record<string, unknown> = {
    version: 0,
    roles: { customer: {} },
    addresses: {
      billing: [
        {
          ...(address.supplement ? { supplement: address.supplement } : {}),
          ...(address.street ? { street: address.street } : {}),
          ...(address.zip ? { zip: address.zip } : {}),
          ...(address.city ? { city: address.city } : {}),
          countryCode: address.countryCode,
        },
      ],
    },
    ...(email ? { emailAddresses: { business: [email] } } : {}),
    note: `Swell customer ${order.account_id || ""}`.trim(),
  };

  if (asCompany) {
    payload.company = {
      name: recipient.company || recipient.person,
      ...(decision.vatNumber ? { vatRegistrationId: decision.vatNumber } : {}),
      allowTaxFreeInvoices: decision.kind !== "standard",
      ...(recipient.company && personName
        ? { contactPersons: [{ ...personName, ...(email ? { emailAddress: email } : {}) }] }
        : {}),
    };
  } else {
    payload.person = personName;
  }

  return {
    key: [order.account_id || "guest", asCompany ? "company" : "person", decision.vatNumber || "", recipient.country].join("|"),
    payload,
  };
}
