import { Suspense } from "react";
import { redirect } from "next/navigation";
import Link from "next/link";
import { prisma } from "@/lib/prisma";
import { forSchool } from "@/lib/scoped-prisma";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { AcademicManager } from "./manager";

export default function AcademicPage() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-8 w-56 rounded bg-slate-200" /><div className="mt-8 h-96 rounded-2xl bg-white" /></div></main>}><AcademicContent /></Suspense>;
}

async function AcademicContent() {
  const principal = await getCurrentPrincipal();
  if (!principal) redirect("/");
  if (!principal.capabilities.has("academic.manage")) return <main className="mx-auto max-w-3xl p-6"><h1 className="text-2xl font-bold">Access unavailable</h1><p className="mt-2 text-slate-600">Your current role cannot manage academic setup.</p><Link className="mt-5 inline-flex min-h-12 items-center rounded-xl border px-4" href="/">Back to dashboard</Link></main>;
  const db = forSchool(prisma, principal.schoolId);
  const [years, classes, streams, groups, subjects, sections] = await Promise.all([
    db.academicYear.findMany({ where: { deletedAt: null }, orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }] }),
    db.classLevel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.stream.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    db.studyGroup.findMany({ where: { deletedAt: null }, orderBy: { name: "asc" } }),
    db.subject.findMany({
      where: { deletedAt: null },
      include: { subjects: { include: {
        classLevel: { select: { name: true } },
        stream: { select: { name: true } },
        group: { select: { name: true } },
      } } },
      orderBy: { name: "asc" },
    }),
    db.section.findMany({
      where: { deletedAt: null },
      include: {
        classLevel: { select: { name: true } },
        stream: { select: { name: true } },
        group: { select: { name: true } },
        academicYear: { select: { label: true } },
        _count: { select: { students: true } },
      },
      orderBy: [{ classLevel: { sortOrder: "asc" } }, { name: "asc" }],
    }),
  ]);
  const view = {
    years: years.map(({ id, label, startsOn, endsOn, isCurrent }) => ({ id, label, startsOn: startsOn.toISOString().slice(0, 10), endsOn: endsOn.toISOString().slice(0, 10), isCurrent })),
    classes: classes.map(({ id, name, sortOrder, active }) => ({ id, name, sortOrder, active })),
    streams: streams.map(({ id, classLevelId, name, active }) => ({ id, classLevelId, name, active })),
    groups: groups.map(({ id, streamId, name, active }) => ({ id, streamId, name, active })),
    subjects: subjects.map(({ id, name, code, optional, active, subjects: links }) => ({ id, name, code, optional, active, assignedTo: links.map((link) => `${link.classLevel.name}${link.stream ? ` · ${link.stream.name}` : ""}${link.group ? ` ${link.group.name}` : ""}`) })),
    sections: sections.map(({ id, name, active, classLevel, stream, group, academicYear, _count }) => ({ id, name, active, className: classLevel.name, streamName: stream?.name ?? null, groupName: group?.name ?? null, academicYear: academicYear.label, students: _count.students })),
  };
  return <main className="min-h-screen bg-[#f5f7f4] px-4 py-6 text-slate-950 sm:px-6 lg:px-8">
    <div className="mx-auto max-w-6xl">
      <Link href="/" className="inline-flex min-h-11 items-center text-sm font-semibold text-emerald-900">← Dashboard</Link>
      <div className="mt-4 flex flex-wrap items-end justify-between gap-4">
        <div><p className="text-xs font-bold uppercase tracking-[.18em] text-emerald-800">School setup</p><h1 className="mt-1 text-3xl font-bold tracking-tight">Academic structure</h1><p className="mt-2 max-w-2xl text-slate-600">Manage academic years, classes, streams, subjects and sections. These records are used by imports and later school workflows.</p></div>
        <span className="rounded-full bg-white px-4 py-2 text-sm font-semibold shadow-sm">{principal.activeRole}</span>
      </div>
      <AcademicManager initial={view} />
    </div>
  </main>;
}
