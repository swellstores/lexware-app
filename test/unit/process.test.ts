import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { creditRefund, giveUp, invoiceOrder, run } from "../../functions/lib/process";
import type { Context } from "../../functions/lib/process";
import * as orders from "../fixtures/orders";
import { createLexware } from "../helpers/lexware";
import { createStore } from "../helpers/store";

const SETTINGS = {
  id: "app-record-id",
  connection: { api_key: "key", enabled: true },
  documents: { mode: "final", language: "de", credit_notes: true, send_email: true },
};

let store: ReturnType<typeof createStore>;
let lexware: ReturnType<typeof createLexware>;
let clock: Date;

function context(settings: Record<string, any> = SETTINGS): Context {
  return { swell: store.swell, settings, now: () => clock };
}

function later(minutes: number): void {
  clock = new Date(clock.getTime() + minutes * 60 * 1000);
}

function refund(order: { id: string }, amount: number, id = "aaaaaaaaaaaaaaaaaaaaaaa1", number = "100019") {
  return { id, number, parent_id: "payment-1", order_id: order.id, amount, currency: "EUR", success: true };
}

beforeEach(() => {
  clock = new Date("2026-10-10T07:00:00.000Z");
  store = createStore({ settings: SETTINGS, orders: Object.values(orders) });
  lexware = createLexware({ distanceSalesPrinciple: "DESTINATION" });
  lexware.state.now = () => clock;
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("creating an invoice", () => {
  it("creates it finalized, stores number, link and PDF, and has the customer e-mailed", async () => {
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(outcome.result).toBe("created");
    expect(outcome.message).toBe("Invoice RE0001 is in Lexware.");
    expect(store.documents).toHaveLength(1);
    expect(store.documents[0]).toMatchObject({
      key: `invoice:${orders.singleRate.id}`,
      type: "invoice",
      status: "created",
      source: "order.paid",
      order_number: "100304",
      customer_name: "Erika Musterfrau",
      customer_email: "lexware-test-de@example.com",
      amount: 76.61,
      currency: "EUR",
      tax_type: "net",
      language: "de",
      name: "RE0001",
      number: "RE0001",
      lexware_id: "inv-1",
      lexware_status: "open",
      lexware_url: "https://app.lexware.de/permalink/invoices/view/inv-1",
      pdf: { filename: "RE0001.pdf", url: "https://cdn.test/RE0001.pdf" },
      notify_customer: true,
      date_submitted: null,
      locked_until: null,
      problem: null,
      attempts: 1,
    });
    expect(lexware.created("invoices")).toHaveLength(1);
    expect(lexware.created("invoices")[0].query.get("finalize")).toBe("true");
  });

  it("writes the record once before the invoice is sent, already marked as submitted", async () => {
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(store.swell.post).toHaveBeenCalledTimes(1);
    expect(store.swell.post.mock.calls[0][1]).toMatchObject({
      status: "pending",
      order_number: "100304",
      date_submitted: "2026-10-10T07:00:00.000Z",
      locked_until: "2026-10-10T07:00:30.000Z",
    });
    const order = store.swell.post.mock.invocationCallOrder[0];
    const sent = (fetch as any).mock.invocationCallOrder[(fetch as any).mock.calls.findIndex((call: any[]) => call[1]?.method === "POST")];
    expect(order).toBeLessThan(sent);
  });

  it("does nothing for a second delivery of the same event", async () => {
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    const again = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(again.result).toBe("exists");
    expect(again.message).toBe("Invoice RE0001 is in Lexware already.");
    expect(lexware.vouchers).toHaveLength(1);
    expect(store.documents).toHaveLength(1);
  });

  it("creates one invoice when two deliveries arrive together", async () => {
    const outcomes = await Promise.all([
      invoiceOrder(context(), orders.singleRate.id, "order.paid"),
      invoiceOrder(context(), orders.singleRate.id, "order.paid"),
    ]);

    expect(outcomes.map((outcome) => outcome.result).sort()).toEqual(["busy", "created"]);
    expect(lexware.vouchers).toHaveLength(1);
    expect(store.documents).toHaveLength(1);
  });

  it("leaves a record alone while another attempt holds it, and takes it over when the lock has run out", async () => {
    store.documents.push({
      id: "bbbbbbbbbbbbbbbbbbbbbbbb",
      key: `invoice:${orders.singleRate.id}`,
      type: "invoice",
      status: "pending",
      order_id: orders.singleRate.id,
      locked_until: "2026-10-10T07:00:20.000Z",
    });
    expect((await invoiceOrder(context(), orders.singleRate.id, "order.paid")).result).toBe("busy");
    expect(lexware.vouchers).toHaveLength(0);

    later(1);
    expect((await invoiceOrder(context(), orders.singleRate.id, "order.paid")).result).toBe("created");
    expect(store.documents[0].attempts).toBe(1);
  });

  it("lets one attempt through when two read a waiting record at the same moment", async () => {
    lexware.state.intercept = (call) => (call.path === "/invoices" ? lexware.json(503, {}) : undefined);
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    lexware.state.intercept = undefined;
    later(5);

    // An event delivered again and a click on Retry, each holding its own copy of the record
    const copies = [{ ...store.documents[0] }, { ...store.documents[0] }] as any[];
    const outcomes = await Promise.all(copies.map((copy) => run(context(), copy)));
    expect(outcomes.map((outcome) => outcome.result).sort()).toEqual(["busy", "created"]);
    expect(lexware.vouchers).toHaveLength(1);
    expect(store.documents[0]).toMatchObject({ status: "created", number: "RE0001", attempts: 3 });
  });

  it("creates a draft when the merchant chose drafts, and e-mails nobody", async () => {
    const drafts = { ...SETTINGS, documents: { ...SETTINGS.documents, mode: "draft" } };
    const outcome = await invoiceOrder(context(drafts), orders.singleRate.id, "order.paid");

    expect(outcome.message).toBe("Invoice RE0001 is a draft in Lexware. Finalize it there to give it a PDF.");
    expect(lexware.created("invoices")[0].query.get("finalize")).toBeNull();
    expect(store.documents[0]).toMatchObject({ status: "created", lexware_status: "draft" });
    expect(store.documents[0].notify_customer).toBeUndefined();
    expect(store.documents[0].pdf).toBeUndefined();
    expect(lexware.calls.some((call) => call.path.endsWith("/file"))).toBe(false);
  });

  it("creates a draft when the setting was never saved", async () => {
    await invoiceOrder(context({ connection: { api_key: "key" } }), orders.singleRate.id, "dashboard");
    expect(lexware.vouchers[0].voucherStatus).toBe("draft");
  });

  it("fetches the PDF and e-mails the customer once a draft was finalized in Lexware", async () => {
    const drafts = { ...SETTINGS, documents: { ...SETTINGS.documents, mode: "draft" } };
    await invoiceOrder(context(drafts), orders.singleRate.id, "order.paid");
    lexware.vouchers[0].voucherStatus = "open";

    later(5);
    const outcome = await run(context(drafts), store.documents[0] as any);
    expect(outcome.result).toBe("created");
    expect(store.documents[0]).toMatchObject({ lexware_status: "open", pdf: { filename: "RE0001.pdf" }, notify_customer: true });
    expect(lexware.vouchers).toHaveLength(1);
  });

  it("lists a draft that was deleted in Lexware under needs attention, and creates it again on a retry", async () => {
    const drafts = { ...SETTINGS, documents: { ...SETTINGS.documents, mode: "draft" } };
    await invoiceOrder(context(drafts), orders.singleRate.id, "order.paid");
    lexware.vouchers.length = 0;

    const read = await run(context(drafts), store.documents[0] as any);
    expect(read.result).toBe("failed");
    expect(read.message).toContain("Invoice RE0001 no longer exists in the connected Lexware account");
    expect(store.documents[0]).toMatchObject({
      status: "failed",
      problem_code: "gone",
      lexware_id: null,
      number: null,
      name: "Invoice for order 100304",
    });
    expect(lexware.created("invoices")).toHaveLength(1);

    const retried = await run(context(drafts), store.documents[0] as any);
    expect(retried.result).toBe("created");
    expect(lexware.created("invoices")).toHaveLength(2);
    expect(store.documents[0]).toMatchObject({ status: "created", lexware_id: "inv-1", problem: null });
  });

  it("does not e-mail when e-mails are off or the customer has no address", async () => {
    const quiet = { ...SETTINGS, documents: { ...SETTINGS.documents, send_email: false } };
    await invoiceOrder(context(quiet), orders.singleRate.id, "order.paid");
    expect(store.documents[0].notify_customer).toBeUndefined();
    expect(store.documents[0].pdf).toBeTruthy();
    expect((await invoiceOrder(context(quiet), orders.singleRate.id, "order.paid")).result).toBe("exists");
  });
});

describe("a create request without an answer", () => {
  it("is looked up in Lexware before anything is created again", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" && call.path === "/invoices" ? "lose-answer" : undefined);
    const first = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(first.result).toBe("retry");
    expect(store.documents[0]).toMatchObject({ status: "pending", problem_code: "temporary", locked_until: null });
    expect(store.documents[0].date_submitted).toBe("2026-10-10T07:00:00.000Z");
    expect(store.documents[0].lexware_id).toBeUndefined();
    expect(lexware.vouchers).toHaveLength(1);

    lexware.state.intercept = undefined;
    later(5);
    const second = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(second.result).toBe("created");
    expect(lexware.vouchers).toHaveLength(1);
    expect(lexware.created("invoices")).toHaveLength(1);
    expect(store.documents[0]).toMatchObject({ status: "created", lexware_id: "inv-1", number: "RE0001", date_submitted: null });
    expect(lexware.calls.some((call) => call.path === "/voucherlist")).toBe(true);
  });

  it("is not mistaken for another order's invoice with the same total", async () => {
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    // A second order with the same items and total, whose own request is lost before Lexware gets it
    const twin = { ...orders.singleRate, id: "cccccccccccccccccccccccc", number: "100399" };
    store = createStore({ settings: SETTINGS, orders: [twin], documents: store.documents });
    lexware.state.intercept = (call) =>
      call.method === "POST" && call.path === "/invoices" ? lexware.json(504, {}) : undefined;
    expect((await invoiceOrder(context(), twin.id, "order.paid")).result).toBe("retry");

    lexware.state.intercept = undefined;
    later(5);
    expect((await invoiceOrder(context(), twin.id, "order.paid")).result).toBe("created");
    expect(lexware.vouchers.map((voucher) => voucher.voucherNumber)).toEqual(["RE0001", "RE0002"]);
    expect(store.documents[1]).toMatchObject({ number: "RE0002", order_number: "100399" });
  });

  it("is found among later invoices with the same total, however late the search runs", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" && call.path === "/invoices" ? "lose-answer" : undefined);
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    lexware.state.intercept = undefined;

    // A store with one product at one price: a day of orders with the same total follows
    const twins = Array.from({ length: 30 }, (_, index) => ({
      ...orders.singleRate,
      id: (0xd00000 + index).toString(16).padStart(24, "0"),
      number: String(200000 + index),
    }));
    store = createStore({ settings: SETTINGS, orders: [orders.singleRate, ...twins], documents: store.documents });
    for (const twin of twins) {
      later(10);
      await invoiceOrder(context(), twin.id, "order.paid");
    }
    expect(lexware.vouchers).toHaveLength(31);

    lexware.calls.length = 0;
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(outcome.result).toBe("created");
    expect(lexware.vouchers).toHaveLength(31);
    expect(store.documents[0]).toMatchObject({ lexware_id: "inv-1", number: "RE0001" });
    // One look at the list and one document read, not one per invoice with that total
    expect(lexware.calls.filter((call) => call.path === "/voucherlist")).toHaveLength(1);
    expect(lexware.calls.filter((call) => call.method === "GET" && /^\/invoices\/inv-\d+$/.test(call.path)).map((call) => call.path)).toEqual([
      "/invoices/inv-1",
      "/invoices/inv-1",
    ]);
  });

  it("reads further pages of Lexware's list when the day had more documents than one page holds", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" && call.path === "/invoices" ? "lose-answer" : undefined);
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    lexware.state.intercept = undefined;
    later(30);
    for (let index = 0; index < 260; index++) {
      lexware.vouchers.push({ ...lexware.vouchers[0], id: `other-${index}`, voucherNumber: `X${index}`, createdDate: clock.toISOString(), lineItems: [] });
    }

    expect((await invoiceOrder(context(), orders.singleRate.id, "order.paid")).result).toBe("created");
    expect(store.documents[0]).toMatchObject({ lexware_id: "inv-1" });
    expect(lexware.calls.filter((call) => call.path === "/voucherlist").map((call) => call.query.get("page"))).toEqual(["0", "1"]);
    expect(lexware.created("invoices")).toHaveLength(1);
  });

  it("waits a minute before it concludes that Lexware created nothing", async () => {
    lexware.state.intercept = (call) =>
      call.method === "POST" && call.path === "/invoices" ? lexware.json(504, {}) : undefined;
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    lexware.state.intercept = undefined;

    clock = new Date(clock.getTime() + 40 * 1000);
    const soon = await invoiceOrder(context(), orders.singleRate.id, "dashboard");
    expect(soon).toMatchObject({ result: "retry", message: "Lexware has not confirmed the last attempt yet. Try again in a minute." });
    expect(lexware.vouchers).toHaveLength(0);

    later(1);
    expect((await invoiceOrder(context(), orders.singleRate.id, "dashboard")).result).toBe("created");
    expect(lexware.vouchers).toHaveLength(1);
  });

  it("finishes a document whose PDF could not be fetched, without creating it again", async () => {
    lexware.state.intercept = (call) => (call.path.endsWith("/file") ? lexware.json(503, {}) : undefined);
    const first = await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(first.result).toBe("retry");
    expect(store.documents[0]).toMatchObject({ status: "pending", lexware_id: "inv-1", number: "RE0001", lexware_status: "open" });

    lexware.state.intercept = undefined;
    later(5);
    const second = await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(second.result).toBe("created");
    expect(store.documents[0]).toMatchObject({ status: "created", pdf: { filename: "RE0001.pdf" }, notify_customer: true });
    expect(lexware.vouchers).toHaveLength(1);
  });
});

