"use client";

import { Button } from "@/components/ui/button";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";
import { FormEvent, useEffect, useState } from "react";

export default function ResetPasswordPage() {
  const [ready, setReady] = useState(false);
  const [checking, setChecking] = useState(true);
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  useEffect(() => {
    let cancelled = false;
    async function openRecoverySession() {
      const supabase = createClient();
      const params = new URLSearchParams(window.location.search);
      const code = params.get("code");
      if (code) {
        const { error: exchangeError } = await supabase.auth.exchangeCodeForSession(code);
        if (exchangeError && !cancelled) {
          setError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
          setChecking(false);
          return;
        }
      }
      const { data } = await supabase.auth.getSession();
      if (cancelled) return;
      if (!data.session) {
        setError("This reset link is invalid or has expired. Request a new one from the sign-in page.");
      } else {
        setReady(true);
      }
      setChecking(false);
    }
    void openRecoverySession();
    return () => {
      cancelled = true;
    };
  }, []);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    const supabase = createClient();
    const { error: updateError } = await supabase.auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setDone(true);
  }

  return (
    <div className="login-shell">
      <div className="login-shell__bg" aria-hidden />
      <div className="login-card login-card--narrow animate-rise">
        <div className="login-brand">
          <div className="login-brand__mark login-brand__mark--logo">
            <img src="/icons/icon-192.png" alt="" />
          </div>
          <div>
            <h1 className="login-brand__title">Umar Distribution</h1>
            <p className="login-brand__subtitle">Choose a new password</p>
          </div>
        </div>

        {checking ? (
          <p className="text-sm text-[var(--muted)]">Checking the reset link…</p>
        ) : null}

        {done ? (
          <div className="space-y-4">
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
              Password updated. Sign in with the new password. If this computer was formatted, download the Windows app from the sign-in page.
            </p>
            <Button className="login-submit" onClick={() => { window.location.href = "/login"; }}>
              Go to sign in
            </Button>
          </div>
        ) : null}

        {ready && !done ? (
          <form onSubmit={onSubmit} className="login-form">
            <div className="login-field">
              <label htmlFor="new-password">New password</label>
              <PasswordInput
                id="new-password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="login-field">
              <label htmlFor="confirm-password">Confirm password</label>
              <PasswordInput
                id="confirm-password"
                autoComplete="new-password"
                required
                minLength={8}
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
              />
            </div>
            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            ) : null}
            <Button type="submit" className="login-submit" loading={loading}>
              {loading ? "Saving…" : "Save new password"}
            </Button>
          </form>
        ) : null}

        {!checking && !ready && !done ? (
          <div className="space-y-4">
            {error ? (
              <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
            ) : null}
            <Button variant="secondary" className="login-submit" onClick={() => { window.location.href = "/login"; }}>
              Back to sign in
            </Button>
          </div>
        ) : null}
      </div>
    </div>
  );
}
