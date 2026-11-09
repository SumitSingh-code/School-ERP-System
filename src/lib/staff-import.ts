import { createHash } from "node:crypto";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { passwordPolicyError } from "./auth-rules";
import { auditedMutation } from "./audited-mutation";
import { normalizeCsvName, normalizeCsvPhone, parseCsv, signImportPreview, verifyImportPreview } from "./csv-import";
import type { ScopedPrisma } from "./scoped-prisma";

const HEADERS = ["name", "phone", "role", "initial_password", "class_teacher_of"];
const ALLOWED_ROLES = new Set(["Principal", "Reception", "Finance", "Teacher", "Class Teacher", "Subject Teacher", "Substitute"]);
const PREVIEW_TTL_MS = 30 * 60 * 1000;

type StaffRow = { rowNumber: number; name: string; phone: string; role: string; initialPassword: string; assignment: { yearId: string; sectionId: string; sectionLabel: string } | null };
type Issue = { row: number; message: string };

function parseClassTeacherLabel(value: string) {
  const parts = value.split("-").map((part) => part.trim()).filter(Boolean);
  if (parts.length === 2) return { className: parts[0] ?? "", streamName: null, groupName: null, sectionName: parts[1] ?? "" };
  if (parts.length === 3 && ["11", "12"].includes(parts[0] ?? "")) return { className: parts[0] ?? "", streamName: parts[1] ?? "", groupName: null, sectionName: parts[2] ?? "" };
  if (parts.length === 4 && ["11", "12"].includes(parts[0] ?? "")) return { className: parts[0] ?? "", streamName: parts[1] ?? "", groupName: parts[2] ?? "", sectionName: parts[3] ?? "" };
  return null;
}

async function validateStaffCsv(db: ScopedPrisma, rawCsv: string) {
  const parsed = parseCsv(rawCsv);
  const missing = HEADERS.filter((header) => !parsed.headers.includes(header));
  if (missing.length) throw new Error(`Missing required columns: ${missing.join(", ")}`);
  const rows: StaffRow[] = [];
  const errors: Issue[] = [];
  const warnings: Issue[] = [];
  const seenPhones = new Set<string>();
  const currentYear = await db.academicYear.findFirst({ where: { isCurrent: true, deletedAt: null } });

  for (const item of parsed.rows) {
    const value = (key: string) => item.values[key] ?? "";
    if (item.values.__row_error) errors.push({ row: item.rowNumber, message: item.values.__row_error });
    const name = normalizeCsvName(value("name"));
    const phone = normalizeCsvPhone(value("phone"));
    const role = normalizeCsvName(value("role"));
    const password = value("initial_password");
    const assignmentText = value("class_teacher_of").trim();
    if (!name) errors.push({ row: item.rowNumber, message: "Staff name is required" });
    if (!phone) errors.push({ row: item.rowNumber, message: "Enter a valid Indian mobile phone number" });
    if (!ALLOWED_ROLES.has(role)) errors.push({ row: item.rowNumber, message: "Role must be Principal, Reception, Finance, Teacher, Class Teacher, Subject Teacher or Substitute" });
    const passwordError = phone ? passwordPolicyError(password, phone) : "Enter a valid phone before checking the password";
    if (passwordError) errors.push({ row: item.rowNumber, message: `Initial password: ${passwordError}` });
    if (phone && seenPhones.has(phone)) errors.push({ row: item.rowNumber, message: "Phone number appears more than once in this file" });
    if (phone) seenPhones.add(phone);

    let assignment: StaffRow["assignment"] = null;
    if (assignmentText) {
      if (role !== "Class Teacher") errors.push({ row: item.rowNumber, message: "Only a Class Teacher role can have class_teacher_of set" });
      const label = parseClassTeacherLabel(assignmentText);
      if (!label) errors.push({ row: item.rowNumber, message: "Use Class-Section (for example 5-A), Class-Stream-Section, or Class-Science-Group-Section" });
      else if (!currentYear) errors.push({ row: item.rowNumber, message: "Set a current academic year before assigning class teachers" });
      else {
        const classLevel = await db.classLevel.findFirst({ where: { name: { equals: label.className, mode: "insensitive" }, active: true, deletedAt: null } });
        const stream = classLevel && label.streamName ? await db.stream.findFirst({ where: { classLevelId: classLevel.id, name: { equals: label.streamName, mode: "insensitive" }, active: true, deletedAt: null } }) : null;
        const group = stream && label.groupName ? await db.studyGroup.findFirst({ where: { streamId: stream.id, name: { equals: label.groupName, mode: "insensitive" }, active: true, deletedAt: null } }) : null;
        const section = classLevel ? await db.section.findFirst({ where: { classLevelId: classLevel.id, academicYearId: currentYear.id, streamId: stream?.id ?? null, groupId: group?.id ?? null, name: { equals: label.sectionName, mode: "insensitive" }, deletedAt: null } }) : null;
        if (!classLevel || (label.streamName && !stream) || (label.groupName && !group) || !section) errors.push({ row: item.rowNumber, message: `Class teacher section '${assignmentText}' does not exist in the current school year` });
        else {
          if (phone) {
            const existingUser = await db.user.findFirst({ where: { phone } });
            const conflict = existingUser ? await db.classTeacherAssignment.findFirst({ where: { userId: existingUser.id, academicYearId: currentYear.id, deletedAt: null, sectionId: { not: section.id } } }) : null;
            if (conflict) errors.push({ row: item.rowNumber, message: "This staff member is already assigned as class teacher to another section this year" });
          }
          assignment = { yearId: currentYear.id, sectionId: section.id, sectionLabel: assignmentText };
        }
      }
    }

    if (name && phone && ALLOWED_ROLES.has(role) && !passwordError) rows.push({ rowNumber: item.rowNumber, name, phone, role, initialPassword: password, assignment });
  }

  const phones = [...new Set(rows.map((row) => row.phone))];
  const existing = phones.length ? await db.user.findMany({ where: { phone: { in: phones } }, select: { id: true, phone: true, name: true, deletedAt: true } }) : [];
  const byPhone = new Map(existing.map((user) => [user.phone, user]));
  for (const row of rows) {
    const user = byPhone.get(row.phone);
    if (user?.deletedAt) errors.push({ row: row.rowNumber, message: "This phone belongs to an archived account; restore it before importing" });
    else if (user) warnings.push({ row: row.rowNumber, message: "This phone already has a staff account; the name/password will be updated and the selected role added" });
  }
  return {
    rows,
    errors,
    warnings,
    rowCount: parsed.rows.length,
    createCount: rows.filter((row) => !byPhone.has(row.phone)).length,
    updateCount: rows.filter((row) => byPhone.has(row.phone)).length,
    digest: createHash("sha256").update(rawCsv).digest("hex"),
  };
}

