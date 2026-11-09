import { createHash } from "node:crypto";
import { Prisma } from "@prisma/client";
import { auditedMutation } from "./audited-mutation";
import { exportCsv, normalizeCsvName, normalizeCsvPhone, parseCsv, parseCsvDate, signImportPreview, verifyImportPreview } from "./csv-import";
import type { ScopedPrisma } from "./scoped-prisma";

const REQUIRED_HEADERS = ["admission_no", "student_name", "dob", "gender", "class", "section", "father_name", "mother_name", "guardian_phone_1", "guardian_phone_2", "address", "payment_plan", "previous_dues"];
const PREVIEW_TTL_MS = 30 * 60 * 1000;

type NormalizedStudent = {
  rowNumber: number;
  admissionNo: string;
  fullName: string;
  dateOfBirth: string;
  gender: string;
  address: string | null;
  paymentPlan: string | null;
  openingBalancePaise: string;
  classLevelId: string;
  className: string;
  sectionId: string | null;
  sectionName: string;
  streamId: string | null;
  streamName: string | null;
  groupId: string | null;
  groupName: string | null;
  guardians: { name: string; phone: string; relation: string; isPrimary: boolean }[];
};

type RowIssue = { row: number; message: string };

function normalizeGender(value: string) {
  const key = value.trim().toLowerCase();
  if (["m", "male", "boy"].includes(key)) return "Male";
  if (["f", "female", "girl"].includes(key)) return "Female";
  if (["other", "others"].includes(key)) return "Other";
  return null;
}

function parseRupeesToPaise(value: string) {
  const input = value.trim().replace(/,/g, "");
  if (!input) return "0";
  if (!/^\d{1,10}(?:\.\d{1,2})?$/.test(input)) return null;
  const [rupees = "0", paise = ""] = input.split(".");
  return String(BigInt(rupees) * 100n + BigInt(paise.padEnd(2, "0")));
}

function sectionKey(value: { classLevelId: string; streamId?: string | null; groupId?: string | null; name: string }) {
  return [value.classLevelId, value.streamId ?? "", value.groupId ?? "", value.name.trim().toLowerCase()].join(":");
}

