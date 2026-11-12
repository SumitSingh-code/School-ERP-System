import { Suspense } from "react";
import { forSchool } from "@/lib/scoped-prisma";
import { getCurrentPrincipal } from "@/lib/with-school-route";
import { prisma } from "@/lib/prisma";
import { SignInForm } from "./sign-in-form";
import { RoleControls } from "./role-controls";
import { ChangePasswordForm } from "./change-password-form";

export default function Home() {
  return <Suspense fallback={<main className="min-h-screen bg-[#f5f7f4] p-5" aria-busy="true"><div className="mx-auto max-w-6xl animate-pulse"><div className="h-8 w-48 rounded bg-slate-200" /><div className="mt-8 h-36 rounded-2xl bg-white" /></div></main>}><DashboardContent /></Suspense>;
}

async function DashboardContent() {
  const principal = await getCurrentPrincipal();

  if (!principal) {
    return <main className="flex min-h-screen items-center justify-center bg-[#f5f7f4] px-4 py-10 text-slate-950">
      <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
        <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-800">School ERP</p>
        <h1 className="mt-3 text-3xl font-bold tracking-tight">Sign in to your school</h1>
        <p className="mt-2 text-sm leading-6 text-slate-600">Use the phone number and password provided by your school administrator.</p>
        <SignInForm />
        <p className="mt-5 border-t border-slate-100 pt-4 text-xs leading-5 text-slate-500">Accounts are created by the school. If you cannot sign in, contact your school office.</p>
      </section>
    </main>;
  }

  if (principal.mustChangePassword) return <main className="flex min-h-screen items-center justify-center bg-[#f5f7f4] px-4 py-10 text-slate-950">
    <section className="w-full max-w-md rounded-3xl border border-slate-200 bg-white p-6 shadow-sm sm:p-9">
      <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-800">School ERP</p>
      <h1 className="mt-3 text-2xl font-bold tracking-tight">Set your private password</h1>
      <p className="mt-2 text-sm leading-6 text-slate-600">Your school gave you a temporary password. Change it before opening any school records.</p>
      <ChangePasswordForm />
    </section>
  </main>;

  let schoolName = "Your school";
  let studentsCount: number | null = null;
  let sectionsCount: number | null = null;
  let databaseUnavailable = false;
  try {
    const db = forSchool(prisma, principal.schoolId);
    const [school, students, sections] = await Promise.all([
      db.school.findUnique({ where: { id: principal.schoolId }, select: { name: true } }),
      db.student.count({ where: { status: "ACTIVE" } }),
      db.section.count(),
    ]);
    schoolName = school?.name ?? schoolName;
    studentsCount = students;
    sectionsCount = sections;
  } catch {
    databaseUnavailable = true;
  }

  return <main className="min-h-screen bg-[#f5f7f4] pb-8 text-slate-950">
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-4 py-4 sm:px-6 lg:px-8">
        <div>
          <p className="text-xs font-bold uppercase tracking-[.2em] text-emerald-800">School ERP</p>
          <h1 className="text-lg font-bold">{schoolName}</h1>
        </div>
        <RoleControls roles={principal.roles} activeRole={principal.activeRole} />
      </div>
    </header>
    <section className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
      <p className="text-sm text-slate-600">Signed in as {principal.name}</p>
      <h2 className="mt-2 text-3xl font-bold tracking-tight">{principal.activeRole} workspace</h2>
      {databaseUnavailable ? <div role="alert" className="mt-6 rounded-2xl border border-amber-300 bg-amber-50 p-5 text-amber-950">
        <h3 className="font-semibold">School data is temporarily unavailable</h3>
        <p className="mt-1 text-sm">Your session is active, but the school database could not be reached. Try again later or contact the administrator.</p>
      </div> : <>
        <p className="mt-2 max-w-2xl text-slate-600">Your overview is based on the current school records.</p>
        <div className="mt-7 grid gap-4 sm:grid-cols-2">
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-medium text-slate-600">Active students</p>
            <p className="mt-3 text-3xl font-bold">{studentsCount}</p>
          </article>
          <article className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
            <p className="font-medium text-slate-600">Sections configured</p>
            <p className="mt-3 text-3xl font-bold">{sectionsCount}</p>
          </article>
        </div>
        {studentsCount === 0 && sectionsCount === 0 && <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5">
          <h3 className="font-semibold">School setup is needed</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">There are no student or section records yet. Add your school structure and import your roster before using daily school workflows.</p>
        </section>}
      </>}
      {principal.capabilities.has("academic.manage") && <a href="/academic" className="mt-6 inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-900 px-5 font-semibold text-white">Manage academic setup</a>}
      {principal.capabilities.has("student.import") && <a href="/imports" className="ml-3 mt-6 inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-900 bg-white px-5 font-semibold text-emerald-950">Import students</a>}
      <div className="mt-4 flex flex-wrap gap-3">
        {principal.capabilities.has("attendance.read") && <a href="/attendance" className="inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-900 px-5 font-semibold text-white">Attendance</a>}
        {principal.capabilities.has("assignment.manage") && <a href="/assignments" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-900 bg-white px-5 font-semibold text-emerald-950">Teacher assignments</a>}
        {principal.capabilities.has("timetable.read") && <a href="/timetable" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-900 bg-white px-5 font-semibold text-emerald-950">Timetable</a>}
        {principal.capabilities.has("holiday.manage") && <a href="/holidays" className="inline-flex min-h-12 items-center justify-center rounded-xl border border-emerald-900 bg-white px-5 font-semibold text-emerald-950">Holidays</a>}
      </div>
    </section>
  </main>;
}
