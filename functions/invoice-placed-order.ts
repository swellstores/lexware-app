import { handleEvent } from "./lib/event";
import { invoiceOrder } from "./lib/process";
import { invoicesUnpaid } from "./lib/settings";

export const config: SwellConfig = {
  description: "Create the Lexware invoice when an order is placed unpaid with a payment method chosen in the settings",
  model: {
    events: ["order.submitted"],
    conditions: { $settings: { connection: { enabled: true } } },
  },
};

export default async function (req: SwellRequest) {
  return handleEvent(req, async (ctx) =>
    invoicesUnpaid(ctx.settings, req.data) ? invoiceOrder(ctx, req.data.id as string, "order.submitted") : undefined,
  );
}
