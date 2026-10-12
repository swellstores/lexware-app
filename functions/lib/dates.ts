/**
 * Lexware takes dates as local time with an offset (yyyy-MM-ddTHH:mm:ss.SSSXXX) and rejects
 * anything else. Documents are dated in German time: an order placed at 23:30 UTC belongs
 * to the next day on a German invoice.
 */

const BERLIN = new Intl.DateTimeFormat("en-GB", {
  timeZone: "Europe/Berlin",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

interface Parts {
  year: string;
  month: string;
  day: string;
  hour: string;
  minute: string;
  second: string;
}

function berlinParts(date: Date): Parts {
  const parts: Record<string, string> = {};
  for (const part of BERLIN.formatToParts(date)) {
    parts[part.type] = part.value;
  }
  return parts as unknown as Parts;
}

function asDate(value: Date | string | undefined | null): Date {
  const date = value instanceof Date ? value : new Date(value || Date.now());
  return Number.isNaN(date.getTime()) ? new Date() : date;
}

/** The moment as German local time with its offset, in the only format Lexware accepts */
export function lexwareDate(value: Date | string | undefined | null): string {
  const date = asDate(value);
  const p = berlinParts(date);
  const local = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  const offsetMinutes = Math.round((local - Math.floor(date.getTime() / 1000) * 1000) / 60000);
  const sign = offsetMinutes < 0 ? "-" : "+";
  const abs = Math.abs(offsetMinutes);
  const offset = `${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`;
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}.000${offset}`;
}

/** The German calendar day of the moment, as yyyy-MM-dd */
export function berlinDay(value: Date | string | undefined | null): string {
  const p = berlinParts(asDate(value));
  return `${p.year}-${p.month}-${p.day}`;
}

/** The day as printed on a document: 10.10.2026 in German, 10 Oct 2026 in English */
export function displayDate(value: Date | string | undefined | null, language: "de" | "en"): string {
  const p = berlinParts(asDate(value));
  if (language === "de") {
    return `${p.day}.${p.month}.${p.year}`;
  }
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  return `${+p.day} ${months[+p.month - 1]} ${p.year}`;
}
