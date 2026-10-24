/**
 * Summary cards on the products and parties screens are cached briefly on the
 * server. The visible rows are always loaded fresh. Saving business data bumps
 * this cookie so the next page load recalculates those summaries immediately.
 */
export const LIST_STATS_COOKIE = "ud_list_rev";

const TTL_MS = 60_000;

type Box<T> = { at: number; value: T };

const store = new Map<string, Box<unknown>>();
const inflight = new Map<string, Promise<unknown>>();

export async function rememberStats<T>(
  key: string,
  load: () => Promise<T>,
): Promise<T> {
  const hit = store.get(key) as Box<T> | undefined;
  if (hit && Date.now() - hit.at < TTL_MS) return hit.value;

  const pending = inflight.get(key) as Promise<T> | undefined;
  if (pending) return pending;

  const job = load()
    .then((value) => {
      store.set(key, { at: Date.now(), value });
      inflight.delete(key);
      return value;
    })
    .catch((error: unknown) => {
      inflight.delete(key);
      throw error;
    });
  inflight.set(key, job);
  return job;
}

export function bumpListStatsRevision() {
  if (typeof document === "undefined") return;
  document.cookie = `${LIST_STATS_COOKIE}=${Date.now()}; Path=/; Max-Age=86400; SameSite=Lax`;
}
