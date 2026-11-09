import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { StudentImport } from "./student-import";
import { StaffImport } from "./staff-import";
import { prisma } from "@/lib/prisma";
import { forSchool } from "@/lib/scoped-prisma";

export default function ImportPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5"><div className="mx-auto max-w-4xl animate-pulse"><div className="h-8 w-48 rounded bg-slate-200" /><div className="mt-8 h-96 rounded-2xl bg-white" /></div></main>}><ImportContent /></Suspense>;
}

async function ImportContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("student.import")) return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-bold">Import access unavailable</h1><p className="mt-2 text-slate-600">Only an authorised school administrator can import records.</p><Link href="/" className="mt-5 inline-flex min-h-12 items-center rounded-xl border px-4">Back to dashboard</Link></main>;
  const db = forSchool(prisma, principal.schoolId);
  const batches = await db.importBatch.findMany({ where: { kind: { in: principal.capabilities.has("staff.manage") ? ["students", "staff"] : ["students"] } }, orderBy: { createdAt: "desc" }, take: 20, select: { id: true, kind: true, status: true, rowCount: true, createdCount: true, updatedCount: true, fileName: true, createdAt: true } });
  const history = batches.map((batch) => ({ ...batch, createdAt: batch.createdAt.toISOString() }));
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-6 text-slate-950 sm:px-6 lg:px-8"><div className="mx-auto max-w-4xl"><Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-900">← Dashboard</Link><div className="mt-4"><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">Director tools</p><h1 className="mt-1 text-3xl font-bold tracking-tight">CSV imports</h1><p className="mt-2 max-w-2xl text-slate-600">Upload, review the preview, and confirm only when the counts and warnings look right. No student or staff records are written before confirmation.</p></div><StudentImport history={history.filter((batch) => batch.kind === "students")} />{principal.capabilities.has("staff.manage") && <StaffImport history={history.filter((batch) => batch.kind === "staff")} />}</div></main>;
}
