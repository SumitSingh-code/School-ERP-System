"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";

type Entry = { id: string; sectionId: string; dayOfWeek: number; period: number; subjectId: string | null; teacherId: string | null; label: string | null; version: number; subject: { name: string } | null; teacher: { name: string } | null };
type Layout = { periods: { period: number; start: string; end: string }[]; breaks: { afterPeriod: number; label: string; start: string; end: string }[] };
type Payload = { years: { id: string; label: string; isCurrent: boolean }[]; sections: { id: string; name: string; academicYearId: string; classLevel: { name: string }; academicYear: { label: string } }[]; subjects: { id: string; name: string }[]; assignments: { sectionId: string; subjectId: string; staff: { id: string; name: string } }[]; entries: Entry[]; settings: { id: string; workingDays: number[]; periodLayout: unknown; attendanceCutoff?: string; attendanceEscalationMinutes?: number } | null };
const days = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const field = "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-2 text-sm";

export function TimetableManager({ canManage }: { canManage: boolean }) {
  const router = useRouter();
  const [data, setData] = useState<Payload | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [day, setDay] = useState(1);
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() { const response = await fetch("/api/v1/timetable"); const result = await response.json(); if (!response.ok) throw new Error(result.error); setData(result); const year = result.years.find((item: Payload["years"][number]) => item.isCurrent) ?? result.years[0]; const first = result.sections.find((item: Payload["sections"][number]) => item.academicYearId === year?.id); setSectionId((current) => current || first?.id || ""); }
  useEffect(() => {
    let active = true;
    void fetch("/api/v1/timetable").then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; }).then((result) => {
      if (!active) return;
      setData(result);
      const year = result.years.find((item: Payload["years"][number]) => item.isCurrent) ?? result.years[0];
      const first = result.sections.find((item: Payload["sections"][number]) => item.academicYearId === year?.id);
      setSectionId((current) => current || first?.id || "");
    }).catch((error: unknown) => { if (active) setNotice(error instanceof Error ? error.message : "Could not load timetable"); });
    return () => { active = false; };
  }, []);
  const section = data?.sections.find((item) => item.id === sectionId);
  const workingDays = data?.settings?.workingDays ?? [1, 2, 3, 4, 5, 6];
  const selectedEntries = useMemo(() => new Map((data?.entries ?? []).filter((entry) => entry.sectionId === sectionId && entry.dayOfWeek === day).map((entry) => [entry.period, entry])), [data, sectionId, day]);
  const subjectAssignments = (data?.assignments ?? []).filter((item) => item.sectionId === sectionId);
  async function save(period: number, form: HTMLFormElement) {
    if (!canManage || !section) return;
    setBusy(true); setNotice("");
    const values = new FormData(form); const existing = selectedEntries.get(period);
    const subjectId = String(values.get("subjectId") ?? ""); const label = String(values.get("label") ?? "").trim();
    const body = { sectionId: section.id, dayOfWeek: day, period, subjectId: subjectId || null, label: subjectId ? null : (label || null), ...(existing ? { id: existing.id, version: existing.version } : {}) };
    try { const response = await fetch("/api/v1/timetable", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setNotice(`Period ${period} saved. Teacher: ${result.entry.teacherId ? data?.assignments.find((a) => a.sectionId === section.id && a.subjectId === subjectId)?.staff.name ?? "assigned" : "none"}.`); await load(); router.refresh(); }
    catch (error) { setNotice(error instanceof Error ? error.message : "Could not save this period"); } finally { setBusy(false); }
  }
  async function remove(entry: Entry) { setBusy(true); try { const response = await fetch("/api/v1/timetable", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: entry.id, version: entry.version }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setNotice("Period cleared and change audited."); await load(); } catch (error) { setNotice(error instanceof Error ? error.message : "Could not clear the period"); } finally { setBusy(false); } }
  if (!data) return <p className="mt-6 rounded-xl bg-white p-5">{notice || "Loading timetable…"}</p>;
  const layout = data.settings?.periodLayout && typeof data.settings.periodLayout === "object" && "periods" in data.settings.periodLayout ? data.settings.periodLayout as Layout : defaultLayout();
  return <>
    <section className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 shadow-sm sm:grid-cols-2"><label className="font-medium">Section<select value={sectionId} onChange={(event) => setSectionId(event.target.value)} className={`${field} mt-1`}>{data.sections.map((item) => <option key={item.id} value={item.id}>{item.classLevel.name} · {item.name} · {item.academicYear.label}</option>)}</select></label><label className="font-medium">Day<select value={day} onChange={(event) => setDay(Number(event.target.value))} className={`${field} mt-1`}>{days.map((name, index) => <option key={name} value={index} disabled={!workingDays.includes(index)}>{name}{workingDays.includes(index) ? "" : " · Off"}</option>)}</select></label></section>
    {!section ? <p className="mt-5 rounded-xl bg-white p-5">Create an academic year and section before building a timetable.</p> : !workingDays.includes(day) ? <p className="mt-5 rounded-xl bg-white p-5">{days[day]} is currently a non-working day.</p> : <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">{section.classLevel.name} · {section.name} · {days[day]}</h2><ul className="mt-4 divide-y">{Array.from({ length: 8 }, (_, index) => index + 1).map((period) => { const entry = selectedEntries.get(period); const assigned = subjectAssignments; return <li key={period} className="grid gap-2 py-3 sm:grid-cols-[7rem_1fr_10rem_auto] sm:items-center"><div className="font-semibold">Period {period}<span className="block text-xs font-normal text-slate-500">{layout.periods?.[period - 1]?.start ?? ""} – {layout.periods?.[period - 1]?.end ?? ""}</span></div><form className="contents" onSubmit={(event) => { event.preventDefault(); void save(period, event.currentTarget); }}><select name="subjectId" defaultValue={entry?.subjectId ?? ""} disabled={!canManage} className={field}><option value="">Other / free period</option>{assigned.map((assignment) => { const subject = data.subjects.find((item) => item.id === assignment.subjectId); return subject ? <option key={subject.id} value={subject.id}>{subject.name} · {assignment.staff.name}</option> : null; })}</select><input name="label" defaultValue={entry?.label ?? ""} disabled={!canManage || Boolean(entry?.subjectId)} placeholder="Assembly, Games, Library…" className={field} />{canManage && <button disabled={busy} className="min-h-11 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white">Save</button>}</form>{entry && <div className="text-xs text-slate-600 sm:col-start-2">Current: {entry.subject?.name ?? entry.label} {entry.teacher?.name ? `· ${entry.teacher.name}` : ""} · version {entry.version}{canManage && <button type="button" disabled={busy} onClick={() => void remove(entry)} className="ml-2 min-h-9 rounded-lg border px-2">Clear</button>}</div>}</li>; })}</ul></section>}
    {canManage && <ScheduleSettingsEditor key={data.settings?.id ?? "defaults"} initial={data.settings} onSaved={async () => { await load(); setNotice("School week and period times saved."); }} />}
    {canManage && <SharedLessonEditor sections={data.sections} subjects={data.subjects} workingDays={workingDays} onSaved={async () => { await load(); setNotice("Shared lesson created for all selected sections."); }} />}
    <p aria-live="polite" className="mt-4 text-sm text-slate-700">{notice}{!canManage && " · View only for this role."}</p>
  </>;
}

function defaultLayout(): Layout {
  const periods = Array.from({ length: 8 }, (_, index) => {
    const start = 8 * 60 + index * 50;
    const format = (value: number) => `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
    return { period: index + 1, start: format(start), end: format(start + 45) };
  });
  return { periods, breaks: [] };
}

function SharedLessonEditor({ sections, subjects, workingDays, onSaved }: { sections: Payload["sections"]; subjects: Payload["subjects"]; workingDays: number[]; onSaved: () => Promise<void> }) {
  const [sectionIds, setSectionIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  async function submit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setMessage("");
    const form = event.currentTarget;
    const values = new FormData(form);
    try {
      const response = await fetch("/api/v1/timetable/shared", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ sectionIds, dayOfWeek: Number(values.get("dayOfWeek")), period: Number(values.get("period")), subjectId: values.get("subjectId"), label: values.get("label") }) });
      const result = await response.json(); if (!response.ok) throw new Error(result.error);
      setSectionIds([]); form.reset(); await onSaved(); setMessage("Shared lesson saved and audited.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not create the shared lesson"); }
    finally { setBusy(false); }
  }
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Combined lesson across sections</h2><p className="mt-1 text-sm text-slate-600">Use when the same teacher intentionally teaches the same subject to several sections together.</p><form className="mt-4 grid gap-3 sm:grid-cols-2" onSubmit={(event) => void submit(event)}><fieldset className="rounded-xl border p-3 sm:row-span-3"><legend className="px-1 font-medium">Select sections (at least two)</legend><div className="max-h-56 space-y-2 overflow-auto">{sections.map((item) => <label key={item.id} className="flex min-h-10 items-center gap-2 text-sm"><input type="checkbox" checked={sectionIds.includes(item.id)} onChange={(event) => setSectionIds((current) => event.target.checked ? [...current, item.id] : current.filter((id) => id !== item.id))} />{item.classLevel.name} · {item.name} · {item.academicYear.label}</label>)}</div></fieldset><label className="font-medium">Subject<select name="subjectId" required className={`${field} mt-1`}>{subjects.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label><label className="font-medium">Day<select name="dayOfWeek" required className={`${field} mt-1`}>{days.map((name, index) => workingDays.includes(index) ? <option key={name} value={index}>{name}</option> : null)}</select></label><label className="font-medium">Period<input name="period" type="number" min={1} max={8} defaultValue={1} required className={`${field} mt-1`} /></label><label className="font-medium">Shared lesson label<input name="label" minLength={2} maxLength={80} defaultValue="Combined lesson" required className={`${field} mt-1`} /></label><button disabled={busy || sectionIds.length < 2} className="min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white">Create combined lesson</button></form><p aria-live="polite" className="mt-3 text-sm">{message}</p></section>;
}

function ScheduleSettingsEditor({ initial, onSaved }: { initial: Payload["settings"]; onSaved: () => Promise<void> }) {
  const stored = initial?.periodLayout && typeof initial.periodLayout === "object" && "periods" in initial.periodLayout ? initial.periodLayout as Layout : defaultLayout();
  const [workingDays, setWorkingDays] = useState(initial?.workingDays ?? [1, 2, 3, 4, 5, 6]);
  const [periods, setPeriods] = useState(stored.periods?.length === 8 ? stored.periods : defaultLayout().periods);
  const [breaks, setBreaks] = useState(stored.breaks ?? []);
  const [attendanceCutoff, setAttendanceCutoff] = useState(initial?.attendanceCutoff ?? "10:00");
  const [attendanceEscalationMinutes, setAttendanceEscalationMinutes] = useState(initial?.attendanceEscalationMinutes ?? 30);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState("");
  const updatePeriod = (index: number, key: "start" | "end", value: string) => setPeriods((current) => current.map((period, row) => row === index ? { ...period, [key]: value } : period));
  const save = async () => {
    setSaving(true); setMessage("");
    try {
      const response = await fetch("/api/v1/schedule-settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify({ workingDays, periods, breaks, attendanceCutoff, attendanceEscalationMinutes }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      await onSaved(); setMessage("Saved.");
    } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save schedule settings"); }
    finally { setSaving(false); }
  };
  return <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm">
    <h2 className="text-xl font-bold">School week and period times</h2><p className="mt-1 text-sm text-slate-600">Sunday starts as a weekly off day. Saturdays work unless disabled here. Attendance reminders use India time.</p>
    <div className="mt-3 flex flex-wrap gap-2">{days.map((name, index) => <label key={name} className="inline-flex min-h-10 items-center gap-2 rounded-lg border px-3 text-sm"><input type="checkbox" checked={workingDays.includes(index)} onChange={(event) => setWorkingDays((current) => event.target.checked ? [...current, index].sort() : current.filter((item) => item !== index))} />{name.slice(0, 3)}</label>)}</div>
    <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{periods.map((period, index) => <fieldset key={period.period} className="grid grid-cols-2 gap-2 rounded-xl border p-3"><legend className="px-1 text-sm font-semibold">Period {period.period}</legend><input aria-label={`Period ${period.period} starts`} type="time" value={period.start} onChange={(event) => updatePeriod(index, "start", event.target.value)} className={field} /><input aria-label={`Period ${period.period} ends`} type="time" value={period.end} onChange={(event) => updatePeriod(index, "end", event.target.value)} className={field} /></fieldset>)}</div>
    <div className="mt-4"><h3 className="font-semibold">Breaks</h3>{breaks.map((item, index) => <div key={`${item.afterPeriod}-${index}`} className="mt-2 grid gap-2 sm:grid-cols-4"><input aria-label="Break name" value={item.label} onChange={(event) => setBreaks((current) => current.map((value, row) => row === index ? { ...value, label: event.target.value } : value))} className={field} /><select aria-label="Break after period" value={item.afterPeriod} onChange={(event) => setBreaks((current) => current.map((value, row) => row === index ? { ...value, afterPeriod: Number(event.target.value) } : value))} className={field}>{Array.from({ length: 9 }, (_, afterPeriod) => <option key={afterPeriod} value={afterPeriod}>After period {afterPeriod}</option>)}</select><input aria-label="Break starts" type="time" value={item.start} onChange={(event) => setBreaks((current) => current.map((value, row) => row === index ? { ...value, start: event.target.value } : value))} className={field} /><div className="flex gap-2"><input aria-label="Break ends" type="time" value={item.end} onChange={(event) => setBreaks((current) => current.map((value, row) => row === index ? { ...value, end: event.target.value } : value))} className={field} /><button type="button" onClick={() => setBreaks((current) => current.filter((_, row) => row !== index))} className="rounded-lg border px-3">×</button></div></div>)}<button type="button" onClick={() => setBreaks((current) => [...current, { afterPeriod: 2, label: "Break", start: "10:00", end: "10:15" }])} className="mt-2 min-h-10 rounded-lg border px-3 text-sm font-medium">Add break</button></div>
    <div className="mt-4 grid gap-3 sm:grid-cols-2"><label className="text-sm font-medium">Attendance reminder cutoff (IST)<input type="time" value={attendanceCutoff} onChange={(event) => setAttendanceCutoff(event.target.value)} className={`${field} mt-1`} /></label><label className="text-sm font-medium">Escalate to Principal after (minutes)<input type="number" min={5} max={240} step={5} value={attendanceEscalationMinutes} onChange={(event) => setAttendanceEscalationMinutes(Number(event.target.value))} className={`${field} mt-1`} /></label></div>
    <button disabled={saving} onClick={() => void save()} className="mt-4 min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white">Save school schedule</button><span aria-live="polite" className="ml-3 text-sm">{message}</span>
  </section>;
}

