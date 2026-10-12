/** What the dashboard actions share: reading the context and answering the merchant */

import type { Context, Outcome } from "./process";
import type { Settings } from "./settings";

export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{24}$/i.test(value);
}

/** The context for an action. Actions work whether or not automatic creation is switched on */
export async function actionContext(req: SwellRequest): Promise<Context> {
  const settings = ((await req.swell.settings()) || {}) as Settings;
  if (!settings.connection?.api_key?.trim()) {
    throw new SwellError("Enter your Lexware API key in the app's settings and save, then try again.", { status: 400 });
  }
  return { swell: req.swell, settings };
}

/** The dashboard shows a returned message as a success and a thrown one as an error */
export function answer(outcome: Outcome): { message: string } {
  switch (outcome.result) {
    case "created":
    case "exists":
    case "busy":
      return { message: outcome.message };
    case "retry":
      throw new SwellError(`${outcome.message} Try again in a minute.`, { status: 503 });
    case "skipped":
      throw new SwellError(`Not sent to Lexware. ${outcome.message}`, { status: 400 });
    default:
      throw new SwellError(outcome.message, { status: 400 });
  }
}
