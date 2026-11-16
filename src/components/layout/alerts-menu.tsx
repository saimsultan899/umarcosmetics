"use client";

import { createClient } from "@/lib/supabase/client";
import { Bell } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";

type Note = {
  id: string;
  title: string;
  body: string | null;
  href: string | null;
  alert_type: string;
  is_read: boolean;
  created_at: string;
  meta?: Record<string, unknown> | null;
};

const ALERT_SOUND_SRC = "/button-click-sound.wav";

function isSaleOrderNote(note: Pick<Note, "alert_type" | "meta" | "href">) {
  if (note.alert_type === "sale_order") return true;
  if (note.meta && note.meta.kind === "sale_order") return true;
  return Boolean(note.href?.startsWith("/sales/orders/"));
}

function playAlertSound() {
  try {
    const audio = new Audio(ALERT_SOUND_SRC);
    audio.volume = 0.9;
    void audio.play().catch(() => {
      // Browsers may block until a user gesture unlocks audio.
    });
  } catch {
    // Ignore missing audio support.
  }
}

export function AlertsMenu({ companyId }: { companyId?: string | null }) {
  const buttonRef = useRef<HTMLButtonElement>(null);
  const knownIdsRef = useRef<Set<string>>(new Set());
  const primedRef = useRef(false);
  const audioUnlockedRef = useRef(false);
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const [notes, setNotes] = useState<Note[]>([]);
  const [ringing, setRinging] = useState(false);
  const [pos, setPos] = useState({ top: 0, right: 0 });

  const unlockAudio = useCallback(() => {
    if (audioUnlockedRef.current) return;
    try {
      const audio = new Audio(ALERT_SOUND_SRC);
      audio.volume = 0.01;
      void audio.play().then(() => {
        audio.pause();
        audio.currentTime = 0;
        audioUnlockedRef.current = true;
      });
    } catch {
      // Ignore.
    }
  }, []);

  const announceNew = useCallback((incoming: Note[]) => {
    if (!incoming.length) return;
    const saleOrders = incoming.filter(isSaleOrderNote);
    if (!saleOrders.length) return;
    playAlertSound();
    setRinging(true);
    window.setTimeout(() => setRinging(false), 1400);
  }, []);

  const mergeNotes = useCallback(
    (rows: Note[], options?: { announce?: boolean }) => {
      const sorted = [...rows].sort((a, b) =>
        b.created_at.localeCompare(a.created_at),
      );
      const nextIds = new Set(sorted.map((row) => row.id));
      if (options?.announce && primedRef.current) {
        const fresh = sorted.filter((row) => !knownIdsRef.current.has(row.id));
        announceNew(fresh);
      }
      knownIdsRef.current = nextIds;
      primedRef.current = true;
      setNotes(sorted.slice(0, 20));
    },
    [announceNew],
  );

  const load = useCallback(async () => {
    if (!companyId) return;
    try {
      const supabase = createClient();
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, href, alert_type, is_read, created_at, meta")
        .eq("company_id", companyId)
        .order("created_at", { ascending: false })
        .limit(20);
      mergeNotes((data as Note[]) || [], { announce: true });
    } catch {
      // offline silent fallback
    }
  }, [companyId, mergeNotes]);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    function unlock() {
      unlockAudio();
    }
    window.addEventListener("pointerdown", unlock, { once: true });
    window.addEventListener("keydown", unlock, { once: true });
    return () => {
      window.removeEventListener("pointerdown", unlock);
      window.removeEventListener("keydown", unlock);
    };
  }, [unlockAudio]);

  useEffect(() => {
    primedRef.current = false;
    knownIdsRef.current = new Set();
    void load();
    const poll = window.setInterval(() => void load(), 15000);
    return () => window.clearInterval(poll);
  }, [companyId, load]);

  useEffect(() => {
    if (!companyId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`company-notifications:${companyId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "notifications",
          filter: `company_id=eq.${companyId}`,
        },
        (payload) => {
          const note = payload.new as Note;
          if (!note?.id) return;
          setNotes((prev) => {
            if (prev.some((row) => row.id === note.id)) return prev;
            const next = [note, ...prev].slice(0, 20);
            knownIdsRef.current = new Set(next.map((row) => row.id));
            primedRef.current = true;
            return next;
          });
          if (isSaleOrderNote(note)) {
            announceNew([note]);
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [announceNew, companyId]);

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
    try {
      const supabase = createClient();
      await supabase.rpc("refresh_company_alerts", { p_company_id: companyId });
      await load();
    } catch {
      // offline fallback
    }
  }

  async function markRead(id: string) {
    setNotes((prev) =>
      prev.map((n) => (n.id === id ? { ...n, is_read: true } : n)),
    );
    try {
      const supabase = createClient();
      await supabase.from("notifications").update({ is_read: true }).eq("id", id);
    } catch {
      // offline fallback
    }
  }

  async function markAllRead() {
    const unreadIds = notes.filter((n) => !n.is_read).map((n) => n.id);
    if (!unreadIds.length) return;
    setNotes((prev) => prev.map((n) => ({ ...n, is_read: true })));
    try {
      const supabase = createClient();
      await supabase
        .from("notifications")
        .update({ is_read: true })
        .in("id", unreadIds);
    } catch {
      // offline fallback
    }
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
              className="absolute w-80 rounded-[var(--radius)] border border-[var(--border)] bg-white p-2 shadow-2xl"
              style={{ top: pos.top, right: pos.right }}
            >
              <div className="flex items-center justify-between gap-2 px-2 py-2">
                <p className="text-sm font-semibold">Notifications</p>
                <div className="flex items-center gap-2">
                  {unread > 0 ? (
                    <button
                      type="button"
                      className="text-xs font-medium text-[var(--muted)] hover:text-[var(--ink)]"
                      onClick={() => void markAllRead()}
                    >
                      Mark all read
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="text-xs font-medium text-[var(--brand)]"
                    onClick={() => void refreshAlerts()}
                  >
                    Refresh
                  </button>
                </div>
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
                      className={`block rounded-[var(--radius-sm)] px-3 py-2 ${
                        n.is_read ? "opacity-70" : "bg-[var(--surface-2)]"
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-sm font-medium">{n.title}</p>
                        {isSaleOrderNote(n) ? (
                          <span className="shrink-0 rounded-[var(--radius-sm)] bg-[var(--brand-soft)] px-1.5 py-0.5 text-[10px] font-semibold text-[var(--brand-strong)]">
                            Order
                          </span>
                        ) : null}
                      </div>
                      {n.body ? (
                        <p className="mt-0.5 text-xs text-[var(--muted)]">{n.body}</p>
                      ) : null}
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
          unlockAudio();
          setOpen((v) => !v);
          if (!open) void refreshAlerts();
        }}
        className={`relative rounded-lg p-2 text-[var(--muted)] hover:bg-[var(--surface-2)] hover:text-[var(--ink)] ${
          ringing ? "text-[var(--brand)]" : ""
        }`}
        aria-label="Notifications"
        aria-expanded={open}
      >
        <Bell className={`h-4 w-4 ${ringing ? "animate-bell-ring" : ""}`} />
        {unread > 0 ? (
          <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-rose-600 px-1 text-[10px] font-semibold text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        ) : null}
      </button>
      {panel}
    </>
  );
}