async function validateStudentCsv(db: ScopedPrisma, schoolId: string, rawCsv: string) {
  const parsed = parseCsv(rawCsv);
  const missing = REQUIRED_HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const [years, classes, streams, groups, currentYear] = await Promise.all([
    db.academicYear.findMany({ where: { deletedAt: null } }),
    db.classLevel.findMany({ where: { active: true, deletedAt: null } }),
    db.stream.findMany({ where: { active: true, deletedAt: null }, include: { classLevel: true } }),
    db.studyGroup.findMany({ where: { active: true, deletedAt: null }, include: { stream: true } }),
    db.academicYear.findFirst({ where: { isCurrent: true, deletedAt: null } }),
  ]);
  if (!currentYear) throw new Error("Set a current academic year before importing students");
  const classByName = new Map(classes.map((record) => [record.name.trim().toLowerCase(), record]));
  const streamByKey = new Map(streams.map((record) => [`${record.classLevelId}:${record.name.trim().toLowerCase()}`, record]));
  const groupByKey = new Map(groups.map((record) => [`${record.streamId}:${record.name.trim().toLowerCase()}`, record]));
  const existingSections = await db.section.findMany({ where: { academicYearId: currentYear.id, deletedAt: null } });
  const existingSectionByKey = new Map(existingSections.map((record) => [sectionKey(record), record]));
  const rows: NormalizedStudent[] = [];
  const errors: RowIssue[] = [];
  const warnings: RowIssue[] = [];
  const seenAdmissionNos = new Set<string>();
  const newSections = new Map<string, { className: string; section: string; stream: string | null; group: string | null; classLevelId: string; streamId: string | null; groupId: string | null }>();

  for (const csvRow of parsed.rows) {
    const cell = (key: string) => csvRow.values[key] ?? "";
    if (csvRow.values.__row_error) errors.push({ row: csvRow.rowNumber, message: csvRow.values.__row_error });
    const admissionNo = cell("admission_no").trim().toUpperCase();
    const fullName = normalizeCsvName(cell("student_name"));
    const dateOfBirth = parseCsvDate(cell("dob"));
    const gender = normalizeGender(cell("gender"));
    const className = cell("class").trim();
    const classLevel = classByName.get(className.toLowerCase());
    const sectionName = normalizeCsvName(cell("section"));
    const fatherName = normalizeCsvName(cell("father_name"));
    const motherName = normalizeCsvName(cell("mother_name"));
    const phone1 = cell("guardian_phone_1") ? normalizeCsvPhone(cell("guardian_phone_1")) : null;
    const phone2 = cell("guardian_phone_2") ? normalizeCsvPhone(cell("guardian_phone_2")) : null;
    const streamName = cell("stream").trim();
    const groupName = cell("group").trim();
    if (!admissionNo) errors.push({ row: csvRow.rowNumber, message: "Admission number is required" });
    if (!fullName) errors.push({ row: csvRow.rowNumber, message: "Student name is required" });
    if (!dateOfBirth) errors.push({ row: csvRow.rowNumber, message: "Date of birth must be a real date in DD-MM-YYYY format" });
    if (!gender) errors.push({ row: csvRow.rowNumber, message: "Gender must be Male, Female or Other" });
    if (!classLevel) errors.push({ row: csvRow.rowNumber, message: `Class '${className || "(blank)"}' is not configured; fix the class name in the school setup` });
    if (!sectionName) errors.push({ row: csvRow.rowNumber, message: "Section is required" });
    if (!phone1 && !phone2) errors.push({ row: csvRow.rowNumber, message: "Enter at least one valid Indian guardian phone number" });
    if (cell("guardian_phone_1") && !phone1) errors.push({ row: csvRow.rowNumber, message: "Guardian phone 1 is not a valid Indian mobile number" });
    if (cell("guardian_phone_2") && !phone2) errors.push({ row: csvRow.rowNumber, message: "Guardian phone 2 is not a valid Indian mobile number" });
    if (phone1 && !fatherName) errors.push({ row: csvRow.rowNumber, message: "Father name is required when guardian phone 1 is entered" });
    if (phone2 && !motherName) errors.push({ row: csvRow.rowNumber, message: "Mother name is required when guardian phone 2 is entered" });
    if (phone1 && phone2 && phone1 === phone2) warnings.push({ row: csvRow.rowNumber, message: "Both guardian columns use the same phone. Because each guardian phone identifies one record, it will be linked once as Father." });
    if (classLevel && Number(classLevel.name) >= 11 && !streamName) errors.push({ row: csvRow.rowNumber, message: "Choose Arts, Commerce or Science for Class 11 or 12" });

    let streamId: string | null = null;
    let groupId: string | null = null;
    let normalizedStream: string | null = null;
    let normalizedGroup: string | null = null;
    if (classLevel && streamName) {
      const stream = streamByKey.get(`${classLevel.id}:${streamName.toLowerCase()}`);
      if (!stream) errors.push({ row: csvRow.rowNumber, message: `Stream '${streamName}' is not configured for class ${classLevel.name}` });
      else {
        streamId = stream.id;
        normalizedStream = stream.name;
        if (stream.name.toLowerCase() === "science" && Number(classLevel.name) >= 11 && !groupName) errors.push({ row: csvRow.rowNumber, message: "Choose PCM, PCB or PCMB for the Science stream" });
        if (groupName) {
          const group = groupByKey.get(`${stream.id}:${groupName.toLowerCase()}`);
          if (!group) errors.push({ row: csvRow.rowNumber, message: `Group '${groupName}' is not configured for ${stream.name}` });
          else { groupId = group.id; normalizedGroup = group.name; }
        }
      }
    }
    if (classLevel && Number(classLevel.name) < 11 && (streamName || groupName)) errors.push({ row: csvRow.rowNumber, message: "Stream and group are only used for Classes 11 and 12" });
    const balance = parseRupeesToPaise(cell("previous_dues"));
    if (balance === null) errors.push({ row: csvRow.rowNumber, message: "Previous dues must be a non-negative amount with up to two decimals" });
    if (seenAdmissionNos.has(admissionNo)) errors.push({ row: csvRow.rowNumber, message: "Admission number appears more than once in this file" });
    seenAdmissionNos.add(admissionNo);

    if (classLevel && sectionName) {
      const key = sectionKey({ classLevelId: classLevel.id, streamId, groupId, name: sectionName });
      if (!existingSectionByKey.has(key)) newSections.set(key, { className: classLevel.name, section: sectionName, stream: normalizedStream, group: normalizedGroup, classLevelId: classLevel.id, streamId, groupId });
    }
    if (dateOfBirth && gender && classLevel && fullName && admissionNo && sectionName && balance !== null) {
      rows.push({
        rowNumber: csvRow.rowNumber, admissionNo, fullName, dateOfBirth, gender,
        address: normalizeCsvName(cell("address")) || null,
        paymentPlan: normalizeCsvName(cell("payment_plan")) || null,
        openingBalancePaise: balance,
        classLevelId: classLevel.id, className: classLevel.name,
        sectionId: null, sectionName, streamId, streamName: normalizedStream, groupId, groupName: normalizedGroup,
        guardians: [
          ...(phone1 ? [{ name: fatherName, phone: phone1, relation: "Father", isPrimary: true }] : []),
          ...(phone2 && phone2 !== phone1 ? [{ name: motherName, phone: phone2, relation: "Mother", isPrimary: !phone1 }] : []),
        ],
      });
    }
  }

  const admissions = [...new Set(rows.map((row) => row.admissionNo))];
  const existingStudents = admissions.length ? await db.student.findMany({ where: { admissionNo: { in: admissions } } }) : [];
  const existingByAdmission = new Map(existingStudents.map((student) => [student.admissionNo.toUpperCase(), student]));
  const dates = [...new Set(rows.map((row) => row.dateOfBirth))].map((value) => new Date(`${value}T00:00:00.000Z`));
  const possibleDuplicates = dates.length ? await db.student.findMany({ where: { dateOfBirth: { in: dates }, deletedAt: null }, select: { admissionNo: true, fullName: true, dateOfBirth: true } }) : [];
  const duplicateKey = (name: string, date: Date) => `${name.trim().toLowerCase()}:${date.toISOString().slice(0, 10)}`;
  const duplicateMap = new Map(possibleDuplicates.map((student) => [duplicateKey(student.fullName, student.dateOfBirth!), student.admissionNo]));
  const guardianPhones = [...new Set(rows.flatMap((row) => row.guardians.map((guardian) => guardian.phone)))];
  const existingGuardians = guardianPhones.length ? await db.guardian.findMany({ where: { phone: { in: guardianPhones } }, select: { phone: true, name: true } }) : [];
  const guardianByPhone = new Map(existingGuardians.map((guardian) => [guardian.phone, guardian.name]));
  for (const row of rows) {
    const existing = existingByAdmission.get(row.admissionNo);
    if (existing?.deletedAt) errors.push({ row: row.rowNumber, message: "This admission number belongs to an archived student; restore the record before importing" });
    const sameNameAdmission = duplicateMap.get(duplicateKey(row.fullName, new Date(`${row.dateOfBirth}T00:00:00.000Z`)));
    if (sameNameAdmission && sameNameAdmission.toUpperCase() !== row.admissionNo) warnings.push({ row: row.rowNumber, message: `Possible duplicate of admission number ${sameNameAdmission} (same name and date of birth)` });
    if (existing) warnings.push({ row: row.rowNumber, message: `Admission number ${row.admissionNo} already exists; this row will update that student` });
    for (const guardian of row.guardians) {
      const knownName = guardianByPhone.get(guardian.phone);
      if (knownName && knownName.trim().toLocaleLowerCase() !== guardian.name.trim().toLocaleLowerCase()) warnings.push({ row: row.rowNumber, message: `Guardian phone ending ${guardian.phone.slice(-4)} already belongs to '${knownName}'. The existing guardian name will be kept.` });
    }
  }

  const fileDigest = createHash("sha256").update(rawCsv).digest("hex");
  return {
    rowCount: parsed.rows.length,
    createCount: rows.filter((row) => !existingByAdmission.has(row.admissionNo)).length,
    updateCount: rows.filter((row) => existingByAdmission.has(row.admissionNo)).length,
    rows,
    errors,
    warnings,
    newSections: [...newSections.values()],
    digest: fileDigest,
    year: years.find((year) => year.id === currentYear.id)?.label ?? currentYear.label,
  };
}

