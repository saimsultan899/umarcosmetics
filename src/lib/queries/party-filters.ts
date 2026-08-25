import { spString } from "@/lib/pagination";

export type PartyLocationFilters = {
  city?: string;
  sector?: string;
  head?: string;
};

export function parsePartyLocationFilters(
  searchParams: Record<string, string | string[] | undefined>,
): PartyLocationFilters {
  return {
    city: spString(searchParams, "city") || undefined,
    sector: spString(searchParams, "sector") || undefined,
    head: spString(searchParams, "head") || undefined,
  };
}

export function applyPartyLocationFilters(
  query: any,
  location: PartyLocationFilters,
) {
  if (location.city) query = query.eq("city", location.city);
  if (location.sector) query = query.eq("route", location.sector);
  if (location.head) query = query.eq("head", location.head);
  return query;
}
