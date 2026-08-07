import { requireCompanyContext } from "@/lib/auth";
import { formatPkr } from "@/lib/utils";
import Link from "next/link";

export default async function FieldShopsPage() {
  const { supabase, company } = await requireCompanyContext();
  const { data: shops } = await supabase.rpc("get_salesman_shops", {
    p_company_id: company.id,
    p_as_of: new Date().toISOString().slice(0, 10),
  });

  const list = (shops || []) as Array<{
    party_id: string;
    party_code: string;
    name_en: string;
    city: string | null;
    route: string | null;
    mobile: string | null;
    balance: number;
  }>;

  return (
    <div className="animate-rise space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
            My shops
          </h1>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Route / city assigned parties · {company.name}
          </p>
        </div>
        <p className="rounded-full bg-[var(--surface-2)] px-3 py-1 text-xs font-semibold text-[var(--muted)]">
          {list.length} shops
        </p>
      </div>

      {list.length ? (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {list.map((s) => (
            <div
              key={s.party_id}
              className="flex h-full flex-col rounded-2xl border border-[var(--border)] bg-white p-4 shadow-sm"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">
                    {s.party_code} — {s.name_en}
                  </p>
                  <p className="mt-1 text-xs text-[var(--muted)]">
                    {[s.city, s.route, s.mobile].filter(Boolean).join(" · ") ||
                      "—"}
                  </p>
                </div>
                <p
                  className={`shrink-0 text-sm font-semibold ${
                    Number(s.balance) > 0
                      ? "text-rose-700"
                      : Number(s.balance) < 0
                        ? "text-emerald-700"
                        : "text-[var(--muted)]"
                  }`}
                >
                  {Math.abs(Number(s.balance)) < 0.005
                    ? "Nil"
                    : `${formatPkr(Math.abs(Number(s.balance)))} ${
                        Number(s.balance) > 0 ? "Dr" : "Cr"
                      }`}
                </p>
              </div>
              <div className="mt-auto flex gap-2 pt-4">
                <Link
                  href={`/field/recovery?party=${s.party_id}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg bg-[var(--brand)] px-3 py-2 text-xs font-semibold text-white"
                >
                  Collect
                </Link>
                <Link
                  href={`/field/sale?party=${s.party_id}`}
                  className="inline-flex flex-1 items-center justify-center rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold"
                >
                  Sale
                </Link>
              </div>
            </div>
          ))}
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-[var(--border)] px-4 py-10 text-center text-sm text-[var(--muted)]">
          No shops assigned. Ask admin to set your routes/cities.
        </div>
      )}
    </div>
  );
}
