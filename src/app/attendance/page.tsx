import { redirect } from "next/navigation";
import { Suspense } from "react";
import Link from "next/link";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { AttendanceManager } from "./manager";

export default function AttendancePage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5" aria-busy="true"><div className="mx-auto max-w-5xl"><p className="text-sm text-slate-600">Loading attendance workspace…</p></div></main>}><AttendanceContent /></Suspense>;
}

async function AttendanceContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("attendance.read")) redirect("/");
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-5 text-slate-950 sm:px-6">
    <div className="mx-auto max-w-5xl">
      <Link href="/" className="text-sm font-semibold text-emerald-900">← Dashboard</Link>
      <h1 className="mt-4 text-3xl font-bold tracking-tight">Attendance</h1>
      <p className="mt-1 text-sm text-slate-600">Mark absentees once for your section. A section stays “Not marked yet” until you submit.</p>
      <AttendanceManager userId={principal.userId} activeRole={principal.activeRole} canManageLate={principal.capabilities.has("attendance.late") || principal.capabilities.has("attendance.override")} />
    </div>
  </main>;
}
