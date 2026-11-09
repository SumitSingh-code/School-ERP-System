"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

type Issue = { row: number; message: string };
type HistoryBatch = { id: string; kind: string; status: string; rowCount: number; createdCount: number; updatedCount: number; fileName: string; createdAt: string };
type Preview = {
  rowCount: number; createCount: number; updateCount: number; errors: Issue[]; warnings: Issue[];
  newSections: { className: string; section: string; stream: string | null; group: string | null }[];
  academicYear: string; previewToken: string | null;
};
type Batch = { id: string; rowCount: number; createdCount: number; updatedCount: number };

const button = "inline-flex min-h-12 items-center justify-center rounded-xl bg-emerald-900 px-5 font-semibold text-white disabled:opacity-50";

function downloadErrors(errors: Issue[]) {
  const quote = (value: string) => `"${(/^[=+\-@\t]/.test(value) ? `'${value}` : value).replace(/"/g, '""')}"`;
  const text = ["row,reason", ...errors.map(({ row, message }) => `${quote(String(row))},${quote(message)}`)].join("\r\n");
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "student-import-errors.csv";
  link.click();
  URL.revokeObjectURL(url);
}

export function StudentImport({ history }: { history: HistoryBatch[] }) {
  const router = useRouter();
  const [rawCsv, setRawCsv] = useState("");
  const [fileName, setFileName] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [batch, setBatch] = useState<Batch | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  async function chooseFile(file?: File) {
    setPreview(null);
    setBatch(null);
    setError("");
    setMessage("");
    if (!file) { setRawCsv(""); setFileName(""); return; }
    if (!file.name.toLowerCase().endsWith(".csv")) { setError("Choose a CSV file."); return; }
    if (file.size > 5 * 1024 * 1024) { setError("CSV file must be 5 MB or smaller."); return; }
    try { setRawCsv(await file.text()); setFileName(file.name); }
    catch { setError("Could not read that file. Save it as UTF-8 CSV and try again."); }
  }

  async function requestPreview() {
    setBusy(true); setError(""); setMessage(""); setPreview(null); setBatch(null);
    try {
      const response = await fetch("/api/v1/imports/students/preview", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: rawCsv, fileName }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not preview this file");
      setPreview(result as Preview);
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not preview this file"); }
    finally { setBusy(false); }
  }

  async function confirmImport() {
    if (!preview?.previewToken) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch("/api/v1/imports/students/confirm", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ csv: rawCsv, fileName, previewToken: preview.previewToken }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not import students");
      setBatch(result.batch as Batch);
      setMessage("Import complete. You can roll it back only while these records stay unchanged and unused.");
      setRawCsv("");
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not import students"); }
    finally { setBusy(false); }
  }

  async function rollbackImport(batchId: string) {
    const confirmed = window.confirm(`Roll back import ${batchId}? Imported records will be restored or archived, and opening-balance entries will be reversed.`);
    if (!confirmed) return;
    setBusy(true); setError(""); setMessage("");
    try {
      const response = await fetch(`/api/v1/imports/students/${batchId}/rollback`, { method: "POST" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error ?? "Could not roll back this import");
      setMessage(`Import ${batchId} was rolled back. Money entries were reversed without deleting ledger history.`);
      setBatch((current) => current?.id === batchId ? null : current);
      router.refresh();
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Could not roll back this import"); }
    finally { setBusy(false); }
  }

  return <>
    <section className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3"><div><h2 className="text-xl font-bold">1. Upload</h2><p className="mt-1 text-sm text-slate-600">UTF-8 CSV, up to 5 MB. Keep student names in English.</p></div><Link href="/api/v1/imports/templates/students" prefetch={false} className="inline-flex min-h-11 items-center rounded-xl border border-slate-300 px-4 text-sm font-semibold">Download template</Link></div>
      <label className="mt-4 block text-sm font-semibold">Student roster CSV<input type="file" accept=".csv,text/csv" onChange={(event) => void chooseFile(event.currentTarget.files?.[0])} className="mt-2 block min-h-12 w-full rounded-xl border border-slate-300 p-2 text-base file:mr-3 file:min-h-9 file:rounded-lg file:border-0 file:bg-slate-100 file:px-3" /></label>
      {fileName && <p className="mt-2 text-sm text-slate-600">Selected: {fileName}</p>}
      <button type="button" disabled={busy || !rawCsv} onClick={() => void requestPreview()} className={`${button} mt-4`}>{busy ? "Checking…" : "Preview CSV"}</button>
    </section>

    {preview && <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
      <h2 className="text-xl font-bold">2. Review preview</h2>
      <p className="mt-1 text-sm text-slate-600">Academic year: {preview.academicYear}</p>
      <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4"><Stat label="Rows" value={preview.rowCount} /><Stat label="New students" value={preview.createCount} /><Stat label="Updates" value={preview.updateCount} /><Stat label="Issues" value={preview.errors.length} /></div>
      {preview.newSections.length > 0 && <div className="mt-4 rounded-xl bg-blue-50 p-4"><h3 className="font-semibold text-blue-950">Sections to create</h3><ul className="mt-2 space-y-1 text-sm text-blue-950">{preview.newSections.map((item, index) => <li key={`${item.className}-${item.stream}-${item.group}-${item.section}-${index}`}>{item.className}{item.stream ? ` · ${item.stream}` : ""}{item.group ? ` ${item.group}` : ""} · Section {item.section}</li>)}</ul></div>}
      {preview.errors.length > 0 && <div className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4"><div className="flex flex-wrap items-start justify-between gap-3"><div><h3 className="font-semibold text-red-950">Fix these errors, then upload again</h3><p className="mt-1 text-sm text-red-900">Nothing has been imported.</p></div><button type="button" onClick={() => downloadErrors(preview.errors)} className="min-h-11 rounded-xl border border-red-400 px-3 text-sm font-semibold text-red-950">Download error CSV</button></div><ul className="mt-3 space-y-2 text-sm text-red-950">{preview.errors.slice(0, 30).map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul>{preview.errors.length > 30 && <p className="mt-2 text-sm text-red-900">Showing first 30. The downloaded CSV includes every error.</p>}</div>}
      {preview.warnings.length > 0 && <div className="mt-4 rounded-xl border border-amber-300 bg-amber-50 p-4"><h3 className="font-semibold text-amber-950">Warnings to review</h3><ul className="mt-2 space-y-2 text-sm text-amber-950">{preview.warnings.slice(0, 30).map((item, index) => <li key={`${item.row}-${index}`}>Row {item.row}: {item.message}</li>)}</ul>{preview.warnings.length > 30 && <p className="mt-2 text-sm text-amber-900">Showing first 30 warnings.</p>}</div>}
      <div className="mt-5 rounded-xl border border-slate-200 bg-slate-50 p-4 text-sm leading-6"><p><strong>Confirming will:</strong> create {preview.createCount} student records, update {preview.updateCount}, link guardian phones, create the listed sections, and add any previous dues as ledger opening-balance entries.</p><p className="mt-2">The selected CSV is sent only for this request and is not saved as an uploaded file.</p></div>
      <button type="button" disabled={busy || preview.errors.length > 0 || !preview.previewToken} onClick={() => void confirmImport()} className={`${button} mt-4`}>{busy ? "Importing…" : "3. Confirm and import"}</button>
    </section>}

    {batch && <section className="mt-4 rounded-2xl border border-emerald-300 bg-emerald-50 p-5"><h2 className="text-xl font-bold text-emerald-950">Import completed</h2><p className="mt-2 text-sm text-emerald-950">{batch.createdCount} students added, {batch.updatedCount} updated across {batch.rowCount} rows. Batch ID: <code>{batch.id}</code></p><p className="mt-2 text-sm text-emerald-950">Rollback remains available only if imported records have not been edited or used after this import.</p><button disabled={busy} type="button" onClick={() => void rollbackImport(batch.id)} className="mt-4 min-h-12 rounded-xl border border-emerald-800 px-4 font-semibold text-emerald-950">Roll back this import</button></section>}
    <section className="mt-4 rounded-2xl border border-slate-200 bg-white p-5 shadow-sm"><h2 className="text-xl font-bold">Recent student imports</h2>{history.length ? <ul className="mt-3 divide-y divide-slate-100">{history.map((item) => <li key={item.id} className="flex flex-wrap items-center justify-between gap-3 py-3"><div><p className="font-semibold">{item.fileName}</p><p className="text-sm text-slate-600">{new Date(item.createdAt).toLocaleString()} · {item.createdCount} added · {item.updatedCount} updated</p><p className="text-xs text-slate-500">Batch {item.id}</p></div><div className="flex items-center gap-3"><span className="rounded-full bg-slate-100 px-3 py-1 text-xs font-semibold">{item.status.replaceAll("_", " ")}</span>{item.status === "COMPLETED" && <button disabled={busy} type="button" onClick={() => void rollbackImport(item.id)} className="min-h-11 rounded-xl border border-emerald-800 px-3 text-sm font-semibold text-emerald-950">Roll back</button>}</div></li>)}</ul> : <p className="mt-2 text-sm text-slate-600">No student imports yet.</p>}</section>
    {message && <p role="status" aria-live="polite" className="mt-4 rounded-xl border border-emerald-300 bg-emerald-50 p-4 text-sm text-emerald-950">{message}</p>}
    {error && <p role="alert" className="mt-4 rounded-xl border border-red-300 bg-red-50 p-4 text-sm text-red-950">{error}</p>}
  </>;
}

function Stat({ label, value }: { label: string; value: number }) {
  return <div className="rounded-xl border border-slate-200 bg-slate-50 p-4"><p className="text-xs font-semibold uppercase tracking-wide text-slate-600">{label}</p><p className="mt-1 text-2xl font-bold">{value}</p></div>;
}
