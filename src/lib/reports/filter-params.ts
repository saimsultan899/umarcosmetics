/** Parse comma-separated report filter values from URL search params. */
export function parseReportList(
  raw?: string | string[] | null,
): string[] {
  if (!raw) return [];
  const text = Array.isArray(raw) ? raw.join(",") : raw;
  return [
    ...new Set(
      text
        .split(",")
        .map((v) => v.trim())
        .filter(Boolean),
    ),
  ];
}

export function joinReportList(values: string[]): string {
  return values.join(",");
}

/** Keep filter params when switching report tabs. */
export function reportLinkQuery(
  filters: Record<string, string | undefined>,
  overrides?: Record<string, string | undefined>,
) {
  const params = new URLSearchParams();
  for (const obj of [filters, overrides]) {
    if (!obj) continue;
    for (const [key, value] of Object.entries(obj)) {
      if (value) params.set(key, value);
    }
  }
  return params;
}