describe("documents that cannot be created", () => {
  it("lists a refusal by Lexware under needs attention, with one alert, and creates the invoice on a retry", async () => {
    lexware.state.intercept = (call) =>
      call.method === "POST" && call.path === "/invoices"
        ? lexware.json(406, { message: "Invalid taxRatePercentage or does not match booking date or country code." })
        : undefined;
    const first = await invoiceOrder(context(), orders.doubleTaxed.id, "order.paid");

    expect(first.result).toBe("failed");
    expect(first.message).toContain("The order's tax rates (19 %, 26 %) are not valid in Lexware for a customer in DE.");
    expect(store.documents[0]).toMatchObject({ status: "failed", problem_code: "rejected", date_submitted: null, order_number: "100301" });
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ key: "documents", subject: "Invoice for order 100301", count: 1, app_id: "app-record-id" });

    lexware.state.intercept = undefined;
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(store.alerts).toHaveLength(1);

    later(5);
    const second = await invoiceOrder(context(), orders.doubleTaxed.id, "dashboard");
    expect(second.result).toBe("created");
    expect(store.documents[0]).toMatchObject({ status: "created", problem: null, problem_code: null, attempts: 2 });
    expect(store.alerts).toHaveLength(0);
  });

  it("counts further failures on the same alert instead of raising new ones", async () => {
    await invoiceOrder(context(), "dddddddddddddddddddddddd", "dashboard");
    const untaxed = { ...orders.singleRate, id: "eeeeeeeeeeeeeeeeeeeeeeee", taxes: [], tax_total: 0, shipment_tax: 0, grand_total: 64.38, items: orders.singleRate.items.map((item) => ({ ...item, tax_total: 0, taxes: [] })) };
    store = createStore({ settings: SETTINGS, orders: [untaxed], documents: store.documents, alerts: store.alerts });
    await invoiceOrder(context(), untaxed.id, "order.paid");

    expect(store.documents.map((doc) => doc.problem_code)).toEqual(["no_order", "no_tax"]);
    expect(store.alerts).toHaveLength(1);
    expect(store.alerts[0]).toMatchObject({ key: "documents", count: 2 });
    expect(lexware.vouchers).toHaveLength(0);
  });

  it("records a refused key on the document and raises the connection alert", async () => {
    lexware.state.intercept = () => lexware.json(401, { message: "Unauthorized" });
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(outcome).toMatchObject({ result: "failed", message: "Lexware did not accept the API key." });
    expect(store.documents[0]).toMatchObject({ status: "failed", problem_code: "connection", order_number: "100304", customer_name: "Erika Musterfrau" });
    expect(store.alerts[0]).toMatchObject({ key: "connection", message: "Lexware did not accept the API key." });
  });

  it("records a missing key the same way, without calling Lexware", async () => {
    const outcome = await invoiceOrder(context({ ...SETTINGS, connection: { enabled: true } }), orders.singleRate.id, "order.paid");
    expect(outcome.message).toBe("The Lexware API key is missing in the app's settings.");
    expect(store.alerts[0].key).toBe("connection");
    expect(fetch).not.toHaveBeenCalled();
  });

  it("clears the connection alert as soon as Lexware accepts a document again", async () => {
    lexware.state.intercept = () => lexware.json(402, { message: "no_active_contract" });
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(store.alerts.map((alert) => alert.key)).toEqual(["connection"]);

    lexware.state.intercept = undefined;
    later(5);
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    expect(store.alerts).toHaveLength(0);
    expect(store.documents.map((doc) => doc.status)).toEqual(["failed", "created"]);
  });

  it("keeps the documents alert while another document still needs attention", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" ? lexware.json(406, { message: "nein" }) : undefined);
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    lexware.state.intercept = undefined;
    later(5);

    await invoiceOrder(context(), orders.singleRate.id, "dashboard");
    expect(store.alerts).toHaveLength(1);
    await invoiceOrder(context(), orders.withCoupon.id, "dashboard");
    expect(store.alerts).toHaveLength(0);
  });

  it("lists a document that is in Lexware but could not be read, and finishes it on a retry without creating it again", async () => {
    // A key that may create invoices but not download them
    lexware.state.intercept = (call) => (call.path.endsWith("/file") ? lexware.json(403, {}) : undefined);
    const first = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(first.result).toBe("failed");
    expect(store.documents[0]).toMatchObject({ status: "failed", problem_code: "connection", lexware_id: "inv-1", number: "RE0001" });
    expect(store.alerts.map((alert) => alert.key)).toEqual(["connection"]);

    lexware.state.intercept = undefined;
    later(5);
    const second = await run(context(), store.documents[0] as any);
    expect(second.result).toBe("created");
    expect(store.documents[0]).toMatchObject({ status: "created", problem: null, pdf: { filename: "RE0001.pdf" }, notify_customer: true });
    expect(lexware.created("invoices")).toHaveLength(1);
    expect(store.alerts).toHaveLength(0);
  });

  it("asks to retry when Lexware is busy or down, and keeps the record pending", async () => {
    lexware.state.intercept = () => lexware.json(429, { message: "Rate limit exceeded" });
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");

    expect(outcome.result).toBe("retry");
    expect(store.documents[0]).toMatchObject({ status: "pending", problem_code: "temporary", locked_until: null });
    expect(store.alerts).toHaveLength(0);
  });

  it("skips an order in another currency without an alert", async () => {
    const dollars = { ...orders.singleRate, id: "ffffffffffffffffffffffff", currency: "USD" };
    store = createStore({ settings: SETTINGS, orders: [dollars] });
    const outcome = await invoiceOrder(context(), dollars.id, "order.paid");

    expect(outcome.result).toBe("skipped");
    expect(store.documents[0]).toMatchObject({ status: "skipped", problem_code: "currency", currency: "USD", name: "Invoice for order 100304" });
    expect(store.documents[0].amount).toBeUndefined();
    expect(store.alerts).toHaveLength(0);
    expect(lexware.created()).toHaveLength(0);
  });

  it("skips it even while Lexware refuses the key, because the order never needs Lexware", async () => {
    const dollars = { ...orders.singleRate, id: "ffffffffffffffffffffffff", currency: "USD" };
    store = createStore({ settings: SETTINGS, orders: [dollars] });
    lexware.state.intercept = () => lexware.json(401, {});
    expect((await invoiceOrder(context(), dollars.id, "order.paid")).result).toBe("skipped");
    expect(store.alerts).toHaveLength(0);
  });

  it("marks a document that could not be completed in time as needing attention", async () => {
    lexware.state.intercept = () => lexware.json(503, {});
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    await giveUp(context(), outcome.doc, "Lexware could not be reached for a day.");

    expect(store.documents[0]).toMatchObject({ status: "failed", problem_code: "unavailable" });
    expect(store.alerts[0].key).toBe("documents");
  });

  it("leaves a document that was resolved by hand alone", async () => {
    store.documents.push({ id: "bbbbbbbbbbbbbbbbbbbbbbbb", key: `invoice:${orders.singleRate.id}`, type: "invoice", status: "resolved", order_number: "100304" });
    const outcome = await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    expect(outcome).toMatchObject({ result: "exists", message: "Invoice for order 100304 was marked as resolved." });
    expect(lexware.created()).toHaveLength(0);
  });

  it("releases the record and passes on a fault of the store API", async () => {
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    store.documents[0].lexware_id = null;
    store.documents[0].status = "pending";
    store.swell.get.mockImplementationOnce(async () => {
      throw new Error("store API is down");
    });
    later(5);
    await expect(run(context(), store.documents[0] as any)).rejects.toThrow("store API is down");
    expect(store.documents[0]).toMatchObject({ locked_until: null, problem_code: "internal" });
  });
});

