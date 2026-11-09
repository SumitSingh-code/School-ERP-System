"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Issue = { row: number; message: string };
type HistoryBatch = { id: string; kind: string; status: string; rowCount: number; createdCount: number; updatedCount: number; fileName: string; createdAt: string };
type Preview = { rowCount: number; createCount: number; updateCount: number; errors: Issue[]; warnings: Issue[]; previewToken: string | null };
type Batch = { id: string; rowCount: number; createdCount: number; updatedCount: number };
const actionClass = "inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-900 px-5 font-semibold text-white disabled:opacity-50";

function downloadIssueReport(errors: Issue[]) {
  const quote = (value: string) => `"${(/^[=+\-@\t]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  const content = ["row,reason", ...errors.map((item) => `${quote(String(item.row))},${quote(item.message)}`)].join("\r\n");
  const url = URL.createObjectURL(new Blob([content], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a"); link.href = url; link.download = "staff-import-errors.csv"; link.click(); URL.revokeObjectURL(url);
}

export function StaffImport({ history }: { history: HistoryBatch[] }) {
  const router = useRouter();
  const [rawCsv, setRawCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function selectFile(file?: File) {
    setPreview(null); setBatch(null); setError(""); setMessage("");
    if (!file) { setRawCsv(""); setFileName(""); return; }
    if (!file.name.toLowerCase().endsWith(".csv") || file.size > 5 * 1024 * 1024) { setError("Choose a CSV file that is 5 MB or smaller."); return; }
    try { setRawCsv(await file.text()); setFileName(file.name); }
    catch { setError("Could not read the file. Save it as UTF-8 CSV and try again."); }
  }

  async function requestPreview() {
    setBusy(true); setError(""); setPreview(null); setBatch(null);
    try {
      const response = await fetch("/api/v1/imports/staff/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: rawCsv, fileName }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not preview staff records");
      setPreview(result as Preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview staff records"); }
    finally { setBusy(false); }
  }

  async function confirm() {
    if (!preview?.previewToken) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/imports/staff/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: rawCsv, fileName, previewToken: preview.previewToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not import staff");
      setBatch(result.batch as Batch); setRawCsv(""); setMessage("Staff import completed. Each imported account must change its initial password before accessing school records."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import staff"); }
    finally { setBusy(false); }
  }

  async function rollback(batchId: string) {
    const confirmed = window.confirm(`Roll back staff import ${batchId}? Accounts and assignments will be restored or archived. If a user has signed in since import, rollback is blocked.`);
    if (!confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/imports/staff/${batchId}/rollback`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not roll back staff import");
      setBatch((current) => current?.id === batchId ? null : current); setMessage("Staff import rolled back."); router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not roll back staff import"); }
    finally { setBusy(false); }
  }

  return <section className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
    <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">Staff accounts</h2><p className="mt-1 text-sm text-slate-600">Set an initial password in the private CSV. It is hashed before storage and staff must change it at first sign-in.</p></div><Link href="/api/v1/imports/templates/staff" prefetch={false} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold">Download staff template</Link></div>
    <p className="mt-3 rounded-xl bg-slate-50 p-3 text-sm text-slate-700">Optional class teacher format: <code>5-A</code>, <code>11-Arts-A</code>, or <code>11-Science-PCM-A</code>. A teacher may own one section per academic year.</p>
    <label className="mt-4 block text-sm font-semibold">Staff CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void selectFile(event.currentTarget.files?.[0])} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 p-2 text-base" /></label>
    {fileName && <p className="mt-2 text-sm text-slate-600">Selected: {fileName}</p>}
    <button type="button" disabled={busy || !rawCsv} onClick={() => void requestPreview()} className={`${actionClass} mt-4`}>{busy ? "Checking…" : "Preview staff CSV"}</button>
    {preview && <div className="mt-5 border-t border-slate-200 pt-5"><h3 className="text-lg font-bold">Review before confirming</h3><div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">{[["Rows", preview.rowCount], ["New accounts", preview.createCount], ["Updates", preview.updateCount], ["Errors", preview.errors.length]].map(([label, count]) => <div key={String(label)} className="rounded-xl bg-slate-50 p-3"><p className="text-xs font-semibold uppercase text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{count}</p></div>)}</div>
      {preview.warnings.length > 0 && <ul className="mt-3 rounded-xl bg-amber-50 p-4 text-sm text-amber-950">{preview.warnings.slice(0, 30).map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul>}
      {preview.errors.length > 0 && <div className="mt-3 rounded-xl bg-red-50 p-4 text-sm text-red-950"><div className="flex flex-wrap justify-between gap-2"><strong>Fix errors before import</strong><button type="button" onClick={() => downloadIssueReport(preview.errors)} className="min-h-11 rounded-lg border border-red-400 px-3 font-semibold">Download error CSV</button></div><ul className="mt-2 space-y-1">{preview.errors.slice(0, 30).map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul></div>}
      <p className="mt-4 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6"><strong>Confirming will:</strong> create {preview.createCount} accounts and update {preview.updateCount}, hash all initial passwords, require a password change, assign roles, and apply any class-teacher assignments.</p>
      <button type="button" disabled={busy || preview.errors.length > 0 || !preview.previewToken} onClick={() => void confirm()} className={`${actionClass} mt-4`}>{busy ? "Importing…" : "Confirm and import staff"}</button>
    </div>}
    {batch && <div className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950"><p><strong>Imported:</strong> {batch.createdCount} new accounts and {batch.updatedCount} updates. Batch ID: <code>{batch.id}</code></p><button type="button" disabled={busy} onClick={() => void rollback(batch.id)} className="mt-3 min-h-11 rounded-xl border border-emerald-800 px-4 font-semibold">Roll back this import</button></div>}
    <div className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h3 className="text-lg font-bold">Recent staff imports</h3>{history.length ? <ul className="mt-3 divide-y divide-slate-100">{history.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.fileName}</p><p className="text-sm text-slate-600">{new Date(item.createdAt).toLocaleString()} · {item.createdCount} added · {item.updatedCount} updated</p><p className="text-xs text-slate-500">Batch {item.id}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{item.status.replaceAll("_", " ")}</span>{item.status === "COMPLETED" && <button type="button" disabled={busy} onClick={() => void rollback(item.id)} className="min-h-11 rounded-xl border border-emerald-800 px-3 text-sm font-semibold">Roll back</button>}</div></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No staff imports yet.</p>}</div>
    {message && <p role="status" className="mt-3 rounded-xl bg-emerald-50 p-3 text-sm text-emerald-950">{message}</p>}{error && <p role="alert" className="mt-3 rounded-xl bg-red-50 p-3 text-sm text-red-950">{error}</p>}
  </section>;
}
