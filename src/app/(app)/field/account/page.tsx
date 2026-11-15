"use client";

import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { PasswordInput } from "@/components/ui/password-input";
import { createClient } from "@/lib/supabase/client";
import { FormEvent, useState } from "react";

export default function SalesmanAccountPage() {
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setError(null);
    setSaved(false);
    if (password.length < 8) {
      setError("Use at least 8 characters.");
      return;
    }
    if (password !== confirm) {
      setError("The two passwords do not match.");
      return;
    }
    setLoading(true);
    const { error: updateError } = await createClient().auth.updateUser({ password });
    setLoading(false);
    if (updateError) {
      setError(updateError.message);
      return;
    }
    setPassword("");
    setConfirm("");
    setSaved(true);
  }

  return (
    <div className="animate-rise mx-auto w-full max-w-lg space-y-5">
      <div>
        <h1 className="font-[family-name:var(--font-display)] text-2xl font-semibold sm:text-3xl">
          My account
        </h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Change the password for this login. The office is not notified.
        </p>
      </div>
      <form onSubmit={onSubmit} className="space-y-3 rounded-2xl border border-[var(--border)] bg-white p-4 sm:p-6">
        <div>
          <Label>New password</Label>
          <PasswordInput
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            placeholder="At least 8 characters"
          />
        </div>
        <div>
          <Label>Confirm password</Label>
          <PasswordInput
            value={confirm}
            onChange={(event) => setConfirm(event.target.value)}
            autoComplete="new-password"
            minLength={8}
            required
            placeholder="Type it again"
          />
        </div>
        {error ? (
          <p className="rounded-lg bg-rose-50 px-3 py-2 text-sm text-rose-700">{error}</p>
        ) : null}
        {saved ? (
          <p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
            Password updated. Use it the next time you sign in.
          </p>
        ) : null}
        <Button type="submit" loading={loading}>
          {loading ? "Saving..." : "Update password"}
        </Button>
      </form>
    </div>
  );
}
