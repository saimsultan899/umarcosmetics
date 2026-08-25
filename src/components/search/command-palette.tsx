"use client";

import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";
import { FileText, Package, Search, Users } from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type Hit = {
  id: string;
  kind: "party" | "product" | "sale";
  title: string;
  subtitle: string;
  href: string;
};

export function CommandPalette({ companyId }: { companyId?: string | null }) {
  const router = useRouter();
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [active, setActive] = useState(0);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  useEffect(() => {
    if (!open || !companyId || q.trim().length < 1) {
      setHits([]);
      return;
    }
    const handle = window.setTimeout(async () => {
      setLoading(true);
      const supabase = createClient();
      const safe = q.trim().replace(/[%_,]/g, " ");
      const term = `%${safe}%`;
      const [{ data: parties }, { data: products }, { data: sales }] =
        await Promise.all([
          supabase
            .from("parties")
            .select("id, party_code, name_en, city")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .or(`name_en.ilike.${term},party_code.ilike.${term}`)
            .limit(6),
          supabase
            .from("products")
            .select("id, code, name_en, manufacturer")
            .eq("company_id", companyId)
            .eq("is_active", true)
            .or(`name_en.ilike.${term},code.ilike.${term}`)
            .limit(6),
          supabase
            .from("sale_invoices")
            .select("id, invoice_no, invoice_date, grand_total")
            .eq("company_id", companyId)
            .ilike("invoice_no", term)
            .limit(4),
        ]);

      const next: Hit[] = [
        ...(parties || []).map((p) => ({
          id: p.id,
          kind: "party" as const,
          title: `${p.party_code} — ${p.name_en}`,
          subtitle: p.city || "Party",
          href: `/parties?q=${encodeURIComponent(p.name_en)}`,
        })),
        ...(products || []).map((p) => ({
          id: p.id,
          kind: "product" as const,
          title: `${p.code} — ${p.name_en}`,
          subtitle: p.manufacturer || "Product",
          href: `/products`,
        })),
        ...(sales || []).map((s) => ({
          id: s.id,
          kind: "sale" as const,
          title: s.invoice_no,
          subtitle: `${s.invoice_date} · ${s.grand_total}`,
          href: `/sales/invoices/${s.id}`,
        })),
      ];
      setHits(next);
      setActive(0);
      setLoading(false);
    }, 180);
    return () => window.clearTimeout(handle);
  }, [q, open, companyId]);

  const icon = useMemo(
    () => ({
      party: Users,
      product: Package,
      sale: FileText,
    }),
    [],
  );

  function close() {
    setOpen(false);
    setQ("");
  }

  const overlay =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[200] flex items-start justify-center px-4 pt-[12vh]">
            <button
              type="button"
              aria-label="Close search"
              className="absolute inset-0 bg-[#0b1915]/55 backdrop-blur-sm"
              onClick={close}
            />
            <div
              role="dialog"
              aria-modal="true"
              aria-label="Global search"
              className="relative z-[201] w-full max-w-xl overflow-hidden rounded-2xl border border-[var(--border)] bg-white shadow-2xl"
            >
              <div className="flex items-center gap-2 border-b border-[var(--border)] px-4">
                <Search className="h-4 w-4 text-[var(--muted)]" />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "ArrowDown") {
                      e.preventDefault();
                      setActive((a) =>
                        Math.min(a + 1, Math.max(hits.length - 1, 0)),
                      );
                    }
                    if (e.key === "ArrowUp") {
                      e.preventDefault();
                      setActive((a) => Math.max(a - 1, 0));
                    }
                    if (e.key === "Enter" && hits[active]) {
                      router.push(hits[active].href);
                      close();
                    }
                  }}
                  placeholder="Search parties, products, invoices..."
                  className="h-12 w-full bg-transparent text-sm outline-none"
                />
                <button
                  type="button"
                  className="text-xs text-[var(--muted)]"
                  onClick={close}
                >
                  Esc
                </button>
              </div>
              <div className="max-h-80 overflow-y-auto p-2">
                {loading ? (
                  <p className="px-3 py-4 text-sm text-[var(--muted)]">
                    Searching...
                  </p>
                ) : hits.length ? (
                  hits.map((hit, idx) => {
                    const Icon = icon[hit.kind];
                    return (
                      <button
                        key={`${hit.kind}-${hit.id}`}
                        type="button"
                        onClick={() => {
                          router.push(hit.href);
                          close();
                        }}
                        className={cn(
                          "flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left",
                          idx === active
                            ? "bg-[var(--brand-soft)]"
                            : "hover:bg-[var(--surface-2)]",
                        )}
                      >
                        <Icon className="h-4 w-4 text-[var(--brand)]" />
                        <div className="min-w-0">
                          <p className="truncate text-sm font-medium">
                            {hit.title}
                          </p>
                          <p className="truncate text-xs text-[var(--muted)]">
                            {hit.subtitle}
                          </p>
                        </div>
                      </button>
                    );
                  })
                ) : (
                  <p className="px-3 py-4 text-sm text-[var(--muted)]">
                    {q
                      ? "No matches"
                      : "Type to search your company data"}
                  </p>
                )}
              </div>
            </div>
          </div>,
          document.body,
        )
      : null;

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="hidden items-center gap-2 rounded-xl border border-[var(--border)] bg-white px-3 py-1.5 text-xs text-[var(--muted)] md:flex"
      >
        <Search className="h-3.5 w-3.5" />
        Search
        <kbd className="rounded bg-[var(--surface-2)] px-1.5 py-0.5 font-mono text-[10px]">
          Ctrl K
        </kbd>
      </button>
      {overlay}
    </>
  );
}
