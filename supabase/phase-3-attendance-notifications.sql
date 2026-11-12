CREATE TYPE "AttendanceRecordStatus" AS ENUM ('ABSENT', 'LATE');
CREATE TYPE "NotificationStatus" AS ENUM ('QUEUED', 'SENT', 'DELIVERED', 'FAILED', 'CANCELLED');

ALTER TABLE "ScheduleSettings" ADD COLUMN "attendanceCutoff" TEXT NOT NULL DEFAULT '10:00';
ALTER TABLE "ScheduleSettings" ADD COLUMN "attendanceEscalationMinutes" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "SubstituteAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    CONSTRAINT "SubstituteAssignment_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceSubmission" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "submittedById" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "voidedAt" TIMESTAMP(3),
    "voidedById" TEXT,
    "voidReason" TEXT,
    CONSTRAINT "AttendanceSubmission_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AttendanceRecord" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "studentId" TEXT NOT NULL,
    "date" DATE NOT NULL,
    "status" "AttendanceRecordStatus" NOT NULL DEFAULT 'ABSENT',
    "lateReason" TEXT,
    "arrivalAt" TIMESTAMP(3),
    "changedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    CONSTRAINT "AttendanceRecord_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "NotificationTemplate" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "language" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "dltTemplateId" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "NotificationTemplate_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "guardianId" TEXT,
    "userId" TEXT,
    "eventType" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'IN_APP',
    "status" "NotificationStatus" NOT NULL DEFAULT 'QUEUED',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "queuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "deliveredAt" TIMESTAMP(3),
    "failedAt" TIMESTAMP(3),
    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Notification_one_recipient_check" CHECK (("guardianId" IS NULL) <> ("userId" IS NULL))
);

CREATE UNIQUE INDEX "SubstituteAssignment_id_schoolId_key" ON "SubstituteAssignment"("id", "schoolId");
CREATE UNIQUE INDEX "SubstituteAssignment_schoolId_sectionId_date_userId_key" ON "SubstituteAssignment"("schoolId", "sectionId", "date", "userId");
CREATE INDEX "SubstituteAssignment_schoolId_userId_date_revokedAt_idx" ON "SubstituteAssignment"("schoolId", "userId", "date", "revokedAt");
CREATE UNIQUE INDEX "AttendanceSubmission_schoolId_sectionId_date_key" ON "AttendanceSubmission"("schoolId", "sectionId", "date");
CREATE UNIQUE INDEX "AttendanceSubmission_schoolId_idempotencyKey_key" ON "AttendanceSubmission"("schoolId", "idempotencyKey");
CREATE UNIQUE INDEX "AttendanceSubmission_id_schoolId_key" ON "AttendanceSubmission"("id", "schoolId");
CREATE INDEX "AttendanceSubmission_schoolId_date_sectionId_idx" ON "AttendanceSubmission"("schoolId", "date", "sectionId");
CREATE UNIQUE INDEX "AttendanceRecord_submissionId_studentId_key" ON "AttendanceRecord"("submissionId", "studentId");
CREATE UNIQUE INDEX "AttendanceRecord_schoolId_studentId_date_key" ON "AttendanceRecord"("schoolId", "studentId", "date");
CREATE UNIQUE INDEX "AttendanceRecord_id_schoolId_key" ON "AttendanceRecord"("id", "schoolId");
CREATE INDEX "AttendanceRecord_schoolId_sectionId_date_status_idx" ON "AttendanceRecord"("schoolId", "sectionId", "date", "status");
CREATE UNIQUE INDEX "NotificationTemplate_schoolId_eventType_language_channel_key" ON "NotificationTemplate"("schoolId", "eventType", "language", "channel");
CREATE UNIQUE INDEX "NotificationTemplate_id_schoolId_key" ON "NotificationTemplate"("id", "schoolId");
CREATE UNIQUE INDEX "Notification_schoolId_idempotencyKey_key" ON "Notification"("schoolId", "idempotencyKey");
CREATE UNIQUE INDEX "Notification_id_schoolId_key" ON "Notification"("id", "schoolId");
CREATE INDEX "Notification_schoolId_guardianId_queuedAt_idx" ON "Notification"("schoolId", "guardianId", "queuedAt");
CREATE INDEX "Notification_schoolId_userId_queuedAt_idx" ON "Notification"("schoolId", "userId", "queuedAt");

