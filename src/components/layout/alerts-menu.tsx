"use client";

import { createClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Note = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  alert_type: string;
  is_read: boolean;
  created_at: string;
};

export function AlertsMenu({ companyId }: { companyId?: string | null }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  async function load() {
    if (!companyId) return;
    const supabase = createClient();
    const { data } = await supabase
      .from("notifications")
      .select("*")
      .eq("company_id", companyId)
      .order("created_at", { ascending: false })
      .limit(12);
    setNotes((data as Note[]) || []);
  }

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    void load();
    const t = window.setInterval(() => void load(), 60000);
    return () => window.clearInterval(t);
  }, [companyId]);

  useEffect(() => {
    if (!open) return;

    function place() {
      const rect = buttonRef.current?.getBoundingClientRect();
      if (!rect) return;
      setPos({
        top: rect.bottom + 8,
        right: Math.max(8, window.innerWidth - rect.right),
      });
    }

    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }

    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const unread = notes.filter((n) => !n.is_read).length;

  async function refreshAlerts() {
    if (!companyId) return;
    const supabase = createClient();
    await supabase.rpc("refresh_company_alerts", { p_company_id: companyId });
    await load();
  }

  async function markRead(id: string) {
    const supabase = createClient();
    await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
  }

  const panel =
    open && mounted
      ? createPortal(
          <div className="fixed inset-0 z-[200]">
            <button
              type="button"
              aria-label="Close alerts"
              className="absolute inset-0 bg-transparent"
              onClick={() => setOpen(false)}
            />
            <div
              className="absolute w-80 rounded-2xl border border-[var(--border)] bg-white p-2 shadow-2xl"
              style={{ top: pos.top, right: pos.right }}
            >
              <div className="flex items-center justify-between px-2 py-2">
                <p className="text-sm font-semibold">Smart alerts</p>
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--brand)]"
                  onClick={() => void refreshAlerts()}
                >
                  Refresh
                </button>
              </div>
              <div className="max-h-80 space-y-1 overflow-y-auto">
                {notes.length ? (
                  notes.map((n) => (
                    <Link
                      key={n.id}
                      href={n.href || "/dashboard"}
                      onClick={() => {
                        void markRead(n.id);
                        setOpen(false);
                      }}
                      className={`block rounded-xl px-3 py-2 ${
                        n.is_read ? "opacity-70" : "bg-[var(--surface-2)]"
                      }`}
                    >
                      <p className="text-sm font-medium">{n.title}</p>
                      <p className="text-xs text-[var(--muted)]">{n.body}</p>
                    </Link>
                  ))
                ) : (
                  <p className="px-3 py-6 text-center text-sm text-[var(--muted)]">
                    No alerts. You&apos;re clear.
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
        ref={buttonRef}
        type="button"
        onClick={() => {
          setOpen((v) => !v);
          if (!open) void refreshAlerts();
        }}
        className="relative rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)]"
        aria-label="Alerts"
        aria-expanded={open}
      >
        <Bell className="h-4 w-4" />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-bold text-white">
            {unread}
          </span>
        ) : null}
      </button>
      {panel}
    </>
  );
}
