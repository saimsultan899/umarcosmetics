/**
 * Walk every Supabase/PostgREST page. A bare `.select()` or `.limit(N)` is still
 * capped by the API max-rows setting (usually 1000) — use this whenever the UI
 * needs the complete company list (shops, products, etc.).
 */
export async function fetchAllPages<T>(
  make: (
    from: number,
    to: number,
  ) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
  opts?: { pageSize?: number; maxRows?: number },
): Promise<T[]> {
  const pageSize = opts?.pageSize ?? 1000;
  const maxRows = opts?.maxRows ?? 50000;
  const rows: T[] = [];
  for (let from = 0; from < maxRows; from += pageSize) {
    const { data, error } = await make(from, from + pageSize - 1);
    if (error) throw new Error(error.message);
    const batch = data || [];
    rows.push(...batch);
    if (batch.length < pageSize) break;
  }
  return rows;
}
