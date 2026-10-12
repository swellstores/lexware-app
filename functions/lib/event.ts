/**
 * Shared path of the two event functions: read the settings, do the work, and turn the
 * outcome into what Swell should do with the delivery.
 *
 * A failed delivery is retried by Swell at growing intervals, and a function that keeps
 * failing for about four days is switched off for good. So a delivery fails only while a
 * retry can help: when Lexware is unreachable or busy. Everything else ends the delivery,
 * because the document's record already holds what happened and can be retried from the
 * dashboard.
 */

import { giveUp } from "./process";
import type { Context, Outcome } from "./process";
import type { Settings } from "./settings";

export const GIVE_UP_MS = 24 * 60 * 60 * 1000;

export async function handleEvent(
  req: SwellRequest,
  work: (ctx: Context) => Promise<Outcome | undefined>,
): Promise<Record<string, unknown>> {
  // Swell only calls the function while the app is switched on, but the merchant
  // may have switched it off since the event was recorded
  const settings = ((await req.swell.settings()) || {}) as Settings;
  if (settings.connection?.enabled !== true) {
    return { skipped: "The app is switched off" };
  }

  const ctx: Context = { swell: req.swell, settings };
  const outcome = await work(ctx);
  if (!outcome) {
    return { skipped: "Nothing to do for this record" };
  }

  if (outcome.result === "retry" || outcome.result === "busy") {
    const firstFailed = req.data.$event?.delivery?.date_first_failed;
    if (firstFailed && Date.now() - new Date(firstFailed as string).getTime() > GIVE_UP_MS) {
      const message = `Lexware could not be reached for a day. ${outcome.message}`;
      await giveUp(ctx, outcome.doc, message);
      return { result: "failed", message };
    }
    throw new SwellError(outcome.message, { status: 503 });
  }

  return { result: outcome.result, number: outcome.doc.number, message: outcome.message };
}
