import { PrismaClient } from "@prisma/client";
import { forSchool } from "@/lib/scoped-prisma";
import { renderTemplate } from "@/lib/attendance-rules";

const istClock = new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Kolkata", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
const istDate = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Kolkata", year: "numeric", month: "2-digit", day: "2-digit" });

export async function queueAttendanceReminders(prisma: PrismaClient, now = new Date()) {
  const dateText = istDate.format(now);
  const date = new Date(`${dateText}T00:00:00.000Z`);
  const clock = istClock.format(now);
  const nowMinutes = Number(clock.slice(0, 2)) * 60 + Number(clock.slice(3, 5));
  const schools = await prisma.school.findMany({ select: { id: true } });
  let queued = 0;
  for (const school of schools) {
    const db = forSchool(prisma, school.id);
    const [schedule, holiday] = await Promise.all([
      db.scheduleSettings.findFirst(),
      db.holiday.findFirst({ where: { date, deletedAt: null } }),
    ]);
    if (holiday || !(schedule?.workingDays ?? [1, 2, 3, 4, 5, 6]).includes(date.getUTCDay())) continue;
    const [cutoffHour, cutoffMinute] = (schedule?.attendanceCutoff ?? "10:00").split(":").map(Number);
    const cutoff = cutoffHour * 60 + cutoffMinute;
    const escalationAt = cutoff + (schedule?.attendanceEscalationMinutes ?? 30);
    if (nowMinutes < cutoff) continue;

    const sections = await db.section.findMany({
      where: { active: true, deletedAt: null, academicYear: { isCurrent: true } },
      include: { classLevel: { select: { name: true } }, classTeacherAssignment: { where: { deletedAt: null }, include: { staff: { select: { id: true, status: true, deletedAt: true } } } } },
    });
    const submitted = new Set((await db.attendanceSubmission.findMany({ where: { date }, select: { sectionId: true } })).map(({ sectionId }) => sectionId));
    const pending = sections.filter((section) => !submitted.has(section.id));
    if (!pending.length) continue;

    const principals = nowMinutes >= escalationAt
      ? await db.userRole.findMany({ where: { deletedAt: null, role: { name: "Principal" }, user: { status: "ACTIVE", deletedAt: null } }, select: { userId: true } })
      : [];
    const eventType = nowMinutes >= escalationAt ? "ATTENDANCE_ESCALATION" : "ATTENDANCE_PENDING";
    const templates = await db.notificationTemplate.findMany({ where: { eventType, language: { in: ["en", "hi"] }, channel: "IN_APP", active: true } });
    const en = templates.find((template) => template.language === "en");
    const hi = templates.find((template) => template.language === "hi");
    const messages = pending.flatMap((section) => {
      const values = { sectionName: `${section.classLevel.name} · ${section.name}`, date: dateText };
      const common = {
        schoolId: school.id,
        eventType,
        channel: "IN_APP",
        title: `${renderTemplate(en?.title ?? "Attendance reminder", values)} / ${renderTemplate(hi?.title ?? "उपस्थिति अनुस्मारक", values)}`,
        body: `${renderTemplate(en?.body ?? "Please submit attendance for {{sectionName}} for {{date}}.", values)}\n${renderTemplate(hi?.body ?? "कृपया {{date}} के लिए {{sectionName}} की उपस्थिति जमा करें।", values)}`,
        payload: { sectionId: section.id, sectionName: values.sectionName, date: dateText },
      };
      const teacherNotices = section.classTeacherAssignment
        .filter(({ staff }) => staff.status === "ACTIVE" && !staff.deletedAt)
        .map(({ userId }) => ({ ...common, userId, idempotencyKey: `attendance:${dateText}:${section.id}:teacher:${userId}` }));
      const principalNotices = principals.map(({ userId }) => ({ ...common, userId, idempotencyKey: `attendance:${dateText}:${section.id}:principal:${userId}` }));
      return [...teacherNotices, ...principalNotices];
    });
    if (messages.length) {
      const count = (await db.notification.createMany({ data: messages, skipDuplicates: true })).count;
      if (count) {
        queued += count;
        await db.auditLog.create({ data: { schoolId: school.id, activeRole: "System", action: "attendance.reminders.queued", entityType: "Notification", newValue: { eventType, date: dateText, count } } });
      }
    }
  }
  return queued;
}
