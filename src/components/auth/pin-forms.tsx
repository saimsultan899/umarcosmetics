"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { PasswordInput } from "@/components/ui/password-input";
import { FormEvent, useState } from "react";

export function PinSetupForm({
  onSave,
  onSkip,
  busy,
  error,
}: {
  onSave: (pin: string) => Promise<void> | void;
  onSkip?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [pin, setPin] = useState("");
  const [confirm, setConfirm] = useState("");
  const [localError, setLocalError] = useState<string | null>(null);

  async function submit(e: FormEvent) {
    e.preventDefault();
    setLocalError(null);
    if (pin.length < 4 || pin.length > 12) {
      setLocalError("PIN must be 4–12 characters");
      return;
    }
    if (pin !== confirm) {
      setLocalError("PINs do not match");
      return;
    }
    await onSave(pin);
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="login-form">
      <p className="text-sm text-[var(--muted)]">
        Create a local PIN to open this app offline. Your email and password are
        stored encrypted on this computer only.
      </p>
      <div className="login-field">
        <label htmlFor="pin-new">PIN</label>
        <PasswordInput
          id="pin-new"
          autoComplete="new-password"
          required
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="4–12 characters"
        />
      </div>
      <div className="login-field">
        <label htmlFor="pin-confirm">Confirm PIN</label>
        <PasswordInput
          id="pin-confirm"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
          placeholder="Repeat PIN"
        />
      </div>
      {localError || error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {localError || error}
        </p>
      ) : null}
      <Button type="submit" className="login-submit" disabled={busy}>
        {busy ? "Saving…" : "Save PIN & continue"}
      </Button>
      {onSkip ? (
        <button
          type="button"
          className="mt-2 w-full text-sm text-[var(--muted)]"
          onClick={onSkip}
          disabled={busy}
        >
          Skip for now
        </button>
      ) : null}
    </form>
  );
}

export function PinUnlockForm({
  emailHint,
  onUnlock,
  onUsePassword,
  busy,
  error,
}: {
  emailHint?: string | null;
  onUnlock: (pin: string) => Promise<void> | void;
  onUsePassword?: () => void;
  busy?: boolean;
  error?: string | null;
}) {
  const [pin, setPin] = useState("");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!pin.trim()) return;
    try {
      await onUnlock(pin.trim());
    } catch (err) {
      // Parent should set error; ensure we don't swallow silently
      console.error("[PinUnlock]", err);
    }
  }

  return (
    <form onSubmit={(e) => void submit(e)} className="login-form">
      <p className="text-sm text-[var(--muted)]">
        Enter your local PIN to unlock
        {emailHint ? (
          <>
            {" "}
            <span className="font-medium text-[var(--ink)]">{emailHint}</span>
          </>
        ) : (
          " saved credentials"
        )}
        .
      </p>
      <div className="login-field">
        <label htmlFor="pin-unlock">PIN</label>
        <Input
          id="pin-unlock"
          type="password"
          inputMode="numeric"
          autoComplete="current-password"
          required
          value={pin}
          onChange={(e) => setPin(e.target.value)}
          placeholder="Enter PIN"
          autoFocus
        />
      </div>
      {error ? (
        <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">
          {error}
        </p>
      ) : null}
      <Button type="submit" className="login-submit" disabled={busy || !pin}>
        {busy ? "Unlocking…" : "Unlock"}
      </Button>
      {onUsePassword ? (
        <button
          type="button"
          className="mt-2 w-full text-sm text-[var(--brand)] font-medium"
          onClick={onUsePassword}
          disabled={busy}
        >
          Sign in with email instead
        </button>
      ) : null}
    </form>
  );
}
