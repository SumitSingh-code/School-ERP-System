import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { renderTemplate } from "@/lib/attendance-rules";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real date");
const indiaToday = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const postSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), date: dateOnly, reason: z.string().trim().min(2).max(120), type: z.enum(["PLANNED", "SUDDEN"]).default("PLANNED") }),
  z.object({ action: z.literal("previewSudden"), date: dateOnly }),
  z.object({ action: z.literal("nationalDates"), year: z.number().int().min(2020).max(2100) }),
  z.object({ action: z.literal("secondSaturday"), date: dateOnly }),
]);

export const GET = withSchoolRoute("holiday.manage", async (request, _context, { db }) => {
  const year = Number(new URL(request.url).searchParams.get("year") ?? new Date().getFullYear());
  const holidays = await db.holiday.findMany({ where: { deletedAt: null, date: { gte: new Date(Date.UTC(year, 0, 1)), lt: new Date(Date.UTC(year + 1, 0, 1)) } }, orderBy: { date: "asc" } });
  return NextResponse.json({ holidays, year });
});

export const POST = withSchoolRoute("holiday.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = postSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the holiday details", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  if (input.action === "previewSudden") {
    if (!principal.capabilities.has("holiday.sudden") || !["Director", "Principal"].includes(principal.activeRole)) return NextResponse.json({ error: "Only a Director or Principal can announce a same-day closure" }, { status: 403 });
    if (input.date !== indiaToday()) return NextResponse.json({ error: "Sudden closures must be for today" }, { status: 400 });
    const links = await db.studentGuardian.findMany({ where: { deletedAt: null, student: { status: "ACTIVE", deletedAt: null } }, select: { guardianId: true } });
    const guardians = new Set(links.map(({ guardianId }) => guardianId));
    const staffCount = await db.user.count({ where: { status: "ACTIVE", deletedAt: null } });
    const attendance = await db.attendanceRecord.findMany({ where: { date: new Date(`${input.date}T00:00:00.000Z`), status: { in: ["ABSENT", "LATE"] }, deletedAt: null }, select: { studentId: true } });
    const absentLinks = attendance.length ? await db.studentGuardian.findMany({ where: { studentId: { in: attendance.map(({ studentId }) => studentId) }, deletedAt: null, student: { status: "ACTIVE", deletedAt: null } }, select: { guardianId: true } }) : [];
    return NextResponse.json({ preview: { guardianCount: guardians.size, staffCount, absenceCorrectionGuardianCount: new Set(absentLinks.map(({ guardianId }) => guardianId)).size } });
  }
  if (input.action === "create" && input.type === "SUDDEN") {
    if (!principal.capabilities.has("holiday.sudden") || !["Director", "Principal"].includes(principal.activeRole)) return NextResponse.json({ error: "Only a Director or Principal can announce a same-day closure" }, { status: 403 });
    if (input.date !== indiaToday()) return NextResponse.json({ error: "Sudden closures must be for today" }, { status: 400 });
  }
  if (input.action === "secondSaturday") {
    const date = new Date(`${input.date}T00:00:00.000Z`);
    if (date.getUTCDay() !== 6 || date.getUTCDate() < 8 || date.getUTCDate() > 14) return NextResponse.json({ error: "Choose the second Saturday of a month" }, { status: 400 });
  }
  const items = input.action === "nationalDates"
    ? [{ date: `${input.year}-01-26`, reason: "Republic Day" }, { date: `${input.year}-08-15`, reason: "Independence Day" }, { date: `${input.year}-10-02`, reason: "Gandhi Jayanti" }]
    : input.action === "secondSaturday" ? [{ date: input.date, reason: "Second Saturday" }] : [{ date: input.date, reason: input.reason }];
  try {
    const created = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "holiday.created", entityType: "Holiday", newValue: items }, async (tx) => {
      const result = [];
      for (const item of items) {
        const date = new Date(`${item.date}T00:00:00.000Z`);
        const existing = await tx.holiday.findFirst({ where: { date } });
        if (existing?.type === "SUDDEN") throw new Error("A sudden closure and its attendance corrections are permanent for that date");
        const holiday = existing
          ? await tx.holiday.update({ where: { id: existing.id }, data: { reason: item.reason, type: input.action === "create" ? input.type : "PLANNED", deletedAt: null, createdById: principal.userId } })
          : await tx.holiday.create({ data: { schoolId: principal.schoolId, date, reason: item.reason, type: input.action === "create" ? input.type : "PLANNED", createdById: principal.userId } });
        await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: existing ? "holiday.updated" : "holiday.created", entityType: "Holiday", entityId: holiday.id, oldValue: existing ? { date: existing.date, type: existing.type, reason: existing.reason } : undefined, newValue: { date, type: holiday.type, reason: holiday.reason } } });
        if (input.action === "create" && input.type === "SUDDEN") {
          const dayText = item.date;
          const submissions = await tx.attendanceSubmission.findMany({ where: { date, voidedAt: null }, include: { records: { where: { status: { in: ["ABSENT", "LATE"] }, deletedAt: null }, include: { student: { select: { id: true, fullName: true } } } } } });
          const absentStudents = new Map<string, string>();
          for (const submission of submissions) for (const record of submission.records) absentStudents.set(record.student.id, record.student.fullName);
          const guardianLinks = await tx.studentGuardian.findMany({ where: { deletedAt: null, student: { status: "ACTIVE", deletedAt: null } }, include: { guardian: { select: { id: true } }, student: { select: { id: true, fullName: true } } } });
          const templates = await tx.notificationTemplate.findMany({ where: { eventType: { in: ["SCHOOL_HOLIDAY", "ATTENDANCE_VOIDED_FOR_HOLIDAY"] }, language: { in: ["en", "hi"] }, channel: "IN_APP", active: true } });
          const getCopy = (eventType: string, language: string, fallback: string, values: Record<string, string>) => renderTemplate(templates.find((template) => template.eventType === eventType && template.language === language)?.body ?? fallback, values);
          const reasonValues = { date: dayText, reason: item.reason };
          const holidayCopy = {
            en: getCopy("SCHOOL_HOLIDAY", "en", "School is closed today ({{date}}): {{reason}}.", reasonValues),
            hi: getCopy("SCHOOL_HOLIDAY", "hi", "आज ({{date}}) स्कूल बंद है: {{reason}}।", reasonValues),
          };
          const guardians = new Map(guardianLinks.map((link) => [link.guardian.id, link.guardian.id]));
          const corrections = new Map<string, { guardianId: string; studentId: string; studentName: string }>();
          for (const link of guardianLinks) if (absentStudents.has(link.student.id)) corrections.set(`${link.guardian.id}:${link.student.id}`, { guardianId: link.guardian.id, studentId: link.student.id, studentName: link.student.fullName });
          const start = new Date(date.getTime() - 330 * 60 * 1000);
          const end = new Date(start.getTime() + 24 * 60 * 60 * 1000);
          await tx.notification.updateMany({ where: { eventType: { in: ["ATTENDANCE_PENDING", "ATTENDANCE_ESCALATION"] }, status: "QUEUED", queuedAt: { gte: start, lt: end } }, data: { status: "CANCELLED" } });
          const queuedAbsenceNotices = await tx.notification.findMany({ where: { eventType: { in: ["ATTENDANCE_ABSENT", "ATTENDANCE_LATE_CORRECTION"] }, status: "QUEUED", payload: { path: ["date"], equals: dayText } }, select: { id: true } });
          if (queuedAbsenceNotices.length) await tx.notification.updateMany({ where: { id: { in: queuedAbsenceNotices.map(({ id }) => id) } }, data: { status: "CANCELLED" } });
          const voided = await tx.attendanceSubmission.updateMany({ where: { date, voidedAt: null }, data: { voidedAt: new Date(), voidedById: principal.userId, voidReason: `Sudden holiday: ${item.reason}` } });
          await tx.attendanceRecord.updateMany({ where: { date, deletedAt: null }, data: { deletedAt: new Date() } });
          for (const submission of submissions) await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "attendance.submission.voided_for_holiday", entityType: "AttendanceSubmission", entityId: submission.id, oldValue: { absentCount: submission.records.length }, newValue: { holidayId: holiday.id, reason: item.reason } } });
          const guardiansNotified = [...guardians.values()].map((guardianId) => ({ schoolId: principal.schoolId, guardianId, eventType: "SCHOOL_HOLIDAY", channel: "IN_APP", title: "School closed today / आज स्कूल बंद है", body: `${holidayCopy.en}\n${holidayCopy.hi}`, payload: { date: dayText, reason: item.reason, en: holidayCopy.en, hi: holidayCopy.hi }, idempotencyKey: createHash("sha256").update(`holiday:${holiday.id}:guardian:${guardianId}`).digest("hex") }));
          if (guardiansNotified.length) await tx.notification.createMany({ data: guardiansNotified, skipDuplicates: true });
          const staff = await tx.user.findMany({ where: { status: "ACTIVE", deletedAt: null }, select: { id: true } });
          const staffNotified = staff.map(({ id }) => ({ schoolId: principal.schoolId, userId: id, eventType: "SCHOOL_HOLIDAY", channel: "IN_APP", title: "School closed today / आज स्कूल बंद है", body: `${holidayCopy.en}\n${holidayCopy.hi}`, payload: { date: dayText, reason: item.reason, en: holidayCopy.en, hi: holidayCopy.hi }, idempotencyKey: createHash("sha256").update(`holiday:${holiday.id}:staff:${id}`).digest("hex") }));
          if (staffNotified.length) await tx.notification.createMany({ data: staffNotified, skipDuplicates: true });
          const correctionNotices = [...corrections.values()].map((recipient) => {
            const values = { date: dayText, studentName: recipient.studentName };
            const en = getCopy("ATTENDANCE_VOIDED_FOR_HOLIDAY", "en", "School is closed on {{date}}. Please ignore the earlier absence message for {{studentName}}.", values);
            const hi = getCopy("ATTENDANCE_VOIDED_FOR_HOLIDAY", "hi", "{{date}} को स्कूल बंद है। कृपया {{studentName}} के लिए पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।", values);
            return { schoolId: principal.schoolId, guardianId: recipient.guardianId, eventType: "ATTENDANCE_VOIDED_FOR_HOLIDAY", channel: "IN_APP", title: "Attendance correction / उपस्थिति में सुधार", body: `${en}\n${hi}`, payload: { date: dayText, studentName: recipient.studentName, en, hi }, idempotencyKey: createHash("sha256").update(`holiday:${holiday.id}:correction:${recipient.guardianId}:${recipient.studentId}`).digest("hex") };
          });
          if (correctionNotices.length) await tx.notification.createMany({ data: correctionNotices, skipDuplicates: true });
          await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "holiday.sudden.broadcast_queued", entityType: "Holiday", entityId: holiday.id, newValue: { guardianCount: guardiansNotified.length, staffCount: staffNotified.length, correctionCount: correctionNotices.length, voidedSubmissionCount: voided.count } } });
        }
        result.push(holiday);
      }
      return result;
    });
    return NextResponse.json({ holidays: created }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save the holiday" }, { status: 409 });
  }
});

export const DELETE = withSchoolRoute("holiday.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid holiday" }, { status: 400 });
  const holiday = await db.holiday.findFirst({ where: { id: parsed.data.id, deletedAt: null } });
  if (!holiday) return NextResponse.json({ error: "Holiday not found" }, { status: 404 });
  if (holiday.type === "SUDDEN") return NextResponse.json({ error: "A sudden closure cannot be removed because attendance and notifications are already audited" }, { status: 409 });
  await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "holiday.deleted", entityType: "Holiday", entityId: holiday.id, oldValue: { date: holiday.date, type: holiday.type, reason: holiday.reason } }, async (tx) => {
    await tx.holiday.update({ where: { id: holiday.id }, data: { deletedAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
});
