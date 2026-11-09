"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";

export function SignInForm() {
  const router = useRouter();
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [challengeId, setChallengeId] = useState<string | null>(null);
  const [destinationHint, setDestinationHint] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setBusy(true);
    const data = new FormData(event.currentTarget);
    try {
      if (challengeId) {
        const response = await fetch("/api/auth/verify-otp", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ challengeId, code: data.get("code") }),
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error ?? "Code verification failed");
        router.replace("/");
        router.refresh();
        return;
      }

      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ phone: data.get("phone"), password: data.get("password") }),
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Sign in failed");
      if (result.otpRequired) {
        setChallengeId(result.challengeId);
        setDestinationHint(result.destinationHint ?? "your registered phone");
        setBusy(false);
        return;
      }
      router.replace("/");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not sign in. Try again.");
      setBusy(false);
    }
  }

  return <form onSubmit={submit} className="mt-7 space-y-5">
    {challengeId ? <>
      <p className="text-sm leading-6 text-slate-600">Enter the six-digit code sent to {destinationHint}. It expires in five minutes.</p>
      <label className="block text-sm font-semibold text-slate-800">
        One-time code
        <input name="code" autoComplete="one-time-code" inputMode="numeric" pattern="[0-9]{6}" required maxLength={6} minLength={6} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-lg tracking-[.35em] outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20" />
      </label>
      <button type="button" onClick={() => { setChallengeId(null); setError(""); }} className="text-sm font-medium text-emerald-900 underline">Use another account</button>
    </> : <>
      <label className="block text-sm font-semibold text-slate-800">
        Phone number
        <input name="phone" autoComplete="tel" inputMode="tel" required maxLength={30} className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20" />
      </label>
      <label className="block text-sm font-semibold text-slate-800">
        Password
        <input name="password" type="password" autoComplete="current-password" required className="mt-2 min-h-12 w-full rounded-xl border border-slate-300 px-4 text-base outline-none focus:border-emerald-700 focus:ring-2 focus:ring-emerald-700/20" />
      </label>
    </>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    <button disabled={busy} className="min-h-12 w-full rounded-xl bg-emerald-950 px-4 font-semibold text-white hover:bg-emerald-900 disabled:opacity-60">{busy ? "Verifying…" : challengeId ? "Verify code" : "Sign in"}</button>
  </form>;
}
