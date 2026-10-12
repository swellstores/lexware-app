import { actionContext, answer, isRecordId } from "./lib/actions";
import { invoiceOrder } from "./lib/process";

export const config: SwellConfig = {
  description: "Create the Lexware invoice for an order from the order's page",
  action: true,
};

export default async function (req: SwellRequest) {
  const orderId = req.data.$action?.record_id;
  if (!isRecordId(orderId)) {
    throw new SwellError("Unknown order", { status: 400 });
  }
  const ctx = await actionContext(req);
  return answer(await invoiceOrder(ctx, orderId, "dashboard"));
}
