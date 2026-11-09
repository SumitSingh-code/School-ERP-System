import { test } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { confirmStudentImport, previewStudentImport, rollbackImportBatch } from "../src/lib/student-import";
import { forSchool } from "../src/lib/scoped-prisma";

const enabled = process.env.TENANT_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);

function syntheticMobile() {
  const digits = randomUUID().replace(/\D/g, "").padEnd(9, "0").slice(0, 9);
  return `6${digits}`;
}

test("Phase 1 student import previews, writes audited school-scoped records, and rolls back untouched rows", { skip: !enabled }, async () => {
  const base = new PrismaClient();
  const schoolA = `phase1-import-a-${randomUUID()}`;
  const schoolB = `phase1-import-b-${randomUUID()}`;
  const actorId = randomUUID();
  const foreignStudentId = randomUUID();
  const admissionNo = `SYN-${randomUUID().slice(0, 8).toUpperCase()}`;
  const secretBefore = process.env.IMPORT_PREVIEW_SECRET;
  process.env.IMPORT_PREVIEW_SECRET = "integration-test-preview-key-with-over-32-bytes";
  try {
    await base.school.createMany({ data: [{ id: schoolA, name: "Synthetic Import School A" }, { id: schoolB, name: "Synthetic Import School B" }] });
    await base.user.create({ data: { id: actorId, schoolId: schoolA, name: "Synthetic Import Director", phone: `phase1-${randomUUID()}` } });
    const yearA = await base.academicYear.create({ data: { schoolId: schoolA, label: "2026-27", startsOn: new Date("2026-04-01T00:00:00.000Z"), endsOn: new Date("2027-03-31T00:00:00.000Z"), isCurrent: true } });
    const classA = await base.classLevel.create({ data: { schoolId: schoolA, name: "5", sortOrder: 5 } });
    const classB = await base.classLevel.create({ data: { schoolId: schoolB, name: "5", sortOrder: 5 } });
    const sectionA = await base.section.create({ data: { schoolId: schoolA, academicYearId: yearA.id, classLevelId: classA.id, name: "A" } });
    await base.student.create({ data: { id: foreignStudentId, schoolId: schoolB, admissionNo, fullName: "Synthetic Foreign Student" } });
    const csv = [
      "admission_no,student_name,dob,gender,class,stream,group,section,father_name,mother_name,guardian_phone_1,guardian_phone_2,address,payment_plan,previous_dues",
      `${admissionNo},Synthetic Imported Child,12-05-2014,Male,5,,,A,Synthetic Father,Synthetic Mother,${syntheticMobile()},${syntheticMobile()},Synthetic Address,Standard,123.45`,
    ].join("\r\n");

    const a = forSchool(base, schoolA);
    const preview = await previewStudentImport(a, schoolA, actorId, csv);
    assert.equal(preview.errors.length, 0);
    assert.equal(preview.createCount, 1);
    assert.equal(preview.updateCount, 0);
    assert.equal(preview.previewToken !== null, true);

    const result = await confirmStudentImport(a, { schoolId: schoolA, actorId, activeRole: "Director", fileName: "synthetic-roster.csv", rawCsv: csv, previewToken: preview.previewToken! });
    assert.equal(result.createdCount, 1);
    const imported = await a.student.findFirst({ where: { admissionNo } });
    assert.equal(imported?.schoolId, schoolA, "import is created only in the active school");
    assert.equal(imported?.fullName, "Synthetic Imported Child");
    assert.equal(await a.student.findUnique({ where: { id: foreignStudentId } }), null, "school A cannot read the matching school B admission number");
    assert.equal((await base.student.findUnique({ where: { id: foreignStudentId } }))?.fullName, "Synthetic Foreign Student", "school B record is unchanged");
    assert.equal(await a.studentGuardian.count({ where: { studentId: imported!.id, deletedAt: null } }), 2);
    assert.equal((await a.ledgerEntry.aggregate({ where: { studentId: imported!.id }, _sum: { amountPaise: true } }))._sum.amountPaise, BigInt(12345));
    assert.equal(await a.auditLog.count({ where: { schoolId: schoolA, action: "student.import.created", entityId: imported!.id } }), 1);

    const rolledBack = await rollbackImportBatch(a, { schoolId: schoolA, actorId, activeRole: "Director", batchId: result.id });
    assert.equal(rolledBack.status, "ROLLED_BACK");
    const archived = await a.student.findFirst({ where: { id: imported!.id } });
    assert.ok(archived?.deletedAt, "rollback archives rather than hard deletes the imported student");
    assert.equal(await a.studentGuardian.count({ where: { studentId: imported!.id, deletedAt: null } }), 0);
    const ledgerAfterRollback = await a.ledgerEntry.aggregate({ where: { studentId: imported!.id }, _sum: { amountPaise: true } });
    assert.equal(ledgerAfterRollback._sum.amountPaise, BigInt(0), "ledger history is preserved with an equal and opposite reversal");
    assert.equal(await a.ledgerEntry.count({ where: { studentId: imported!.id, entryType: "REVERSAL" } }), 1);
    assert.equal(await a.importBatch.count({ where: { id: result.id, status: "ROLLED_BACK" } }), 1);
    void sectionA;
    void classB;
  } finally {
    if (secretBefore === undefined) delete process.env.IMPORT_PREVIEW_SECRET;
    else process.env.IMPORT_PREVIEW_SECRET = secretBefore;
    await base.$disconnect();
  }
});

