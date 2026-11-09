import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD dates").refine((value) => {
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}, "Enter a real calendar date");

const createSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("createYear"), label: z.string().trim().min(4).max(12), startsOn: dateOnly, endsOn: dateOnly, isCurrent: z.boolean().default(false) }),
  z.object({ action: z.literal("createClass"), name: z.string().trim().min(1).max(30), sortOrder: z.number().int().min(1).max(99) }),
  z.object({ action: z.literal("createStream"), classLevelId: z.string().uuid(), name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("createGroup"), streamId: z.string().uuid(), name: z.string().trim().min(1).max(40) }),
  z.object({ action: z.literal("createSubject"), name: z.string().trim().min(1).max(80), code: z.string().trim().min(1).max(24).regex(/^[A-Za-z0-9-]+$/), optional: z.boolean().default(false), classLevelId: z.string().uuid(), streamId: z.string().uuid().optional(), groupId: z.string().uuid().optional() }),
  z.object({ action: z.literal("createSection"), name: z.string().trim().min(1).max(40), academicYearId: z.string().uuid(), classLevelId: z.string().uuid(), streamId: z.string().uuid().optional(), groupId: z.string().uuid().optional() }),
]);

const updateSchema = z.object({
  resource: z.enum(["year", "class", "stream", "group", "subject", "section"]),
  id: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  active: z.boolean().optional(),
  isCurrent: z.boolean().optional(),
}).superRefine((value, context) => {
  if (value.resource === "year" && value.active !== undefined) context.addIssue({ code: "custom", message: "Academic years use the current-year setting", path: ["active"] });
  if (value.resource !== "year" && value.isCurrent !== undefined) context.addIssue({ code: "custom", message: "Only academic years can be current", path: ["isCurrent"] });
});

export const GET = withSchoolRoute("academic.manage", async (_request, _context, { db, principal }) => {
  const [years, classes, streams, groups, subjects, sections] = await Promise.all([
    db.academicYear.findMany({ where: { deletedAt: null }, orderBy: [{ isCurrent: "desc" }, { startsOn: "desc" }] }),
    db.classLevel.findMany({ where: { deletedAt: null }, orderBy: { sortOrder: "asc" } }),
    db.stream.findMany({ where: { deletedAt: null }, include: { classLevel: { select: { id: true, name: true } } }, orderBy: [{ classLevelId: "asc" }, { name: "asc" }] }),
    db.studyGroup.findMany({ where: { deletedAt: null }, include: { stream: { include: { classLevel: { select: { id: true, name: true } } } } }, orderBy: { name: "asc" } }),
    db.subject.findMany({ where: { deletedAt: null }, include: { subjects: { include: { classLevel: { select: { id: true, name: true } }, stream: { select: { name: true } }, group: { select: { name: true } } } } }, orderBy: [{ name: "asc" }, { code: "asc" }] }),
    db.section.findMany({ where: { deletedAt: null }, include: { classLevel: { select: { name: true } }, stream: { select: { name: true } }, group: { select: { name: true } }, academicYear: { select: { label: true } }, _count: { select: { students: true } } }, orderBy: [{ classLevel: { sortOrder: "asc" } }, { name: "asc" }] }),
  ]);
  return NextResponse.json({ years, classes, streams, groups, subjects, sections, activeRole: principal.activeRole });
});

