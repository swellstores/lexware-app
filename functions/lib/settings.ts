/** The app's settings as the merchant saved them. Groups are the file names in settings/ */
export interface Settings {
  /** The app's record id in this store */
  id?: string;
  connection?: {
    api_key?: string;
    enabled?: boolean;
    /** The Lexware company the key belongs to, saved by Test connection */
    company?: string | null;
  };
  documents?: {
    /** "final" creates finalized documents. Anything else, a missing value included, creates drafts */
    mode?: "draft" | "final" | null;
    language?: "de" | "en" | "auto" | null;
    credit_notes?: boolean | null;
    send_email?: boolean | null;
    /** Manual payment methods whose unpaid orders are invoiced when placed */
    unpaid_methods?: string[] | null;
  };
}

/** The part of the store client that functions and workflows share */
export interface StoreClient {
  settings(): Promise<unknown>;
  get(path: string, data?: any): Promise<unknown>;
  post(path: string, data?: any): Promise<unknown>;
  put(path: string, data?: any): Promise<unknown>;
  delete(path: string, data?: any): Promise<unknown>;
}

export function finalizes(settings: Settings): boolean {
  return settings.documents?.mode === "final";
}

export function creditNotesEnabled(settings: Settings): boolean {
  return settings.documents?.credit_notes !== false;
}

/** True for an unpaid order paid with a method the merchant has invoiced when placed */
export function invoicesUnpaid(settings: Settings, order: Record<string, any>): boolean {
  const methods = settings.documents?.unpaid_methods;
  const method = order?.billing?.method;
  return !order?.paid && Boolean(method) && Array.isArray(methods) && methods.includes(method);
}