export async function previewStaffImport(db: ScopedPrisma, schoolId: string, actorId: string, rawCsv: string) {
  const result = await validateStaffCsv(db, rawCsv);
  const secret = process.env.IMPORT_PREVIEW_SECRET ?? "";
  const previewToken = result.errors.length === 0
    ? signImportPreview({ schoolId, actorId, kind: "staff", digest: result.digest, expiresAt: Date.now() + PREVIEW_TTL_MS }, secret)
    : null;
  return { rowCount: result.rowCount, createCount: result.createCount, updateCount: result.updateCount, errors: result.errors, warnings: result.warnings, previewToken };
}

function toJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}

export async function confirmStaffImport(db: ScopedPrisma, input: { schoolId: string; actorId: string; activeRole: string; fileName: string; rawCsv: string; previewToken: string }) {
  const preview = await validateStaffCsv(db, input.rawCsv);
  const secret = process.env.IMPORT_PREVIEW_SECRET ?? "";
  if (preview.errors.length) throw new Error("The staff CSV has errors. Fix them and preview again.");
  if (!verifyImportPreview(input.previewToken, { schoolId: input.schoolId, actorId: input.actorId, kind: "staff" }, preview.digest, secret)) throw new Error("This preview expired or the file changed. Preview the staff CSV again.");
  const hashedRows = await Promise.all(preview.rows.map(async (row) => ({ ...row, passwordHash: await argon2.hash(row.initialPassword, { type: argon2.argon2id }) })));

  return auditedMutation(db, {
    actorId: input.actorId, activeRole: input.activeRole, schoolId: input.schoolId,
    action: "import.staff.confirmed", entityType: "ImportBatch",
    newValue: { rowCount: preview.rowCount, created: preview.createCount, updated: preview.updateCount },
  }, async (tx) => {
    const batch = await tx.importBatch.create({ data: { schoolId: input.schoolId, actorId: input.actorId, activeRole: input.activeRole, kind: "staff", fileName: input.fileName.replace(/[\\/]/g, "_").slice(-120) || "staff.csv", rowCount: preview.rowCount, createdCount: preview.createCount, updatedCount: preview.updateCount } });
    const records: { targetType: string; targetId: string; operation: string; beforeValue: Prisma.InputJsonValue | null; afterUpdatedAt: Date }[] = [];
    for (const row of hashedRows) {
      const role = await tx.role.findFirst({ where: { name: row.role } });
      if (!role || row.role === "Director") throw new Error("The selected staff role is no longer available");
      const existing = await tx.user.findFirst({ where: { phone: row.phone } });
      if (existing?.deletedAt) throw new Error("A staff account changed after preview. Reopen the preview and try again.");
      const oldUser = existing ? toJson({ name: existing.name, passwordHash: existing.passwordHash, status: existing.status, mustChangePassword: existing.mustChangePassword, deletedAt: existing.deletedAt, updatedAt: existing.updatedAt }) : null;
      const user = existing
        ? await tx.user.update({ where: { id: existing.id }, data: { name: row.name, passwordHash: row.passwordHash, mustChangePassword: true, status: "ACTIVE" } })
        : await tx.user.create({ data: { schoolId: input.schoolId, name: row.name, phone: row.phone, passwordHash: row.passwordHash, mustChangePassword: true } });
      records.push({ targetType: "user", targetId: user.id, operation: existing ? "UPDATE" : "CREATE", beforeValue: oldUser, afterUpdatedAt: user.updatedAt });
      await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: existing ? "staff.import.updated" : "staff.import.created", entityType: "User", entityId: user.id, ...(oldUser ? { oldValue: { name: existing?.name, status: existing?.status } } : {}), newValue: { name: user.name, phoneLastFour: row.phone.slice(-4), mustChangePassword: true } } });
      if (existing) {
        const revoked = await tx.session.updateMany({ where: { userId: user.id, schoolId: input.schoolId, revokedAt: null }, data: { revokedAt: new Date() } });
        if (revoked.count) await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "auth.sessions.revoked_by_staff_import", entityType: "User", entityId: user.id, newValue: { count: revoked.count } } });
      }

      const oldRoleLink = await tx.userRole.findFirst({ where: { userId: user.id, schoolId: input.schoolId, roleId: role.id } });
      if (!oldRoleLink) {
        const link = await tx.userRole.create({ data: { userId: user.id, roleId: role.id, schoolId: input.schoolId } });
        records.push({ targetType: "userRole", targetId: `${user.id}:${role.id}`, operation: "CREATE", beforeValue: null, afterUpdatedAt: link.updatedAt });
        await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "staff.role.assigned_by_import", entityType: "UserRole", entityId: `${user.id}:${role.id}`, newValue: { role: row.role } } });
      } else if (oldRoleLink.deletedAt) {
        const beforeLink = toJson({ deletedAt: oldRoleLink.deletedAt, updatedAt: oldRoleLink.updatedAt });
        const link = await tx.userRole.update({ where: { userId_roleId: { userId: user.id, roleId: role.id } }, data: { deletedAt: null } });
        records.push({ targetType: "userRole", targetId: `${user.id}:${role.id}`, operation: "UPDATE", beforeValue: beforeLink, afterUpdatedAt: link.updatedAt });
        await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "staff.role.restored_by_import", entityType: "UserRole", entityId: `${user.id}:${role.id}`, oldValue: beforeLink, newValue: { role: row.role, active: true } } });
      }

      if (row.assignment) {
        const existingAssignment = await tx.classTeacherAssignment.findFirst({ where: { userId: user.id, academicYearId: row.assignment.yearId, deletedAt: null } });
        if (existingAssignment && existingAssignment.sectionId !== row.assignment.sectionId) throw new Error("Class teacher assignment changed after preview; nothing was imported");
        if (!existingAssignment) {
          const assignment = await tx.classTeacherAssignment.create({ data: { schoolId: input.schoolId, academicYearId: row.assignment.yearId, sectionId: row.assignment.sectionId, userId: user.id } });
          records.push({ targetType: "classTeacherAssignment", targetId: assignment.id, operation: "CREATE", beforeValue: null, afterUpdatedAt: assignment.updatedAt });
          await tx.auditLog.create({ data: { actorId: input.actorId, schoolId: input.schoolId, activeRole: input.activeRole, action: "staff.class_teacher_assigned_by_import", entityType: "ClassTeacherAssignment", entityId: assignment.id, newValue: { sectionId: assignment.sectionId, academicYearId: assignment.academicYearId } } });
        }
      }
    }
    if (records.length) await tx.importRecord.createMany({ data: records.map((record) => ({ schoolId: input.schoolId, batchId: batch.id, actorId: input.actorId, ...record, beforeValue: record.beforeValue ?? Prisma.DbNull })) });
    return { id: batch.id, rowCount: batch.rowCount, createdCount: batch.createdCount, updatedCount: batch.updatedCount };
  });
}
