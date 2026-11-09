import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { TimetableManager } from "./manager";

export default function TimetablePage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-8 w-56 rounded bg-slate-200" /><div className="mt-8 h-96 rounded-2xl bg-white" /></div></main>}><TimetableContent /></Suspense>;
}

async function TimetableContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("timetable.read")) return <main className="p-6"><h1 className="text-2xl font-bold">Access unavailable</h1><Link href="/">Dashboard</Link></main>;
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-6 text-slate-950 sm:px-6"><div className="mx-auto max-w-6xl"><Link href="/" className="inline-flex min-h-11 items-center font-semibold text-emerald-900">← Dashboard</Link><header className="mt-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">Weekly planning</p><h1 className="mt-1 text-3xl font-bold">Timetable</h1><p className="mt-2 text-slate-600">Eight periods, configurable working days and teacher assignments. Concurrent slot edits are protected.</p></header><TimetableManager canManage={principal.capabilities.has("timetable.manage")} /></div></main>;
}
