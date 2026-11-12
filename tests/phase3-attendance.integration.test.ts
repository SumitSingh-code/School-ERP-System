import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { seedSystemRoles } from "../src/lib/role-permissions";
import { GET as getAttendance, POST as submitAttendance } from "../src/app/api/v1/attendance/route";
import { POST as markLate } from "../src/app/api/v1/attendance/late/route";
import { POST as addHoliday } from "../src/app/api/v1/holidays/route";
import { queueAttendanceReminders } from "../src/worker/attendance-reminders";

const enabled = process.env.TENANT_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);
type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;
function call(handler: Handler, token: string, method: string, url: string, body?: object) {
  const request = new NextRequest(url, { method, headers: { cookie: `school_access=${token}`, ...(body ? { "content-type": "application/json", ...(typeof body === "object" && "idempotencyKey" in body ? { "idempotency-key": String(body.idempotencyKey) } : {}) } : {}) }, ...(body ? { body: JSON.stringify(Object.fromEntries(Object.entries(body).filter(([key]) => key !== "idempotencyKey"))) } : {}) });
  return handler(request, { params: Promise.resolve({}) });
}

test("Phase 3 attendance submission, notification outbox, late correction, permissions and school isolation", { skip: !enabled }, async () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const schoolA = `phase3-a-${suffix}`; const schoolB = `phase3-b-${suffix}`;
  const directorId = randomUUID(); const teacherId = randomUUID(); const teacherTwoId = randomUUID(); const principalId = randomUUID(); const financeId = randomUUID(); const parentActorId = randomUUID();
  const tokens: string[] = [];
  try {
    await seedSystemRoles(prisma);
    const [directorRole, teacherRole, financeRole, classTeacherRole, principalRole] = await Promise.all([
      prisma.role.findUniqueOrThrow({ where: { name: "Director" } }),
      prisma.role.findUniqueOrThrow({ where: { name: "Teacher" } }),
      prisma.role.findUniqueOrThrow({ where: { name: "Finance" } }),
      prisma.role.findUniqueOrThrow({ where: { name: "Class Teacher" } }),
      prisma.role.findUniqueOrThrow({ where: { name: "Principal" } }),
    ]);
    await prisma.school.createMany({ data: [{ id: schoolA, name: "Synthetic Attendance School A" }, { id: schoolB, name: "Synthetic Attendance School B" }] });
    await prisma.user.createMany({ data: [
      { id: directorId, schoolId: schoolA, name: "Synthetic Director", phone: `p3-${suffix}-director` },
      { id: teacherId, schoolId: schoolA, name: "Synthetic Class Teacher", phone: `p3-${suffix}-teacher` },
      { id: teacherTwoId, schoolId: schoolA, name: "Synthetic Second Class Teacher", phone: `p3-${suffix}-teacher-two` },
      { id: principalId, schoolId: schoolA, name: "Synthetic Principal", phone: `p3-${suffix}-principal` },
      { id: financeId, schoolId: schoolA, name: "Synthetic Finance", phone: `p3-${suffix}-finance` },
      { id: parentActorId, schoolId: schoolB, name: "Synthetic School B Director", phone: `p3-${suffix}-schoolb` },
    ] });
    await prisma.userRole.createMany({ data: [
      { schoolId: schoolA, userId: directorId, roleId: directorRole.id },
      { schoolId: schoolA, userId: teacherId, roleId: classTeacherRole.id },
      { schoolId: schoolA, userId: teacherId, roleId: teacherRole.id },
      { schoolId: schoolA, userId: teacherTwoId, roleId: classTeacherRole.id },
      { schoolId: schoolA, userId: principalId, roleId: principalRole.id },
      { schoolId: schoolA, userId: financeId, roleId: financeRole.id },
    ] });
    const tokenFor = async (userId: string, schoolId: string, activeRole: string) => {
      const token = randomUUID(); tokens.push(token);
      await prisma.session.create({ data: { userId, schoolId, activeRole, refreshTokenHash: createHash("sha256").update(randomUUID()).digest("hex"), accessTokenHash: createHash("sha256").update(token).digest("hex"), accessExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 60_000) } });
      return token;
    };
    const directorToken = await tokenFor(directorId, schoolA, "Director");
    const teacherToken = await tokenFor(teacherId, schoolA, "Class Teacher");
    const financeToken = await tokenFor(financeId, schoolA, "Finance");
    const yearA = await prisma.academicYear.create({ data: { schoolId: schoolA, label: "2026-27", startsOn: new Date("2026-04-01Z"), endsOn: new Date("2027-03-31Z"), isCurrent: true } });
    const classA = await prisma.classLevel.create({ data: { schoolId: schoolA, name: "Synthetic Class 4", sortOrder: 4 } });
    const classB = await prisma.classLevel.create({ data: { schoolId: schoolB, name: "Synthetic Class 4", sortOrder: 4 } });
    const sectionA = await prisma.section.create({ data: { schoolId: schoolA, academicYearId: yearA.id, classLevelId: classA.id, name: "A" } });
    const sectionA2 = await prisma.section.create({ data: { schoolId: schoolA, academicYearId: yearA.id, classLevelId: classA.id, name: "B" } });
    const yearB = await prisma.academicYear.create({ data: { schoolId: schoolB, label: "2026-27", startsOn: new Date("2026-04-01Z"), endsOn: new Date("2027-03-31Z"), isCurrent: true } });
    const sectionB = await prisma.section.create({ data: { schoolId: schoolB, academicYearId: yearB.id, classLevelId: classB.id, name: "A" } });
    await prisma.classTeacherAssignment.create({ data: { schoolId: schoolA, academicYearId: yearA.id, sectionId: sectionA.id, userId: teacherId } });
    await prisma.classTeacherAssignment.create({ data: { schoolId: schoolA, academicYearId: yearA.id, sectionId: sectionA2.id, userId: teacherTwoId } });
    const studentA = await prisma.student.create({ data: { schoolId: schoolA, admissionNo: `SYN-${suffix.slice(0, 8)}`, fullName: "Synthetic Absent Student", status: "ACTIVE", sectionId: sectionA.id } });
    const studentB = await prisma.student.create({ data: { schoolId: schoolB, admissionNo: `SYN-B-${suffix.slice(0, 8)}`, fullName: "Synthetic Other School Student", status: "ACTIVE", sectionId: sectionB.id } });
    const foreignSubmission = await prisma.attendanceSubmission.create({ data: { schoolId: schoolB, sectionId: sectionB.id, date: new Date("2026-11-10T00:00:00Z"), submittedById: parentActorId, idempotencyKey: randomUUID() } });
    const foreignRecord = await prisma.attendanceRecord.create({ data: { schoolId: schoolB, submissionId: foreignSubmission.id, sectionId: sectionB.id, studentId: studentB.id, date: new Date("2026-11-10T00:00:00Z"), status: "ABSENT" } });
    const guardianA = await prisma.guardian.create({ data: { schoolId: schoolA, name: "Synthetic Guardian A", phone: `p3-parent-a-${suffix}` } });
    await prisma.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentA.id, guardianId: guardianA.id, relation: "Parent", isPrimary: true } });
    const baseUrl = "http://localhost/api/v1/attendance";
    const date = "2026-11-10";

    const before = await call(getAttendance as Handler, teacherToken, "GET", `${baseUrl}?date=${date}`);
    assert.equal(before.status, 200);
    const initial = await before.json();
    assert.equal(initial.attendance.length, 1, "teacher only sees their assigned section");
    assert.equal(initial.attendance[0].status, "NOT_SUBMITTED", "a missing submission is not presented as present");
    assert.equal(initial.attendance[0].students.some((student: { id: string }) => student.id === studentB.id), false);

    const body = { sectionId: sectionA.id, date, idempotencyKey: randomUUID(), absentStudentIds: [studentA.id] };
    const noIdempotencyKey = await call(submitAttendance as Handler, teacherToken, "POST", baseUrl, { sectionId: sectionA.id, date, absentStudentIds: [studentA.id] });
    assert.equal(noIdempotencyKey.status, 400, "attendance writes require the idempotency-key header");
    const denied = await call(submitAttendance as Handler, financeToken, "POST", baseUrl, body);
    assert.equal(denied.status, 403, "Finance cannot mark attendance");
    const foreignRead = await call(getAttendance as Handler, teacherToken, "GET", `${baseUrl}?date=${date}&sectionId=${sectionB.id}`);
    assert.equal(foreignRead.status, 403, "teacher cannot ask for a foreign school section");
    const foreignWrite = await call(submitAttendance as Handler, directorToken, "POST", baseUrl, { ...body, sectionId: sectionB.id, absentStudentIds: [studentB.id] });
    assert.equal(foreignWrite.status, 403, "school A Director cannot submit school B students into attendance");

    const parallel = await Promise.all([
      call(submitAttendance as Handler, teacherToken, "POST", baseUrl, body),
      call(submitAttendance as Handler, teacherToken, "POST", baseUrl, body),
    ]);
    assert.deepEqual(parallel.map((response) => response.status).sort(), [200, 201], "parallel retries are idempotent and create one section submission");
    const submission = await prisma.attendanceSubmission.findFirstOrThrow({ where: { schoolId: schoolA, sectionId: sectionA.id, date: new Date(`${date}T00:00:00Z`) } });
    assert.equal(await prisma.attendanceRecord.count({ where: { schoolId: schoolA, submissionId: submission.id, studentId: studentA.id, status: "ABSENT" } }), 1);
    const notice = await prisma.notification.findFirstOrThrow({ where: { schoolId: schoolA, guardianId: guardianA.id, eventType: "ATTENDANCE_ABSENT" } });
    assert.match(notice.body, /अनुपस्थित/);
    assert.equal(await prisma.auditLog.count({ where: { schoolId: schoolA, entityId: submission.id, action: "attendance.section.submitted" } }), 1);
    const repeated = await call(submitAttendance as Handler, teacherToken, "POST", baseUrl, body);
    assert.equal(repeated.status, 200, "retrying a synced offline draft returns the existing success");
    assert.equal((await repeated.json()).replayed, true);

    const after = await call(getAttendance as Handler, teacherToken, "GET", `${baseUrl}?date=${date}`);
    assert.equal((await after.json()).attendance[0].status, "SUBMITTED");
    const deniedLate = await call(markLate as Handler, teacherToken, "POST", "http://localhost/api/v1/attendance/late", { recordId: notice.id, reason: "Synthetic reason", arrivalAt: `${date}T03:00:00.000Z` });
    assert.equal(deniedLate.status, 403, "class teachers cannot edit submitted attendance");
    const crossSchoolLate = await call(markLate as Handler, directorToken, "POST", "http://localhost/api/v1/attendance/late", { recordId: foreignRecord.id, reason: "Synthetic reason", arrivalAt: `${date}T03:00:00.000Z` });
    assert.equal(crossSchoolLate.status, 404, "school A cannot change school B's attendance record");
    assert.equal((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: foreignRecord.id } })).status, "ABSENT");

    const schoolBSubmissionCount = await prisma.attendanceSubmission.count({ where: { schoolId: schoolB } });
    assert.equal(schoolBSubmissionCount, 0, "school B remains unchanged");

    await prisma.scheduleSettings.create({ data: { schoolId: schoolA, workingDays: [1, 2, 3, 4, 5, 6], periodLayout: [], attendanceCutoff: "10:00", attendanceEscalationMinutes: 30 } });
    const beforeCutoff = new Date("2026-11-10T04:35:00.000Z"); // 10:05 IST
    assert.equal(await queueAttendanceReminders(prisma, beforeCutoff), 1, "the unsubmitted section queues its class teacher reminder");
    assert.equal(await queueAttendanceReminders(prisma, beforeCutoff), 0, "reminder retries are idempotent");
    const escalationTime = new Date("2026-11-10T05:00:00.000Z"); // 10:30 IST
    assert.equal(await queueAttendanceReminders(prisma, escalationTime), 2, "the class teacher and Principal receive escalation-stage reminders");
    assert.ok(await prisma.auditLog.count({ where: { schoolId: schoolA, action: "attendance.reminders.queued" } }) >= 2, "worker reminder writes are audited");

    const today = new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
    const todayDate = new Date(`${today}T00:00:00Z`);
    const studentToday = await prisma.student.create({ data: { schoolId: schoolA, admissionNo: `SYN-T-${suffix.slice(0, 8)}`, fullName: "Synthetic Holiday Student", status: "ACTIVE", sectionId: sectionA2.id } });
    const guardianToday = await prisma.guardian.create({ data: { schoolId: schoolA, name: "Synthetic Holiday Guardian", phone: `p3-parent-today-${suffix}` } });
    await prisma.studentGuardian.create({ data: { schoolId: schoolA, studentId: studentToday.id, guardianId: guardianToday.id, relation: "Parent", isPrimary: true } });
    const todaySubmission = await prisma.attendanceSubmission.create({ data: { schoolId: schoolA, sectionId: sectionA2.id, date: todayDate, submittedById: teacherTwoId, idempotencyKey: randomUUID() } });
    const todayRecord = await prisma.attendanceRecord.create({ data: { schoolId: schoolA, submissionId: todaySubmission.id, sectionId: sectionA2.id, studentId: studentToday.id, date: todayDate, status: "ABSENT" } });
    const queuedAbsence = await prisma.notification.create({ data: { schoolId: schoolA, guardianId: guardianToday.id, eventType: "ATTENDANCE_ABSENT", channel: "IN_APP", title: "Synthetic absence", body: "Synthetic queued absence", payload: { date: today, studentName: studentToday.fullName }, idempotencyKey: randomUUID() } });
    const preview = await call(addHoliday as Handler, directorToken, "POST", "http://localhost/api/v1/holidays", { action: "previewSudden", date: today });
    assert.equal(preview.status, 200);
    assert.equal((await preview.json()).preview.absenceCorrectionGuardianCount, 1);
    const sudden = await call(addHoliday as Handler, directorToken, "POST", "http://localhost/api/v1/holidays", { action: "create", date: today, reason: "Synthetic emergency closure", type: "SUDDEN" });
    assert.equal(sudden.status, 201, "a Director can announce a same-day closure");
    assert.ok((await prisma.attendanceSubmission.findUniqueOrThrow({ where: { id: todaySubmission.id } })).voidedAt, "today's attendance submission is retained as voided");
    assert.ok((await prisma.attendanceRecord.findUniqueOrThrow({ where: { id: todayRecord.id } })).deletedAt, "absence record is soft-voided");
    assert.equal((await prisma.notification.findUniqueOrThrow({ where: { id: queuedAbsence.id } })).status, "CANCELLED", "queued absence notification is cancelled");
    assert.equal(await prisma.notification.count({ where: { schoolId: schoolA, guardianId: guardianToday.id, eventType: "SCHOOL_HOLIDAY" } }), 1, "guardian receives the school closure outbox event");
    assert.equal(await prisma.notification.count({ where: { schoolId: schoolA, guardianId: guardianToday.id, eventType: "ATTENDANCE_VOIDED_FOR_HOLIDAY" } }), 1, "guardian receives the absence correction outbox event");
    assert.equal(await prisma.notification.count({ where: { schoolId: schoolA, userId: directorId, eventType: "SCHOOL_HOLIDAY" } }), 1, "staff receive the closure outbox event");
    assert.ok(await prisma.auditLog.count({ where: { schoolId: schoolA, entityId: todaySubmission.id, action: "attendance.submission.voided_for_holiday" } }));
    const downgradeSudden = await call(addHoliday as Handler, directorToken, "POST", "http://localhost/api/v1/holidays", { action: "create", date: today, reason: "Synthetic attempted undo", type: "PLANNED" });
    assert.equal(downgradeSudden.status, 409, "a sudden closure cannot be downgraded after attendance was voided");
    assert.equal((await prisma.holiday.findFirstOrThrow({ where: { schoolId: schoolA, date: todayDate } })).type, "SUDDEN");
  } finally {
    await prisma.$disconnect();
  }
});
