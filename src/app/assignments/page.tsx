import Link from "next/link";
import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { AssignmentManager } from "./manager";

export default function AssignmentsPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-8 w-56 rounded bg-slate-200" /><div className="mt-8 h-96 rounded-2xl bg-white" /></div></main>}><AssignmentsContent /></Suspense>;
}

async function AssignmentsContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("assignment.manage")) return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-bold">Access unavailable</h1><Link href="/" className="mt-4 inline-block underline">Dashboard</Link></main>;
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-6 text-slate-950 sm:px-6"><div className="mx-auto max-w-6xl"><Link href="/" className="inline-flex min-h-11 items-center font-semibold text-emerald-900">← Dashboard</Link><header className="mt-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">Staff and sections</p><h1 className="mt-1 text-3xl font-bold">Teacher assignments</h1><p className="mt-2 text-slate-600">Assign one class teacher to each section and subject teachers by section. Timetable entries use these assignments automatically.</p></header><AssignmentManager /></div></main>;
}
