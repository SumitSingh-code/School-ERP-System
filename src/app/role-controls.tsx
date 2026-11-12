"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function RoleControls({ roles, activeRole }: { roles: string[]; activeRole: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  async function changeRole(role: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/auth/active-role", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ role }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not switch role");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch role");
      setBusy(false);
    }
  }

  async function signOut() {
    setBusy(true);
    for (let index = window.localStorage.length - 1; index >= 0; index -= 1) {
      const key = window.localStorage.key(index);
      if (key?.startsWith("school-erp-attendance:")) window.localStorage.removeItem(key);
    }
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/");
    router.refresh();
  }

  return <div className="flex flex-wrap items-center gap-2">
    <span className="rounded-full bg-emerald-50 px-3 py-2 text-sm font-semibold text-emerald-950">{activeRole}</span>
    {roles.length > 1 && <label className="sr-only" htmlFor="active-role">Switch role</label>}
    {roles.length > 1 && <select id="active-role" aria-label="Switch role" disabled={busy} value={activeRole} onChange={(event) => void changeRole(event.target.value)} className="min-h-11 rounded-xl border border-slate-300 bg-white px-3 text-sm font-medium">
      {roles.map((role) => <option key={role} value={role}>{role}</option>)}
    </select>}
    <button type="button" onClick={() => void signOut()} disabled={busy} className="min-h-11 rounded-xl border border-slate-300 px-3 text-sm font-medium hover:bg-slate-50">Sign out</button>
    {error && <p role="alert" className="w-full text-sm text-red-700">{error}</p>}
  </div>;
}
