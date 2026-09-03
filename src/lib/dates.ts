/** Calendar date helpers using the local timezone (not UTC). */

/** Format a Date as YYYY-MM-DD in local time. */
export function localDateIso(d = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

/** First day of the month containing `d`, as YYYY-MM-DD (local). */
export function monthStartLocal(d = new Date()): string {
  return localDateIso(new Date(d.getFullYear(), d.getMonth(), 1));
}

/** Last day of the month containing `d`, as YYYY-MM-DD (local). */
export function monthEndLocal(d = new Date()): string {
  return localDateIso(new Date(d.getFullYear(), d.getMonth() + 1, 0));
}