INSERT INTO "NotificationTemplate" ("id", "schoolId", "eventType", "language", "channel", "title", "body", "updatedAt")
SELECT gen_random_uuid()::text, school."id", template."eventType", template."language", 'IN_APP', template."title", template."body", CURRENT_TIMESTAMP
FROM "School" AS school
CROSS JOIN (VALUES
  ('ATTENDANCE_ABSENT', 'en', 'Attendance update', '{{studentName}} was marked absent on {{date}}. If this is unexpected, please contact the school.'),
  ('ATTENDANCE_ABSENT', 'hi', 'उपस्थिति की जानकारी', '{{studentName}} को {{date}} को अनुपस्थित दर्ज किया गया है। यदि यह सही नहीं है, तो कृपया स्कूल से संपर्क करें।'),
  ('ATTENDANCE_LATE_CORRECTION', 'en', 'Attendance correction', '{{studentName}} arrived late on {{date}}; please ignore the earlier absence message.'),
  ('ATTENDANCE_LATE_CORRECTION', 'hi', 'उपस्थिति में सुधार', '{{studentName}} आज देर से पहुँचे हैं; कृपया पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।'),
  ('ATTENDANCE_PENDING', 'en', 'Attendance reminder', 'Please submit attendance for {{sectionName}} for {{date}}.'),
  ('ATTENDANCE_PENDING', 'hi', 'उपस्थिति अनुस्मारक', 'कृपया {{date}} के लिए {{sectionName}} की उपस्थिति जमा करें।'),
  ('ATTENDANCE_ESCALATION', 'en', 'Attendance pending', 'Attendance for {{sectionName}} is still not submitted for {{date}}.'),
  ('ATTENDANCE_ESCALATION', 'hi', 'उपस्थिति बाकी है', '{{date}} के लिए {{sectionName}} की उपस्थिति अभी जमा नहीं हुई है।'),
  ('SCHOOL_HOLIDAY', 'en', 'School closed today', 'School is closed today ({{date}}): {{reason}}.'),
  ('SCHOOL_HOLIDAY', 'hi', 'आज स्कूल बंद है', 'आज ({{date}}) स्कूल बंद है: {{reason}}।'),
  ('ATTENDANCE_VOIDED_FOR_HOLIDAY', 'en', 'Attendance correction', 'School is closed on {{date}}. Please ignore the earlier absence message for {{studentName}}.'),
  ('ATTENDANCE_VOIDED_FOR_HOLIDAY', 'hi', 'उपस्थिति में सुधार', '{{date}} को स्कूल बंद है। कृपया {{studentName}} के लिए पहले भेजे गए अनुपस्थिति संदेश को अनदेखा करें।')
) AS template("eventType", "language", "title", "body")
ON CONFLICT ("schoolId", "eventType", "language", "channel") DO NOTHING;

ALTER TABLE "SubstituteAssignment" ADD CONSTRAINT "SubstituteAssignment_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubstituteAssignment" ADD CONSTRAINT "SubstituteAssignment_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubstituteAssignment" ADD CONSTRAINT "SubstituteAssignment_assignedById_schoolId_fkey" FOREIGN KEY ("assignedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceSubmission" ADD CONSTRAINT "AttendanceSubmission_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceSubmission" ADD CONSTRAINT "AttendanceSubmission_submittedById_schoolId_fkey" FOREIGN KEY ("submittedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceSubmission" ADD CONSTRAINT "AttendanceSubmission_voidedById_schoolId_fkey" FOREIGN KEY ("voidedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_submissionId_schoolId_fkey" FOREIGN KEY ("submissionId", "schoolId") REFERENCES "AttendanceSubmission"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_sectionId_schoolId_fkey" FOREIGN KEY ("sectionId", "schoolId") REFERENCES "Section"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_studentId_schoolId_fkey" FOREIGN KEY ("studentId", "schoolId") REFERENCES "Student"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "AttendanceRecord" ADD CONSTRAINT "AttendanceRecord_changedById_schoolId_fkey" FOREIGN KEY ("changedById", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "NotificationTemplate" ADD CONSTRAINT "NotificationTemplate_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_guardianId_schoolId_fkey" FOREIGN KEY ("guardianId", "schoolId") REFERENCES "Guardian"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_schoolId_fkey" FOREIGN KEY ("userId", "schoolId") REFERENCES "User"("id", "schoolId") ON DELETE RESTRICT ON UPDATE CASCADE;
