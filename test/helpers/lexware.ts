import { vi } from "vitest";
import { pacing } from "../../functions/lib/lexware";

type Row = Record<string, any>;

export interface LexwareCall {
  method: string;
  path: string;
  query: URLSearchParams;
  body: any;
}

function round(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) * 100 + 1e-7) / 100;
}

/** Lexware's totals for a voucher: lines rounded to cents, summed per rate, tax on each sum */
function totals(voucher: Row) {
  const gross = voucher.taxConditions.taxType === "gross";
  const sums = new Map<number, number>();
  for (const line of voucher.lineItems) {
    if (line.type !== "custom") {
      continue;
    }
    const rate = line.unitPrice.taxRatePercentage;
    const unit = gross ? line.unitPrice.grossAmount : line.unitPrice.netAmount;
    sums.set(rate, round((sums.get(rate) || 0) + round(unit * line.quantity)));
  }
  let net = 0;
  let tax = 0;
  const taxAmounts = [];
  for (const [rate, sum] of sums) {
    const rateNet = gross ? round(sum / (1 + rate / 100)) : sum;
    const rateTax = gross ? round(sum - rateNet) : round((sum * rate) / 100);
    net = round(net + rateNet);
    tax = round(tax + rateTax);
    if (rate > 0) {
      taxAmounts.push({ taxRatePercentage: rate, taxAmount: rateTax, netAmount: rateNet });
    }
  }
  return {
    totalPrice: { currency: "EUR", totalNetAmount: net, totalGrossAmount: round(net + tax), totalTaxAmount: tax },
    taxAmounts,
  };
}

function json(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

/**
 * Replaces `fetch` with a small Lexware: it numbers documents, computes their totals,
 * lists them and hands out a PDF for finalized ones. `intercept` can answer any call
 * differently, to play refusals, outages and lost answers.
 */
export function createLexware(profile: Row = {}) {
  pacing.spacingMs = 0;
  pacing.rateLimitWaitsMs = [0, 0];

  const vouchers: Row[] = [];
  const contacts: Row[] = [];
  const calls: LexwareCall[] = [];
  const state: {
    intercept?: (call: LexwareCall) => Response | Promise<Response> | "lose-answer" | undefined;
    /** The clock Lexware dates new documents by */
    now?: () => Date;
  } = {};

  function create(kind: string, body: Row, finalize: boolean): Row {
    const invoice = kind === "invoices";
    const count = vouchers.filter((voucher) => voucher.kind === kind).length + 1;
    const voucher = {
      ...body,
      ...totals(body),
      kind,
      id: `${invoice ? "inv" : "cn"}-${count}`,
      voucherNumber: `${invoice ? "RE" : "GS"}${String(count).padStart(4, "0")}`,
      voucherStatus: finalize ? "open" : "draft",
      createdDate: (state.now?.() || new Date()).toISOString(),
    };
    vouchers.push(voucher);
    return voucher;
  }

  const mock = vi.fn(async (input: RequestInfo | URL, init: RequestInit = {}) => {
    const url = new URL(String(input));
    const call: LexwareCall = {
      method: init.method || "GET",
      path: url.pathname.replace("/v1", ""),
      query: url.searchParams,
      body: init.body ? JSON.parse(init.body as string) : undefined,
    };
    calls.push(call);

    const intercepted = await state.intercept?.(call);
    if (intercepted === "lose-answer") {
      // Lexware performs the call, but the answer never arrives
      const [, kind] = call.path.split("/");
      create(kind, call.body, call.query.get("finalize") === "true");
      throw new TypeError("network connection lost");
    }
    if (intercepted) {
      return intercepted;
    }

    const [, resource, id, sub] = call.path.split("/");
    if (resource === "profile") {
      return json(200, { companyName: "Test GmbH", taxType: "net", smallBusiness: false, ...profile });
    }
    if (resource === "contacts" && call.method === "POST") {
      const contact = { ...call.body, id: `contact-${contacts.length + 1}` };
      contacts.push(contact);
      return json(200, { id: contact.id });
    }
    if (resource === "voucherlist") {
      const type = call.query.get("voucherType") === "invoice" ? "invoices" : "credit-notes";
      const size = Number(call.query.get("size") || 25);
      const page = Number(call.query.get("page") || 0);
      // Days are compared as Lexware does, in German time. The tests stay within one offset
      const day = (date: string) => new Date(new Date(date).getTime() + 2 * 60 * 60 * 1000).toISOString().slice(0, 10);
      const from = call.query.get("createdDateFrom");
      const to = call.query.get("createdDateTo");
      const listed = vouchers
        .filter((voucher) => voucher.kind === type)
        .filter((voucher) => (!from || day(voucher.createdDate) >= from) && (!to || day(voucher.createdDate) <= to))
        .sort((a, b) => (a.createdDate < b.createdDate ? 1 : -1));
      const content = listed.slice(page * size, (page + 1) * size).map((voucher) => ({
        id: voucher.id,
        voucherNumber: voucher.voucherNumber,
        voucherStatus: voucher.voucherStatus,
        totalAmount: voucher.totalPrice.totalGrossAmount,
        createdDate: voucher.createdDate,
      }));
      return json(200, { content, last: (page + 1) * size >= listed.length });
    }
    if (resource === "invoices" || resource === "credit-notes") {
      if (call.method === "POST") {
        return json(201, { id: create(resource, call.body, call.query.get("finalize") === "true").id });
      }
      const voucher = vouchers.find((item) => item.kind === resource && item.id === id);
      if (!voucher) {
        return json(404, { message: "not found" });
      }
      if (sub === "file") {
        return voucher.voucherStatus === "draft"
          ? json(409, { message: "is in status 'draft' and therefore cannot be downloaded" })
          : new Response(new TextEncoder().encode(`%PDF ${voucher.voucherNumber}`), { status: 200 });
      }
      return json(200, voucher);
    }
    return json(404, { message: `Unexpected call ${call.method} ${call.path}` });
  });
  vi.stubGlobal("fetch", mock);

  return {
    vouchers,
    contacts,
    calls,
    state,
    json,
    /** The create calls made so far */
    created(kind?: string) {
      return calls.filter((call) => call.method === "POST" && (kind ? call.path === `/${kind}` : call.path !== "/contacts"));
    },
  };
}
