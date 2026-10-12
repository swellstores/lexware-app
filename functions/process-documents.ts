import type { DocumentRecord } from "./lib/documents";
import { invoiceOrder, run } from "./lib/process";
import type { Context, Outcome } from "./lib/process";
import type { Settings } from "./lib/settings";

export const config: SwellConfig = {
  kind: "workflow",
  description:
    "Create or retry Lexware documents in bulk: every document that needs attention, the selected documents, or invoices for the selected orders",
  action: true,
};

// A step is the unit that is repeated after a failure, so it stays small. Repeating one
// is safe: a document that exists in Lexware is found in the ledger and left alone
const BATCH = 5;

interface Batch {
  cursor?: string;
  done: boolean;
  /** Lexware refuses the key or the account. Going on would fail every document the same way */
  halted: boolean;
  created: number;
  failed: number;
  skipped: number;
}

type Target =
  /** Everything that is not finished */
  | { kind: "unfinished" }
  /** The rows selected in the documents list */
  | { kind: "documents"; query: Record<string, any> }
  /** The rows selected in the order list */
  | { kind: "orders"; query: Record<string, any> };

function readTarget(data: Record<string, any>, trigger: string | undefined): Target {
  const action = trigger === "action" ? data?.$action : undefined;
  if (action?.source === "bulk" && action.selection?.query) {
    return { kind: action.id === "invoice-selected" ? "orders" : "documents", query: action.selection.query };
  }
  return { kind: "unfinished" };
}

const UNFINISHED = {
  $or: [{ status: "failed" }, { status: "pending" }, { status: "created", problem_code: "temporary" }],
};

async function nextRecords(swell: SwellWorkflowAPI, target: Target, cursor: string | undefined) {
  const selection = target.kind === "unfinished" ? {} : target.query;
  const conditions = [
    ...(selection.$and || []),
    ...(target.kind === "unfinished" ? [UNFINISHED] : []),
    ...(cursor ? [{ id: { $gt: cursor } }] : []),
  ];
  const page = (await swell.get(target.kind === "orders" ? "/orders" : "/documents", {
    ...selection,
    // The store refuses an empty $and
    ...(conditions.length > 0 ? { $and: conditions } : {}),
    sort: "id asc",
    limit: BATCH,
  })) as { results?: Record<string, any>[] };
  return page?.results || [];
}

async function processBatch(swell: SwellWorkflowAPI, target: Target, cursor: string | undefined): Promise<Batch> {
  const settings = ((await swell.settings()) || {}) as Settings;
  const ctx: Context = { swell, settings };
  const batch: Batch = { cursor, done: false, halted: false, created: 0, failed: 0, skipped: 0 };

  const records = await nextRecords(swell, target, cursor);
  for (const record of records) {
    const outcome: Outcome =
      target.kind === "orders"
        ? await invoiceOrder(ctx, record.id, "dashboard")
        : await run(ctx, record as DocumentRecord);

    if (outcome.result === "retry") {
      // Lexware is unreachable or busy: fail the step, which waits and repeats the batch
      throw new Error(outcome.message);
    }
    if (outcome.result === "failed" && outcome.doc.problem_code === "connection") {
      batch.halted = true;
      batch.failed += 1;
      return batch;
    }
    batch.created += outcome.result === "created" ? 1 : 0;
    batch.failed += outcome.result === "failed" ? 1 : 0;
    batch.skipped += outcome.result === "skipped" ? 1 : 0;
    batch.cursor = record.id;
  }
  batch.done = records.length < BATCH;
  return batch;
}

export default class ProcessDocuments {
  async run(req: SwellWorkflowRequest, step: SwellWorkflowStep) {
    const target = readTarget((req.data || {}) as Record<string, any>, req.workflow?.trigger);
    const totals = { created: 0, failed: 0, skipped: 0, halted: false };
    let cursor: string | undefined;

    for (let index = 1; ; index++) {
      const batch = (await step.do(
        `documents ${index}`,
        { retries: { limit: 4, delay: "20 seconds", backoff: "exponential" }, timeout: "2 minutes" },
        () => processBatch(req.swell, target, cursor),
      )) as Batch;

      totals.created += batch.created;
      totals.failed += batch.failed;
      totals.skipped += batch.skipped;
      cursor = batch.cursor;
      if (batch.halted) {
        totals.halted = true;
        break;
      }
      if (batch.done) {
        break;
      }
    }
    return totals;
  }
}
