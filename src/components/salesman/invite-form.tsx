"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { Select } from "@/components/ui/select";
import {
  PERMISSIONS,
  permissionsForRole,
  samePermissions,
  type PermissionKey,
} from "@/lib/access/permissions";
import { createClient } from "@/lib/supabase/client";
import { useSingleSubmit } from "@/lib/forms/single-submit";
import {
  floatingMenuStyleEqual,
  getFloatingMenuStyle,
} from "@/lib/ui/floating-menu";
import { cn, fieldControlClass } from "@/lib/utils";
import { Check, ChevronsUpDown, Eye, EyeOff } from "lucide-react";
import { useRouter } from "next/navigation";
import {
  FormEvent,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from "react";
import { createPortal } from "react-dom";

type RosterSalesman = {
  id: string;
  full_name: string;
  user_id: string | null;
};

export function SalesmanInviteForm({
  companyId,
  organizationId,
  salesmen = [],
  sectorOptions = [],
  cityOptions = [],
}: {
  companyId: string;
  organizationId: string;
  salesmen?: RosterSalesman[];
  sectorOptions?: string[];
  cityOptions?: string[];
}) {
  const router = useRouter();
  const singleSubmit = useSingleSubmit();
  const [mode, setMode] = useState<"now" | "link">("now");
  const [salesmanId, setSalesmanId] = useState("");
  const [email, setEmail] = useState("");
  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [password, setPassword] = useState("");
  const [routes, setRoutes] = useState<string[]>([]);
  const [cities, setCities] = useState<string[]>([]);
  const [showReadyPassword, setShowReadyPassword] = useState(false);
  const [custom, setCustom] = useState<PermissionKey[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [inviteUrl, setInviteUrl] = useState<string | null>(null);
  const [ready, setReady] = useState<{ email: string; password: string } | null>(
    null,
  );

  const template = permissionsForRole("salesman");
  const selected = custom ?? template;
  const selectedSet = new Set(selected);

  function toggle(key: PermissionKey, checked: boolean) {
    const next = new Set(selected);
    if (checked) next.add(key);
    else next.delete(key);
    setCustom(PERMISSIONS.map((item) => item.key).filter((item) => next.has(item)));
  }

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    await singleSubmit(async () => {
      setLoading(true);
      setError(null);
      setInviteUrl(null);
      setReady(null);
      try {
        if (mode === "now") {
          const res = await fetch("/api/company/salesman-login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              companyId,
              salesmanId: salesmanId || null,
              fullName,
              phone,
              email,
              password,
              permissions: custom && !samePermissions(custom, template) ? custom : null,
              routes,
              cities,
            }),
          });
          const data = (await res.json().catch(() => null)) as { error?: string } | null;
          if (!res.ok) throw new Error(data?.error || "Could not create the login.");
          setReady({ email: email.trim().toLowerCase(), password });
          setShowReadyPassword(false);
          setPassword("");
        } else {
          const supabase = createClient();
          const { data, error: rpcError } = await supabase.rpc("create_salesman_invite", {
            p_payload: {
              organization_id: organizationId,
              company_id: companyId,
              email,
              full_name: fullName,
              routes,
              cities,
            },
          });
          if (rpcError) throw new Error(rpcError.message);
          const token = (data as { token: string }).token;
          setInviteUrl(`${window.location.origin}/join/${token}`);
        }
        setEmail("");
        setFullName("");
        setPhone("");
        setRoutes([]);
        setCities([]);
        setSalesmanId("");
        router.refresh();
      } catch (err) {
        setError(err instanceof Error ? err.message : "Could not create the login.");
      } finally {
        setLoading(false);
      }
    });
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-3 sm:grid-cols-2">
      <div className="sm:col-span-2 flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => setMode("now")}
          className={
            mode === "now"
              ? "rounded-full bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)]"
          }
        >
          Create login now
        </button>
        <button
          type="button"
          onClick={() => setMode("link")}
          className={
            mode === "link"
              ? "rounded-full bg-[var(--brand)] px-3 py-1.5 text-sm font-medium text-white"
              : "rounded-full border border-[var(--border)] bg-white px-3 py-1.5 text-sm text-[var(--muted)]"
          }
        >
          Invite link
        </button>
      </div>
      <p className="sm:col-span-2 text-xs text-[var(--muted)]">
        {mode === "now"
          ? "The login is ready immediately. Nothing is emailed — give the salesman this email and password."
          : "A link is created for you to copy. Mail is not sent. They choose a password on the link and can sign in at once."}
      </p>
      {salesmen.length ? (
        <div className="sm:col-span-2">
          <Label>Existing salesman</Label>
          <Select
            value={salesmanId}
            onChange={(e) => {
              const id = e.target.value;
              setSalesmanId(id);
              const row = salesmen.find((item) => item.id === id);
              if (row && !fullName) setFullName(row.full_name);
            }}
          >
            <option value="">New name</option>
            {salesmen
              .filter((item) => !item.user_id)
              .map((item) => (
                <option key={item.id} value={item.id}>
                  {item.full_name}
                </option>
              ))}
          </Select>
        </div>
      ) : null}
      <div>
        <Label>Full name</Label>
        <Input value={fullName} onChange={(e) => setFullName(e.target.value)} required />
      </div>
      <div>
        <Label>Email</Label>
        <Input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          placeholder="salesman@email.com"
        />
      </div>
      {mode === "now" ? (
        <>
          <div>
            <Label>Phone</Label>
            <Input value={phone} onChange={(e) => setPhone(e.target.value)} />
          </div>
          <div>
            <Label>Password</Label>
            <PasswordInput
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              minLength={8}
              required
              autoComplete="new-password"
              placeholder="At least 8 characters"
            />
          </div>
          <div className="sm:col-span-2">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <Label>Access</Label>
              {custom ? (
                <button
                  type="button"
                  className="text-xs font-medium text-[var(--brand)]"
                  onClick={() => setCustom(null)}
                >
                  Use salesman defaults
                </button>
              ) : null}
            </div>
            <div className="grid gap-2 sm:grid-cols-2">
              {PERMISSIONS.map((item) => (
                <label key={item.key} className="flex items-start gap-2 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={selectedSet.has(item.key)}
                    onChange={(e) => toggle(item.key, e.target.checked)}
                  />
                  <span>
                    <span className="font-medium">{item.label}</span>
                    <span className="block text-xs text-[var(--muted)]">{item.hint}</span>
                  </span>
                </label>
              ))}
            </div>
          </div>
        </>
      ) : null}
      <MultiOptionPicker
        label="Sectors"
        options={sectorOptions}
        value={routes}
        onChange={setRoutes}
        emptyLabel="Select sectors"
      />
      <MultiOptionPicker
        label="Cities"
        options={cityOptions}
        value={cities}
        onChange={setCities}
        emptyLabel="Select cities"
      />
      {error ? (
        <p className="sm:col-span-2 rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      {ready ? (
        <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Login created. Share these details — they were not emailed.</p>
          <p className="mt-2">
            Email: <span className="font-mono">{ready.email}</span>
          </p>
          <p className="flex items-center gap-2">
            Password:{" "}
            <span className="font-mono">
              {showReadyPassword ? ready.password : "••••••••"}
            </span>
            <button
              type="button"
              onClick={() => setShowReadyPassword((current) => !current)}
              className="inline-flex h-7 w-7 items-center justify-center rounded-md text-emerald-800 hover:bg-emerald-100"
              aria-label={showReadyPassword ? "Hide password" : "Show password"}
            >
              {showReadyPassword ? (
                <EyeOff className="h-4 w-4" aria-hidden />
              ) : (
                <Eye className="h-4 w-4" aria-hidden />
              )}
            </button>
          </p>
          <p className="mt-2 text-xs">
            They sign in and land on the field app. Access is the salesman role plus the boxes you left on.
          </p>
        </div>
      ) : null}
      {inviteUrl ? (
        <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-3 text-sm text-emerald-800">
          <p className="font-semibold">Invite link ready. Mail was not sent — copy this link.</p>
          <p className="mt-1 break-all font-mono text-xs">{inviteUrl}</p>
        </div>
      ) : null}
      <div className="sm:col-span-2">
        {ready || inviteUrl ? (
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setReady(null);
              setInviteUrl(null);
              setShowReadyPassword(false);
              setError(null);
            }}
          >
            Create another
          </Button>
        ) : (
          <Button type="submit" loading={loading}>
            {loading
              ? "Creating..."
              : mode === "now"
                ? "Create salesman login"
                : "Create invite link"}
          </Button>
        )}
      </div>
    </form>
  );
}

