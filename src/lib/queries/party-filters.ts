import { escapeIlike, spString } from "@/lib/pagination";

export type PartyLocationFilters = {
  city?: string;
  sector?: string;
  head?: string;
};

type PlaceRow = {
  city?: string | null;
  head?: string | null;
  route?: string | null;
};

function sameText(a?: string | null, b?: string | null) {
  return (a || "").trim().toLowerCase() === (b || "").trim().toLowerCase();
}

/** Value shown as City / Head on the customers table. */
export function partyPlace(row: PlaceRow) {
  return (row.city || row.head || "").trim();
}

export function parsePartyLocationFilters(
  searchParams: Record<string, string | string[] | undefined>,
): PartyLocationFilters {
  return {
    city: spString(searchParams, "city")?.trim() || undefined,
    sector: spString(searchParams, "sector")?.trim() || undefined,
    head: spString(searchParams, "head")?.trim() || undefined,
  };
}

function quotedIlike(value: string) {
  return `"${value.replace(/"/g, "")}"`;
}

/**
 * Search and city/sector filters in one PostgREST `or` group.
 * A second `.or()` would replace the first, and an unquoted space breaks the filter.
 */
export function applyPartyQueryFilters(
  query: any,
  q: string,
  location: PartyLocationFilters,
) {
  if (location.sector) query = query.ilike("route", escapeIlike(location.sector));
  if (location.head) query = query.ilike("head", escapeIlike(location.head));

  const groups: string[] = [];
  if (location.city) {
    const city = quotedIlike(escapeIlike(location.city));
    groups.push(`or(city.ilike.${city},head.ilike.${city})`);
  }
  const term = escapeIlike(q);
  if (term) {
    const pattern = quotedIlike(`%${term}%`);
    groups.push(
      `or(${["party_code", "name_en", "name_ur", "city", "route", "head", "mobile", "phone"]
        .map((column) => `${column}.ilike.${pattern}`)
        .join(",")})`,
    );
  }

  if (groups.length === 1 && groups[0].startsWith("or(")) {
    return query.or(groups[0].slice(3, -1));
  }
  if (groups.length > 1) {
    return query.or(`and(${groups.join(",")})`);
  }
  return query;
}

export function matchesPartyLocation(row: PlaceRow, location: PartyLocationFilters) {
  if (location.city && !sameText(row.city, location.city) && !sameText(row.head, location.city)) {
    return false;
  }
  if (location.sector && !sameText(row.route, location.sector)) return false;
  if (location.head && !sameText(row.head, location.head)) return false;
  return true;
}
