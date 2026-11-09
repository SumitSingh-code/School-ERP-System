import { Prisma, PrismaClient } from "@prisma/client";
import { academicYearFor, DEFAULT_CLASS_LEVELS, DEFAULT_GROUPS, DEFAULT_STREAMS, defaultSubjectsFor } from "./academic-defaults";

type Db = PrismaClient | Prisma.TransactionClient;

/** Create editable CBSE-style school defaults; safe to rerun for a school. */
export async function initializeAcademicStructure(db: Db, schoolId: string, today = new Date()) {
  const yearInput = academicYearFor(today);
  let year = await db.academicYear.findFirst({ where: { schoolId, label: yearInput.label } });
  if (!year) year = await db.academicYear.create({ data: { schoolId, ...yearInput, isCurrent: true } });
  else if (!year.isCurrent) {
    await db.academicYear.updateMany({ where: { schoolId, isCurrent: true }, data: { isCurrent: false } });
    year = await db.academicYear.update({ where: { id: year.id }, data: { isCurrent: true } });
  }

  const levels = new Map<string, { id: string; name: string }>();
  for (let index = 0; index < DEFAULT_CLASS_LEVELS.length; index += 1) {
    const name = DEFAULT_CLASS_LEVELS[index];
    if (!name) continue;
    const level = await db.classLevel.findFirst({ where: { schoolId, name } })
      ?? await db.classLevel.create({ data: { schoolId, name, sortOrder: index + 1 } });
    levels.set(name, level);
  }

  const streamIds = new Map<string, string>();
  for (const className of ["11", "12"]) {
    const level = levels.get(className);
    if (!level) continue;
    for (const name of DEFAULT_STREAMS) {
      let stream = await db.stream.findFirst({ where: { schoolId, classLevelId: level.id, name } });
      if (!stream) stream = await db.stream.create({ data: { schoolId, classLevelId: level.id, name } });
      streamIds.set(`${className}:${name}`, stream.id);
    }
  }

  const groupIds = new Map<string, string>();
  for (const className of ["11", "12"]) {
    const streamId = streamIds.get(`${className}:Science`);
    if (!streamId) continue;
    for (const name of DEFAULT_GROUPS) {
      let group = await db.studyGroup.findFirst({ where: { schoolId, streamId, name } });
      if (!group) group = await db.studyGroup.create({ data: { schoolId, streamId, name } });
      groupIds.set(`${className}:${name}`, group.id);
    }
  }

  const assignmentCount: { sectionId: string; className: string; label: string }[] = [];
  for (const className of DEFAULT_CLASS_LEVELS) {
    const level = levels.get(className);
    if (!level) continue;
    const placements: { streamId?: string; groupId?: string; name: string; label: string }[] = Number(className) < 11
      ? [{ name: "A", label: "A" }]
      : [
        { streamId: streamIds.get(`${className}:Arts`), name: "A", label: "Arts · A" },
        { streamId: streamIds.get(`${className}:Commerce`), name: "A", label: "Commerce · A" },
        ...DEFAULT_GROUPS.map((group) => ({ streamId: streamIds.get(`${className}:Science`), groupId: groupIds.get(`${className}:${group}`), name: "A", label: `Science ${group} · A` })),
      ];

    for (const placement of placements) {
      if (Number(className) >= 11 && !placement.streamId) continue;
      let section = await db.section.findFirst({
        where: { schoolId, academicYearId: year.id, classLevelId: level.id, streamId: placement.streamId ?? null, groupId: placement.groupId ?? null, name: placement.name },
      });
      if (!section) section = await db.section.create({
        data: { schoolId, academicYearId: year.id, classLevelId: level.id, streamId: placement.streamId, groupId: placement.groupId, name: placement.name },
      });
      assignmentCount.push({ sectionId: section.id, className, label: placement.label });

      const subjects = defaultSubjectsFor(className, placement.streamId ? placement.label.split(" · ")[0]?.replace(/^Science /, "Science") : undefined, placement.groupId ? placement.label.match(/Science (PCM|PCB|PCMB)/)?.[1] : undefined);
      for (const item of subjects) {
        const subjectCode = item.name.toUpperCase().replace(/[^A-Z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 24);
        let subject = await db.subject.findFirst({ where: { schoolId, code: subjectCode } });
        if (!subject) subject = await db.subject.create({ data: { schoolId, code: subjectCode, name: item.name, optional: item.optional ?? false } });
        else if (item.optional && !subject.optional) subject = await db.subject.update({ where: { id: subject.id }, data: { optional: true } });
        const streamId = placement.streamId;
        const groupId = placement.groupId;
        const linked = await db.classSubject.findFirst({ where: { schoolId, classLevelId: level.id, streamId: streamId ?? null, groupId: groupId ?? null, subjectId: subject.id } });
        if (!linked) await db.classSubject.create({ data: { schoolId, classLevelId: level.id, streamId, groupId, subjectId: subject.id } });
      }
    }
  }

  return { academicYear: year, classLevels: levels.size, sections: assignmentCount };
}