function MultiOptionPicker({
  label,
  options,
  value,
  onChange,
  emptyLabel,
}: {
  label: string;
  options: string[];
  value: string[];
  onChange: (next: string[]) => void;
  emptyLabel: string;
}) {
  const listId = useId();
  const [open, setOpen] = useState(false);
  const [mounted, setMounted] = useState(false);
  const [query, setQuery] = useState("");
  const [menuStyle, setMenuStyle] = useState<CSSProperties>({});
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuStyleRef = useRef<CSSProperties>({});
  const searchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setMounted(true);
  }, []);

  useEffect(() => {
    if (!open) return;

    function position() {
      const trigger = triggerRef.current;
      if (!trigger) return;
      const next = getFloatingMenuStyle(trigger.getBoundingClientRect(), {
        minWidth: Math.max(220, trigger.offsetWidth),
        preferredMaxHeight: 288,
        zIndex: 320,
      });
      if (floatingMenuStyleEqual(menuStyleRef.current, next)) return;
      menuStyleRef.current = next;
      setMenuStyle(next);
    }

    position();

    const onPointer = (event: MouseEvent) => {
      const target = event.target as Node;
      if (rootRef.current?.contains(target)) return;
      const menu = document.getElementById(listId);
      if (menu?.contains(target)) return;
      setOpen(false);
    };

    window.addEventListener("resize", position);
    window.addEventListener("scroll", position, true);
    window.addEventListener("mousedown", onPointer);
    requestAnimationFrame(() => {
      searchRef.current?.focus({ preventScroll: true });
    });

    return () => {
      window.removeEventListener("resize", position);
      window.removeEventListener("scroll", position, true);
      window.removeEventListener("mousedown", onPointer);
    };
  }, [open, listId]);

  const selected = useMemo(
    () => new Set(value.map((item) => item.toLowerCase())),
    [value],
  );
  const visible = options.filter((option) =>
    option.toLowerCase().includes(query.trim().toLowerCase()),
  );
  const summary =
    value.length === 0
      ? emptyLabel
      : value.length <= 2
        ? value.join(", ")
        : `${value.length} selected`;

  function toggle(option: string) {
    const key = option.toLowerCase();
    if (selected.has(key)) {
      onChange(value.filter((item) => item.toLowerCase() !== key));
    } else {
      onChange([...value, option]);
    }
  }

  return (
    <div ref={rootRef} className="relative w-full min-w-0 space-y-1.5">
      <Label>{label}</Label>
      <button
        ref={triggerRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        onClick={() => {
          setOpen((current) => !current);
          setQuery("");
        }}
        className={cn(
          fieldControlClass,
          "flex h-10 w-full min-w-0 items-center justify-between gap-2 overflow-hidden border border-[var(--field-border)] px-3 text-left",
        )}
      >
        <span
          className={cn(
            "min-w-0 flex-1 truncate",
            value.length === 0 && "text-[var(--muted)]",
          )}
        >
          {summary}
        </span>
        <ChevronsUpDown className="h-4 w-4 shrink-0 text-[var(--muted)]" />
      </button>
      {open && mounted
        ? createPortal(
            <div
              id={listId}
              role="listbox"
              aria-multiselectable="true"
              style={menuStyle}
              className="overflow-hidden rounded-xl border border-[var(--field-border)] bg-white p-2 shadow-[0_18px_50px_rgba(11,25,21,0.18)] ring-1 ring-black/5"
            >
              <Input
                ref={searchRef}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={`Search ${label.toLowerCase()}`}
              />
              <div className="mt-2 min-h-0 flex-1 space-y-1 overflow-y-auto">
                {visible.length === 0 ? (
                  <p className="px-2 py-3 text-sm text-[var(--muted)]">
                    {options.length === 0
                      ? `No ${label.toLowerCase()} on the main company yet.`
                      : "No matches."}
                  </p>
                ) : (
                  visible.map((option) => {
                    const on = selected.has(option.toLowerCase());
                    return (
                      <label
                        key={option}
                        className="flex cursor-pointer items-center gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-[var(--surface-2)]"
                      >
                        <input
                          type="checkbox"
                          className="sr-only"
                          checked={on}
                          onChange={() => toggle(option)}
                        />
                        <span
                          className={cn(
                            "inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border",
                            on
                              ? "border-[var(--brand)] bg-[var(--brand)] text-white"
                              : "border-[var(--field-border)] bg-white",
                          )}
                        >
                          {on ? <Check className="h-3 w-3" /> : null}
                        </span>
                        <span className="min-w-0 truncate">{option}</span>
                      </label>
                    );
                  })
                )}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
