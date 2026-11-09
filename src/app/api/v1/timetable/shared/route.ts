import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const schema = z.object({ sectionIds: z.array(z.string().uuid()).min(2).max(8), dayOfWeek: z.number().int().min(0).max(6), period: z.number().int().min(1).max(8), subjectId: z.string().uuid(), label: z.string().trim().min(2).max(80) }).superRefine((value, context) => { if (new Set(value.sectionIds).size !== value.sectionIds.length) context.addIssue({ code: "custom", message: "Choose each section only once", path: ["sectionIds"] }); });

export const POST = withSchoolRoute("timetable.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the shared lesson details", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "timetable.sharedLesson.created", entityType: "CombinedLessonGroup", newValue: input }, async (tx) => {
      const sections = await tx.section.findMany({ where: { id: { in: input.sectionIds }, active: true, deletedAt: null } });
      if (sections.length !== input.sectionIds.length || new Set(sections.map((section) => section.academicYearId)).size !== 1) throw new Error("Choose sections from the same school and academic year");
      const teachers: string[] = [];
      for (const section of sections) {
        const assignment = await tx.subjectTeacherAssignment.findFirst({ where: { academicYearId: section.academicYearId, sectionId: section.id, subjectId: input.subjectId, deletedAt: null } });
        if (!assignment) throw new Error("Assign the subject teacher in every selected section first");
        teachers.push(assignment.userId);
      }
      if (new Set(teachers).size !== 1) throw new Error("All selected sections must share the same subject teacher");
      const teacherId = teachers[0];
      const group = await tx.combinedLessonGroup.create({ data: { schoolId: principal.schoolId, academicYearId: sections[0].academicYearId, dayOfWeek: input.dayOfWeek, period: input.period, subjectId: input.subjectId, teacherId, label: input.label, createdById: principal.userId } });
      for (const section of sections) {
        const existing = await tx.timetableEntry.findFirst({ where: { sectionId: section.id, dayOfWeek: input.dayOfWeek, period: input.period } });
        if (existing?.deletedAt === null) throw new Error("One of these section timetable slots is already occupied");
        const entry = existing
          ? await tx.timetableEntry.update({ where: { id: existing.id }, data: { academicYearId: section.academicYearId, subjectId: input.subjectId, teacherId, combinedGroupId: group.id, label: null, deletedAt: null, updatedById: principal.userId, version: { increment: 1 } } })
          : await tx.timetableEntry.create({ data: { schoolId: principal.schoolId, academicYearId: section.academicYearId, sectionId: section.id, dayOfWeek: input.dayOfWeek, period: input.period, subjectId: input.subjectId, teacherId, combinedGroupId: group.id, createdById: principal.userId, updatedById: principal.userId } });
        const oldValue = existing ? { subjectId: existing.subjectId, teacherId: existing.teacherId, label: existing.label } : undefined;
        const newValue = { subjectId: entry.subjectId, teacherId: entry.teacherId, combinedGroupId: group.id, label: input.label };
        await tx.timetableChange.create({ data: { schoolId: principal.schoolId, entryId: entry.id, actorId: principal.userId, activeRole: principal.activeRole, action: existing ? "UPDATED_TO_SHARED" : "CREATED_SHARED", oldValue, newValue } });
        await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "timetable.slot.shared", entityType: "TimetableEntry", entityId: entry.id, oldValue, newValue } });
      }
      return group;
    });
    return NextResponse.json({ group: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not create shared lesson";
    return NextResponse.json({ error: message.includes("Unique constraint") ? "One of the selected slots is already occupied" : message }, { status: 409 });
  }
});
