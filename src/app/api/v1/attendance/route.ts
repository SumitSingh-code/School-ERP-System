import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { attendanceNotificationCopy, normalizeAttendanceDate, renderTemplate, teacherCanMarkForDate } from "@/lib/attendance-rules";
import { auditedMutation } from "@/lib/audited-mutation";
import type { ScopedPrisma } from "@/lib/scoped-prisma";
import { withSchoolRoute } from "@/lib/with-school-route";

const todayIst = () => new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
const submitSchema = z.object({
  sectionId: z.string().uuid(),
  date: z.string(),
  absentStudentIds: z.array(z.string().uuid()).max(250),
}).superRefine((value, ctx) => {
  if (!normalizeAttendanceDate(value.date)) ctx.addIssue({ code: "custom", path: ["date"], message: "Enter a real attendance date" });
  if (new Set(value.absentStudentIds).size !== value.absentStudentIds.length) ctx.addIssue({ code: "custom", path: ["absentStudentIds"], message: "A student is listed more than once" });
});

async function canAccessSection(db: ScopedPrisma, principal: { userId: string; activeRole: string; capabilities: ReadonlySet<string> }, sectionId: string, date: Date) {
  if (principal.capabilities.has("attendance.override") || principal.capabilities.has("attendance.late")) return true;
  const classTeacher = Boolean(await db.classTeacherAssignment.findFirst({ where: { userId: principal.userId, sectionId, deletedAt: null } }));
  const substitute = principal.capabilities.has("attendance.substitute") && Boolean(await db.substituteAssignment.findFirst({ where: { userId: principal.userId, sectionId, date, revokedAt: null } }));
  return teacherCanMarkForDate({ classTeacher, substitute, date: date.toISOString().slice(0, 10), today: todayIst() });
}

export const GET = withSchoolRoute("attendance.read", async (request, _context, { db, principal }) => {
  const query = new URL(request.url).searchParams;
  const dateText = query.get("date") ?? todayIst();
  const date = normalizeAttendanceDate(dateText);
  if (!date) return NextResponse.json({ error: "Enter a real date" }, { status: 400 });

  const limited = !principal.capabilities.has("attendance.override") && !principal.capabilities.has("attendance.late");
  const classAssignments = limited ? await db.classTeacherAssignment.findMany({ where: { userId: principal.userId, deletedAt: null }, select: { sectionId: true } }) : [];
  const substituteAssignments = limited && principal.capabilities.has("attendance.substitute") ? await db.substituteAssignment.findMany({ where: { userId: principal.userId, date, revokedAt: null }, select: { sectionId: true } }) : [];
  const ownIds = [...new Set([...classAssignments.map((item) => item.sectionId), ...substituteAssignments.map((item) => item.sectionId)])];
  const requestedSection = query.get("sectionId");
  if (limited && requestedSection && !ownIds.includes(requestedSection)) return NextResponse.json({ error: "This section is not assigned to you" }, { status: 403 });
  const sections = await db.section.findMany({
    where: { active: true, deletedAt: null, ...(limited ? { id: { in: ownIds } } : {}), ...(requestedSection ? { id: requestedSection } : {}) },
    include: { classLevel: { select: { name: true } }, academicYear: { select: { label: true, isCurrent: true } } },
    orderBy: [{ classLevel: { sortOrder: "asc" } }, { name: "asc" }],
  });
  const holiday = await db.holiday.findFirst({ where: { date, deletedAt: null } });
  const attendance = await Promise.all(sections.map(async (section) => {
    const submission = await db.attendanceSubmission.findFirst({ where: { sectionId: section.id, date, voidedAt: null }, include: { submittedBy: { select: { name: true } }, records: { where: { deletedAt: null }, select: { id: true, studentId: true, status: true, lateReason: true, arrivalAt: true } } } });
    const students = await db.student.findMany({ where: { sectionId: section.id, status: "ACTIVE", deletedAt: null }, select: { id: true, admissionNo: true, fullName: true }, orderBy: { fullName: "asc" } });
    return { section, submission, students, status: holiday ? "HOLIDAY" : submission ? "SUBMITTED" : "NOT_SUBMITTED" };
  }));
  return NextResponse.json({ date: dateText, holiday, attendance });
});

