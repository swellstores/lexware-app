import { handleEvent } from "./lib/event";
import { creditRefund } from "./lib/process";

export const config: SwellConfig = {
  description: "Create the Lexware credit note when a payment is refunded",
  model: {
    events: ["payment.refund.succeeded"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  return handleEvent(req, (ctx) => creditRefund(ctx, req.data, "payment.refund.succeeded"));
}