describe("invoices across borders", () => {
  it("creates a Lexware contact for the customer and uses it again for the next order", async () => {
    await invoiceOrder(context(), orders.frenchConsumer.id, "order.paid");
    expect(lexware.contacts).toHaveLength(1);
    expect(lexware.vouchers[0].address).toMatchObject({ contactId: "contact-1", name: "Jean Dupont", countryCode: "FR" });
    expect(lexware.vouchers[0].taxConditions).toEqual({ taxType: "net", taxSubType: "distanceSales" });
    expect(store.documents[0]).toMatchObject({ contact_id: "contact-1", tax_type: "net / distanceSales", status: "created" });

    const next = { ...orders.frenchConsumer, id: "cccccccccccccccccccccccc", number: "100400" };
    store = createStore({ settings: SETTINGS, orders: [next], documents: store.documents });
    await invoiceOrder(context(), next.id, "order.paid");
    expect(lexware.contacts).toHaveLength(1);
    expect(lexware.vouchers[1].address.contactId).toBe("contact-1");
  });

  it("keeps the contact when the invoice itself is refused, so a retry does not create a second one", async () => {
    lexware.state.intercept = (call) =>
      call.method === "POST" && call.path === "/invoices"
        ? lexware.json(406, { message: "Validation failed: [NO_SOURCE: Erstellen von Sonderfällen ohne eigene USt-IdNr. nicht möglich.]" })
        : undefined;
    const first = await invoiceOrder(context(), orders.belgianBusiness.id, "order.paid");
    expect(first.message).toContain("Lexware needs your company's own VAT ID");
    expect(lexware.contacts).toHaveLength(1);

    lexware.state.intercept = undefined;
    later(5);
    await invoiceOrder(context(), orders.belgianBusiness.id, "dashboard");
    expect(lexware.contacts).toHaveLength(1);
    expect(lexware.vouchers[0].taxConditions).toEqual({ taxType: "intraCommunitySupply" });
  });
});

