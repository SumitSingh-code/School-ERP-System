-- Backfill academic year from the already school-scoped section before adding the required column.
ALTER TABLE "TimetableEntry" ADD COLUMN "academicYearId" TEXT;
UPDATE "TimetableEntry" AS timetable
SET "academicYearId" = section."academicYearId"
FROM "Section" AS section
WHERE timetable."sectionId" = section."id" AND timetable."schoolId" = section."schoolId";
ALTER TABLE "TimetableEntry" ALTER COLUMN "academicYearId" SET NOT NULL;

-- AlterTable
ALTER TABLE "TimetableEntry" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "createdById" TEXT,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "label" TEXT,
ADD COLUMN     "updatedById" TEXT;

-- CreateTable
CREATE TABLE "SubjectTeacherAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "subjectId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "SubjectTeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScheduleSettings" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "workingDays" INTEGER[] DEFAULT ARRAY[1, 2, 3, 4, 5, 6]::INTEGER[],
    "periodLayout" JSONB NOT NULL DEFAULT '[]',
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScheduleSettings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Holiday" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'PLANNED',
    "reason" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Holiday_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CombinedLessonGroup" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "dayOfWeek" INTEGER NOT NULL,
    "period" INTEGER NOT NULL,
    "subjectId" TEXT NOT NULL,
    "teacherId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "CombinedLessonGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TimetableChange" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "entryId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "activeRole" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "oldValue" JSONB,
    "newValue" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TimetableChange_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubjectTeacherAssignment_schoolId_academicYearId_userId_idx" ON "SubjectTeacherAssignment"("schoolId", "academicYearId", "userId");

-- CreateIndex
CREATE UNIQUE INDEX "SubjectTeacherAssignment_active_section_subject_key" ON "SubjectTeacherAssignment"("schoolId", "academicYearId", "sectionId", "subjectId") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SubjectTeacherAssignment_id_schoolId_key" ON "SubjectTeacherAssignment"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ScheduleSettings_schoolId_key" ON "ScheduleSettings"("schoolId");

-- CreateIndex
CREATE INDEX "Holiday_schoolId_date_deletedAt_idx" ON "Holiday"("schoolId", "date", "deletedAt");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_schoolId_date_key" ON "Holiday"("schoolId", "date");

-- CreateIndex
CREATE UNIQUE INDEX "Holiday_id_schoolId_key" ON "Holiday"("id", "schoolId");

-- CreateIndex
CREATE INDEX "CombinedLessonGroup_schoolId_academicYearId_dayOfWeek_perio_idx" ON "CombinedLessonGroup"("schoolId", "academicYearId", "dayOfWeek", "period", "teacherId");

-- CreateIndex
CREATE UNIQUE INDEX "CombinedLessonGroup_id_schoolId_key" ON "CombinedLessonGroup"("id", "schoolId");

-- CreateIndex
CREATE INDEX "TimetableChange_schoolId_entryId_createdAt_idx" ON "TimetableChange"("schoolId", "entryId", "createdAt");

-- CreateIndex
CREATE INDEX "TimetableEntry_schoolId_academicYearId_dayOfWeek_period_idx" ON "TimetableEntry"("schoolId", "academicYearId", "dayOfWeek", "period");

-- CreateIndex
CREATE INDEX "TimetableEntry_schoolId_teacherId_dayOfWeek_period_idx" ON "TimetableEntry"("schoolId", "teacherId", "dayOfWeek", "period");

-- CreateIndex
CREATE UNIQUE INDEX "TimetableEntry_id_schoolId_key" ON "TimetableEntry"("id", "schoolId");

-- AddForeignKey
-- Legacy combinedGroupId values did not reference a real group table. Remove those dangling markers before enforcing the new composite FK.
UPDATE "TimetableEntry" SET "combinedGroupId" = NULL WHERE "combinedGroupId" IS NOT NULL;

