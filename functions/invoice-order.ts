import { handleEvent } from "./lib/event";
import { invoiceOrder } from "./lib/process";

export const config: SwellConfig = {
  description: "Create the Lexware invoice when an order is paid",
  model: {
    events: ["order.paid"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  return handleEvent(req, (ctx) => invoiceOrder(ctx, req.data.id as string, "order.paid"));
}
