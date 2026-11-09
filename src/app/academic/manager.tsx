"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type AcademicData = {
  years: { id: string; label: string; startsOn: string; endsOn: string; isCurrent: boolean }[];
  classes: { id: string; name: string; sortOrder: number; active: boolean }[];
  streams: { id: string; classLevelId: string; name: string; active: boolean }[];
  groups: { id: string; streamId: string; name: string; active: boolean }[];
  subjects: { id: string; name: string; code: string; optional: boolean; active: boolean; assignedTo: string[] }[];
  sections: { id: string; name: string; active: boolean; className: string; streamName: string | null; groupName: string | null; academicYear: string; students: number }[];
};

const fieldClass = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base";
const buttonClass = "min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white disabled:opacity-50";

export function AcademicManager({ initial }: { initial: AcademicData }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [streamClass, setStreamClass] = useState(initial.classes.find((item) => item.name === "11")?.id ?? initial.classes[0]?.id ?? "");
  const [subjectClass, setSubjectClass] = useState(initial.classes[0]?.id ?? "");
  const [subjectStream, setSubjectStream] = useState("");
  const [subjectGroup, setSubjectGroup] = useState("");
  const [sectionClass, setSectionClass] = useState(initial.classes[0]?.id ?? "");
  const [sectionStream, setSectionStream] = useState("");
  const [sectionGroup, setSectionGroup] = useState("");
  const [groupStream, setGroupStream] = useState("");

  const subjectStreams = useMemo(() => initial.streams.filter((item) => item.classLevelId === subjectClass && item.active), [initial.streams, subjectClass]);
  const sectionStreams = useMemo(() => initial.streams.filter((item) => item.classLevelId === sectionClass && item.active), [initial.streams, sectionClass]);
  const selectedSubjectStream = initial.streams.find((item) => item.id === subjectStream);
  const selectedSectionStream = initial.streams.find((item) => item.id === sectionStream);
  const subjectGroups = initial.groups.filter((item) => item.streamId === subjectStream && item.active);
  const sectionGroups = initial.groups.filter((item) => item.streamId === sectionStream && item.active);

  async function save(body: Record<string, unknown>, form?: HTMLFormElement) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/academic", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not save this record");
      form?.reset();
      setNotice("Saved. The academic list is up to date.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not save this record");
    } finally {
      setBusy(false);
    }
  }

  async function change(resource: string, id: string, changes: Record<string, unknown>) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/v1/academic", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ resource, id, ...changes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not update this record");
      setNotice("Updated.");
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update this record");
    } finally {
      setBusy(false);
    }
  }

  function formSubmit(action: string, convert: (data: FormData) => Record<string, unknown>) {
    return (event: React.FormEvent<HTMLFormElement>) => {
      event.preventDefault();
      const form = event.currentTarget;
      const data = new FormData(form);
      const body = { action, ...convert(data) };
      void save(body, form);
    };
  }

  return <>
    <div className="mt-6 grid gap-4 lg:grid-cols-2">
      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Academic years</h2>
        <p className="mt-1 text-sm text-slate-600">Each section and roster belongs to one school year.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={formSubmit("createYear", (data) => ({ label: String(data.get("label") ?? ""), startsOn: String(data.get("startsOn") ?? ""), endsOn: String(data.get("endsOn") ?? ""), isCurrent: data.get("isCurrent") === "on" }))}>
          <label className="text-sm font-medium">Label<input name="label" required maxLength={12} placeholder="2026-27" className={`${fieldClass} mt-1`} /></label>
          <label className="flex min-h-12 items-center gap-2 self-end rounded-xl border border-slate-300 px-3 text-sm font-medium"><input name="isCurrent" type="checkbox" className="size-5 accent-emerald-900" />Make current year</label>
          <label className="text-sm font-medium">Starts<input name="startsOn" type="date" required className={`${fieldClass} mt-1`} /></label>
          <label className="text-sm font-medium">Ends<input name="endsOn" type="date" required className={`${fieldClass} mt-1`} /></label>
          <button disabled={busy} className={`${buttonClass} sm:col-span-2`}>Add academic year</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">
          {initial.years.length ? initial.years.map((year) => <li key={year.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{year.label}</p><p className="text-sm text-slate-600">{year.startsOn} to {year.endsOn}</p></div><div className="flex items-center gap-2">{year.isCurrent ? <span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-bold text-emerald-950">Current</span> : <button type="button" disabled={busy} onClick={() => void change("year", year.id, { isCurrent: true })} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">Make current</button>}<button type="button" disabled={busy} onClick={() => { const label = window.prompt("Academic year label", year.label); if (label?.trim()) void change("year", year.id, { name: label.trim() }); }} className="min-h-11 rounded-xl border px-3 text-sm font-semibold">Rename</button></div></li>) : <li className="py-3 text-sm text-slate-500">No academic years yet.</li>}
        </ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Classes, streams and groups</h2>
        <p className="mt-1 text-sm text-slate-600">Names and ordering can be changed without code.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_9rem_auto]" onSubmit={formSubmit("createClass", (data) => ({ name: String(data.get("name") ?? ""), sortOrder: Number(data.get("sortOrder") ?? 1) }))}>
          <label className="text-sm font-medium">Class name<input name="name" required maxLength={30} placeholder="Class 6" className={`${fieldClass} mt-1`} /></label>
          <label className="text-sm font-medium">Order<input name="sortOrder" type="number" min={1} max={99} defaultValue={initial.classes.length + 1} className={`${fieldClass} mt-1`} /></label>
          <button disabled={busy} className={`${buttonClass} self-end`}>Add class</button>
        </form>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={formSubmit("createStream", (data) => ({ classLevelId: String(data.get("classLevelId") ?? ""), name: String(data.get("name") ?? "") }))}>
          <label className="text-sm font-medium">For class<select name="classLevelId" value={streamClass} onChange={(event) => setStreamClass(event.target.value)} required className={`${fieldClass} mt-1`}>{initial.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-sm font-medium">Stream name<input name="name" required maxLength={40} placeholder="Science" className={`${fieldClass} mt-1`} /></label>
          <button disabled={busy} className={`${buttonClass} self-end`}>Add stream</button>
        </form>
        <form className="mt-4 grid gap-3 sm:grid-cols-[1fr_1fr_auto]" onSubmit={formSubmit("createGroup", (data) => ({ streamId: String(data.get("streamId") ?? ""), name: String(data.get("name") ?? "") }))}>
          <label className="text-sm font-medium">For stream<select name="streamId" value={groupStream} onChange={(event) => setGroupStream(event.target.value)} required className={`${fieldClass} mt-1`}><option value="">Choose stream</option>{initial.streams.map((item) => <option key={item.id} value={item.id}>{initial.classes.find((level) => level.id === item.classLevelId)?.name} · {item.name}</option>)}</select></label>
          <label className="text-sm font-medium">Group name<input name="name" required maxLength={40} placeholder="PCM" className={`${fieldClass} mt-1`} /></label>
          <button disabled={busy} className={`${buttonClass} self-end`}>Add group</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">{initial.classes.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-2"><span className={`font-medium ${item.active ? "" : "text-slate-500 line-through"}`}>{item.name} · order {item.sortOrder}{!item.active ? " · inactive" : ""}</span><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { const name = window.prompt("Class name", item.name); if (name?.trim()) void change("class", item.id, { name: name.trim() }); }} className="min-h-10 rounded-lg border px-3 text-sm">Rename</button><button type="button" disabled={busy} onClick={() => void change("class", item.id, { active: !item.active })} className="min-h-10 rounded-lg border px-3 text-sm">{item.active ? "Archive" : "Restore"}</button></div></li>)}</ul>
        <div className="mt-4 grid gap-3 sm:grid-cols-2"><div><h3 className="font-semibold">Streams</h3><ul className="mt-1 divide-y divide-slate-100">{initial.streams.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className={item.active ? "" : "text-slate-500 line-through"}>{initial.classes.find((level) => level.id === item.classLevelId)?.name} · {item.name}</span><span className="flex gap-1"><button type="button" disabled={busy} onClick={() => { const name = window.prompt("Stream name", item.name); if (name?.trim()) void change("stream", item.id, { name: name.trim() }); }} className="min-h-9 rounded-lg border px-2">Rename</button><button type="button" disabled={busy} onClick={() => void change("stream", item.id, { active: !item.active })} className="min-h-9 rounded-lg border px-2">{item.active ? "Archive" : "Restore"}</button></span></li>)}</ul></div><div><h3 className="font-semibold">Groups</h3><ul className="mt-1 divide-y divide-slate-100">{initial.groups.map((item) => <li key={item.id} className="flex flex-wrap justify-between gap-2 py-2 text-sm"><span className={item.active ? "" : "text-slate-500 line-through"}>{initial.streams.find((stream) => stream.id === item.streamId)?.name} · {item.name}</span><span className="flex gap-1"><button type="button" disabled={busy} onClick={() => { const name = window.prompt("Group name", item.name); if (name?.trim()) void change("group", item.id, { name: name.trim() }); }} className="min-h-9 rounded-lg border px-2">Rename</button><button type="button" disabled={busy} onClick={() => void change("group", item.id, { active: !item.active })} className="min-h-9 rounded-lg border px-2">{item.active ? "Archive" : "Restore"}</button></span></li>)}</ul></div></div>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Subjects</h2>
        <p className="mt-1 text-sm text-slate-600">A subject can be assigned to a full class, stream or elective group.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={formSubmit("createSubject", (data) => ({ name: String(data.get("name") ?? ""), code: String(data.get("code") ?? ""), optional: data.get("optional") === "on", classLevelId: String(data.get("classLevelId") ?? ""), ...(subjectStream ? { streamId: subjectStream } : {}), ...(subjectGroup ? { groupId: subjectGroup } : {}) }))}>
          <label className="text-sm font-medium">Subject name<input name="name" required maxLength={80} placeholder="Mathematics" className={`${fieldClass} mt-1`} /></label>
          <label className="text-sm font-medium">Code<input name="code" required maxLength={24} pattern="[A-Za-z0-9-]+" placeholder="MATH" className={`${fieldClass} mt-1`} /></label>
          <label className="text-sm font-medium">Class<select name="classLevelId" value={subjectClass} onChange={(event) => { setSubjectClass(event.target.value); setSubjectStream(""); setSubjectGroup(""); }} required className={`${fieldClass} mt-1`}>{initial.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-sm font-medium">Stream<select value={subjectStream} onChange={(event) => { setSubjectStream(event.target.value); setSubjectGroup(""); }} className={`${fieldClass} mt-1`}><option value="">Whole class</option>{subjectStreams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {selectedSubjectStream?.name === "Science" && <label className="text-sm font-medium">Elective group<select value={subjectGroup} onChange={(event) => setSubjectGroup(event.target.value)} className={`${fieldClass} mt-1`}><option value="">All science groups</option>{subjectGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <label className="flex min-h-12 items-center gap-2 rounded-xl border border-slate-300 px-3 text-sm font-medium"><input name="optional" type="checkbox" className="size-5 accent-emerald-900" />Optional subject</label>
          <button disabled={busy} className={`${buttonClass} sm:col-span-2`}>Add subject</button>
        </form>
        <ul className="mt-4 max-h-80 divide-y divide-slate-100 overflow-y-auto">{initial.subjects.length ? initial.subjects.map((item) => <li key={item.id} className="py-3"><div className="flex flex-wrap items-center justify-between gap-2"><span className={`font-semibold ${item.active ? "" : "text-slate-500 line-through"}`}>{item.name}{item.optional ? " · Optional" : ""}</span><code className="text-xs text-slate-500">{item.code}</code></div><p className="mt-1 text-sm text-slate-600">{item.assignedTo.join(", ") || "Not assigned"}</p><div className="mt-2 flex gap-2"><button type="button" disabled={busy} onClick={() => { const name = window.prompt("Subject name", item.name); if (name?.trim()) void change("subject", item.id, { name: name.trim() }); }} className="min-h-10 rounded-lg border px-3 text-sm">Rename</button><button type="button" disabled={busy} onClick={() => void change("subject", item.id, { active: !item.active })} className="min-h-10 rounded-lg border px-3 text-sm">{item.active ? "Archive" : "Restore"}</button></div></li>) : <li className="py-3 text-sm text-slate-500">No subjects yet.</li>}</ul>
      </section>

      <section className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
        <h2 className="text-xl font-bold">Sections</h2>
        <p className="mt-1 text-sm text-slate-600">Create divisions within an academic year; students are assigned during roster import.</p>
        <form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={formSubmit("createSection", (data) => ({ name: String(data.get("name") ?? ""), academicYearId: String(data.get("academicYearId") ?? ""), classLevelId: String(data.get("classLevelId") ?? ""), ...(sectionStream ? { streamId: sectionStream } : {}), ...(sectionGroup ? { groupId: sectionGroup } : {}) }))}>
          <label className="text-sm font-medium">Academic year<select name="academicYearId" required className={`${fieldClass} mt-1`}>{initial.years.map((item) => <option key={item.id} value={item.id}>{item.label}{item.isCurrent ? " · Current" : ""}</option>)}</select></label>
          <label className="text-sm font-medium">Class<select name="classLevelId" value={sectionClass} onChange={(event) => { setSectionClass(event.target.value); setSectionStream(""); setSectionGroup(""); }} required className={`${fieldClass} mt-1`}>{initial.classes.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          <label className="text-sm font-medium">Stream<select value={sectionStream} onChange={(event) => { setSectionStream(event.target.value); setSectionGroup(""); }} className={`${fieldClass} mt-1`}><option value="">No stream</option>{sectionStreams.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>
          {selectedSectionStream?.name === "Science" && <label className="text-sm font-medium">Group<select value={sectionGroup} onChange={(event) => setSectionGroup(event.target.value)} className={`${fieldClass} mt-1`}><option value="">All science groups</option>{sectionGroups.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
          <label className="text-sm font-medium">Section name<input name="name" required maxLength={40} placeholder="A" className={`${fieldClass} mt-1`} /></label>
          <button disabled={busy || !initial.years.length || !initial.classes.length} className={`${buttonClass} self-end`}>Add section</button>
        </form>
        <ul className="mt-4 divide-y divide-slate-100">{initial.sections.length ? initial.sections.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-2 py-3"><div><p className={`font-semibold ${item.active ? "" : "text-slate-500 line-through"}`}>{item.className}{item.streamName ? ` · ${item.streamName}` : ""}{item.groupName ? ` ${item.groupName}` : ""} · {item.name}</p><p className="text-sm text-slate-600">{item.academicYear} · {item.students} students</p></div><div className="flex gap-2"><button type="button" disabled={busy} onClick={() => { const name = window.prompt("Section name", item.name); if (name?.trim()) void change("section", item.id, { name: name.trim() }); }} className="min-h-10 rounded-lg border px-3 text-sm">Rename</button><button type="button" disabled={busy} onClick={() => void change("section", item.id, { active: !item.active })} className="min-h-10 rounded-lg border px-3 text-sm">{item.active ? "Archive" : "Restore"}</button></div></li>) : <li className="py-3 text-sm text-slate-500">No sections yet.</li>}</ul>
      </section>
    </div>
    <div aria-live="polite" className="mt-4">{error && <p role="alert" className="rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-900">{error}</p>}{notice && <p className="rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">{notice}</p>}</div>
  </>;
}
