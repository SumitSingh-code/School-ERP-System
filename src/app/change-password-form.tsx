"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function ChangePasswordForm() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const data = new FormData(event.currentTarget);
    try {
      const response = await fetch("/api/auth/change-password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ currentPassword: data.get("currentPassword"), newPassword: data.get("newPassword"), confirmPassword: data.get("confirmPassword") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update your password");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update your password");
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-6 space-y-4">
    <label className="block text-sm font-semibold">Current password<input name="currentPassword" type="password" autoComplete="current-password" required className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" /></label>
    <label className="block text-sm font-semibold">New password<input name="newPassword" type="password" autoComplete="new-password" minLength={8} maxLength={200} required className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" /><span className="mt-1 block text-xs font-normal text-slate-600">Use at least 8 characters. Avoid common passwords and your phone number.</span></label>
    <label className="block text-sm font-semibold">Confirm new password<input name="confirmPassword" type="password" autoComplete="new-password" minLength={8} maxLength={200} required className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 px-3 text-base" /></label>
    {error && <p role="alert" className="rounded-xl bg-red-50 p-3 text-sm text-red-900">{error}</p>}
    <button disabled={busy} className="min-h-12 w-full rounded-xl bg-emerald-950 px-4 font-semibold text-white disabled:opacity-60">{busy ? "Saving…" : "Set new password"}</button>
  </form>;
}
