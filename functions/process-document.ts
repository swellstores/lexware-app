import { actionContext, answer, isRecordId } from "./lib/actions";
import type { DocumentRecord } from "./lib/documents";
import { run } from "./lib/process";

export const config: SwellConfig = {
  description: "Retry a document that needs attention, or read a draft's state from Lexware again",
  action: true,
};

export default async function (req: SwellRequest) {
  const id = req.data.$action?.record_id;
  if (!isRecordId(id)) {
    throw new SwellError("Unknown document", { status: 400 });
  }
  const doc = (await req.swell.get(`/documents/${id}`)) as DocumentRecord;
  if (!doc?.id) {
    throw new SwellError("The document record no longer exists", { status: 404 });
  }
  const ctx = await actionContext(req);
  return answer(await run(ctx, doc));
}
