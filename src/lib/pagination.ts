export const PAGE_SIZE_OPTIONS = [12, 24, 48, 96] as const;
export const DEFAULT_PAGE_SIZE = 24;

export type PageSize = (typeof PAGE_SIZE_OPTIONS)[number];

export type PaginationParams = {
  page: number;
  pageSize: PageSize;
};

export type PaginationMeta = PaginationParams & {
  total: number;
  totalPages: number;
  from: number;
  to: number;
};

export function parsePageSize(raw: string | undefined): PageSize {
  const n = Number(raw);
  return (PAGE_SIZE_OPTIONS as readonly number[]).includes(n)
    ? (n as PageSize)
    : DEFAULT_PAGE_SIZE;
}

export function parsePaginationParams(
  sp: Record<string, string | string[] | undefined>,
): PaginationParams {
  const page = Math.max(1, Number(Array.isArray(sp.page) ? sp.page[0] : sp.page) || 1);
  const pageSize = parsePageSize(
    Array.isArray(sp.pageSize) ? sp.pageSize[0] : sp.pageSize,
  );
  return { page, pageSize };
}

export function toRange({ page, pageSize }: PaginationParams) {
  const from = (page - 1) * pageSize;
  const to = from + pageSize - 1;
  return { from, to };
}

export function buildPaginationMeta(
  total: number,
  params: PaginationParams,
): PaginationMeta {
  const totalPages = Math.max(1, Math.ceil(total / params.pageSize) || 1);
  const page = Math.min(params.page, totalPages);
  const from = total === 0 ? 0 : (page - 1) * params.pageSize + 1;
  const to = Math.min(page * params.pageSize, total);
  return { page, pageSize: params.pageSize, total, totalPages, from, to };
}

export function spString(
  sp: Record<string, string | string[] | undefined>,
  key: string,
): string | undefined {
  const v = sp[key];
  return Array.isArray(v) ? v[0] : v;
}

/** Safe term for PostgREST ilike filters. */
export function escapeIlike(term: string) {
  return term.replace(/[%_,]/g, " ").trim();
}
