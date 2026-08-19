export function one<T>(value: T | T[] | null | undefined): T | null {
  if (value == null) return null;
  return Array.isArray(value) ? value[0] ?? null : value;
}

const SHORT_MONTHS = [
  "Jan",
  "Feb",
  "Mar",
  "Apr",
  "May",
  "Jun",
  "Jul",
  "Aug",
  "Sep",
  "Oct",
  "Nov",
  "Dec",
];

/** Classic ERP print date: 15-Jun-2026 */
export function formatReportDate(value: string | Date | null | undefined) {
  if (!value) return "";
  const d =
    value instanceof Date
      ? value
      : new Date(
          typeof value === "string" && value.length === 10
            ? `${value}T00:00:00`
            : value,
        );
  if (Number.isNaN(d.getTime())) return String(value);
  return `${String(d.getDate()).padStart(2, "0")}-${SHORT_MONTHS[d.getMonth()]}-${d.getFullYear()}`;
}

export function formatReportRange(from: string, to: string) {
  return `${formatReportDate(from)} To ${formatReportDate(to)}`;
}

export function formatReportNumber(value: number, digits = 2) {
  return Number(value || 0).toLocaleString("en-US", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
}

/** Invoice no with thousands comma (e.g. 9686 → 9,686) */
export function formatReportInvNo(value: string | null | undefined) {
  if (!value) return "";
  const trimmed = value.trim();
  const match = trimmed.match(/^(\D*)(\d+)$/);
  if (!match) return trimmed;
  const [, prefix, digits] = match;
  const formatted = Number(digits).toLocaleString("en-US");
  return prefix ? `${prefix}${formatted}` : formatted;
}
