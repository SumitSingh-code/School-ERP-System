-- AlterTable
ALTER TABLE "UserRole" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Student" ADD COLUMN     "address" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "dateOfBirth" DATE,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "gender" TEXT,
ADD COLUMN     "paymentPlanLabel" TEXT,
ADD COLUMN     "sectionId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Guardian" ADD COLUMN     "deletedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "StudentGuardian" ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- AlterTable
ALTER TABLE "Section" ADD COLUMN     "active" BOOLEAN NOT NULL DEFAULT true,
ADD COLUMN     "classLevelId" TEXT,
ADD COLUMN     "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
ADD COLUMN     "deletedAt" TIMESTAMP(3),
ADD COLUMN     "groupId" TEXT,
ADD COLUMN     "streamId" TEXT,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "AcademicYear" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "AcademicYear_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassLevel" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClassLevel_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Stream" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Stream_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudyGroup" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "streamId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "StudyGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Subject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "optional" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Subject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassSubject" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "classLevelId" TEXT NOT NULL,
    "streamId" TEXT,
    "groupId" TEXT,
    "subjectId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClassSubject_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "activeRole" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "rowCount" INTEGER NOT NULL,
    "createdCount" INTEGER NOT NULL,
    "updatedCount" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'COMPLETED',
    "rolledBackAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClassTeacherAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "academicYearId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "ClassTeacherAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LedgerEntry" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "importBatchId" TEXT,
    "entryType" TEXT NOT NULL,
    "amountPaise" BIGINT NOT NULL,
    "description" TEXT NOT NULL,
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LedgerEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "operation" TEXT NOT NULL,
    "beforeValue" JSONB,
    "afterUpdatedAt" TIMESTAMP(3) NOT NULL,
    "isUsed" BOOLEAN NOT NULL DEFAULT false,
    "actorId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ImportRecord_pkey" PRIMARY KEY ("id")
);

-- Preserve any Phase 0 section rows while converting their free-text class/year values to scoped records.
INSERT INTO "ClassLevel" ("id", "schoolId", "name", "sortOrder", "active", "updatedAt")
SELECT gen_random_uuid()::text, source."schoolId", source."className",
       CASE WHEN source."className" ~ '^[0-9]+$' THEN source."className"::integer
            WHEN upper(source."className") = 'NC' THEN 0
            WHEN upper(source."className") = 'LKG' THEN 1
            WHEN upper(source."className") = 'UKG' THEN 2
            ELSE 99 END,
       true, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "schoolId", "className" FROM "Section") AS source
ON CONFLICT ("schoolId", "name") DO NOTHING;

INSERT INTO "AcademicYear" ("id", "schoolId", "label", "startsOn", "endsOn", "isCurrent", "updatedAt")
SELECT source."academicYearId", source."schoolId", left(source."academicYearId", 12),
       make_date(CASE WHEN source."academicYearId" ~ '^20[0-9]{2}(-[0-9]{2,4})?$' THEN substring(source."academicYearId" from 1 for 4)::integer ELSE extract(year FROM CURRENT_DATE)::integer END, 4, 1),
       make_date((CASE WHEN source."academicYearId" ~ '^20[0-9]{2}(-[0-9]{2,4})?$' THEN substring(source."academicYearId" from 1 for 4)::integer ELSE extract(year FROM CURRENT_DATE)::integer END) + 1, 3, 31),
       false, CURRENT_TIMESTAMP
FROM (SELECT DISTINCT "schoolId", "academicYearId" FROM "Section") AS source
ON CONFLICT DO NOTHING;

UPDATE "Section" AS section
SET "classLevelId" = class."id"
FROM "ClassLevel" AS class
WHERE class."schoolId" = section."schoolId" AND class."name" = section."className";

ALTER TABLE "Section" ALTER COLUMN "classLevelId" SET NOT NULL;
ALTER TABLE "Section" DROP COLUMN "className";
ALTER TABLE "UserRole" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Student" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "StudentGuardian" ALTER COLUMN "updatedAt" DROP DEFAULT;
ALTER TABLE "Section" ALTER COLUMN "updatedAt" DROP DEFAULT;

-- CreateIndex
CREATE INDEX "AcademicYear_schoolId_isCurrent_idx" ON "AcademicYear"("schoolId", "isCurrent");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_schoolId_label_key" ON "AcademicYear"("schoolId", "label");

