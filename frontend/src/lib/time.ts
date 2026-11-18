// Display timezone helpers — the deployment is in the Philippines, so all
// timestamps are shown in Philippine Time regardless of the viewer's browser
// timezone. The backend stores and returns UTC.

export const APP_TIME_ZONE = "Asia/Manila";
export const APP_TZ_LABEL = "PHT";
/** Philippine Time has no daylight saving, so the offset is fixed. */
const APP_UTC_OFFSET = "+08:00";

const partsFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: APP_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  second: "2-digit",
  hourCycle: "h23",
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function pht(time: number | string | Date) {
  const date = time instanceof Date ? time : new Date(time);
  const parts: Record<string, string> = {};
  for (const { type, value } of partsFormatter.formatToParts(date)) parts[type] = value;
  return parts as Record<"year" | "month" | "day" | "hour" | "minute" | "second", string>;
}

/** `yyyy-MM-dd HH:mm:ss` in Philippine Time. */
export function formatPhtDateTime(time: number | string | Date) {
  const p = pht(time);
  return `${p.year}-${p.month}-${p.day} ${p.hour}:${p.minute}:${p.second}`;
}

/** `HH:mm:ss` in Philippine Time. */
export function formatPhtTime(time: number | string | Date) {
  const p = pht(time);
  return `${p.hour}:${p.minute}:${p.second}`;
}

/** Compact chart-axis label in Philippine Time: `HH:mm` or `MMM d HH:mm` for multi-day spans. */
export function formatPhtAxis(time: number, spanMs: number) {
  const p = pht(time);
  const clock = `${p.hour}:${p.minute}`;
  return spanMs > 86_400_000 ? `${MONTHS[Number(p.month) - 1]} ${Number(p.day)} ${clock}` : clock;
}

/**
 * Convert an `<input type="datetime-local">` value (entered as Philippine Time)
 * to a UTC ISO string for the backend.
 */
export function phtInputToIso(value: string) {
  return new Date(`${value}${APP_UTC_OFFSET}`).toISOString();
}
