import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const saveSchema = z.object({
  sectionId: z.string().uuid(), dayOfWeek: z.number().int().min(0).max(6), period: z.number().int().min(1).max(8),
  subjectId: z.string().uuid().nullable().optional(), label: z.string().trim().min(1).max(50).nullable().optional(),
  combinedGroupId: z.string().uuid().nullable().optional(), id: z.string().uuid().optional(), version: z.number().int().positive().optional(),
}).refine((entry) => Boolean(entry.subjectId) !== Boolean(entry.label), { message: "Choose a subject or a timetable label" });

export const GET = withSchoolRoute("timetable.read", async (request, _context, { db }) => {
  const yearId = new URL(request.url).searchParams.get("yearId");
  const [years, sections, subjects, assignments, entries, groups, settings] = await Promise.all([
    db.academicYear.findMany({ where: { deletedAt: null }, orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }] }),
    db.section.findMany({ where: { deletedAt: null, ...(yearId ? { academicYearId: yearId } : {}) }, include: { classLevel: { select: { name: true, sortOrder: true } }, academicYear: { select: { id: true, label: true } } }, orderBy: [{ classLevel: { sortOrder: "asc" } }, { name: "asc" }] }),
    db.subject.findMany({ where: { active: true, deletedAt: null }, orderBy: { name: "asc" } }),
    db.subjectTeacherAssignment.findMany({ where: { deletedAt: null }, include: { staff: { select: { id: true, name: true } } } }),
    db.timetableEntry.findMany({ where: { deletedAt: null, ...(yearId ? { academicYearId: yearId } : {}) }, include: { subject: { select: { name: true } }, teacher: { select: { id: true, name: true } }, section: { include: { classLevel: { select: { name: true } } } } }, orderBy: [{ dayOfWeek: "asc" }, { period: "asc" }] }),
    db.combinedLessonGroup.findMany({ where: { deletedAt: null }, include: { teacher: { select: { name: true } }, subject: { select: { name: true } } } }),
    db.scheduleSettings.findFirst(),
  ]);
  return NextResponse.json({ years, sections, subjects, assignments, entries, groups, settings });
});