export async function previewStudentImport(db: ScopedPrisma, schoolId: string, actorId: string, rawCsv: string) {
  const result = await validateStudentCsv(db, schoolId, rawCsv);
  const secret = process.env.IMPORT_PREVIEW_SECRET ?? "";
  let previewToken: string | null = null;
  if (result.errors.length === 0) {
    previewToken = signImportPreview({ schoolId, actorId, kind: "students", digest: result.digest, expiresAt: Date.now() + PREVIEW_TTL_MS }, secret);
  }
  return { rowCount: result.rowCount, createCount: result.createCount, updateCount: result.updateCount, errors: result.errors, warnings: result.warnings, newSections: result.newSections.map(({ className, section, stream, group }) => ({ className, stream, group, section })), academicYear: result.year, previewToken };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function confirmStudentImport(db: ScopedPrisma, input: { schoolId: string; actorId: string; activeRole: string; fileName: string; rawCsv: string; previewToken: string }) {
  const preview = await validateStudentCsv(db, input.schoolId, input.rawCsv);
  const secret = process.env.IMPORT_PREVIEW_SECRET ?? "";
  if (preview.errors.length) throw new Error("The CSV has errors. Fix them and preview it again.");
  if (!verifyImportPreview(input.previewToken, { schoolId: input.schoolId, actorId: input.actorId, kind: "students" }, preview.digest, secret)) throw new Error("This preview expired or the file changed. Preview the CSV again.");

  return auditedMutation(db, {
    actorId: input.actorId, activeRole: input.activeRole, schoolId: input.schoolId,
    action: "import.students.confirmed", entityType: "ImportBatch",
    newValue: { rowCount: preview.rowCount, created: preview.createCount, updated: preview.updateCount },
  }, async (tx) => {
    const fileName = input.fileName.replace(/[\\/]/g, "_").slice(-120) || "students.csv";
    const batch = await tx.importBatch.create({ data: { schoolId: input.schoolId, actorId: input.actorId, activeRole: input.activeRole, kind: "students", fileName, rowCount: preview.rowCount, createdCount: preview.createCount, updatedCount: preview.updateCount } });
    const currentYear = await tx.academicYear.findFirst({ where: { isCurrent: true, deletedAt: null } });
    if (!currentYear) throw new Error("Set a current academic year before importing students");
    const sectionIds = new Map<string, string>();
    const recordsForRollback: { targetType: string; targetId: string; operation: string; beforeValue: Prisma.InputJsonValue | null; afterUpdatedAt: Date }[] = [];

    for (const section of preview.newSections) {
      const classLevel = await tx.classLevel.findFirst({ where: { name: section.className, deletedAt: null } });
      if (!classLevel) throw new Error("A configured class changed after preview. Preview the file again.");
      const existing = await tx.section.findFirst({ where: { schoolId: input.schoolId, academicYearId: currentYear.id, classLevelId: classLevel.id, streamId: section.streamId, groupId: section.groupId, name: section.section, deletedAt: null } });
      const created = existing ?? await tx.section.create({ data: { schoolId: input.schoolId, academicYearId: currentYear.id, classLevelId: classLevel.id, streamId: section.streamId ?? undefined, groupId: section.groupId ?? undefined, name: section.section } });
      sectionIds.set(sectionKey({ classLevelId: classLevel.id, streamId: section.streamId, groupId: section.groupId, name: section.section }), created.id);
      if (!existing) {
        recordsForRollback.push({ targetType: "section", targetId: created.id, operation: "CREATE", beforeValue: null, afterUpdatedAt: created.updatedAt });
        await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "academic.section.created_by_import", entityType: "Section", entityId: created.id, newValue: { className: section.className, section: section.section, stream: section.stream, group: section.group } } });
      }
    }

    for (const row of preview.rows) {
      const classLevel = await tx.classLevel.findFirst({ where: { id: row.classLevelId } });
      if (!classLevel) throw new Error("A configured class changed after preview. Preview the file again.");
      const section = await tx.section.findFirst({ where: { academicYearId: currentYear.id, classLevelId: row.classLevelId, streamId: row.streamId, groupId: row.groupId, name: row.sectionName, deletedAt: null } });
      const sectionId = section?.id ?? sectionIds.get(sectionKey({ classLevelId: row.classLevelId, streamId: row.streamId, groupId: row.groupId, name: row.sectionName }));
      if (!sectionId) throw new Error("A section changed after preview. Preview the file again.");

      const existing = await tx.student.findFirst({ where: { admissionNo: row.admissionNo, deletedAt: null } });
      const beforeStudent = existing ? toJson({ fullName: existing.fullName, dateOfBirth: existing.dateOfBirth, gender: existing.gender, address: existing.address, sectionId: existing.sectionId, status: existing.status, paymentPlanLabel: existing.paymentPlanLabel, updatedAt: existing.updatedAt }) : null;
      const studentData = { fullName: row.fullName, dateOfBirth: new Date(`${row.dateOfBirth}T00:00:00.000Z`), gender: row.gender, address: row.address, sectionId, status: "ACTIVE", paymentPlanLabel: row.paymentPlan };
      const student = existing
        ? await tx.student.update({ where: { id: existing.id }, data: studentData })
        : await tx.student.create({ data: { schoolId: input.schoolId, admissionNo: row.admissionNo, ...studentData } });
      recordsForRollback.push({ targetType: "student", targetId: student.id, operation: existing ? "UPDATE" : "CREATE", beforeValue: beforeStudent, afterUpdatedAt: student.updatedAt });
      await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: existing ? "student.import.updated" : "student.import.created", entityType: "Student", entityId: student.id, ...(beforeStudent ? { oldValue: beforeStudent } : {}), newValue: { admissionNo: row.admissionNo, fullName: row.fullName, sectionId } } });

      const desiredGuardianIds = new Set<string>();
      for (const guardianInput of row.guardians) {
        const found = await tx.guardian.findFirst({ where: { phone: guardianInput.phone } });
        let guardian = found;
        if (!guardian) guardian = await tx.guardian.create({ data: { schoolId: input.schoolId, name: guardianInput.name, phone: guardianInput.phone } });
        else if (guardian.deletedAt) {
          const oldGuardian = toJson({ name: guardian.name, updatedAt: guardian.updatedAt, deletedAt: guardian.deletedAt });
          guardian = await tx.guardian.update({ where: { id: guardian.id }, data: { name: guardianInput.name, deletedAt: null } });
          recordsForRollback.push({ targetType: "guardian", targetId: guardian.id, operation: "UPDATE", beforeValue: oldGuardian, afterUpdatedAt: guardian.updatedAt });
          await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "guardian.restored_by_import", entityType: "Guardian", entityId: guardian.id, oldValue: oldGuardian, newValue: { name: guardianInput.name, active: true } } });
        } else if (guardian.name !== guardianInput.name) {
          // The guardian's phone is the stable identity; do not silently replace a shared sibling record's name.
        }
        if (!found) {
          recordsForRollback.push({ targetType: "guardian", targetId: guardian.id, operation: "CREATE", beforeValue: null, afterUpdatedAt: guardian.updatedAt });
          await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "guardian.created_by_import", entityType: "Guardian", entityId: guardian.id, newValue: { name: guardian.name, phoneLastFour: guardian.phone.slice(-4) } } });
        }
        desiredGuardianIds.add(guardian.id);
        const link = await tx.studentGuardian.findFirst({ where: { studentId: student.id, guardianId: guardian.id } });
        const linkData = { schoolId: input.schoolId, relation: guardianInput.relation, isPrimary: guardianInput.isPrimary, deletedAt: null };
        if (!link) {
          const createdLink = await tx.studentGuardian.create({ data: { studentId: student.id, guardianId: guardian.id, ...linkData } });
          recordsForRollback.push({ targetType: "studentGuardian", targetId: `${student.id}:${guardian.id}`, operation: "CREATE", beforeValue: null, afterUpdatedAt: createdLink.updatedAt });
          await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "student.guardian.linked_by_import", entityType: "StudentGuardian", entityId: `${student.id}:${guardian.id}`, newValue: { studentId: student.id, guardianId: guardian.id, relation: guardianInput.relation } } });
        } else if (link.deletedAt || link.relation !== guardianInput.relation || link.isPrimary !== guardianInput.isPrimary) {
          const beforeLink = toJson({ relation: link.relation, isPrimary: link.isPrimary, deletedAt: link.deletedAt, updatedAt: link.updatedAt });
          const updatedLink = await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId: student.id, guardianId: guardian.id } }, data: linkData });
          recordsForRollback.push({ targetType: "studentGuardian", targetId: `${student.id}:${guardian.id}`, operation: "UPDATE", beforeValue: beforeLink, afterUpdatedAt: updatedLink.updatedAt });
          await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "student.guardian.updated_by_import", entityType: "StudentGuardian", entityId: `${student.id}:${guardian.id}`, oldValue: beforeLink, newValue: { relation: updatedLink.relation, isPrimary: updatedLink.isPrimary, deletedAt: null } } });
        }
      }
      const oldLinks = await tx.studentGuardian.findMany({ where: { studentId: student.id, deletedAt: null } });
      for (const oldLink of oldLinks) {
        if (desiredGuardianIds.has(oldLink.guardianId)) continue;
        const beforeLink = toJson({ relation: oldLink.relation, isPrimary: oldLink.isPrimary, deletedAt: oldLink.deletedAt, updatedAt: oldLink.updatedAt });
        const detached = await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId: student.id, guardianId: oldLink.guardianId } }, data: { deletedAt: new Date() } });
        recordsForRollback.push({ targetType: "studentGuardian", targetId: `${student.id}:${oldLink.guardianId}`, operation: "UPDATE", beforeValue: beforeLink, afterUpdatedAt: detached.updatedAt });
        await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "student.guardian.unlinked_by_import", entityType: "StudentGuardian", entityId: `${student.id}:${oldLink.guardianId}`, oldValue: beforeLink, newValue: { studentId: student.id, guardianId: oldLink.guardianId, deletedAt: true } } });
      }

      const duePaise = BigInt(row.openingBalancePaise);
      const previousEntries = await tx.ledgerEntry.findMany({
        where: { studentId: student.id, OR: [
          { entryType: { in: ["OPENING_BALANCE", "OPENING_BALANCE_ADJUSTMENT"] } },
          { entryType: "REVERSAL", reversalOf: { entryType: { in: ["OPENING_BALANCE", "OPENING_BALANCE_ADJUSTMENT"] } } },
        ] },
        select: { amountPaise: true },
      });
      const currentOpeningBalance = previousEntries.reduce((sum, entry) => sum + entry.amountPaise, BigInt(0));
      const adjustment = duePaise - currentOpeningBalance;
      if (adjustment !== BigInt(0)) {
        const ledger = await tx.ledgerEntry.create({ data: { schoolId: input.schoolId, studentId: student.id, createdBy: input.actorId, importBatchId: batch.id, entryType: currentOpeningBalance === BigInt(0) && duePaise >= BigInt(0) ? "OPENING_BALANCE" : "OPENING_BALANCE_ADJUSTMENT", amountPaise: adjustment, description: "Opening balance imported from student CSV" } });
        await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "fees.opening_balance.imported", entityType: "LedgerEntry", entityId: ledger.id, newValue: { studentId: student.id, amountPaise: adjustment.toString() } } });
      }
    }

    if (recordsForRollback.length) await tx.importRecord.createMany({ data: recordsForRollback.map((record) => ({ schoolId: input.schoolId, batchId: batch.id, actorId: input.actorId, ...record, beforeValue: record.beforeValue ?? Prisma.DbNull })) });
    return { id: batch.id, rowCount: batch.rowCount, createdCount: batch.createdCount, updatedCount: batch.updatedCount };
  });
}

