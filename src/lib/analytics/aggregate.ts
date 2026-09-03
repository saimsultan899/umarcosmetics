import { localDateIso } from "@/lib/dates";

export type DayPoint = { name: string; value: number; secondary?: number };

export function lastNDates(n: number, end = new Date()): string[] {
  const dates: string[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(end);
    d.setDate(d.getDate() - i);
    dates.push(localDateIso(d));
  }
  return dates;
}

export function shortDay(iso: string) {
  return iso.slice(5); // MM-DD
}

export function sumByDay(
  rows: Array<{ date: string; amount: number }>,
  days = 7,
): DayPoint[] {
  const dates = lastNDates(days);
  const map = new Map(dates.map((d) => [d, 0]));
  for (const row of rows) {
    if (map.has(row.date)) {
      map.set(row.date, (map.get(row.date) || 0) + Number(row.amount || 0));
    }
  }
  return dates.map((d) => ({ name: shortDay(d), value: map.get(d) || 0 }));
}

export function compareByDay(
  primary: Array<{ date: string; amount: number }>,
  secondary: Array<{ date: string; amount: number }>,
  days = 7,
): DayPoint[] {
  const dates = lastNDates(days);
  const a = new Map(dates.map((d) => [d, 0]));
  const b = new Map(dates.map((d) => [d, 0]));
  for (const row of primary) {
    if (a.has(row.date)) a.set(row.date, (a.get(row.date) || 0) + Number(row.amount || 0));
  }
  for (const row of secondary) {
    if (b.has(row.date)) b.set(row.date, (b.get(row.date) || 0) + Number(row.amount || 0));
  }
  return dates.map((d) => ({
    name: shortDay(d),
    value: a.get(d) || 0,
    secondary: b.get(d) || 0,
  }));
}

export function groupSum(
  rows: Array<{ key: string; amount: number }>,
  limit = 6,
): Array<{ name: string; value: number }> {
  const map = new Map<string, number>();
  for (const row of rows) {
    const key = row.key || "Other";
    map.set(key, (map.get(key) || 0) + Number(row.amount || 0));
  }
  return [...map.entries()]
    .map(([name, value]) => ({ name, value }))
    .sort((x, y) => y.value - x.value)
    .slice(0, limit);
}

export function pct(part: number, whole: number) {
  if (!whole) return 0;
  return Math.round((part / whole) * 100);
}
