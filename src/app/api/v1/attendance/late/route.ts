import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { renderTemplate } from "@/lib/attendance-rules";
import { withSchoolRoute } from "@/lib/with-school-route";

const schema = z.object({ recordId: z.string().uuid(), reason: z.string().trim().min(3).max(240), arrivalAt: z.string().datetime() });

export const POST = withSchoolRoute("attendance.late", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Add an arrival time and reason", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const record = await db.attendanceRecord.findFirst({ where: { id: parsed.data.recordId, status: "ABSENT", deletedAt: null }, include: { student: { select: { fullName: true } }, submission: { select: { date: true } } } });
  if (!record) return NextResponse.json({ error: "Absent record not found or already changed" }, { status: 404 });
  const arrivalAt = new Date(parsed.data.arrivalAt);
  const arrivalDateIst = new Date(arrivalAt.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10);
  if (arrivalDateIst !== record.date.toISOString().slice(0, 10)) return NextResponse.json({ error: "Arrival time must be on the attendance date" }, { status: 400 });
  const links = await db.studentGuardian.findMany({ where: { studentId: record.studentId, deletedAt: null }, select: { guardianId: true } });
  try {
    await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "attendance.absent.changed_to_late", entityType: "AttendanceRecord", entityId: record.id, oldValue: { status: "ABSENT" }, newValue: { status: "LATE", reason: parsed.data.reason, arrivalAt } }, async (tx) => {
      const changed = await tx.attendanceRecord.updateMany({ where: { id: record.id, status: "ABSENT", deletedAt: null }, data: { status: "LATE", lateReason: parsed.data.reason, arrivalAt, changedById: principal.userId } });
      if (changed.count !== 1) throw new Error("Attendance record has already changed");
      const date = record.date.toISOString().slice(0, 10);
      if (links.length) {
        const templates = await tx.notificationTemplate.findMany({ where: { eventType: "ATTENDANCE_LATE_CORRECTION", channel: "IN_APP", active: true, language: { in: ["en", "hi"] } } });
        const english = templates.find((template) => template.language === "en");
        const hindi = templates.find((template) => template.language === "hi");
        const values = { studentName: record.student.fullName, date };
        const enTitle = renderTemplate(english?.title ?? "Attendance correction", values);
        const enBody = renderTemplate(english?.body ?? "{{studentName}} arrived late on {{date}}; please ignore the earlier absence message.", values);
        const hiTitle = renderTemplate(hindi?.title ?? "उपस्थिति में सुधार", values);
        const hiBody = renderTemplate(hindi?.body ?? "{{studentName}} आज देर से पहुँचे हैं; कृपया पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।", values);
        await tx.notification.createMany({ data: links.map(({ guardianId }) => ({ schoolId: principal.schoolId, guardianId, eventType: "ATTENDANCE_LATE_CORRECTION", channel: "IN_APP", title: `${enTitle} / ${hiTitle}`, body: `${enBody}\n${hiBody}`, payload: { studentName: record.student.fullName, date, reason: parsed.data.reason, en: { title: enTitle, body: enBody }, hi: { title: hiTitle, body: hiBody } }, idempotencyKey: `late:${record.id}:${guardianId}` })), skipDuplicates: true });
      }
    });
    return NextResponse.json({ ok: true, status: "LATE" });
  } catch {
    return NextResponse.json({ error: "This attendance record changed already; refresh and try again" }, { status: 409 });
  }
});
