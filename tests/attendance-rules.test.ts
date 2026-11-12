import { test } from "node:test";
import assert from "node:assert/strict";
import { attendanceNotificationCopy, attendanceViewStatus, normalizeAttendanceDate, parentAttendanceStatus, teacherCanMarkForDate } from "../src/lib/attendance-rules";

test("attendance dates are validated as calendar dates", () => {
  assert.equal(normalizeAttendanceDate("2026-11-12")?.toISOString(), "2026-11-12T00:00:00.000Z");
  assert.equal(normalizeAttendanceDate("2026-02-30"), null);
  assert.equal(normalizeAttendanceDate("12-11-2026"), null);
});

test("substitute attendance is limited to the assigned day", () => {
  assert.equal(teacherCanMarkForDate({ classTeacher: true, substitute: false, date: "2026-11-11", today: "2026-11-12" }), true);
  assert.equal(teacherCanMarkForDate({ classTeacher: false, substitute: true, date: "2026-11-12", today: "2026-11-12" }), true);
  assert.equal(teacherCanMarkForDate({ classTeacher: false, substitute: true, date: "2026-11-11", today: "2026-11-12" }), false);
});

test("parent-safe status is never Present before section submission", () => {
  assert.equal(attendanceViewStatus(false), "NOT_SUBMITTED");
  assert.equal(attendanceViewStatus(true), "SUBMITTED");
  assert.equal(parentAttendanceStatus(false, null), "NOT_MARKED_YET");
  assert.equal(parentAttendanceStatus(true, null), "PRESENT");
  assert.equal(parentAttendanceStatus(true, "ABSENT"), "ABSENT");
});

test("absence notification copy includes the English and Hindi message", () => {
  const copy = attendanceNotificationCopy("Synthetic Student", "2026-11-12");
  assert.match(copy.en.body, /marked absent/);
  assert.match(copy.hi.body, /अनुपस्थित/);
  assert.match(copy.en.body, /2026-11-12/);
});
