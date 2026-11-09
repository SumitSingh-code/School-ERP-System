"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Payload = { years: { id: string; label: string; isCurrent: boolean }[]; sections: { id: string; name: string; classLevel: { name: string }; academicYearId: string; academicYear: { label: string } }[]; subjects: { id: string; name: string }[]; staff: { id: string; name: string }[]; sectionSubjects: { sectionId: string; subjectIds: string[] }[]; classTeachers: { id: string; userId: string; sectionId: string; deletedAt: string | null; staff: { name: string }; section: { name: string; classLevel: { name: string }; academicYear: { label: string } } }[]; subjectTeachers: { id: string; userId: string; subjectId: string; sectionId: string; deletedAt: string | null; staff: { name: string }; subject: { name: string }; section: { name: string; classLevel: { name: string }; academicYear: { label: string } } }[] };
const input = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3";

export function AssignmentManager() {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [classYear, setClassYear] = useState("");
  const [subjectYear, setSubjectYear] = useState("");
  const [classSection, setClassSection] = useState("");
  const [subjectSection, setSubjectSection] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function load() { const response = await fetch("/api/v1/assignments"); const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); }
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/assignments").then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; }).then((result) => { if (active) setData(result); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load assignments"); });
    return () => { active = false; };
  }, []);
  async function save(form: HTMLFormElement, kind: "classTeacher" | "subjectTeacher") {
    setBusy(true); setMessage("");
    const values = new FormData(form);
    const body = { kind, yearId: values.get("yearId"), sectionId: values.get("sectionId"), teacherId: values.get("teacherId"), ...(kind === "subjectTeacher" ? { subjectId: values.get("subjectId") } : {}) };
    try { const response = await fetch("/api/v1/assignments", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage("Assignment saved and audited."); await load(); router.refresh(); form.reset(); }
    catch (error) { setMessage(error instanceof Error ? error.message : "Could not save assignment"); } finally { setBusy(false); }
  }
  if (!data) return <p className="mt-6 rounded-xl bg-white p-5">{message || "Loading assignments…"}</p>;
  const defaultYear = data.years.find((year) => year.isCurrent)?.id ?? data.years[0]?.id ?? "";
  const classYearId = classYear || defaultYear;
  const subjectYearId = subjectYear || defaultYear;
  const classSections = data.sections.filter((section) => section.academicYearId === classYearId);
  const subjectSections = data.sections.filter((section) => section.academicYearId === subjectYearId);
  const selectedClassSection = classSections.some((section) => section.id === classSection) ? classSection : classSections[0]?.id || "";
  const selectedSubjectSection = subjectSections.some((section) => section.id === subjectSection) ? subjectSection : subjectSections[0]?.id || "";
  const subjectIds = data.sectionSubjects.find((item) => item.sectionId === selectedSubjectSection)?.subjectIds ?? [];
  return <>
    <div className="mt-6 grid gap-5 lg:grid-cols-2">
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Class teacher</h2><p className="mt-1 text-sm text-slate-600">A teacher can lead one section per academic year.</p><form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget, "classTeacher"); }}>
        <label>Academic year<select name="yearId" required value={classYearId} onChange={(event) => setClassYear(event.target.value)} className={`${input} mt-1`}>{data.years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select></label>
        <label>Section<select name="sectionId" required value={selectedClassSection} onChange={(event) => setClassSection(event.target.value)} className={`${input} mt-1`}>{classSections.map((section) => <option key={section.id} value={section.id}>{section.classLevel.name} · {section.name} · {section.academicYear.label}</option>)}</select></label>
        <label>Teacher<select name="teacherId" required className={`${input} mt-1`}>{data.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <button disabled={busy || !data.staff.length || !data.sections.length} className="min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white">Save class teacher</button>
      </form><ul className="mt-5 divide-y">{data.classTeachers.map((row) => <li key={row.id} className="py-3 text-sm"><b>{row.section.classLevel.name} · {row.section.name}</b><span className="text-slate-600"> · {row.staff.name} · {row.section.academicYear.label}{row.deletedAt ? ` · previous, ended ${row.deletedAt.slice(0, 10)}` : " · current"}</span></li>)}</ul></section>
      <section className="rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Subject teacher</h2><p className="mt-1 text-sm text-slate-600">Timetable subject choices inherit this assignment automatically.</p><form className="mt-4 grid gap-3" onSubmit={(event) => { event.preventDefault(); void save(event.currentTarget, "subjectTeacher"); }}>
        <label>Academic year<select name="yearId" required value={subjectYearId} onChange={(event) => setSubjectYear(event.target.value)} className={`${input} mt-1`}>{data.years.map((year) => <option key={year.id} value={year.id}>{year.label}</option>)}</select></label>
        <label>Section<select name="sectionId" required value={selectedSubjectSection} onChange={(event) => setSubjectSection(event.target.value)} className={`${input} mt-1`}>{subjectSections.map((section) => <option key={section.id} value={section.id}>{section.classLevel.name} · {section.name} · {section.academicYear.label}</option>)}</select></label>
        <label>Subject<select name="subjectId" required className={`${input} mt-1`}>{data.subjects.filter((subject) => subjectIds.includes(subject.id)).map((subject) => <option key={subject.id} value={subject.id}>{subject.name}</option>)}</select></label>
        <label>Teacher<select name="teacherId" required className={`${input} mt-1`}>{data.staff.map((person) => <option key={person.id} value={person.id}>{person.name}</option>)}</select></label>
        <button disabled={busy || !data.staff.length || !data.sections.length || !data.subjects.length} className="min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white">Save subject teacher</button>
      </form><ul className="mt-5 divide-y">{data.subjectTeachers.map((row) => <li key={row.id} className="py-3 text-sm"><b>{row.subject.name}</b><span className="text-slate-600"> · {row.staff.name} · {row.section.classLevel.name} {row.section.name} · {row.section.academicYear.label}{row.deletedAt ? ` · previous, ended ${row.deletedAt.slice(0, 10)}` : " · current"}</span></li>)}</ul></section>
    </div>
    <p aria-live="polite" className="mt-4 text-sm text-slate-700">{message}</p>
  </>;
}