export const POST = withSchoolRoute("attendance.mark", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = submitSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the attendance list", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const keyParsed = z.string().uuid().safeParse(request.headers.get("idempotency-key"));
  if (!keyParsed.success) return NextResponse.json({ error: "A valid Idempotency-Key header is required" }, { status: 400 });
  const idempotencyKey = keyParsed.data;
  const date = normalizeAttendanceDate(input.date)!;
  if (input.date > todayIst()) return NextResponse.json({ error: "Attendance cannot be submitted for a future date" }, { status: 400 });
  if (!await canAccessSection(db, principal, input.sectionId, date)) return NextResponse.json({ error: "This section is not assigned to you for attendance" }, { status: 403 });
  if (await db.holiday.findFirst({ where: { date, deletedAt: null } })) return NextResponse.json({ error: "Attendance is not expected on a school holiday" }, { status: 409 });

  const students = await db.student.findMany({ where: { id: { in: input.absentStudentIds }, sectionId: input.sectionId, status: "ACTIVE", deletedAt: null }, select: { id: true, fullName: true } });
  if (students.length !== input.absentStudentIds.length) return NextResponse.json({ error: "One or more students are not active members of this section" }, { status: 403 });
  const alreadySubmitted = await db.attendanceSubmission.findFirst({ where: { sectionId: input.sectionId, date, idempotencyKey }, include: { records: { select: { studentId: true } } } });
  if (alreadySubmitted) {
    const previous = alreadySubmitted.records.map(({ studentId }) => studentId).sort();
    const requested = [...input.absentStudentIds].sort();
    if (previous.length !== requested.length || previous.some((id, index) => id !== requested[index])) return NextResponse.json({ error: "This sync key was already used for different attendance" }, { status: 409 });
    return NextResponse.json({ submission: alreadySubmitted, absentCount: previous.length, notificationCount: 0, replayed: true }, { status: 200 });
  }
  const section = await db.section.findFirst({ where: { id: input.sectionId, active: true, deletedAt: null } });
  if (!section) return NextResponse.json({ error: "Section not found" }, { status: 404 });
  const year = await db.academicYear.findFirst({ where: { id: section.academicYearId } });
  if (!year || date < year.startsOn || date > year.endsOn) return NextResponse.json({ error: "Attendance date must be inside this section's academic year" }, { status: 400 });

  try {
    const result = await auditedMutation(db, {
      actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId,
      action: "attendance.section.submitted", entityType: "AttendanceSubmission",
      newValue: { sectionId: input.sectionId, date: input.date, absentCount: students.length, idempotencyKey },
    }, async (tx) => {
      const submission = await tx.attendanceSubmission.create({ data: { schoolId: principal.schoolId, sectionId: input.sectionId, date, submittedById: principal.userId, idempotencyKey } });
      if (students.length) await tx.attendanceRecord.createMany({ data: students.map((student) => ({ schoolId: principal.schoolId, submissionId: submission.id, sectionId: input.sectionId, studentId: student.id, date, status: "ABSENT" })) });
      const links = students.length ? await tx.studentGuardian.findMany({ where: { studentId: { in: students.map((student) => student.id) }, deletedAt: null }, include: { guardian: { select: { id: true, name: true } }, student: { select: { id: true, fullName: true } } } }) : [];
      const templates = links.length ? await tx.notificationTemplate.findMany({ where: { eventType: "ATTENDANCE_ABSENT", channel: "IN_APP", active: true, language: { in: ["en", "hi"] } } }) : [];
      const notifications = links.map((link) => {
        const copy = attendanceNotificationCopy(link.student.fullName, input.date);
        const english = templates.find((template) => template.language === "en");
        const hindi = templates.find((template) => template.language === "hi");
        const digest = createHash("sha256").update(`${idempotencyKey}:${link.guardian.id}:${link.student.id}`).digest("hex");
        const values = { studentName: link.student.fullName, date: input.date };
        const en = { title: renderTemplate(english?.title ?? copy.en.title, values), body: renderTemplate(english?.body ?? copy.en.body, values) };
        const hi = { title: renderTemplate(hindi?.title ?? copy.hi.title, values), body: renderTemplate(hindi?.body ?? copy.hi.body, values) };
        return { schoolId: principal.schoolId, guardianId: link.guardian.id, eventType: "ATTENDANCE_ABSENT", channel: "IN_APP", status: "QUEUED" as const, title: `${en.title} / ${hi.title}`, body: `${en.body}\n${hi.body}`, payload: { studentName: link.student.fullName, date: input.date, en, hi }, idempotencyKey: digest };
      });
      if (notifications.length) await tx.notification.createMany({ data: notifications, skipDuplicates: true });
      return { submission, absentCount: students.length, notificationCount: notifications.length };
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not submit attendance";
    if (message.includes("Unique constraint")) {
      const raced = await db.attendanceSubmission.findFirst({ where: { sectionId: input.sectionId, date, idempotencyKey }, include: { records: { select: { studentId: true } } } });
      if (raced) {
        const previous = raced.records.map(({ studentId }) => studentId).sort();
        const requested = [...input.absentStudentIds].sort();
        if (previous.length === requested.length && previous.every((id, index) => id === requested[index])) return NextResponse.json({ submission: raced, absentCount: previous.length, notificationCount: 0, replayed: true }, { status: 200 });
      }
      return NextResponse.json({ error: "Attendance for this section was already submitted. Refresh the page to see it." }, { status: 409 });
    }
    return NextResponse.json({ error: "Could not submit attendance. Check the connection and try again." }, { status: 409 });
  }
});
