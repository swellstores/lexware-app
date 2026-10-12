import { afterEach, describe, expect, it, vi } from "vitest";
import { LexwareError, createVoucher, getProfile, getVoucherFile, listVouchersCreated, voucherLink } from "../../functions/lib/lexware";
import type { VoucherPayload } from "../../functions/lib/lexware";
import { createLexware } from "../helpers/lexware";

const payload = {
  voucherDate: "2026-10-10T09:00:00.000+02:00",
  address: { name: "Erika Musterfrau", countryCode: "DE" },
  lineItems: [{ type: "custom", name: "Kerze", quantity: 2, unitName: "Stück", unitPrice: { currency: "EUR", netAmount: 10, taxRatePercentage: 19 } }],
  totalPrice: { currency: "EUR" },
  taxConditions: { taxType: "net" },
} as VoucherPayload;

async function failure(run: () => Promise<unknown>): Promise<LexwareError> {
  try {
    await run();
  } catch (err) {
    return err as LexwareError;
  }
  throw new Error("Expected a failure");
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Lexware client", () => {
  it("sends the key as a bearer token and asks for finalization in the address", async () => {
    const lexware = createLexware();
    const fetchMock = fetch as unknown as ReturnType<typeof vi.fn>;
    const id = await createVoucher(" key-123 ", "invoices", payload, true);

    expect(id).toBe("inv-1");
    const [url, init] = fetchMock.mock.calls[0];
    expect(String(url)).toBe("https://api.lexware.io/v1/invoices?finalize=true");
    expect(init.headers.Authorization).toBe("Bearer key-123");
    expect(lexware.vouchers[0].voucherStatus).toBe("open");

    await createVoucher("key-123", "credit-notes", payload, false);
    expect(String(fetchMock.mock.calls[1][0])).toBe("https://api.lexware.io/v1/credit-notes");
  });

  it("fails without a request when the key is missing", async () => {
    createLexware();
    const err = await failure(() => getProfile("  "));
    expect(err).toMatchObject({ kind: "credentials", connection: true });
    expect(fetch).not.toHaveBeenCalled();
  });

  it.each([
    [401, "credentials"],
    [402, "contract"],
    [403, "permission"],
  ])("reports %i as a failure of the connection", async (status, kind) => {
    const lexware = createLexware();
    lexware.state.intercept = () => lexware.json(status, { message: "nope" });
    const err = await failure(() => getProfile("key"));
    expect(err).toMatchObject({ kind, status, connection: true, temporary: false });
  });

  it("reports a refusal with Lexware's own words, from either error shape", async () => {
    const lexware = createLexware();
    lexware.state.intercept = () =>
      lexware.json(406, { message: "Validation failed", details: [{ violation: "NOTNULL", field: "lineItems[0].name", message: "darf nicht leer sein" }] });
    const invalid = await failure(() => createVoucher("key", "invoices", payload, false));
    expect(invalid).toMatchObject({ kind: "rejected", status: 406, uncertain: false });
    expect(invalid.message).toBe("Validation failed · lineItems[0].name: NOTNULL: darf nicht leer sein");

    lexware.state.intercept = () => lexware.json(400, { IssueList: [{ i18nKey: "missing_entity", source: "company.name", type: "validation_failure" }] });
    const contact = await failure(() => createVoucher("key", "invoices", payload, false));
    expect(contact.message).toBe("company.name: missing_entity: validation_failure");
  });

  it("repeats a call that hit the rate limit, which Lexware did not perform", async () => {
    const lexware = createLexware();
    let refusals = 2;
    lexware.state.intercept = () => (refusals-- > 0 ? lexware.json(429, { message: "Rate limit exceeded" }) : undefined);
    expect(await createVoucher("key", "invoices", payload, false)).toBe("inv-1");
    expect(lexware.vouchers).toHaveLength(1);

    refusals = 3;
    const err = await failure(() => createVoucher("key", "invoices", payload, false));
    expect(err).toMatchObject({ kind: "rate_limit", temporary: true, uncertain: false });
  });

  it("marks a write without an answer as uncertain, and a read as merely failed", async () => {
    const lexware = createLexware();
    lexware.state.intercept = () => lexware.json(504, {});
    expect(await failure(() => createVoucher("key", "invoices", payload, true))).toMatchObject({ kind: "unavailable", uncertain: true });
    expect(await failure(() => getProfile("key"))).toMatchObject({ kind: "unavailable", uncertain: false });

    lexware.state.intercept = () => "lose-answer";
    expect(await failure(() => createVoucher("key", "invoices", payload, true))).toMatchObject({ kind: "unavailable", uncertain: true, temporary: true });
  });

  it("downloads the PDF of a finalized document and reports a draft's missing file as a refusal", async () => {
    createLexware();
    const finalId = await createVoucher("key", "invoices", payload, true);
    const file = await getVoucherFile("key", "invoices", finalId);
    expect(new TextDecoder().decode(file)).toBe("%PDF RE0001");

    const draftId = await createVoucher("key", "invoices", payload, false);
    expect(await failure(() => getVoucherFile("key", "invoices", draftId))).toMatchObject({ kind: "rejected", status: 409 });
  });

  it("lists the documents of a kind created between two days, a page at a time", async () => {
    const lexware = createLexware();
    lexware.state.now = () => new Date("2026-10-10T07:00:00.000Z");
    await createVoucher("key", "invoices", payload, true);
    await createVoucher("key", "credit-notes", payload, true);
    const listed = await listVouchersCreated("key", "credit-notes", "2026-10-10", "2026-10-11", 0);
    expect(listed).toEqual({
      entries: [{ id: "cn-1", voucherNumber: "GS0001", voucherStatus: "open", totalAmount: 23.8, createdDate: "2026-10-10T07:00:00.000Z" }],
      last: true,
    });
    const query = lexware.calls[lexware.calls.length - 1].query;
    expect(query.get("voucherType")).toBe("creditnote");
    expect(query.get("createdDateFrom")).toBe("2026-10-10");
    expect(query.get("createdDateTo")).toBe("2026-10-11");
    expect(query.get("voucherStatus")).toBe("any");
    expect(query.get("page")).toBe("0");

    expect((await listVouchersCreated("key", "credit-notes", "2026-10-11", "2026-10-11")).entries).toEqual([]);
  });

  it("links to the document in the Lexware app", () => {
    expect(voucherLink("credit-notes", "abc")).toBe("https://app.lexware.de/permalink/credit-notes/view/abc");
  });
});