export const POST = withSchoolRoute("academic.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = createSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Check the fields and try again", fields: parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  try {
    const result = await auditedMutation(db, {
      actorId: principal.userId,
      activeRole: principal.activeRole,
      schoolId: principal.schoolId,
      action: `academic.${input.action}`,
      entityType: input.action.replace(/^create/, ""),
      newValue: input,
    }, async (tx) => {
      switch (input.action) {
        case "createYear": {
          if (input.endsOn <= input.startsOn) throw new Error("Academic year end must be after its start");
          if (input.isCurrent) {
            const previous = await tx.academicYear.findMany({ where: { isCurrent: true, deletedAt: null } });
            await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
            for (const year of previous) await tx.auditLog.create({ data: { actorId: principal.userId, schoolId: principal.schoolId, activeRole: principal.activeRole, action: "academic.year.updated", entityType: "year", entityId: year.id, oldValue: { label: year.label, isCurrent: true }, newValue: { label: year.label, isCurrent: false } } });
          }
          return tx.academicYear.create({ data: { schoolId: principal.schoolId, label: input.label, startsOn: new Date(`${input.startsOn}T00:00:00.000Z`), endsOn: new Date(`${input.endsOn}T00:00:00.000Z`), isCurrent: input.isCurrent } });
        }
        case "createClass":
          return tx.classLevel.create({ data: { schoolId: principal.schoolId, name: input.name, sortOrder: input.sortOrder } });
        case "createStream": {
          const level = await tx.classLevel.findFirst({ where: { id: input.classLevelId, active: true, deletedAt: null } });
          if (!level) throw new Error("Choose an active class in this school");
          return tx.stream.create({ data: { schoolId: principal.schoolId, classLevelId: level.id, name: input.name } });
        }
        case "createGroup": {
          const stream = await tx.stream.findFirst({ where: { id: input.streamId, active: true, deletedAt: null } });
          if (!stream) throw new Error("Choose an active stream in this school");
          return tx.studyGroup.create({ data: { schoolId: principal.schoolId, streamId: stream.id, name: input.name } });
        }
        case "createSubject": {
          const level = await tx.classLevel.findFirst({ where: { id: input.classLevelId, active: true, deletedAt: null } });
          if (!level) throw new Error("Choose an active class in this school");
          if (input.groupId && !input.streamId) throw new Error("A subject group must belong to a stream");
          if (input.streamId) {
            const stream = await tx.stream.findFirst({ where: { id: input.streamId, classLevelId: level.id, active: true, deletedAt: null } });
            if (!stream) throw new Error("Choose a stream from the selected class");
          }
          if (input.groupId) {
            const group = await tx.studyGroup.findFirst({ where: { id: input.groupId, streamId: input.streamId, active: true, deletedAt: null } });
            if (!group) throw new Error("Choose a group from the selected stream");
          }
          let subject = await tx.subject.findFirst({ where: { code: input.code.toUpperCase(), deletedAt: null } });
          if (!subject) subject = await tx.subject.create({ data: { schoolId: principal.schoolId, name: input.name, code: input.code.toUpperCase(), optional: input.optional } });
          const link = await tx.classSubject.findFirst({ where: { classLevelId: level.id, streamId: input.streamId ?? null, groupId: input.groupId ?? null, subjectId: subject.id } });
          if (link) throw new Error("That subject is already assigned to this class or group");
          const assignment = await tx.classSubject.create({ data: { schoolId: principal.schoolId, classLevelId: level.id, streamId: input.streamId, groupId: input.groupId, subjectId: subject.id } });
          await tx.auditLog.create({ data: { actorId: principal.userId, schoolId: principal.schoolId, activeRole: principal.activeRole, action: "academic.subject.assigned", entityType: "ClassSubject", entityId: assignment.id, newValue: { subjectId: subject.id, classLevelId: level.id, streamId: input.streamId ?? null, groupId: input.groupId ?? null } } });
          return subject;
        }
        case "createSection": {
          const [level, year] = await Promise.all([
            tx.classLevel.findFirst({ where: { id: input.classLevelId, active: true, deletedAt: null } }),
            tx.academicYear.findFirst({ where: { id: input.academicYearId, deletedAt: null } }),
          ]);
          if (!level || !year) throw new Error("Choose an active class and an academic year from this school");
          if (input.groupId && !input.streamId) throw new Error("A section group must belong to a stream");
          if (input.streamId) {
            const stream = await tx.stream.findFirst({ where: { id: input.streamId, classLevelId: level.id, active: true, deletedAt: null } });
            if (!stream) throw new Error("Choose a stream from the selected class");
          }
          if (input.groupId) {
            const group = await tx.studyGroup.findFirst({ where: { id: input.groupId, streamId: input.streamId, active: true, deletedAt: null } });
            if (!group) throw new Error("Choose a group from the selected stream");
          }
          return tx.section.create({ data: { schoolId: principal.schoolId, name: input.name, academicYearId: year.id, classLevelId: level.id, streamId: input.streamId, groupId: input.groupId } });
        }
      }
    });
    return NextResponse.json({ record: result }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not save this record";
    return NextResponse.json({ error: message.includes("Unique constraint") ? "A matching record already exists" : message }, { status: 409 });
  }
});

