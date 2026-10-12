import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import createInvoice from "../../functions/create-invoice";
import creditRefund from "../../functions/credit-refund";
import invoiceOrder from "../../functions/invoice-order";
import processDocument from "../../functions/process-document";
import ProcessDocuments from "../../functions/process-documents";
import resolveDocument from "../../functions/resolve-document";
import testConnection, { describeAccount } from "../../functions/test-connection";
import * as orders from "../fixtures/orders";
import { createLexware } from "../helpers/lexware";
import { createMockRequest } from "../helpers/mock-request";
import { createStore } from "../helpers/store";

const SETTINGS = {
  id: "app-record-id",
  connection: { api_key: "key", enabled: true },
  documents: { mode: "final", send_email: false },
};

let store: ReturnType<typeof createStore>;
let lexware: ReturnType<typeof createLexware>;

function request(data: Record<string, any>) {
  return createMockRequest({ data, swell: store.swell as any, appId: "lexware" });
}

function action(extra: Record<string, any>, values: Record<string, any> = {}) {
  return request({ ...values, $action: { id: "x", source: "record", user_id: "user-1", ...extra } });
}

async function thrown(run: () => Promise<unknown>): Promise<any> {
  try {
    await run();
  } catch (err) {
    return err;
  }
  throw new Error("Expected the function to throw");
}

/** A workflow step runner that runs each step once, like a run without failures */
const step = {
  do: vi.fn(async (_name: string, _options: unknown, work: () => Promise<unknown>) => work()),
} as any;

function workflow(data: Record<string, any>, trigger = "action") {
  return new ProcessDocuments().run({ data, swell: store.swell, workflow: { trigger }, appId: "lexware" } as any, step);
}