export async function rollbackImportBatch(db: ScopedPrisma, input: { schoolId: string; actorId: string; activeRole: string; batchId: string }) {
  const batch = await db.importBatch.findFirst({ where: { id: input.batchId, status: "COMPLETED" }, include: { records: true, ledgerEntries: true } });
  if (!batch) throw new Error("Import batch not found or already rolled back");
  const timestampMatches: Record<string, Date | null> = {};
  for (const record of batch.records) {
    if (record.isUsed) throw new Error("Rollback is unavailable because imported data has been used since the import");
    if (record.targetType === "student") timestampMatches[record.targetId] = (await db.student.findFirst({ where: { id: record.targetId } }))?.updatedAt ?? null;
    else if (record.targetType === "guardian") timestampMatches[record.targetId] = (await db.guardian.findFirst({ where: { id: record.targetId } }))?.updatedAt ?? null;
    else if (record.targetType === "section") timestampMatches[record.targetId] = (await db.section.findFirst({ where: { id: record.targetId } }))?.updatedAt ?? null;
    else if (record.targetType === "user") {
      const user = await db.user.findFirst({ where: { id: record.targetId } });
      timestampMatches[record.targetId] = user?.updatedAt ?? null;
      if (user && await db.session.count({ where: { userId: user.id, createdAt: { gt: record.afterUpdatedAt } } })) throw new Error("Rollback is unavailable because the imported staff account has been used to sign in");
    }
    else if (record.targetType === "classTeacherAssignment") timestampMatches[record.targetId] = (await db.classTeacherAssignment.findFirst({ where: { id: record.targetId } }))?.updatedAt ?? null;
    else if (record.targetType === "userRole") {
      const [userId, roleId] = record.targetId.split(":");
      const roleLink = userId && roleId ? await db.userRole.findFirst({ where: { userId, roleId } }) : null;
      timestampMatches[record.targetId] = roleLink?.updatedAt ?? null;
    }
    else if (record.targetType === "studentGuardian") {
      const [studentId, guardianId] = record.targetId.split(":");
      const link = studentId && guardianId ? await db.studentGuardian.findFirst({ where: { studentId, guardianId } }) : null;
      timestampMatches[record.targetId] = link?.updatedAt ?? null;
    }
    if (timestampMatches[record.targetId]?.getTime() !== record.afterUpdatedAt.getTime()) throw new Error("Rollback is unavailable because an imported record was edited after the import");
  }
  const batchGuardianIds = new Set(batch.records.filter((row) => row.targetType === "guardian").map((row) => row.targetId));
  const importedStudentIds = batch.records.filter((row) => row.targetType === "student").map((row) => row.targetId);
  for (const guardianId of batchGuardianIds) {
    const outsideLinks = await db.studentGuardian.count({ where: { guardianId, deletedAt: null, studentId: { notIn: importedStudentIds } } });
    if (outsideLinks > 0) throw new Error("Rollback is unavailable because an imported guardian was linked to another record afterwards");
  }
  const importedSectionIds = batch.records.filter((row) => row.targetType === "section").map((row) => row.targetId);
  for (const sectionId of importedSectionIds) {
    const outsideStudents = await db.student.count({ where: { sectionId, deletedAt: null, id: { notIn: importedStudentIds } } });
    if (outsideStudents > 0) throw new Error("Rollback is unavailable because an imported section has been used by another student");
  }

  return auditedMutation(db, {
    actorId: input.actorId, activeRole: input.activeRole, schoolId: input.schoolId,
    action: `import.${batch.kind}.rolled_back`, entityType: "ImportBatch", entityId: batch.id,
    oldValue: { status: batch.status }, newValue: { status: "ROLLED_BACK" },
  }, async (tx) => {
    const claimed = await tx.importBatch.updateMany({ where: { id: batch.id, status: "COMPLETED" }, data: { status: "ROLLING_BACK" } });
    if (claimed.count !== 1) throw new Error("Import batch is already being rolled back");
    const rollbackOrder = [...batch.records].sort((a, b) => {
      const order: Record<string, number> = { studentGuardian: 0, classTeacherAssignment: 0, userRole: 1, guardian: 2, student: 3, user: 3, section: 4 };
      return (order[a.targetType] ?? 4) - (order[b.targetType] ?? 4);
    });
    for (const record of rollbackOrder) {
      const before = record.beforeValue && typeof record.beforeValue === "object" && !Array.isArray(record.beforeValue) ? record.beforeValue as Record<string, unknown> : null;
      const [studentId, guardianId] = record.targetId.split(":");
      if (record.targetType === "student" && studentId) {
        if (!before) await tx.student.update({ where: { id: record.targetId }, data: { deletedAt: new Date() } });
        else await tx.student.update({ where: { id: record.targetId }, data: {
          fullName: String(before.fullName), dateOfBirth: before.dateOfBirth ? new Date(String(before.dateOfBirth)) : null,
          gender: typeof before.gender === "string" ? before.gender : null, address: typeof before.address === "string" ? before.address : null,
          sectionId: typeof before.sectionId === "string" ? before.sectionId : null, status: String(before.status),
          paymentPlanLabel: typeof before.paymentPlanLabel === "string" ? before.paymentPlanLabel : null,
        } });
      } else if (record.targetType === "guardian") {
        if (!before) await tx.guardian.update({ where: { id: record.targetId }, data: { deletedAt: new Date() } });
        else await tx.guardian.update({ where: { id: record.targetId }, data: { name: String(before.name), deletedAt: before.deletedAt ? new Date(String(before.deletedAt)) : null } });
      } else if (record.targetType === "studentGuardian" && studentId && guardianId) {
        if (!before) await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data: { deletedAt: new Date() } });
        else await tx.studentGuardian.update({ where: { studentId_guardianId: { studentId, guardianId } }, data: { relation: String(before.relation), isPrimary: Boolean(before.isPrimary), deletedAt: before.deletedAt ? new Date(String(before.deletedAt)) : null } });
      } else if (record.targetType === "section" && !before) await tx.section.update({ where: { id: record.targetId }, data: { deletedAt: new Date(), active: false } });
      else if (record.targetType === "user" && !before) await tx.user.update({ where: { id: record.targetId }, data: { deletedAt: new Date(), status: "INACTIVE" } });
      else if (record.targetType === "user" && before) await tx.user.update({ where: { id: record.targetId }, data: {
        name: String(before.name), passwordHash: typeof before.passwordHash === "string" ? before.passwordHash : null,
        status: before.status === "ACTIVE" || before.status === "LOCKED" ? before.status : "INACTIVE",
        mustChangePassword: Boolean(before.mustChangePassword), deletedAt: before.deletedAt ? new Date(String(before.deletedAt)) : null,
      } });
      else if (record.targetType === "userRole" && studentId && guardianId) {
        if (!before) await tx.userRole.update({ where: { userId_roleId: { userId: studentId, roleId: guardianId } }, data: { deletedAt: new Date() } });
        else await tx.userRole.update({ where: { userId_roleId: { userId: studentId, roleId: guardianId } }, data: { deletedAt: before.deletedAt ? new Date(String(before.deletedAt)) : null } });
      } else if (record.targetType === "classTeacherAssignment" && !before) await tx.classTeacherAssignment.update({ where: { id: record.targetId }, data: { deletedAt: new Date() } });
      await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "import.record.rolled_back", entityType: record.targetType, entityId: record.targetId, ...(before ? { oldValue: before } : {}), newValue: { batchId: batch.id, softDeleted: !before } } });
    }
    for (const entry of batch.ledgerEntries) {
      const reversal = await tx.ledgerEntry.create({ data: { schoolId: input.schoolId, studentId: entry.studentId, createdBy: input.actorId, entryType: "REVERSAL", amountPaise: -entry.amountPaise, description: `Import rollback for batch ${batch.id}`, reversalOfId: entry.id } });
      await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "fees.opening_balance.reversed_by_import_rollback", entityType: "LedgerEntry", entityId: reversal.id, oldValue: { reverses: entry.id, amountPaise: entry.amountPaise.toString() }, newValue: { amountPaise: reversal.amountPaise.toString(), batchId: batch.id } } });
    }
    await tx.importBatch.update({ where: { id: batch.id }, data: { status: "ROLLED_BACK", rolledBackAt: new Date() } });
    return { id: batch.id, status: "ROLLED_BACK" };
  });
}

export function studentImportErrorCsv(errors: RowIssue[]) {
  return exportCsv(["row", "reason"], errors.map(({ row, message }) => [String(row), message]));
}

/** Call when a later workflow makes an imported record part of durable school history. */
export async function markImportedRecordsUsed(db: ScopedPrisma, schoolId: string, targetType: string, targetId: string) {
  await db.importRecord.updateMany({ where: { schoolId, targetType, targetId, isUsed: false }, data: { isUsed: true } });
}

export const studentImportHeaders = REQUIRED_HEADERS;
