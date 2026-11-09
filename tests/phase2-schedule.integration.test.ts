import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { PrismaClient } from "@prisma/client";
import { NextRequest } from "next/server";
import { seedSystemRoles } from "../src/lib/role-permissions";
import { POST as assign } from "../src/app/api/v1/assignments/route";
import { POST as saveTimetable } from "../src/app/api/v1/timetable/route";
import { POST as createShared } from "../src/app/api/v1/timetable/shared/route";
import { GET as listHolidays, POST as addHoliday, DELETE as deleteHoliday } from "../src/app/api/v1/holidays/route";
import { PUT as updateSchedule } from "../src/app/api/v1/schedule-settings/route";

const enabled = process.env.TENANT_DB_TEST === "1" && Boolean(process.env.DATABASE_URL);
type Handler = (request: NextRequest, context: { params: Promise<Record<string, string>> }) => Promise<Response>;

function request(handler: Handler, token: string, method: string, url: string, body?: object) {
  const input = new NextRequest(url, { method, headers: { cookie: `school_access=${token}`, ...(body ? { "content-type": "application/json" } : {}) }, ...(body ? { body: JSON.stringify(body) } : {}) });
  return handler(input, { params: Promise.resolve({}) });
}

test("Phase 2 assignments, timetable concurrency, shared lessons, holidays, permissions and school isolation", { skip: !enabled }, async () => {
  const prisma = new PrismaClient();
  const suffix = randomUUID();
  const schoolA = `phase2-a-${suffix}`;
  const schoolB = `phase2-b-${suffix}`;
  const directorId = randomUUID();
  const teacherId = randomUUID();
  const replacementTeacherId = randomUUID();
  const schoolBActorId = randomUUID();
  const financeId = randomUUID();
  let teacherToken = "";
  let financeToken = "";
  const tokens: string[] = [];
  try {
    await seedSystemRoles(prisma);
    const directorRole = await prisma.role.findUniqueOrThrow({ where: { name: "Director" } });
    const teacherRole = await prisma.role.findUniqueOrThrow({ where: { name: "Teacher" } });
    const financeRole = await prisma.role.findUniqueOrThrow({ where: { name: "Finance" } });
    await prisma.school.createMany({ data: [{ id: schoolA, name: "Synthetic Schedule School A" }, { id: schoolB, name: "Synthetic Schedule School B" }] });
    await prisma.user.createMany({ data: [
      { id: directorId, schoolId: schoolA, name: "Synthetic Director", phone: `p2-${suffix}-director` },
      { id: teacherId, schoolId: schoolA, name: "Synthetic Teacher", phone: `p2-${suffix}-teacher` },
      { id: replacementTeacherId, schoolId: schoolA, name: "Synthetic Replacement Teacher", phone: `p2-${suffix}-replacement` },
      { id: schoolBActorId, schoolId: schoolB, name: "Synthetic School B Director", phone: `p2-${suffix}-schoolb` },
      { id: financeId, schoolId: schoolA, name: "Synthetic Finance Staff", phone: `p2-${suffix}-finance` },
    ] });
    await prisma.userRole.createMany({ data: [
      { schoolId: schoolA, userId: directorId, roleId: directorRole.id },
      { schoolId: schoolA, userId: teacherId, roleId: teacherRole.id },
      { schoolId: schoolA, userId: replacementTeacherId, roleId: teacherRole.id },
      { schoolId: schoolA, userId: financeId, roleId: financeRole.id },
    ] });
    const tokenFor = async (userId: string, schoolId: string, activeRole: string) => {
      const token = randomUUID(); tokens.push(token);
      await prisma.session.create({ data: { userId, schoolId, activeRole, refreshTokenHash: createHash("sha256").update(randomUUID()).digest("hex"), accessTokenHash: createHash("sha256").update(token).digest("hex"), accessExpiresAt: new Date(Date.now() + 60_000), expiresAt: new Date(Date.now() + 60_000) } });
      return token;
    };
    const directorToken = await tokenFor(directorId, schoolA, "Director");
    financeToken = await tokenFor(financeId, schoolA, "Finance");
    teacherToken = await tokenFor(teacherId, schoolA, "Teacher");
    const yearA = await prisma.academicYear.create({ data: { schoolId: schoolA, label: "2026-27", startsOn: new Date("2026-04-01Z"), endsOn: new Date("2027-03-31Z"), isCurrent: true } });
    const classA = await prisma.classLevel.create({ data: { schoolId: schoolA, name: "Synthetic 5", sortOrder: 5 } });
    const classB = await prisma.classLevel.create({ data: { schoolId: schoolB, name: "Synthetic 5", sortOrder: 5 } });
    const sectionA1 = await prisma.section.create({ data: { schoolId: schoolA, academicYearId: yearA.id, classLevelId: classA.id, name: "A" } });
    const sectionA2 = await prisma.section.create({ data: { schoolId: schoolA, academicYearId: yearA.id, classLevelId: classA.id, name: "B" } });
    const yearB = await prisma.academicYear.create({ data: { schoolId: schoolB, label: "2026-27", startsOn: new Date("2026-04-01Z"), endsOn: new Date("2027-03-31Z"), isCurrent: true } });
    const sectionB = await prisma.section.create({ data: { schoolId: schoolB, academicYearId: yearB.id, classLevelId: classB.id, name: "A" } });
    const subject = await prisma.subject.create({ data: { schoolId: schoolA, name: "Synthetic Mathematics", code: `M-${suffix.slice(0, 8)}` } });
    await prisma.classSubject.create({ data: { schoolId: schoolA, classLevelId: classA.id, subjectId: subject.id } });
    const call = (handler: Handler, token: string, method: string, url: string, body?: object) => request(handler, token, method, url, body);

    const classTeacherResponse = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "classTeacher", yearId: yearA.id, sectionId: sectionA1.id, teacherId });
    assert.equal(classTeacherResponse.status, 201);
    const duplicateTeacherResponse = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "classTeacher", yearId: yearA.id, sectionId: sectionA2.id, teacherId });
    assert.equal(duplicateTeacherResponse.status, 409, "a class teacher cannot lead two sections in the same year");
    const deniedAssignment = await call(assign as Handler, teacherToken, "POST", "http://localhost/api/v1/assignments", { kind: "classTeacher", yearId: yearA.id, sectionId: sectionA2.id, teacherId });
    assert.equal(deniedAssignment.status, 403, "teachers cannot manage staff assignments");
    for (const section of [sectionA1, sectionA2]) {
      const response = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "subjectTeacher", yearId: yearA.id, sectionId: section.id, subjectId: subject.id, teacherId });
      assert.equal(response.status, 201);
    }
    const foreignAssignment = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "classTeacher", yearId: yearB.id, sectionId: sectionB.id, teacherId });
    assert.equal(foreignAssignment.status, 409, "school A cannot assign school B sections");

    const slot = { sectionId: sectionA1.id, dayOfWeek: 1, period: 1, subjectId: subject.id, label: null };
    const concurrent = await Promise.all([
      call(saveTimetable as Handler, directorToken, "POST", "http://localhost/api/v1/timetable", slot),
      call(saveTimetable as Handler, directorToken, "POST", "http://localhost/api/v1/timetable", slot),
    ]);
    assert.deepEqual(concurrent.map((response) => response.status).sort(), [201, 409], "exactly one concurrent save owns the same section slot");
    const savedEntry = await prisma.timetableEntry.findFirstOrThrow({ where: { schoolId: schoolA, sectionId: sectionA1.id, dayOfWeek: 1, period: 1 } });
    assert.equal(savedEntry.teacherId, teacherId, "teacher is taken from the assignment matrix");
    assert.equal(await prisma.timetableChange.count({ where: { schoolId: schoolA, entryId: savedEntry.id } }), 1);
    assert.equal(await prisma.auditLog.count({ where: { schoolId: schoolA, entityId: savedEntry.id, action: { startsWith: "timetable.slot." } } }), 1);
    const previousSubjectAssignment = await prisma.subjectTeacherAssignment.findFirstOrThrow({ where: { schoolId: schoolA, sectionId: sectionA1.id, subjectId: subject.id, deletedAt: null } });
    const reassigned = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "subjectTeacher", yearId: yearA.id, sectionId: sectionA1.id, subjectId: subject.id, teacherId: replacementTeacherId });
    assert.equal(reassigned.status, 201, "changing the subject teacher updates dependent lessons");
    assert.ok((await prisma.subjectTeacherAssignment.findUniqueOrThrow({ where: { id: previousSubjectAssignment.id } })).deletedAt, "previous teacher assignment remains in history");
    assert.equal((await prisma.timetableEntry.findUniqueOrThrow({ where: { id: savedEntry.id } })).teacherId, replacementTeacherId);
    const returnedAssignment = await call(assign as Handler, directorToken, "POST", "http://localhost/api/v1/assignments", { kind: "subjectTeacher", yearId: yearA.id, sectionId: sectionA1.id, subjectId: subject.id, teacherId });
    assert.equal(returnedAssignment.status, 201);
    const deniedTimetable = await call(saveTimetable as Handler, teacherToken, "POST", "http://localhost/api/v1/timetable", { ...slot, sectionId: sectionA2.id, period: 3 });
    assert.equal(deniedTimetable.status, 403, "read-only teachers cannot mutate timetable");
    const foreignSlot = await call(saveTimetable as Handler, directorToken, "POST", "http://localhost/api/v1/timetable", { ...slot, sectionId: sectionB.id });
    assert.equal(foreignSlot.status, 409, "school A cannot write a timetable entry into school B");
    const teacherClash = await Promise.all([
      call(saveTimetable as Handler, directorToken, "POST", "http://localhost/api/v1/timetable", { ...slot, period: 3 }),
      call(saveTimetable as Handler, directorToken, "POST", "http://localhost/api/v1/timetable", { ...slot, sectionId: sectionA2.id, period: 3 }),
    ]);
    assert.deepEqual(teacherClash.map((response) => response.status).sort(), [201, 409], "the same teacher cannot be saved into simultaneous section slots");

    const shared = await call(createShared as Handler, directorToken, "POST", "http://localhost/api/v1/timetable/shared", { sectionIds: [sectionA1.id, sectionA2.id], dayOfWeek: 1, period: 4, subjectId: subject.id, label: "Shared mathematics" });
    assert.equal(shared.status, 201);
    const sharedGroupId = (await shared.json()).group.id as string;
    assert.equal(await prisma.timetableEntry.count({ where: { schoolId: schoolA, combinedGroupId: sharedGroupId, deletedAt: null } }), 2, "one teacher can teach a shared combined lesson across sections");

    const holidayResponse = await call(addHoliday as Handler, directorToken, "POST", "http://localhost/api/v1/holidays", { action: "create", date: "2026-12-24", reason: "Synthetic winter closure", type: "PLANNED" });
    assert.equal(holidayResponse.status, 201);
    const holiday = (await holidayResponse.json()).holidays[0] as { id: string };
    assert.equal(await prisma.auditLog.count({ where: { schoolId: schoolA, entityId: holiday.id, action: "holiday.created" } }), 1);
    const denied = await call(addHoliday as Handler, financeToken, "POST", "http://localhost/api/v1/holidays", { action: "create", date: "2026-12-25", reason: "Synthetic denied holiday", type: "PLANNED" });
    assert.equal(denied.status, 403, "Finance has no holiday management capability");
    const crossSchoolHoliday = await prisma.holiday.create({ data: { schoolId: schoolB, date: new Date("2026-12-24Z"), reason: "Synthetic school B closure", createdById: schoolBActorId } });
    const deniedRead = await call(listHolidays as Handler, directorToken, "GET", "http://localhost/api/v1/holidays?year=2026");
    assert.equal(deniedRead.status, 200);
    assert.equal((await deniedRead.json()).holidays.some((row: { id: string }) => row.id === crossSchoolHoliday.id), false, "school A cannot list school B holidays");
    const deniedDelete = await call(deleteHoliday as Handler, directorToken, "DELETE", "http://localhost/api/v1/holidays", { id: crossSchoolHoliday.id });
    assert.equal(deniedDelete.status, 404, "school A cannot delete school B holidays");
    assert.ok(await prisma.holiday.findUnique({ where: { id: crossSchoolHoliday.id } }), "school B holiday remains unchanged");

    const periodTimes = Array.from({ length: 8 }, (_, index) => { const start = 8 * 60 + index * 50; const format = (minutes: number) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`; return { period: index + 1, start: format(start), end: format(start + 45) }; });
    const schedulePayload = { workingDays: [1, 2, 3, 4, 5, 6], periods: periodTimes, breaks: [] };
    const scheduleSaved = await call(updateSchedule as Handler, directorToken, "PUT", "http://localhost/api/v1/schedule-settings", schedulePayload);
    assert.equal(scheduleSaved.status, 200, "Director can configure the school week and eight period times");
    assert.equal(await prisma.auditLog.count({ where: { schoolId: schoolA, action: "schedule.settings.created" } }), 1);
    const scheduleDenied = await call(updateSchedule as Handler, financeToken, "PUT", "http://localhost/api/v1/schedule-settings", schedulePayload);
    assert.equal(scheduleDenied.status, 403, "Finance cannot change the timetable schedule");
    const schoolBSettings = await prisma.scheduleSettings.create({ data: { schoolId: schoolB, workingDays: [1, 2, 3, 4, 5], periodLayout: { periods: periodTimes, breaks: [] } } });
    assert.equal(schoolBSettings.workingDays.length, 5);
    assert.deepEqual((await prisma.scheduleSettings.findUnique({ where: { schoolId: schoolB } }))?.workingDays, [1, 2, 3, 4, 5], "school A settings writes do not alter school B");
  } finally {
    await prisma.$disconnect();
  }
});