export const PATCH = withSchoolRoute("academic.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = updateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || (parsed.data.name === undefined && parsed.data.active === undefined && parsed.data.isCurrent === undefined)) {
    return NextResponse.json({ error: "Choose a valid name or status change" }, { status: 400 });
  }
  const input = parsed.data;
  const existing = input.resource === "year" ? await db.academicYear.findFirst({ where: { id: input.id, deletedAt: null } })
    : input.resource === "class" ? await db.classLevel.findFirst({ where: { id: input.id, deletedAt: null } })
      : input.resource === "stream" ? await db.stream.findFirst({ where: { id: input.id, deletedAt: null } })
        : input.resource === "group" ? await db.studyGroup.findFirst({ where: { id: input.id, deletedAt: null } })
          : input.resource === "subject" ? await db.subject.findFirst({ where: { id: input.id, deletedAt: null } })
            : await db.section.findFirst({ where: { id: input.id, deletedAt: null } });
  if (!existing) return NextResponse.json({ error: "Record not found" }, { status: 404 });
  const oldValue = existing as unknown as Record<string, unknown>;
  try {
    const updated = await auditedMutation(db, {
      actorId: principal.userId,
      activeRole: principal.activeRole,
      schoolId: principal.schoolId,
      action: `academic.${input.resource}.updated`,
      entityType: input.resource,
      entityId: input.id,
      oldValue: { name: oldValue.name, active: oldValue.active, isCurrent: oldValue.isCurrent },
      newValue: { name: input.name, active: input.active, isCurrent: input.isCurrent },
    }, async (tx) => {
      if (input.resource === "year" && input.isCurrent) {
        const previous = await tx.academicYear.findMany({ where: { isCurrent: true, deletedAt: null } });
        await tx.academicYear.updateMany({ where: { isCurrent: true }, data: { isCurrent: false } });
        for (const year of previous) if (year.id !== input.id) await tx.auditLog.create({ data: { actorId: principal.userId, schoolId: principal.schoolId, activeRole: principal.activeRole, action: "academic.year.updated", entityType: "year", entityId: year.id, oldValue: { label: year.label, isCurrent: true }, newValue: { label: year.label, isCurrent: false } } });
      }
      const setActive = input.active === undefined ? {} : { active: input.active, deletedAt: input.active ? null : new Date() };
      const setName = input.name === undefined ? {} : { name: input.name };
      if (input.resource === "year") return tx.academicYear.update({ where: { id: input.id }, data: { ...(input.name ? { label: input.name } : {}), ...(input.isCurrent !== undefined ? { isCurrent: input.isCurrent } : {}) } });
      if (input.resource === "class") return tx.classLevel.update({ where: { id: input.id }, data: { ...setName, ...setActive } });
      if (input.resource === "stream") return tx.stream.update({ where: { id: input.id }, data: { ...setName, ...setActive } });
      if (input.resource === "group") return tx.studyGroup.update({ where: { id: input.id }, data: { ...setName, ...setActive } });
      if (input.resource === "subject") return tx.subject.update({ where: { id: input.id }, data: { ...setName, ...setActive } });
      return tx.section.update({ where: { id: input.id }, data: { ...setName, ...setActive } });
    });
    return NextResponse.json({ record: updated });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Could not update this record";
    return NextResponse.json({ error: message.includes("Unique constraint") ? "A matching record already exists" : message }, { status: 409 });
  }
});
