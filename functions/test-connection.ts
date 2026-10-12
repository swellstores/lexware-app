import { clearAlert } from "./lib/alerts";
import { LexwareError, getProfile } from "./lib/lexware";
import type { Profile } from "./lib/lexware";
import { finalizes } from "./lib/settings";
import type { Settings } from "./lib/settings";

export const config: SwellConfig = {
  description: "Check the saved API key with Lexware and show how the account is set up",
  action: true,
};

/** How the Lexware account will be invoiced, in the merchant's words */
export function describeAccount(profile: Profile): string {
  if (profile.smallBusiness) {
    return "small business, invoices without VAT";
  }
  if (profile.taxType === "vatfree") {
    return "tax-exempt, invoices without VAT";
  }
  const consumers =
    profile.distanceSalesPrinciple === "DESTINATION"
      ? "EU consumers are invoiced with their own country's VAT"
      : "EU consumers are invoiced with German VAT";
  return `regular VAT, ${consumers}`;
}

export default async function (req: SwellRequest) {
  const settings = ((await req.swell.settings()) || {}) as Settings;
  const apiKey = settings.connection?.api_key?.trim();
  if (!apiKey) {
    throw new SwellError("Enter the API key, save the settings, then test again.", { status: 400 });
  }

  let profile: Profile;
  try {
    profile = await getProfile(apiKey);
  } catch (err) {
    if (err instanceof LexwareError && err.kind === "credentials") {
      throw new SwellError(
        "Lexware did not accept the API key. Copy it again from Extensions → Public API in Lexware. A key is shown in full only when it is created.",
        { status: 400 },
      );
    }
    if (err instanceof LexwareError && err.connection) {
      throw new SwellError(err.message, { status: 400 });
    }
    throw new SwellError(`${(err as Error).message} Try again in a minute.`, { status: 502 });
  }

  const company = profile.companyName || "your Lexware account";
  if (settings.connection?.company !== profile.companyName) {
    try {
      await req.swell.put(`/settings/${req.appId}`, { connection: { company: profile.companyName || null } });
    } catch (err) {
      // Only the display of the account name depends on it
      console.error("Unable to save the Lexware company name", (err as Error).message);
    }
  }
  await clearAlert(req.swell, "connection");

  const waiting = (await req.swell.get("/documents", { where: { status: "failed" }, limit: 1 })) as { count?: number };
  const parts = [
    `Connected to ${company} (${describeAccount(profile)}).`,
    finalizes(settings) ? "Documents are created finalized." : "Documents are created as drafts.",
  ];
  if (settings.connection?.enabled !== true) {
    parts.push('Turn on "Create documents automatically" to start.');
  }
  if ((waiting?.count || 0) > 0) {
    parts.push(
      `${waiting.count} ${waiting.count === 1 ? "document needs" : "documents need"} attention: choose Retry failed documents in the Actions menu.`,
    );
  }
  return { message: parts.join(" ") };
}