export const POST = withSchoolRoute("timetable.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = saveSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the timetable slot", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "timetable.slot.saved", entityType: "TimetableEntry", entityId: input.id, newValue: input }, async (tx) => {
      const section = await tx.section.findFirst({ where: { id: input.sectionId, active: true, deletedAt: null } });
      if (!section) throw new Error("Choose an active section from this school");
      const workingDays = await tx.scheduleSettings.findFirst();
      if (workingDays && !workingDays.workingDays.includes(input.dayOfWeek)) throw new Error("That day is configured as a non-working day");
      let teacherId: string | null = null;
      if (input.subjectId) {
        const assignment = await tx.subjectTeacherAssignment.findFirst({ where: { academicYearId: section.academicYearId, sectionId: section.id, subjectId: input.subjectId, deletedAt: null }, include: { staff: { select: { id: true } } } });
        if (!assignment) throw new Error("Assign a subject teacher before adding this subject to the timetable");
        teacherId = assignment.staff.id;
      }
      if (input.combinedGroupId) {
        const group = await tx.combinedLessonGroup.findFirst({ where: { id: input.combinedGroupId, academicYearId: section.academicYearId, dayOfWeek: input.dayOfWeek, period: input.period, subjectId: input.subjectId ?? undefined, teacherId: teacherId ?? undefined, deletedAt: null } });
        if (!group) throw new Error("The shared lesson must match this section's year, subject, teacher, day and period");
      }
      const conflict = teacherId ? await tx.timetableEntry.findFirst({ where: { academicYearId: section.academicYearId, teacherId, dayOfWeek: input.dayOfWeek, period: input.period, deletedAt: null, ...(input.id ? { id: { not: input.id } } : {}), ...(input.combinedGroupId ? { combinedGroupId: { not: input.combinedGroupId } } : {}) } }) : null;
      if (conflict) throw new Error("This teacher already has a lesson in that period");
      const old = input.id
        ? await tx.timetableEntry.findFirst({ where: { id: input.id, sectionId: input.sectionId, dayOfWeek: input.dayOfWeek, period: input.period, deletedAt: null } })
        : await tx.timetableEntry.findFirst({ where: { sectionId: input.sectionId, dayOfWeek: input.dayOfWeek, period: input.period } });
      if (input.id && (!old || old.version !== input.version)) throw new Error("This slot changed since you opened it. Refresh and try again.");
      const data = { academicYearId: section.academicYearId, sectionId: section.id, dayOfWeek: input.dayOfWeek, period: input.period, subjectId: input.subjectId ?? null, teacherId, combinedGroupId: input.combinedGroupId ?? null, label: input.label ?? null, version: (old?.version ?? 0) + 1, updatedById: principal.userId, deletedAt: null as Date | null };
      let entry;
      if (old) {
        const changed = await tx.timetableEntry.updateMany({ where: { id: old.id, version: old.version, deletedAt: null }, data });
        if (changed.count !== 1) throw new Error("This slot changed since you opened it. Refresh and try again.");
        entry = await tx.timetableEntry.findFirstOrThrow({ where: { id: old.id } });
      } else {
        entry = await tx.timetableEntry.create({ data: { ...data, schoolId: principal.schoolId, createdById: principal.userId } });
      }
      const oldValue = old ? { sectionId: old.sectionId, dayOfWeek: old.dayOfWeek, period: old.period, subjectId: old.subjectId, teacherId: old.teacherId, label: old.label } : undefined;
      const newValue = { sectionId: entry.sectionId, dayOfWeek: entry.dayOfWeek, period: entry.period, subjectId: entry.subjectId, teacherId: entry.teacherId, label: entry.label };
      await tx.timetableChange.create({ data: { schoolId: principal.schoolId, entryId: entry.id, actorId: principal.userId, activeRole: principal.activeRole, action: old ? "UPDATED" : "CREATED", oldValue, newValue } });
      await tx.auditLog.create({ data: { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: old ? "timetable.slot.updated" : "timetable.slot.created", entityType: "TimetableEntry", entityId: entry.id, oldValue, newValue } });
      return entry;
    });
    return NextResponse.json({ entry: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save this timetable slot";
    return NextResponse.json({ error: message.includes("Unique constraint") ? "This timetable slot was saved by another user. Refresh to see it." : message }, { status: 409 });
  }
});

export const DELETE = withSchoolRoute("timetable.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = z.object({ id: z.string().uuid(), version: z.number().int().positive() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid timetable slot" }, { status: 400 });
  const old = await db.timetableEntry.findFirst({ where: { id: parsed.data.id, deletedAt: null } });
  if (!old || old.version !== parsed.data.version) return NextResponse.json({ error: "Slot not found or changed. Refresh and try again." }, { status: 409 });
  try {
    await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "timetable.slot.deleted", entityType: "TimetableEntry", entityId: old.id, oldValue: { subjectId: old.subjectId, teacherId: old.teacherId, label: old.label } }, async (tx) => {
      const changed = await tx.timetableEntry.updateMany({ where: { id: old.id, version: parsed.data.version, deletedAt: null }, data: { deletedAt: new Date(), updatedById: principal.userId, version: { increment: 1 } } });
      if (changed.count !== 1) throw new Error("This slot changed since you opened it. Refresh and try again.");
      await tx.timetableChange.create({ data: { schoolId: principal.schoolId, entryId: old.id, actorId: principal.userId, activeRole: principal.activeRole, action: "DELETED", oldValue: { subjectId: old.subjectId, teacherId: old.teacherId, label: old.label } } });
    });
    return NextResponse.json({ ok: true });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Could not clear this timetable slot" }, { status: 409 });
  }
});
