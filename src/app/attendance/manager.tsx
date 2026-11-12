"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type Student = { id: string; admissionNo: string; fullName: string };
type AttendanceItem = { section: { id: string; name: string; classLevel: { name: string }; academicYear: { label: string } }; submission: null | { id: string; submittedAt: string; submittedBy: { name: string }; records: Array<{ id: string; studentId: string; status: "ABSENT" | "LATE"; lateReason: string | null; arrivalAt: string | null }> }; students: Student[]; status: "SUBMITTED" | "NOT_SUBMITTED" | "HOLIDAY" };
type ResponseData = { date: string; holiday: { reason: string } | null; attendance: AttendanceItem[] };
type Draft = { key: string; absentStudentIds: string[]; savedAt: string };
const storageKey = (userId: string, date: string, sectionId: string) => `school-erp-attendance:${userId}:${date}:${sectionId}`;
const todayInIndia = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);

export function AttendanceManager({ userId, activeRole, canManageLate }: { userId: string; activeRole: string; canManageLate: boolean }) {
  const [date, setDate] = useState(todayInIndia());
  const [data, setData] = useState<ResponseData | null>(null);
  const [sectionId, setSectionId] = useState("");
  const [absentIds, setAbsentIds] = useState<string[]>([]);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [online, setOnline] = useState(true);
  const selected = useMemo(() => data?.attendance.find((item) => item.section.id === sectionId) ?? null, [data, sectionId]);
  const teacherOnly = ["Class Teacher", "Substitute"].includes(activeRole);

  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    update(); window.addEventListener("online", update); window.addEventListener("offline", update);
    return () => { window.removeEventListener("online", update); window.removeEventListener("offline", update); };
  }, []);

  const load = useCallback(async (signal?: AbortSignal) => {
    const response = await fetch(`/api/v1/attendance?date=${encodeURIComponent(date)}`, { signal, cache: "no-store" });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error ?? "Could not load attendance");
    setError("");
    setData(result);
    setSectionId((current) => result.attendance.some((item: AttendanceItem) => item.section.id === current) ? current : result.attendance[0]?.section.id ?? "");
  }, [date]);

  useEffect(() => {
    const controller = new AbortController();
    void fetch(`/api/v1/attendance?date=${encodeURIComponent(date)}`, { signal: controller.signal, cache: "no-store" })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error ?? "Could not load attendance"); return result as ResponseData; })
      .then((result) => { setError(""); setData(result); setSectionId((current) => result.attendance.some((item) => item.section.id === current) ? current : result.attendance[0]?.section.id ?? ""); })
      .catch((reason: unknown) => { if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "Could not load attendance"); });
    return () => controller.abort();
  }, [date]);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!selected || !teacherOnly || selected.status === "SUBMITTED") { setDraft(null); setAbsentIds([]); return; }
      const key = storageKey(userId, date, selected.section.id);
      if (selected.status === "HOLIDAY") { window.localStorage.removeItem(key); setDraft(null); setAbsentIds([]); setNotice("This device's unsent attendance draft was cleared because the school is closed."); return; }
      const raw = window.localStorage.getItem(key);
      if (!raw) { setDraft(null); setAbsentIds([]); return; }
      try { const value = JSON.parse(raw) as Draft; setDraft(value); setAbsentIds(value.absentStudentIds); }
      catch { window.localStorage.removeItem(key); setDraft(null); setAbsentIds([]); }
    }, 0);
    return () => window.clearTimeout(timer);
  }, [selected, userId, date, teacherOnly]);

  const saveOfflineDraft = useCallback((item: AttendanceItem, ids: string[], key = crypto.randomUUID()) => {
    const value = { key, absentStudentIds: ids, savedAt: new Date().toISOString() };
    window.localStorage.setItem(storageKey(userId, date, item.section.id), JSON.stringify(value));
    setDraft(value);
    setNotice("Saved on this device. Only this signed-in teacher can see the draft; it has not been sent to parents.");
  }, [date, userId]);

  const syncDraft = useCallback(async (item = selected, currentDraft = draft) => {
    if (!item || !currentDraft) return;
    setBusy(true); setNotice(""); setError("");
    try {
      const response = await fetch("/api/v1/attendance", { method: "POST", headers: { "content-type": "application/json", "idempotency-key": currentDraft.key }, body: JSON.stringify({ sectionId: item.section.id, date, absentStudentIds: currentDraft.absentStudentIds }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not sync attendance");
      window.localStorage.removeItem(storageKey(userId, date, item.section.id));
      setDraft(null); setAbsentIds([]); setConfirming(false); setNotice("Attendance synced. Bilingual in-app updates are queued for the linked guardians.");
      await load();
    } catch (reason) {
      if (!navigator.onLine || reason instanceof TypeError) saveOfflineDraft(item, currentDraft.absentStudentIds, currentDraft.key);
      else setError(reason instanceof Error ? reason.message : "Could not sync attendance");
    } finally { setBusy(false); }
  }, [date, draft, load, saveOfflineDraft, selected, userId]);

  useEffect(() => {
    if (!draft || selected?.status === "SUBMITTED") return;
    const online = () => { if (selected) void syncDraft(selected, draft); };
    window.addEventListener("online", online);
    return () => window.removeEventListener("online", online);
  }, [draft, selected, syncDraft]);

  function toggleAbsent(studentId: string) {
    setAbsentIds((ids) => ids.includes(studentId) ? ids.filter((id) => id !== studentId) : [...ids, studentId]);
  }

  function saveAndSubmit() {
    if (!selected) return;
    if (!online) { saveOfflineDraft(selected, absentIds); setConfirming(false); return; }
    const nextDraft = { key: crypto.randomUUID(), absentStudentIds: absentIds, savedAt: new Date().toISOString() };
    void syncDraft(selected, nextDraft);
  }

  return <>
    <div className="mt-6 grid gap-4 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
      <label className="block text-sm font-semibold">Attendance date<input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="mt-1 min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3 text-base" /></label>
      <div className={`rounded-xl px-4 py-3 text-sm font-semibold ${!online ? "bg-amber-100 text-amber-950" : "bg-emerald-100 text-emerald-950"}`} aria-live="polite">{!online ? "Offline · drafts stay on this device" : "Online · ready to sync"}</div>
    </div>
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-red-900">{error}</p>}
    {notice && <p role="status" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-emerald-950">{notice}</p>}
    {!data && !error && <p role="status" aria-busy="true" className="mt-4 rounded-xl border bg-white p-5 text-slate-700">Loading attendance…</p>}
    {data?.holiday && <p className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4 text-amber-950">School holiday: {data.holiday.reason}. Attendance is not expected.</p>}
    {!error && data && data.attendance.length === 0 && <p className="mt-4 rounded-xl border bg-white p-5 text-slate-700">No sections are assigned to this account for attendance on this date.</p>}
    {data && data.attendance.length > 0 && <div className="mt-5 grid gap-5 lg:grid-cols-[260px_minmax(0,1fr)]">
      <nav aria-label="Sections" className="grid content-start gap-2">
        {data.attendance.map((item) => <button key={item.section.id} onClick={() => setSectionId(item.section.id)} className={`min-h-14 rounded-xl border px-4 py-3 text-left ${sectionId === item.section.id ? "border-emerald-900 bg-emerald-50" : "border-slate-200 bg-white"}`}>
          <span className="block font-semibold">{item.section.classLevel.name} · {item.section.name}</span><span className="mt-1 block text-sm text-slate-600">{item.status === "SUBMITTED" ? "Submitted" : item.status === "HOLIDAY" ? "Holiday" : "Not marked yet"}</span>
        </button>)}
      </nav>
      {selected && <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
        <div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-sm text-slate-600">{selected.section.academicYear.label}</p><h2 className="text-xl font-bold">{selected.section.classLevel.name} · {selected.section.name}</h2></div><span className="rounded-full bg-slate-100 px-3 py-2 text-sm font-semibold">{selected.status === "SUBMITTED" ? "Submitted" : selected.status === "HOLIDAY" ? "Holiday" : "Not marked yet"}</span></div>
        {selected.status === "HOLIDAY" ? <p className="mt-4 rounded-xl bg-amber-50 p-4 text-amber-950">Attendance is not expected for this section on a school holiday.</p> : selected.status === "SUBMITTED" ? <><p className="mt-3 text-sm text-slate-600">Submitted by {selected.submission?.submittedBy.name}. Only the absentees are listed below.</p><ul className="mt-3 divide-y">{selected.submission?.records.map((record) => { const student = selected.students.find((value) => value.id === record.studentId); return <li key={record.studentId} className="py-3"><b>{student?.fullName}</b><span className="ml-2 rounded-full bg-amber-100 px-2 py-1 text-sm">{record.status === "LATE" ? "Late" : "Absent"}</span>{record.status === "LATE" && record.arrivalAt && <p className="mt-1 text-sm text-slate-600">Arrived {new Date(record.arrivalAt).toLocaleTimeString("en-IN", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit" })} · {record.lateReason}</p>}{canManageLate && record.status === "ABSENT" && <LateButton recordId={record.id} date={date} onSaved={() => void load()} />}</li>; })}</ul>{selected.submission?.records.length === 0 && <p className="mt-4 rounded-xl bg-emerald-50 p-4 text-emerald-950">No absentees were recorded for this section.</p>}</> : <>
          {teacherOnly && <p className="mt-3 text-sm text-slate-600">Roster starts as present. Tap only the students who are absent.</p>}
          <ul className="mt-3 divide-y">{selected.students.map((student) => { const absent = absentIds.includes(student.id); const submittedRecord = selected.submission?.records.find((record) => record.studentId === student.id); return <li key={student.id} className="flex min-h-16 items-center justify-between gap-3 py-2"><div><p className="font-semibold">{student.fullName}</p><p className="text-xs text-slate-500">{student.admissionNo}</p></div>{teacherOnly && <button type="button" disabled={Boolean(selected.submission) || Boolean(data.holiday)} onClick={() => toggleAbsent(student.id)} aria-pressed={absent} className={`min-h-12 min-w-28 rounded-xl border px-4 font-semibold ${absent ? "border-amber-500 bg-amber-50 text-amber-950" : "border-slate-300 bg-white"}`}>{absent ? "Absent" : "Present"}</button>}{!teacherOnly && submittedRecord && <span className="font-semibold">{submittedRecord.status}</span>}</li>; })}</ul>
          {teacherOnly && <div className="sticky bottom-3 mt-5 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-lg backdrop-blur"><div className="flex items-center justify-between gap-3"><p className="font-semibold">{absentIds.length} absent</p><button disabled={busy || Boolean(data.holiday)} onClick={() => setConfirming(true)} className="min-h-12 rounded-xl bg-emerald-900 px-5 font-semibold text-white disabled:opacity-50">Review & submit</button></div>{draft && <div className="mt-2 flex items-center justify-between gap-3 text-sm"><span>Offline draft · saved on this device</span><button disabled={busy || !online} onClick={() => void syncDraft()} className="min-h-10 rounded-lg border px-3 font-semibold">Sync now</button></div>}</div>}
        </>}
      </section>}
    </div>}
    {confirming && selected && <div role="dialog" aria-modal="true" aria-labelledby="attendance-confirm-title" className="fixed inset-0 z-50 flex items-end justify-center bg-slate-950/50 p-0 sm:items-center sm:p-4"><section className="w-full max-w-lg rounded-t-3xl bg-white p-5 pb-8 sm:rounded-3xl"><h2 id="attendance-confirm-title" className="text-xl font-bold">Review attendance</h2><p className="mt-2">{absentIds.length ? `These ${absentIds.length} students will be marked absent. Bilingual in-app updates will be queued for their linked guardians after submission.` : "No absentees are selected. Submitting will mark this section's attendance complete without parent absence updates."}</p><ul className="mt-3 max-h-48 overflow-auto divide-y">{selected.students.filter((student) => absentIds.includes(student.id)).map((student) => <li key={student.id} className="py-2 font-medium">{student.fullName}</li>)}</ul><div className="mt-5 grid grid-cols-2 gap-3"><button onClick={() => setConfirming(false)} className="min-h-12 rounded-xl border font-semibold">Go back</button><button disabled={busy} onClick={saveAndSubmit} className="min-h-12 rounded-xl bg-emerald-900 font-semibold text-white">{busy ? "Saving…" : "Confirm submission"}</button></div></section></div>}
  </>;
}

function LateButton({ recordId, date, onSaved }: { recordId: string; date: string; onSaved: () => void }) {
  const [open, setOpen] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  if (!open) return <button onClick={() => setOpen(true)} className="mt-2 min-h-10 rounded-lg border px-3 text-sm font-semibold">Mark late</button>;
  return <form className="mt-3 grid gap-2 rounded-xl bg-slate-50 p-3 sm:grid-cols-2" onSubmit={async (event) => { event.preventDefault(); const values = new FormData(event.currentTarget); const [hour, minute] = String(values.get("arrivalAt")).split(":").map(Number); const arrivalAt = new Date(`${date}T${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:00+05:30`); setBusy(true); setError(""); try { const response = await fetch("/api/v1/attendance/late", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ recordId, reason: values.get("reason"), arrivalAt: arrivalAt.toISOString() }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setOpen(false); onSaved(); } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not record the late arrival"); } finally { setBusy(false); } }}><label className="text-sm">Arrival time<input name="arrivalAt" type="time" required className="mt-1 min-h-12 w-full rounded-lg border bg-white px-2" /></label><label className="text-sm">Reason<input name="reason" minLength={3} maxLength={240} required className="mt-1 min-h-12 w-full rounded-lg border bg-white px-2" /></label>{error && <p role="alert" className="text-sm text-red-800 sm:col-span-2">{error}</p>}<button disabled={busy} className="min-h-11 rounded-lg bg-emerald-900 px-3 text-sm font-semibold text-white sm:col-span-2">{busy ? "Saving…" : "Save late arrival"}</button></form>;
}
