import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const assignmentSchema = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("classTeacher"), yearId: z.string().uuid(), sectionId: z.string().uuid(), teacherId: z.string().uuid() }),
  z.object({ kind: z.literal("subjectTeacher"), yearId: z.string().uuid(), sectionId: z.string().uuid(), subjectId: z.string().uuid(), teacherId: z.string().uuid() }),
]);

export const GET = withSchoolRoute("assignment.manage", async (_request, _context, { db }) => {
  const [years, sections, subjects, staff, classTeachers, subjectTeachers, classSubjects] = await Promise.all([
    db.academicYear.findMany({ where: { deletedAt: null }, orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }] }),
    db.section.findMany({ where: { deletedAt: null }, include: { classLevel: { select: { name: true } }, stream: { select: { name: true } }, group: { select: { name: true } }, academicYear: { select: { label: true } } }, orderBy: [{ classLevel: { sortOrder: "asc" } }, { name: "asc" }] }),
    db.subject.findMany({ where: { deletedAt: null, active: true }, orderBy: { name: "asc" } }),
    db.user.findMany({ where: { deletedAt: null, status: "ACTIVE", roles: { some: { deletedAt: null, role: { name: { in: ["Teacher", "Class Teacher", "Subject Teacher"] } } } } }, select: { id: true, name: true, roles: { where: { deletedAt: null }, select: { role: { select: { name: true } } } } }, orderBy: { name: "asc" } }),
    db.classTeacherAssignment.findMany({ include: { staff: { select: { id: true, name: true } }, section: { include: { classLevel: { select: { name: true } }, academicYear: { select: { label: true } } } } }, orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }] }),
    db.subjectTeacherAssignment.findMany({ include: { staff: { select: { id: true, name: true } }, subject: { select: { name: true } }, section: { include: { classLevel: { select: { name: true } }, academicYear: { select: { label: true } } } } }, orderBy: [{ deletedAt: "asc" }, { createdAt: "desc" }] }),
    db.classSubject.findMany(),
  ]);
  const sectionSubjects = sections.map((section) => ({ sectionId: section.id, subjectIds: classSubjects.filter((link) => link.classLevelId === section.classLevelId && (link.streamId === null || link.streamId === section.streamId) && (link.groupId === null || link.groupId === section.groupId)).map((link) => link.subjectId) }));
  return NextResponse.json({ years, sections, subjects, staff, classTeachers, subjectTeachers, sectionSubjects });
});

export const POST = withSchoolRoute("assignment.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = assignmentSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the assignment fields", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: `assignment.${input.kind}.saved`, entityType: input.kind, newValue: input }, async (tx) => {
      const [section, staff] = await Promise.all([
        tx.section.findFirst({ where: { id: input.sectionId, academicYearId: input.yearId, active: true, deletedAt: null } }),
        tx.user.findFirst({ where: { id: input.teacherId, status: "ACTIVE", deletedAt: null, roles: { some: { deletedAt: null, role: { name: { in: ["Teacher", "Class Teacher", "Subject Teacher"] } } } } } }),
      ]);
      if (!section || !staff) throw new Error("Choose an active section and a teacher from this school");
      if (input.kind === "classTeacher") {
        const otherSection = await tx.classTeacherAssignment.findFirst({ where: { academicYearId: input.yearId, userId: input.teacherId, deletedAt: null, sectionId: { not: input.sectionId } } });
        if (otherSection) throw new Error("A class teacher can be assigned to only one section per year");
        const previous = await tx.classTeacherAssignment.findFirst({ where: { academicYearId: input.yearId, sectionId: input.sectionId, deletedAt: null } });
        if (previous) {
          if (previous.userId === input.teacherId) return previous;
          await tx.classTeacherAssignment.update({ where: { id: previous.id }, data: { deletedAt: new Date() } });
          const changed = await tx.classTeacherAssignment.create({ data: { schoolId: principal.schoolId, academicYearId: input.yearId, sectionId: input.sectionId, userId: input.teacherId } });
          await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "assignment.classTeacher.reassigned", entityType: "ClassTeacherAssignment", entityId: previous.id, oldValue: { teacherId: previous.userId }, newValue: { teacherId: input.teacherId } } });
          return changed;
        }
        return tx.classTeacherAssignment.create({ data: { schoolId: principal.schoolId, academicYearId: input.yearId, sectionId: input.sectionId, userId: input.teacherId } });
      }
      const subject = await tx.subject.findFirst({ where: { id: input.subjectId, active: true, deletedAt: null } });
      if (!subject) throw new Error("Choose an active subject from this school");
      const classSubject = await tx.classSubject.findFirst({ where: { classLevelId: section.classLevelId, subjectId: subject.id, OR: [{ streamId: null }, { streamId: section.streamId }], AND: [{ OR: [{ groupId: null }, { groupId: section.groupId }] }] } });
      if (!classSubject) throw new Error("That subject is not assigned to this section");
      const old = await tx.subjectTeacherAssignment.findFirst({ where: { academicYearId: input.yearId, sectionId: input.sectionId, subjectId: subject.id, deletedAt: null } });
      if (old?.userId === input.teacherId) return old;
      if (old) await tx.subjectTeacherAssignment.update({ where: { id: old.id }, data: { deletedAt: new Date() } });
      const assignment = await tx.subjectTeacherAssignment.create({ data: { schoolId: principal.schoolId, academicYearId: input.yearId, sectionId: input.sectionId, subjectId: subject.id, userId: input.teacherId } });
      if (old) {
        const entries = await tx.timetableEntry.findMany({ where: { academicYearId: input.yearId, sectionId: input.sectionId, subjectId: subject.id, teacherId: old.userId, deletedAt: null } });
        if (entries.some((entry) => entry.combinedGroupId)) throw new Error("Clear the shared lesson from each section before changing its subject teacher");
        for (const entry of entries) {
          const newValue = { subjectId: entry.subjectId, teacherId: input.teacherId, label: entry.label };
          const oldValue = { subjectId: entry.subjectId, teacherId: entry.teacherId, label: entry.label };
          await tx.timetableEntry.update({ where: { id: entry.id }, data: { teacherId: input.teacherId, updatedById: principal.userId, version: { increment: 1 } } });
          await tx.timetableChange.create({ data: { schoolId: principal.schoolId, entryId: entry.id, actorId: principal.userId, activeRole: principal.activeRole, action: "TEACHER_REASSIGNED", oldValue, newValue } });
          await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "timetable.teacher.reassigned", entityType: "TimetableEntry", entityId: entry.id, oldValue, newValue } });
        }
        await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "assignment.subjectTeacher.reassigned", entityType: "SubjectTeacherAssignment", entityId: old.id, oldValue: { teacherId: old.userId }, newValue: { teacherId: input.teacherId, currentAssignmentId: assignment.id } } });
      }
      return assignment;
    });
    return NextResponse.json({ assignment: result }, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not save this assignment" }, { status: 409 });
  }
});