beforeEach(() => {
  store = createStore({ settings: SETTINGS, orders: Object.values(orders) });
  lexware = createLexware();
  step.do.mockClear();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("order.paid", () => {
  it("creates the invoice and reports it in the delivery log", async () => {
    const result = await invoiceOrder(request({ ...orders.singleRate, $event: { type: "order.paid", delivery: { attempts: 0 } } }));
    expect(result).toEqual({ result: "created", number: "RE0001", message: "Invoice RE0001 is in Lexware." });
    expect(store.documents[0].source).toBe("order.paid");
  });

  it("does nothing when the merchant has switched the app off since the event", async () => {
    store.setSettings({ ...SETTINGS, connection: { api_key: "key", enabled: false } });
    const result = await invoiceOrder(request({ ...orders.singleRate, $event: { type: "order.paid" } }));
    expect(result).toEqual({ skipped: "The app is switched off" });
    expect(store.documents).toHaveLength(0);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("fails the delivery while Lexware is unreachable, so Swell delivers the event again", async () => {
    lexware.state.intercept = () => lexware.json(503, {});
    const err = await thrown(() => invoiceOrder(request({ ...orders.singleRate, $event: { type: "order.paid", delivery: { attempts: 0 } } })));
    expect(err).toBeInstanceOf(SwellError);
    expect(err.status).toBe(503);
    expect(store.documents[0].status).toBe("pending");
  });

  it("ends the delivery for data Lexware refuses, which a retry cannot fix", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" ? lexware.json(406, { message: "nein" }) : undefined);
    const result = await invoiceOrder(request({ ...orders.singleRate, $event: { type: "order.paid" } }));
    expect(result).toMatchObject({ result: "failed", message: "Lexware refused the document: nein" });
  });

  it("gives up after a day of failures and lists the order under needs attention", async () => {
    lexware.state.intercept = () => lexware.json(503, {});
    const firstFailed = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    const result = await invoiceOrder(
      request({ ...orders.singleRate, $event: { type: "order.paid", delivery: { attempts: 9, date_first_failed: firstFailed } } }),
    );
    expect(result).toMatchObject({ result: "failed" });
    expect(String(result.message)).toContain("Lexware could not be reached for a day.");
    expect(store.documents[0]).toMatchObject({ status: "failed", problem_code: "unavailable" });
    expect(store.alerts[0].key).toBe("documents");
  });
});

describe("payment.refund.succeeded", () => {
  it("creates the credit note for an invoiced order and ignores other refunds", async () => {
    await invoiceOrder(request({ ...orders.singleRate, $event: { type: "order.paid" } }));
    const refund = { id: "aaaaaaaaaaaaaaaaaaaaaaa1", number: "100019", parent_id: "payment-1", order_id: orders.singleRate.id, amount: 20 };
    const result = await creditRefund(request({ ...refund, $event: { type: "payment.refund.succeeded" } }));
    expect(result).toMatchObject({ result: "created", number: "GS0001" });

    const other = await creditRefund(request({ ...refund, id: "aaaaaaaaaaaaaaaaaaaaaaa2", order_id: orders.withCoupon.id }));
    expect(other).toEqual({ skipped: "Nothing to do for this record" });
    expect(store.documents).toHaveLength(2);
  });
});

describe("Create Lexware invoice on an order", () => {
  it("creates the invoice whether or not automatic creation is on", async () => {
    store.setSettings({ ...SETTINGS, connection: { api_key: "key", enabled: false } });
    const result = await createInvoice(action({ record_id: orders.mixedRates.id, collection: "orders" }));
    expect(result).toEqual({ message: "Invoice RE0001 is in Lexware." });
    expect(store.documents[0].source).toBe("dashboard");
  });

  it("answers with the existing invoice instead of creating a second one", async () => {
    await createInvoice(action({ record_id: orders.mixedRates.id }));
    expect(await createInvoice(action({ record_id: orders.mixedRates.id }))).toEqual({ message: "Invoice RE0001 is in Lexware already." });
    expect(lexware.vouchers).toHaveLength(1);
  });

  it("shows the reason as an error when no invoice can be created", async () => {
    const dollars = { ...orders.singleRate, id: "ffffffffffffffffffffffff", currency: "USD" };
    store = createStore({ settings: SETTINGS, orders: [dollars] });
    const err = await thrown(() => createInvoice(action({ record_id: dollars.id })));
    expect(err.message).toBe("Not sent to Lexware. The order is in USD. Lexware Office issues invoices in EUR only.");
    expect(err.status).toBe(400);
  });

  it("refuses an id that is not a record id, and a missing key", async () => {
    expect((await thrown(() => createInvoice(action({ record_id: "../settings" })))).message).toBe("Unknown order");
    store.setSettings({ connection: {} });
    expect((await thrown(() => createInvoice(action({ record_id: orders.mixedRates.id })))).message).toContain("Enter your Lexware API key");
  });
});

describe("actions on a document", () => {
  it("retries a document that needs attention", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" ? lexware.json(406, { message: "nein" }) : undefined);
    await thrown(() => createInvoice(action({ record_id: orders.singleRate.id })));
    lexware.state.intercept = undefined;
    vi.useFakeTimers({ now: Date.now() + 60 * 1000, toFake: ["Date"] });

    const result = await processDocument(action({ id: "retry", record_id: store.documents[0].id }));
    expect(result).toEqual({ message: "Invoice RE0001 is in Lexware." });
    expect(store.documents[0].status).toBe("created");
  });

  it("marks a document as resolved, with the number the merchant gives, and settles the alert", async () => {
    lexware.state.intercept = (call) => (call.method === "POST" ? lexware.json(406, { message: "nein" }) : undefined);
    await thrown(() => createInvoice(action({ record_id: orders.singleRate.id })));
    expect(store.alerts).toHaveLength(1);

    const result = await resolveDocument(action({ id: "resolve", record_id: store.documents[0].id }, { number: " RE0099 " }));
    expect(result.message).toContain("Marked as resolved");
    expect(store.documents[0]).toMatchObject({ status: "resolved", number: "RE0099" });
    expect(store.alerts).toHaveLength(0);

    lexware.state.intercept = undefined;
    expect(await createInvoice(action({ record_id: orders.singleRate.id }))).toEqual({ message: "Invoice RE0099 was marked as resolved." });
    expect(lexware.vouchers).toHaveLength(0);
  });

  it("lets a document that is in Lexware but could not be read be resolved as it is", async () => {
    lexware.state.intercept = (call) => (call.path.endsWith("/file") ? lexware.json(404, {}) : undefined);
    await thrown(() => createInvoice(action({ record_id: orders.singleRate.id })));
    expect(store.documents[0]).toMatchObject({ status: "failed", lexware_id: "inv-1" });

    const answer = await resolveDocument(action({ record_id: store.documents[0].id }));
    expect(answer.message).toBe("Marked as resolved. The document stays in Lexware as it is.");
    expect(store.documents[0]).toMatchObject({ status: "created", number: "RE0001", problem: null });
    expect(store.alerts).toHaveLength(0);
  });

  it("does not resolve a document that exists in Lexware", async () => {
    await createInvoice(action({ record_id: orders.singleRate.id }));
    const err = await thrown(() => resolveDocument(action({ record_id: store.documents[0].id })));
    expect(err.status).toBe(409);
    expect((await thrown(() => resolveDocument(action({ record_id: "aaaaaaaaaaaaaaaaaaaaaaaa" })))).status).toBe(404);
    expect((await thrown(() => processDocument(action({ record_id: "nope" })))).status).toBe(400);
  });
});

describe("Test connection", () => {
  it("names the account and how it will be invoiced, and remembers the company", async () => {
    store.setSettings({ connection: { api_key: "key" } });
    const result = await testConnection(action({ source: "field", settings: "connection" }));
    expect(result.message).toBe(
      'Connected to Test GmbH (regular VAT, EU consumers are invoiced with German VAT). Documents are created as drafts. Turn on "Create documents automatically" to start.',
    );
    expect(store.settings.connection).toEqual({ api_key: "key", company: "Test GmbH" });
    expect(store.swell.put).toHaveBeenCalledWith("/settings/lexware", { connection: { company: "Test GmbH" } });
  });

  it("clears the connection alert and points at documents that wait", async () => {
    store = createStore({
      settings: { ...SETTINGS, connection: { ...SETTINGS.connection, company: "Test GmbH" } },
      alerts: [{ id: "a1", key: "connection", message: "refused" }],
      documents: [{ id: "d1", key: "invoice:1", status: "failed" }, { id: "d2", key: "invoice:2", status: "failed" }],
    });
    const result = await testConnection(action({ source: "field", settings: "connection" }));
    expect(result.message).toBe(
      "Connected to Test GmbH (regular VAT, EU consumers are invoiced with German VAT). Documents are created finalized. 2 documents need attention: choose Retry failed documents in the Actions menu.",
    );
    expect(store.alerts).toHaveLength(0);
    expect(store.swell.put).not.toHaveBeenCalled();
  });

  it("says what to do about a missing or refused key", async () => {
    lexware.state.intercept = () => lexware.json(401, {});
    expect((await thrown(() => testConnection(action({ source: "field" })))).message).toContain("Lexware did not accept the API key.");
    lexware.state.intercept = () => lexware.json(402, {});
    expect((await thrown(() => testConnection(action({ source: "field" })))).message).toContain("no active plan with API access");
    lexware.state.intercept = () => lexware.json(500, {});
    expect((await thrown(() => testConnection(action({ source: "field" })))).status).toBe(502);
    store.setSettings({ connection: {} });
    expect((await thrown(() => testConnection(action({ source: "field" })))).message).toBe("Enter the API key, save the settings, then test again.");
  });

  it("describes each kind of Lexware account", () => {
    expect(describeAccount({ smallBusiness: true })).toBe("small business, invoices without VAT");
    expect(describeAccount({ taxType: "vatfree" })).toBe("tax-exempt, invoices without VAT");
    expect(describeAccount({ taxType: "gross", distanceSalesPrinciple: "DESTINATION" })).toBe(
      "regular VAT, EU consumers are invoiced with their own country's VAT",
    );
  });
});

describe("bulk workflow", () => {
  function fail(id: string, order: { id: string; number: string }) {
    return { id, key: `invoice:${order.id}`, type: "invoice", status: "failed", order_id: order.id, order_number: order.number, problem_code: "rejected" };
  }

  it("retries every document that is not finished, in small steps", async () => {
    const all = [orders.singleRate, orders.withCoupon, orders.mixedRates, orders.frenchConsumer, orders.swissExport, orders.doubleTaxed];
    store = createStore({
      settings: SETTINGS,
      orders: all,
      documents: [
        ...all.map((order, index) => fail(`a0000000000000000000000${index}`, order)),
        { id: "b00000000000000000000000", key: "invoice:x", type: "invoice", status: "resolved" },
        { id: "b00000000000000000000001", key: "invoice:y", type: "invoice", status: "skipped" },
      ],
      alerts: [{ id: "a1", key: "documents", message: "x", date_last_seen: new Date().toISOString() }],
    });
    lexware = createLexware({ distanceSalesPrinciple: "DESTINATION" });

    const totals = await workflow({ $action: { id: "retry-failed", source: "settings", settings: "connection" } });
    expect(totals).toEqual({ created: 6, failed: 0, skipped: 0, halted: false });
    expect(step.do).toHaveBeenCalledTimes(2);
    expect(lexware.vouchers).toHaveLength(6);
    expect(store.documents.map((doc) => doc.status)).toEqual(["created", "created", "created", "created", "created", "created", "resolved", "skipped"]);
    expect(store.alerts).toHaveLength(0);
  });

  it("creates invoices for the orders selected in the order list", async () => {
    const query = { $and: [{ id: { $in: [orders.singleRate.id, orders.withCoupon.id] } }] };
    const totals = await workflow({ $action: { id: "invoice-selected", source: "bulk", selection: { query, count: 2 } } });

    expect(totals).toMatchObject({ created: 2, failed: 0 });
    expect(store.documents.map((doc) => [doc.order_number, doc.status, doc.source]).sort()).toEqual([
      ["100303", "created", "dashboard"],
      ["100304", "created", "dashboard"],
    ]);
    expect(store.swell.get).toHaveBeenCalledWith("/orders", expect.objectContaining({ sort: "id asc", limit: 5 }));
  });

  it("stops at once when Lexware refuses the key, instead of failing every document the same way", async () => {
    store = createStore({
      settings: SETTINGS,
      orders: [orders.singleRate, orders.withCoupon],
      documents: [fail("a00000000000000000000001", orders.singleRate), fail("a00000000000000000000002", orders.withCoupon)],
    });
    lexware.state.intercept = () => lexware.json(401, {});
    const totals = await workflow({ $action: { id: "retry-failed", source: "settings" } });
    expect(totals).toEqual({ created: 0, failed: 1, skipped: 0, halted: true });
    expect(store.documents.map((doc) => doc.problem_code)).toEqual(["connection", "rejected"]);
    expect(store.alerts[0].key).toBe("connection");
  });

  it("fails the step when Lexware is unreachable, so the workflow waits and repeats it", async () => {
    store = createStore({ settings: SETTINGS, orders: [orders.singleRate], documents: [fail("a00000000000000000000001", orders.singleRate)] });
    lexware.state.intercept = () => lexware.json(503, {});
    await expect(workflow({ $action: { id: "retry-failed", source: "settings" } })).rejects.toThrow("Lexware is not available (503).");
    expect(store.documents[0].status).toBe("pending");
  });

  it("trusts a selection only when the run was started by a dashboard action", async () => {
    store = createStore({ settings: SETTINGS, orders: [orders.singleRate], documents: [fail("a00000000000000000000001", orders.singleRate)] });
    const forged = { $action: { id: "invoice-selected", source: "bulk", selection: { query: {} } } };
    const totals = await workflow(forged, "function");
    expect(totals).toMatchObject({ created: 1 });
    expect(store.swell.get).not.toHaveBeenCalledWith("/orders", expect.anything());
  });
});