-- AddForeignKey
ALTER TABLE "ScheduleSettings" ADD CONSTRAINT "ScheduleSettings_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_academicYearId_schoolId_fkey" FOREIGN KEY ("academicYearId", "schoolId") REFERENCES "AcademicYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_subjectId_schoolId_fkey" FOREIGN KEY ("subjectId", "schoolId") REFERENCES "Subject"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubjectTeacherAssignment" ADD CONSTRAINT "SubjectTeacherAssignment_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScheduleSettings" ADD CONSTRAINT "ScheduleSettings_updatedById_schoolId_fkey" FOREIGN KEY ("updatedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Holiday" ADD CONSTRAINT "Holiday_createdById_schoolId_fkey" FOREIGN KEY ("createdById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombinedLessonGroup" ADD CONSTRAINT "CombinedLessonGroup_academicYearId_schoolId_fkey" FOREIGN KEY ("academicYearId", "schoolId") REFERENCES "AcademicYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombinedLessonGroup" ADD CONSTRAINT "CombinedLessonGroup_subjectId_schoolId_fkey" FOREIGN KEY ("subjectId", "schoolId") REFERENCES "Subject"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombinedLessonGroup" ADD CONSTRAINT "CombinedLessonGroup_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CombinedLessonGroup" ADD CONSTRAINT "CombinedLessonGroup_createdById_schoolId_fkey" FOREIGN KEY ("createdById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_academicYearId_schoolId_fkey" FOREIGN KEY ("academicYearId", "schoolId") REFERENCES "AcademicYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_subjectId_schoolId_fkey" FOREIGN KEY ("subjectId", "schoolId") REFERENCES "Subject"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_teacherId_schoolId_fkey" FOREIGN KEY ("teacherId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_createdById_schoolId_fkey" FOREIGN KEY ("createdById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_updatedById_schoolId_fkey" FOREIGN KEY ("updatedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_combinedGroupId_schoolId_fkey" FOREIGN KEY ("combinedGroupId", "schoolId") REFERENCES "CombinedLessonGroup"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableChange" ADD CONSTRAINT "TimetableChange_entryId_schoolId_fkey" FOREIGN KEY ("entryId", "schoolId") REFERENCES "TimetableEntry"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TimetableChange" ADD CONSTRAINT "TimetableChange_actorId_schoolId_fkey" FOREIGN KEY ("actorId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Timetable coordinates and subject/label exclusivity are also enforced for concurrent writers.
UPDATE "TimetableEntry" SET "label" = 'Unspecified lesson' WHERE "subjectId" IS NULL AND NULLIF(BTRIM("label"), '') IS NULL;
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_valid_slot_check"
  CHECK ("dayOfWeek" BETWEEN 0 AND 6 AND "period" BETWEEN 1 AND 8);
ALTER TABLE "TimetableEntry" ADD CONSTRAINT "TimetableEntry_subject_or_label_check"
  CHECK (("subjectId" IS NOT NULL AND "label" IS NULL) OR ("subjectId" IS NULL AND NULLIF(BTRIM("label"), '') IS NOT NULL));

-- Serialize teacher-slot checks, including saves to different sections at the same time.
CREATE OR REPLACE FUNCTION school_erp_timetable_teacher_conflict() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."deletedAt" IS NOT NULL OR NEW."teacherId" IS NULL THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(
    NEW."schoolId" || ':' || NEW."teacherId" || ':' || NEW."dayOfWeek" || ':' || NEW."period", 0
  ));

  IF NEW."combinedGroupId" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM "CombinedLessonGroup" group_row
    WHERE group_row."id" = NEW."combinedGroupId"
      AND group_row."schoolId" = NEW."schoolId"
      AND group_row."academicYearId" = NEW."academicYearId"
      AND group_row."dayOfWeek" = NEW."dayOfWeek"
      AND group_row."period" = NEW."period"
      AND group_row."subjectId" = NEW."subjectId"
      AND group_row."teacherId" = NEW."teacherId"
      AND group_row."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'Combined lesson does not match this slot, subject and teacher' USING ERRCODE = '23514';
  END IF;

  IF EXISTS (
    SELECT 1 FROM "TimetableEntry" other
    WHERE other."schoolId" = NEW."schoolId"
      AND other."academicYearId" = NEW."academicYearId"
      AND other."teacherId" = NEW."teacherId"
      AND other."dayOfWeek" = NEW."dayOfWeek"
      AND other."period" = NEW."period"
      AND other."deletedAt" IS NULL
      AND other."id" <> NEW."id"
      AND (NEW."combinedGroupId" IS NULL OR other."combinedGroupId" IS DISTINCT FROM NEW."combinedGroupId")
  ) THEN
    RAISE EXCEPTION 'Teacher already has a lesson in this timetable slot' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER "TimetableEntry_teacher_conflict_trigger"
BEFORE INSERT OR UPDATE OF "schoolId", "academicYearId", "dayOfWeek", "period", "teacherId", "combinedGroupId", "subjectId", "deletedAt"
ON "TimetableEntry" FOR EACH ROW EXECUTE FUNCTION school_erp_timetable_teacher_conflict();

-- Unique indexes provide race-safe conflict checks even when simultaneous requests have stale query snapshots.
CREATE UNIQUE INDEX "TimetableEntry_active_teacher_slot_key"
ON "TimetableEntry"("schoolId", "academicYearId", "teacherId", "dayOfWeek", "period")
WHERE "deletedAt" IS NULL AND "teacherId" IS NOT NULL AND "combinedGroupId" IS NULL;
CREATE UNIQUE INDEX "CombinedLessonGroup_active_teacher_slot_key"
ON "CombinedLessonGroup"("schoolId", "academicYearId", "teacherId", "dayOfWeek", "period")
WHERE "deletedAt" IS NULL;

-- Timetable change history is append-only.
CREATE OR REPLACE FUNCTION school_erp_timetable_change_immutable() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Timetable history is append-only';
END;
$$;
CREATE TRIGGER "TimetableChange_immutable_trigger"
BEFORE UPDATE OR DELETE ON "TimetableChange"
FOR EACH ROW EXECUTE FUNCTION school_erp_timetable_change_immutable();

-- These tables are server-only. The Prisma connection is scoped in application code; browser roles receive no row access.
ALTER TABLE "SubjectTeacherAssignment" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ScheduleSettings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "Holiday" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "CombinedLessonGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "TimetableChange" ENABLE ROW LEVEL SECURITY;

