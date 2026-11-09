"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

type Holiday = { id: string; date: string; reason: string; type: string };
const input = "min-h-12 w-full rounded-xl border border-slate-300 bg-white px-3";

export function HolidayManager({ canAnnounceSudden }: { canAnnounceSudden: boolean }) {
  const router = useRouter();
  const [year, setYear] = useState(new Date().getFullYear());
  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  async function load() { const response = await fetch(`/api/v1/holidays?year=${year}`); const result = await response.json(); if (!response.ok) throw new Error(result.error); setHolidays(result.holidays.map((item: Holiday) => ({ ...item, date: item.date.slice(0, 10) }))); }
  useEffect(() => {
    let active = true;
    void fetch(`/api/v1/holidays?year=${year}`).then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.error); return result; }).then((result) => { if (active) setHolidays(result.holidays.map((item: Holiday) => ({ ...item, date: item.date.slice(0, 10) }))); }).catch((error: unknown) => { if (active) setMessage(error instanceof Error ? error.message : "Could not load holidays"); });
    return () => { active = false; };
  }, [year]);
  async function post(body: Record<string, unknown>) { setBusy(true); setMessage(""); try { const response = await fetch("/api/v1/holidays", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); setMessage("Holiday saved and audit recorded."); await load(); router.refresh(); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not save holiday"); } finally { setBusy(false); } }
  async function remove(id: string) { setBusy(true); try { const response = await fetch("/api/v1/holidays", { method: "DELETE", headers: { "content-type": "application/json" }, body: JSON.stringify({ id }) }); const result = await response.json(); if (!response.ok) throw new Error(result.error); await load(); setMessage("Holiday removed from the calendar; history retained."); } catch (error) { setMessage(error instanceof Error ? error.message : "Could not remove holiday"); } finally { setBusy(false); } }
  return <>
    <section className="mt-6 grid gap-4 rounded-2xl border bg-white p-5 shadow-sm md:grid-cols-2"><form className="grid gap-3" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const values = new FormData(form); void post({ action: "create", date: values.get("date"), reason: values.get("reason"), type: canAnnounceSudden && values.get("type") === "SUDDEN" ? "SUDDEN" : "PLANNED" }).then(() => form.reset()); }}><h2 className="text-xl font-bold">Add closure</h2><label>Date<input name="date" type="date" required className={`${input} mt-1`} /></label><label>Reason<input name="reason" minLength={2} maxLength={120} required placeholder="Festival, annual day…" className={`${input} mt-1`} /></label>{canAnnounceSudden && <label>Type<select name="type" className={`${input} mt-1`}><option value="PLANNED">Planned holiday</option><option value="SUDDEN">Sudden closure today</option></select></label>}<button disabled={busy} className="min-h-12 rounded-xl bg-emerald-900 px-4 font-semibold text-white">Add holiday</button></form><div><h2 className="text-xl font-bold">Calendar helpers</h2><label className="mt-3 block">Year<input value={year} type="number" min={2020} max={2100} onChange={(event) => setYear(Number(event.target.value))} className={`${input} mt-1`} /></label><button disabled={busy} onClick={() => void post({ action: "nationalDates", year })} className="mt-3 min-h-12 w-full rounded-xl border border-emerald-900 px-4 font-semibold text-emerald-950">Add 26 Jan, 15 Aug and 2 Oct</button><form className="mt-3 grid gap-2" onSubmit={(event) => { event.preventDefault(); const form = event.currentTarget; const date = String(new FormData(form).get("date")); void post({ action: "secondSaturday", date }); }}><label>Second Saturday date<input name="date" type="date" required className={`${input} mt-1`} /></label><button disabled={busy} className="min-h-12 rounded-xl border px-4 font-semibold">Mark second Saturday</button></form></div></section>
    <section className="mt-5 rounded-2xl border bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">{year} calendar</h2><ul className="mt-3 divide-y">{holidays.map((holiday) => <li key={holiday.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><b>{new Date(`${holiday.date}T12:00:00`).toLocaleDateString("en-IN", { day: "numeric", month: "short", weekday: "short" })}</b><span className="text-slate-600"> · {holiday.reason} · {holiday.type.toLowerCase()}</span></div><button disabled={busy} onClick={() => void remove(holiday.id)} className="min-h-10 rounded-lg border px-3 text-sm">Remove</button></li>)}</ul>{holidays.length === 0 && <p className="py-4 text-sm text-slate-600">No holidays recorded for this year.</p>}</section><p aria-live="polite" className="mt-4 text-sm">{message}</p>
  </>;
}
