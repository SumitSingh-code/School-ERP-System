import { createHmac, timingSafeEqual } from "node:crypto";

export type CsvRow = { rowNumber: number; values: Record<string, string> };
export type CsvParseResult = { headers: string[]; rows: CsvRow[] };

export function parseCsv(text: string): CsvParseResult {
  if (Buffer.byteLength(text, "utf8") > 5 * 1024 * 1024) throw new Error("CSV file must be 5 MB or smaller");
  const source = text.replace(/^\uFEFF/, "");
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let index = 0; index < source.length; index += 1) {
    const character = source[index] ?? "";
    if (quoted) {
      if (character === '"' && source[index + 1] === '"') { cell += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else cell += character;
      continue;
    }
    if (character === '"' && cell.length === 0) quoted = true;
    else if (character === ",") { record.push(cell); cell = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && source[index + 1] === "\n") index += 1;
      record.push(cell);
      cell = "";
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
    } else cell += character;
  }
  if (quoted) throw new Error("CSV has an unclosed quotation mark");
  if (cell.length || record.length) {
    record.push(cell);
    if (record.some((value) => value.trim() !== "")) records.push(record);
  }
  if (records.length < 2) throw new Error("CSV needs a header row and at least one data row");
  const headers = (records.shift() ?? []).map((value) => value.trim().toLowerCase().replace(/\s+/g, "_").replace(/[^a-z0-9_]/g, ""));
  if (headers.some((header) => !header)) throw new Error("CSV has an empty column name");
  if (new Set(headers).size !== headers.length) throw new Error("CSV has duplicate column names");
  const rows = records.map((cells, index) => {
    if (cells.length !== headers.length) return { rowNumber: index + 2, values: Object.fromEntries([...headers, "__row_error"].map((header, cellIndex) => [header, cellIndex === headers.length ? "Column count does not match the header" : cells[cellIndex] ?? ""])) };
    return { rowNumber: index + 2, values: Object.fromEntries(headers.map((header, cellIndex) => [header, (cells[cellIndex] ?? "").trim()])) };
  });
  return { headers, rows };
}

export function normalizeCsvName(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

export function normalizeCsvPhone(value: string) {
  let candidate = value.trim().replace(/[\s"']/g, "");
  if (/^\d+(?:\.\d+)?e[+-]?\d+$/i.test(candidate)) {
    const number = Number(candidate);
    if (Number.isSafeInteger(number)) candidate = String(number);
  }
  const digits = candidate.replace(/[\s()+-]/g, "").replace(/^91/, "").replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function parseCsvDate(value: string): string | null {
  const trimmed = value.trim();
  const match = /^(\d{2})-(\d{2})-(\d{4})$/.exec(trimmed);
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  const year = Number(match?.[3] ?? iso?.[1]);
  const month = Number(match?.[2] ?? iso?.[2]);
  const day = Number(match?.[1] ?? iso?.[3]);
  if (!match && !iso) return null;
  const result = new Date(Date.UTC(year, month - 1, day));
  if (result.getUTCFullYear() !== year || result.getUTCMonth() !== month - 1 || result.getUTCDate() !== day) return null;
  return result.toISOString().slice(0, 10);
}

export function sanitizeCsvCell(value: string) {
  const safe = value.replace(/[\r\n]/g, " ");
  return /^[=+\-@\t]/.test(safe) ? `'${safe}` : safe;
}

export type ImportPreviewClaims = { schoolId: string; actorId: string; kind: "students" | "staff"; digest: string; expiresAt: number };

export function signImportPreview(claims: ImportPreviewClaims, secret: string) {
  if (secret.length < 32) throw new Error("Import preview signing key must be at least 32 characters");
  const payload = Buffer.from(JSON.stringify(claims)).toString("base64url");
  const signature = createHmac("sha256", secret).update(payload).digest("base64url");
  return `${payload}.${signature}`;
}

export function verifyImportPreview(token: string, expected: Omit<ImportPreviewClaims, "digest" | "expiresAt">, digest: string, secret: string, now = Date.now()) {
  if (secret.length < 32) return false;
  const [payload, signature] = token.split(".");
  if (!payload || !signature) return false;
  const actualSignature = createHmac("sha256", secret).update(payload).digest();
  const providedSignature = Buffer.from(signature, "base64url");
  if (actualSignature.length !== providedSignature.length || !timingSafeEqual(actualSignature, providedSignature)) return false;
  try {
    const claims = JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as ImportPreviewClaims;
    return claims.schoolId === expected.schoolId && claims.actorId === expected.actorId && claims.kind === expected.kind
      && claims.digest === digest && claims.expiresAt > now;
  } catch {
    return false;
  }
}

export function exportCsv(headers: string[], rows: string[][]) {
  const quote = (value: string) => `"${sanitizeCsvCell(value).replace(/"/g, '""')}"`;
  return [headers, ...rows].map((row) => row.map(quote).join(",")).join("\r\n");
}