describe("credit notes", () => {
  it("creates one for a refund of an order the app invoiced", async () => {
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    later(60);
    const outcome = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");

    expect(outcome?.result).toBe("created");
    expect(outcome?.message).toBe("Credit note GS0001 is in Lexware.");
    expect(store.documents[1]).toMatchObject({
      key: "credit_note:aaaaaaaaaaaaaaaaaaaaaaa1",
      type: "credit_note",
      status: "created",
      order_number: "100303",
      refund_id: "aaaaaaaaaaaaaaaaaaaaaaa1",
      payment_id: "payment-1",
      reference: "100019",
      invoice_number: "RE0001",
      number: "GS0001",
      amount: 10,
      tax_type: "gross",
      customer_email: "lexware-test-de@example.com",
      pdf: { filename: "GS0001.pdf" },
      notify_customer: true,
    });
    const sent = lexware.created("credit-notes")[0].body;
    expect(sent.lineItems[0].name).toBe("Erstattung zu Rechnung RE0001, Bestellung Nr. 100303 (Ref. 100019)");
    expect(sent.lineItems.slice(1).map((line: any) => line.unitPrice.grossAmount)).toEqual([8.73, 1.27]);
  });

  it("creates one per refund, and none for a refund delivered twice", async () => {
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");
    const repeat = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");
    expect(repeat?.result).toBe("exists");

    const rest = await creditRefund(context(), refund(orders.withCoupon, 88.63, "aaaaaaaaaaaaaaaaaaaaaaa2", "100020"), "payment.refund.succeeded");
    expect(rest?.result).toBe("created");
    expect(lexware.vouchers.filter((voucher) => voucher.kind === "credit-notes")).toHaveLength(2);
    expect(lexware.vouchers[2].totalPrice.totalGrossAmount).toBe(88.63);
  });

  it("refuses a refund that would credit more than the invoice", async () => {
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    await creditRefund(context(), refund(orders.withCoupon, 90), "payment.refund.succeeded");
    const over = await creditRefund(context(), refund(orders.withCoupon, 10, "aaaaaaaaaaaaaaaaaaaaaaa2", "100020"), "payment.refund.succeeded");

    expect(over).toMatchObject({ result: "failed" });
    expect(store.documents[2]).toMatchObject({ status: "failed", problem_code: "refund_exceeds" });
    expect(store.alerts[0]).toMatchObject({ key: "documents", subject: "Credit note for order 100303" });
  });

  it("repeats the invoice's lines when the whole order is refunded", async () => {
    await invoiceOrder(context(), orders.singleRate.id, "order.paid");
    await creditRefund(context(), refund(orders.singleRate, 76.61), "payment.refund.succeeded");
    const sent = lexware.created("credit-notes")[0].body;
    expect(sent.taxConditions).toEqual({ taxType: "net" });
    expect(sent.lineItems.slice(1).map((line: any) => line.name)).toEqual(["Lexware Test T-Shirt", "Lexware Test E-Book", "Versand (DHL Paket)"]);
  });

  it("ignores refunds that are not the app's business", async () => {
    expect(await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded")).toBeUndefined();
    expect(await creditRefund(context(), { id: "x", amount: 5 }, "payment.refund.succeeded")).toBeUndefined();

    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    const off = { ...SETTINGS, documents: { ...SETTINGS.documents, credit_notes: false } };
    expect(await creditRefund(context(off), refund(orders.withCoupon, 10), "payment.refund.succeeded")).toBeUndefined();
    expect(store.documents).toHaveLength(1);
  });

  it("waits for the invoice when the invoice itself needs attention", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" ? lexware.json(406, { message: "nein" }) : undefined);
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    const outcome = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");
    expect(outcome).toMatchObject({ result: "failed" });
    expect(store.documents[1]).toMatchObject({ status: "failed", problem_code: "no_invoice" });

    lexware.state.intercept = undefined;
    later(5);
    await run(context(), store.documents[0] as any);
    const retried = await run(context(), store.documents[1] as any);
    expect(retried.result).toBe("created");
    expect(store.documents[1]).toMatchObject({ status: "created", invoice_number: "RE0001", number: "GS0001" });
    expect(store.alerts).toHaveLength(0);
  });

  it("asks for a credit note by hand when the invoice is no longer in the Lexware account", async () => {
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    lexware.vouchers.length = 0;
    const outcome = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");

    expect(outcome?.result).toBe("failed");
    expect(outcome?.message).toContain("Invoice RE0001 no longer exists in the connected Lexware account");
    expect(store.documents[1]).toMatchObject({ status: "failed", problem_code: "invoice_gone" });
    expect(lexware.created("credit-notes")).toHaveLength(0);
  });

  it("asks for a credit note by hand when the invoice was resolved by hand", async () => {
    store.documents.push({ id: "bbbbbbbbbbbbbbbbbbbbbbbb", key: `invoice:${orders.withCoupon.id}`, type: "invoice", status: "resolved", order_number: "100303", number: "RE0099" });
    const outcome = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");
    expect(outcome?.result).toBe("failed");
    expect(store.documents[1]).toMatchObject({ status: "failed", problem_code: "invoice_by_hand", name: "Credit note for order 100303" });
    expect(lexware.calls).toHaveLength(0);
  });

  it("finds a credit note whose answer was lost by the refund's reference", async () => {
    await invoiceOrder(context(), orders.withCoupon.id, "order.paid");
    lexware.state.intercept = (call) => (call.method === "POST" && call.path === "/credit-notes" ? "lose-answer" : undefined);
    await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");
    lexware.state.intercept = undefined;
    later(5);
    const outcome = await creditRefund(context(), refund(orders.withCoupon, 10), "payment.refund.succeeded");

    expect(outcome?.result).toBe("created");
    expect(lexware.vouchers.filter((voucher) => voucher.kind === "credit-notes")).toHaveLength(1);
    expect(store.documents[1]).toMatchObject({ lexware_id: "cn-1", number: "GS0001" });
  });
});