-- CreateIndex
CREATE UNIQUE INDEX "AcademicYear_id_schoolId_key" ON "AcademicYear"("id", "schoolId");
CREATE UNIQUE INDEX "AcademicYear_one_current_per_school_key" ON "AcademicYear"("schoolId") WHERE "isCurrent" = true AND "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "ClassLevel_schoolId_sortOrder_idx" ON "ClassLevel"("schoolId", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ClassLevel_schoolId_name_key" ON "ClassLevel"("schoolId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "ClassLevel_id_schoolId_key" ON "ClassLevel"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_schoolId_classLevelId_name_key" ON "Stream"("schoolId", "classLevelId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_id_schoolId_key" ON "Stream"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "Stream_id_schoolId_classLevelId_key" ON "Stream"("id", "schoolId", "classLevelId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyGroup_schoolId_streamId_name_key" ON "StudyGroup"("schoolId", "streamId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "StudyGroup_id_schoolId_key" ON "StudyGroup"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "StudyGroup_id_schoolId_streamId_key" ON "StudyGroup"("id", "schoolId", "streamId");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_schoolId_code_key" ON "Subject"("schoolId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "Subject_id_schoolId_key" ON "Subject"("id", "schoolId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSubject_schoolId_classLevelId_streamId_groupId_subject_key" ON "ClassSubject"("schoolId", "classLevelId", "streamId", "groupId", "subjectId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassSubject_id_schoolId_key" ON "ClassSubject"("id", "schoolId");
CREATE UNIQUE INDEX "ClassSubject_class_global_key" ON "ClassSubject"("schoolId", "classLevelId", "subjectId") WHERE "streamId" IS NULL AND "groupId" IS NULL;
CREATE UNIQUE INDEX "ClassSubject_class_stream_key" ON "ClassSubject"("schoolId", "classLevelId", "streamId", "subjectId") WHERE "streamId" IS NOT NULL AND "groupId" IS NULL;
CREATE UNIQUE INDEX "ClassSubject_class_group_key" ON "ClassSubject"("schoolId", "classLevelId", "streamId", "groupId", "subjectId") WHERE "groupId" IS NOT NULL;
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_group_requires_stream" CHECK ("groupId" IS NULL OR "streamId" IS NOT NULL);

-- CreateIndex
CREATE INDEX "ImportBatch_schoolId_createdAt_idx" ON "ImportBatch"("schoolId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ImportBatch_id_schoolId_key" ON "ImportBatch"("id", "schoolId");

-- CreateIndex
CREATE INDEX "ClassTeacherAssignment_schoolId_academicYearId_sectionId_idx" ON "ClassTeacherAssignment"("schoolId", "academicYearId", "sectionId");

-- CreateIndex
CREATE INDEX "ClassTeacherAssignment_schoolId_academicYearId_userId_idx" ON "ClassTeacherAssignment"("schoolId", "academicYearId", "userId");

-- CreateIndex
CREATE INDEX "ClassTeacherAssignment_schoolId_userId_academicYearId_idx" ON "ClassTeacherAssignment"("schoolId", "userId", "academicYearId");

-- CreateIndex
CREATE UNIQUE INDEX "ClassTeacherAssignment_id_schoolId_key" ON "ClassTeacherAssignment"("id", "schoolId");
CREATE UNIQUE INDEX "ClassTeacherAssignment_active_section_key" ON "ClassTeacherAssignment"("schoolId", "academicYearId", "sectionId") WHERE "deletedAt" IS NULL;
CREATE UNIQUE INDEX "ClassTeacherAssignment_active_user_key" ON "ClassTeacherAssignment"("schoolId", "academicYearId", "userId") WHERE "deletedAt" IS NULL;

-- CreateIndex
CREATE INDEX "LedgerEntry_schoolId_studentId_createdAt_idx" ON "LedgerEntry"("schoolId", "studentId", "createdAt");

-- CreateIndex
CREATE INDEX "LedgerEntry_schoolId_importBatchId_idx" ON "LedgerEntry"("schoolId", "importBatchId");

-- CreateIndex
CREATE UNIQUE INDEX "LedgerEntry_id_schoolId_key" ON "LedgerEntry"("id", "schoolId");

-- CreateIndex
CREATE INDEX "ImportRecord_schoolId_targetType_targetId_idx" ON "ImportRecord"("schoolId", "targetType", "targetId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRecord_batchId_targetType_targetId_key" ON "ImportRecord"("batchId", "targetType", "targetId");

-- CreateIndex
CREATE INDEX "Student_schoolId_sectionId_idx" ON "Student"("schoolId", "sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "Section_schoolId_academicYearId_classLevelId_streamId_group_key" ON "Section"("schoolId", "academicYearId", "classLevelId", "streamId", "groupId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "Section_id_schoolId_key" ON "Section"("id", "schoolId");
CREATE UNIQUE INDEX "Section_year_class_global_key" ON "Section"("schoolId", "academicYearId", "classLevelId", "name") WHERE "streamId" IS NULL AND "groupId" IS NULL;
CREATE UNIQUE INDEX "Section_year_class_stream_key" ON "Section"("schoolId", "academicYearId", "classLevelId", "streamId", "name") WHERE "streamId" IS NOT NULL AND "groupId" IS NULL;
CREATE UNIQUE INDEX "Section_year_class_group_key" ON "Section"("schoolId", "academicYearId", "classLevelId", "streamId", "groupId", "name") WHERE "groupId" IS NOT NULL;
ALTER TABLE "Section" ADD CONSTRAINT "Section_group_requires_stream" CHECK ("groupId" IS NULL OR "streamId" IS NOT NULL);
ALTER TABLE "AcademicYear" ADD CONSTRAINT "AcademicYear_date_order" CHECK ("endsOn" > "startsOn");

-- AddForeignKey
ALTER TABLE "Stream" ADD CONSTRAINT "Stream_classLevelId_schoolId_fkey" FOREIGN KEY ("classLevelId", "schoolId") REFERENCES "ClassLevel"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudyGroup" ADD CONSTRAINT "StudyGroup_streamId_schoolId_fkey" FOREIGN KEY ("streamId", "schoolId") REFERENCES "Stream"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_classLevelId_schoolId_fkey" FOREIGN KEY ("classLevelId", "schoolId") REFERENCES "ClassLevel"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_streamId_schoolId_classLevelId_fkey" FOREIGN KEY ("streamId", "schoolId", "classLevelId") REFERENCES "Stream"("id", "schoolId", "classLevelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_groupId_schoolId_streamId_fkey" FOREIGN KEY ("groupId", "schoolId", "streamId") REFERENCES "StudyGroup"("id", "schoolId", "streamId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassSubject" ADD CONSTRAINT "ClassSubject_subjectId_schoolId_fkey" FOREIGN KEY ("subjectId", "schoolId") REFERENCES "Subject"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Student" ADD CONSTRAINT "Student_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_classLevelId_schoolId_fkey" FOREIGN KEY ("classLevelId", "schoolId") REFERENCES "ClassLevel"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_streamId_schoolId_classLevelId_fkey" FOREIGN KEY ("streamId", "schoolId", "classLevelId") REFERENCES "Stream"("id", "schoolId", "classLevelId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_groupId_schoolId_streamId_fkey" FOREIGN KEY ("groupId", "schoolId", "streamId") REFERENCES "StudyGroup"("id", "schoolId", "streamId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Section" ADD CONSTRAINT "Section_academicYearId_schoolId_fkey" FOREIGN KEY ("academicYearId", "schoolId") REFERENCES "AcademicYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_academicYearId_schoolId_fkey" FOREIGN KEY ("academicYearId", "schoolId") REFERENCES "AcademicYear"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClassTeacherAssignment" ADD CONSTRAINT "ClassTeacherAssignment_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_createdBy_schoolId_fkey" FOREIGN KEY ("createdBy", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_importBatchId_schoolId_fkey" FOREIGN KEY ("importBatchId", "schoolId") REFERENCES "ImportBatch"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LedgerEntry" ADD CONSTRAINT "LedgerEntry_reversalOfId_schoolId_fkey" FOREIGN KEY ("reversalOfId", "schoolId") REFERENCES "LedgerEntry"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_batchId_schoolId_fkey" FOREIGN KEY ("batchId", "schoolId") REFERENCES "ImportBatch"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRecord" ADD CONSTRAINT "ImportRecord_actorId_schoolId_fkey" FOREIGN KEY ("actorId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Ledger corrections are appended as reversal entries; existing entries cannot be edited or removed.
CREATE OR REPLACE FUNCTION prevent_ledger_entry_mutation() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Ledger entries are append-only; create a reversal entry instead.';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "LedgerEntry_append_only"
BEFORE UPDATE OR DELETE ON "LedgerEntry"
FOR EACH ROW EXECUTE FUNCTION prevent_ledger_entry_mutation();
