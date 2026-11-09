import { test } from "node:test";
import assert from "node:assert/strict";
import { exportCsv, normalizeCsvName, normalizeCsvPhone, parseCsv, parseCsvDate, signImportPreview, verifyImportPreview } from "../src/lib/csv-import";
import { defaultSubjectsFor, DEFAULT_CLASS_LEVELS } from "../src/lib/academic-defaults";

test("CSV parser accepts UTF-8 BOM, escaped quotes, commas and embedded newlines", () => {
  const parsed = parseCsv('\uFEFFadmission_no,student_name,note\r\nSYN-001,"Synthetic, Student","line one\nline ""two"""\r\n');
  assert.deepEqual(parsed.headers, ["admission_no", "student_name", "note"]);
  assert.deepEqual(parsed.rows[0]?.values, { admission_no: "SYN-001", student_name: "Synthetic, Student", note: 'line one\nline "two"' });
});

test("CSV parser reports malformed rows and rejects unclosed quotes", () => {
  assert.equal(parseCsv("a,b\n1,2,3").rows[0]?.values.__row_error, "Column count does not match the header");
  assert.throws(() => parseCsv('a,b\n"unfinished,cell'), /unclosed quotation/i);
});

test("CSV normalizes names and common Indian phone spreadsheet formats", () => {
  assert.equal(normalizeCsvName("  Synthetic   Parent "), "Synthetic Parent");
  assert.equal(normalizeCsvPhone("+91 98765 43210"), "9876543210");
  assert.equal(normalizeCsvPhone("09876543210"), "9876543210");
  assert.equal(normalizeCsvPhone("9.87654321E+09"), "9876543210");
  assert.equal(normalizeCsvPhone("123"), null);
});

test("CSV dates are strict calendar dates and outputs prevent formula injection", () => {
  assert.equal(parseCsvDate("09-11-2026"), "2026-11-09");
  assert.equal(parseCsvDate("2026-11-09"), "2026-11-09");
  assert.equal(parseCsvDate("31-02-2026"), null);
  assert.equal(exportCsv(["value"], [["=1+1"]]), '"value"\r\n"\'=1+1"');
});

test("preview token is tied to school, user, kind, contents and expiry", () => {
  const secret = "synthetic-test-key-which-is-longer-than-32-bytes";
  const claims = { schoolId: "school-a", actorId: "user-a", kind: "students" as const, digest: "digest-a", expiresAt: Date.now() + 60_000 };
  const token = signImportPreview(claims, secret);
  assert.equal(verifyImportPreview(token, { schoolId: "school-a", actorId: "user-a", kind: "students" }, "digest-a", secret), true);
  assert.equal(verifyImportPreview(token, { schoolId: "school-b", actorId: "user-a", kind: "students" }, "digest-a", secret), false);
  assert.equal(verifyImportPreview(token, { schoolId: "school-a", actorId: "user-b", kind: "students" }, "digest-a", secret), false);
  assert.equal(verifyImportPreview(token, { schoolId: "school-a", actorId: "user-a", kind: "students" }, "different-file", secret), false);
  assert.equal(verifyImportPreview(token, { schoolId: "school-a", actorId: "user-a", kind: "students" }, "digest-a", secret, claims.expiresAt + 1), false);
});

test("editable CBSE seed includes all required classes and separate senior secondary subject groups", () => {
  assert.equal(DEFAULT_CLASS_LEVELS.length, 15);
  assert.ok(defaultSubjectsFor("11", "Science", "PCM").some((subject) => subject.name === "Maths"));
  assert.ok(defaultSubjectsFor("11", "Science", "PCB").some((subject) => subject.name === "Biology"));
  assert.ok(defaultSubjectsFor("11", "Commerce").some((subject) => subject.name === "Accountancy"));
  assert.ok(defaultSubjectsFor("1").some((subject) => subject.name === "Moral Science"));
});
