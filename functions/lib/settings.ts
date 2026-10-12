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
