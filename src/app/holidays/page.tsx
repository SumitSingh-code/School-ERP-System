import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { HolidayManager } from "./manager";

export default function HolidaysPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5"><div className="mx-auto max-w-5xl animate-pulse"><div className="h-8 w-56 rounded bg-slate-200" /><div className="mt-8 h-72 rounded-2xl bg-white" /></div></main>}><HolidaysContent /></Suspense>;
}

async function HolidaysContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("holiday.manage")) return <main className="p-6"><h1 className="text-2xl font-bold">Access unavailable</h1><Link href="/">Dashboard</Link></main>;
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-6 text-slate-950 sm:px-6"><div className="mx-auto max-w-5xl"><Link href="/" className="inline-flex min-h-11 items-center font-semibold text-emerald-900">← Dashboard</Link><header className="mt-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">School calendar</p><h1 className="mt-1 text-3xl font-bold">Holidays and closures</h1><p className="mt-2 text-slate-600">Manage planned holidays, national dates and second Saturdays. A same-day closure requires the Director or Principal role.</p></header><HolidayManager canAnnounceSudden={principal.capabilities.has("holiday.sudden") && ["Director", "Principal"].includes(principal.activeRole)} /></div></main>;
}
