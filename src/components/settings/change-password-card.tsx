"use client";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";
import {
  clearCredentialVault,
  shouldOfferPinVault,
} from "@/lib/offline/local-auth";
import { FormEvent, useEffect, useState } from "react";

export function ChangePasswordCard() {
  const [email, setEmail] = useState("");
  const [currentPassword, setCurrentPassword] = useState("");
  const [nextPassword, setNextPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [offline, setOffline] = useState(false);

  useEffect(() => {
    if (typeof navigator !== "undefined" && navigator.onLine === false) {
      setOffline(true);
      return;
    }
    const supabase = createClient();
    void supabase.auth.getSession().then(({ data }) => {
      setEmail(data.session?.user.email || "");
    });
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setMessage(null);
    if (!email) {
      setError("Sign in online before changing the password.");
      return;
    }
    if (nextPassword.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (nextPassword !== confirmPassword) {
      setError("The new password and the confirmation do not match.");
      return;
    }
    if (nextPassword === currentPassword) {
      setError("Choose a password that is different from the current one.");
      return;
    }

    setLoading(true);
    const supabase = createClient();
    const { error: signError } = await supabase.auth.signInWithPassword({
      email,
      password: currentPassword,
    });
    if (signError) {
      setLoading(false);
      setError("The current password is not correct.");
      return;
    }
    const { error: updateError } = await supabase.auth.updateUser({
      password: nextPassword,
    });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setCurrentPassword("");
    setNextPassword("");
    setConfirmPassword("");
    if (shouldOfferPinVault()) {
      await clearCredentialVault();
      try {
        localStorage.removeItem("umar_vault_hint");
      } catch {
        /* ignore */
      }
      setMessage(
        "Password updated. Next time, sign in with email and password, then save a new PIN.",
      );
      return;
    }
    setMessage("Password updated. Use it the next time you sign in.");
  }

  return (
    <section className="panel p-5">
      <h2 className="font-[family-name:var(--font-display)] text-lg font-semibold">
        Password
      </h2>
      <p className="mt-1 text-sm text-[var(--muted)]">
        {email
          ? `This changes the sign-in password for ${email}.`
          : "This changes the password for the signed-in account."}{" "}
        If you forget it later, use Forgot password on the sign-in page.
      </p>
      {offline ? (
        <p className="mt-4 text-sm text-[var(--muted)]">
          Connect to the internet to change the password.
        </p>
      ) : (
        <form onSubmit={onSubmit} className="mt-4 space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Current password</span>
            <PasswordInput
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
              required
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">New password</span>
            <PasswordInput
              autoComplete="new-password"
              value={nextPassword}
              onChange={(e) => setNextPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[var(--muted)]">Confirm new password</span>
            <PasswordInput
              autoComplete="new-password"
              value={confirmPassword}
              onChange={(e) => setConfirmPassword(e.target.value)}
              required
              minLength={8}
            />
          </label>
          {error ? (
            <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
          ) : null}
          {message ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{message}</p>
          ) : null}
          <Button type="submit" loading={loading}>
            {loading ? "Saving…" : "Update password"}
          </Button>
        </form>
      )}
    </section>
  );
}
