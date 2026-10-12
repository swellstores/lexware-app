/**
 * The few words the app itself prints on a document. Everything else on it (title,
 * introduction, closing text, footer) comes from the merchant's Lexware settings.
 */

export type Language = "de" | "en";

const GERMAN_SPEAKING = ["DE", "AT", "CH", "LI"];

/** The document language for a setting of "de", "en" or "auto" (German for DE, AT, CH and LI) */
export function chooseLanguage(setting: string | undefined | null, country: string | undefined): Language {
  if (setting === "en") {
    return "en";
  }
  if (setting === "auto") {
    return !country || GERMAN_SPEAKING.includes(country.toUpperCase()) ? "de" : "en";
  }
  return "de";
}

const PAYMENT_METHODS: Record<string, { de: string; en: string }> = {
  card: { de: "Kreditkarte", en: "credit card" },
  paypal: { de: "PayPal", en: "PayPal" },
  amazon: { de: "Amazon Pay", en: "Amazon Pay" },
  apple: { de: "Apple Pay", en: "Apple Pay" },
  google: { de: "Google Pay", en: "Google Pay" },
  klarna: { de: "Klarna", en: "Klarna" },
  ideal: { de: "iDEAL", en: "iDEAL" },
  bancontact: { de: "Bancontact", en: "Bancontact" },
  sepa: { de: "SEPA-Lastschrift", en: "SEPA direct debit" },
  bank_transfer: { de: "Überweisung", en: "bank transfer" },
  cash: { de: "Barzahlung", en: "cash" },
  account: { de: "Kundenguthaben", en: "store credit" },
  giftcard: { de: "Geschenkgutschein", en: "gift card" },
};

export interface Texts {
  unit: string;
  flat: string;
  order(number: string, date: string): string;
  shipping(service?: string): string;
  discount(code?: string): string;
  discountAtRate(rate: string, code?: string): string;
  paid(method?: string): string;
  refund(invoice: string, order: string, reference: string): string;
  refundLine(rate?: string): string;
}

function percent(rate: number, language: Language): string {
  const text = String(Math.round(rate * 100) / 100);
  return language === "de" ? text.replace(".", ",") : text;
}

const TEXTS: Record<Language, Texts> = {
  de: {
    unit: "Stück",
    flat: "pauschal",
    order: (number, date) => `Bestellung Nr. ${number} vom ${date}`,
    shipping: (service) => (service ? `Versand (${service})` : "Versand"),
    discount: (code) => (code ? `Rabatt (${code})` : "Rabatt"),
    discountAtRate: (rate, code) => `Rabatt (${code ? `${code}, ` : ""}${rate} % USt)`,
    paid: (method) =>
      method ? `Der Rechnungsbetrag wurde bereits per ${method} beglichen.` : "Der Rechnungsbetrag wurde bereits beglichen.",
    refund: (invoice, order, reference) =>
      `Erstattung zu Rechnung ${invoice}, Bestellung Nr. ${order} (Ref. ${reference})`,
    refundLine: (rate) => (rate ? `Erstattung (${rate} % USt)` : "Erstattung"),
  },
  en: {
    unit: "pcs",
    flat: "flat",
    order: (number, date) => `Order no. ${number} of ${date}`,
    shipping: (service) => (service ? `Shipping (${service})` : "Shipping"),
    discount: (code) => (code ? `Discount (${code})` : "Discount"),
    discountAtRate: (rate, code) => `Discount (${code ? `${code}, ` : ""}${rate}% VAT)`,
    paid: (method) => (method ? `The invoice amount has been paid by ${method}.` : "The invoice amount has been paid."),
    refund: (invoice, order, reference) => `Refund for invoice ${invoice}, order no. ${order} (ref. ${reference})`,
    refundLine: (rate) => (rate ? `Refund (${rate}% VAT)` : "Refund"),
  },
};

export function texts(language: Language): Texts {
  return TEXTS[language];
}

export function paymentMethodName(method: string | undefined | null, language: Language): string | undefined {
  return method ? PAYMENT_METHODS[method]?.[language] : undefined;
}

export function formatRate(rate: number, language: Language): string {
  return percent(rate, language);
}