test("Phase 1 refuses rollback after an imported student is edited", { skip: !enabled }, async () => {
  const base = new PrismaClient();
  const schoolId = `phase1-edit-${randomUUID()}`;
  const actorId = randomUUID();
  const secretBefore = process.env.IMPORT_PREVIEW_SECRET;
  process.env.IMPORT_PREVIEW_SECRET = "integration-test-preview-key-with-over-32-bytes";
  try {
    await base.school.create({ data: { id: schoolId, name: "Synthetic Import Edit School" } });
    await base.user.create({ data: { id: actorId, schoolId, name: "Synthetic Import Director", phone: `phase1-${randomUUID()}` } });
    const year = await base.academicYear.create({ data: { schoolId, label: "2026-27", startsOn: new Date("2026-04-01T00:00:00.000Z"), endsOn: new Date("2027-03-31T00:00:00.000Z"), isCurrent: true } });
    const classLevel = await base.classLevel.create({ data: { schoolId, name: "4", sortOrder: 4 } });
    await base.section.create({ data: { schoolId, academicYearId: year.id, classLevelId: classLevel.id, name: "A" } });
    const admissionNo = `SYN-${randomUUID().slice(0, 8).toUpperCase()}`;
    const phone = syntheticMobile();
    const csv = [
      "admission_no,student_name,dob,gender,class,stream,group,section,father_name,mother_name,guardian_phone_1,guardian_phone_2,address,payment_plan,previous_dues",
      `${admissionNo},Synthetic Edited Child,09-09-2015,Female,4,,,A,,Synthetic Guardian,,${phone},Synthetic Address,Standard,0`,
    ].join("\r\n");
    const scoped = forSchool(base, schoolId);
    const preview = await previewStudentImport(scoped, schoolId, actorId, csv);
    assert.equal(preview.errors.length, 0);
    const imported = await confirmStudentImport(scoped, { schoolId, actorId, activeRole: "Director", fileName: "synthetic.csv", rawCsv: csv, previewToken: preview.previewToken! });
    const student = await scoped.student.findFirst({ where: { admissionNo } });
    await scoped.student.update({ where: { id: student!.id }, data: { fullName: "Synthetic Edited Child Updated" } });
    await assert.rejects(() => rollbackImportBatch(scoped, { schoolId, actorId, activeRole: "Director", batchId: imported.id }), /edited after the import/i);
  } finally {
    if (secretBefore === undefined) delete process.env.IMPORT_PREVIEW_SECRET;
    else process.env.IMPORT_PREVIEW_SECRET = secretBefore;
    await base.$disconnect();
  }
});
