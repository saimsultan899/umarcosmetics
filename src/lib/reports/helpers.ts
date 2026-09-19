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

/**
 * Invoice no formatting for reports & print.
 * Sanitizes any raw legacy local prefixes to standard SI- / PI- prefixes,
 * and formats invoice numbers (avoiding thousands-grouping on timestamps).
 */
export function formatReportInvNo(value: string | null | undefined) {
  if (!value) return "";
  let trimmed = value.trim();

  // Strip/rewrite any legacy LOCAL- tags
  if (/^LOCAL[-_]SALE[-_]INVOICE[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]SALE[-_]INVOICE[-_]/i, "SI-");
  } else if (/^LOCAL[-_]PURCHASE[-_]INVOICE[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]PURCHASE[-_]INVOICE[-_]/i, "PI-");
  } else if (/^LOCAL[-_]SALE[-_]RETURN[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]SALE[-_]RETURN[-_]/i, "SR-");
  } else if (/^LOCAL[-_]PURCHASE[-_]RETURN[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]PURCHASE[-_]RETURN[-_]/i, "PR-");
  } else if (/^LOCAL[-_]STOCK[-_]TRANSFER[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]STOCK[-_]TRANSFER[-_]/i, "ST-");
  } else if (/^LOCAL[-_]GATE[-_]PASS[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]GATE[-_]PASS[-_]/i, "GP-");
  } else if (/^LOCAL[-_]LOAD[-_]SHEET[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]LOAD[-_]SHEET[-_]/i, "LD-");
  } else if (/^LOCAL[-_](?:CASH[-_]RECEIPT|RECOVERY)[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_](?:CASH[-_]RECEIPT|RECOVERY)[-_]/i, "CR-");
  } else if (/^LOCAL[-_]CASH[-_]PAYMENT[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]CASH[-_]PAYMENT[-_]/i, "CP-");
  } else if (/^LOCAL[-_]JOURNAL[-_]VOUCHER[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]JOURNAL[-_]VOUCHER[-_]/i, "JV-");
  } else if (/^LOCAL[-_]EXPENSE[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]EXPENSE[-_]/i, "EXP-");
  } else if (/^LOCAL[-_]EXPIRY[-_]RECEIPT[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]EXPIRY[-_]RECEIPT[-_]/i, "EXR-");
  } else if (/^LOCAL[-_]EXPIRY[-_]CLAIM[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]EXPIRY[-_]CLAIM[-_]/i, "CLM-");
  } else if (/^LOCAL[-_]EXPIRY[-_]SETTLE(?:MENT)?[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]EXPIRY[-_]SETTLE(?:MENT)?[-_]/i, "SET-");
  } else if (/^LOCAL[-_]/i.test(trimmed)) {
    trimmed = trimmed.replace(/^LOCAL[-_]/i, "");
  }

  const match = trimmed.match(/^(\D*)(\d+)$/);
  if (!match) return trimmed;
  const [, prefix, digits] = match;
  // If digits are > 6 chars (e.g. timestamp 1789545915342), do not format with commas
  if (digits.length > 6) {
    return prefix ? `${prefix}${digits.slice(-4)}` : digits;
  }
  const formatted = Number(digits).toLocaleString("en-US");
  return prefix ? `${prefix}${formatted}` : formatted;
}
