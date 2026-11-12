import { PrismaClient } from "@prisma/client";
import argon2 from "argon2";
import { passwordPolicyError } from "../src/lib/auth-rules";
import { seedSystemRoles } from "../src/lib/role-permissions";
import { initializeAcademicStructure } from "../src/lib/seed-academics";
import { defaultAttendanceTemplates } from "../src/lib/attendance-rules";

const prisma = new PrismaClient();

function syntheticUuid(sequence: number) {
  return `00000000-0000-4000-8000-${sequence.toString(16).padStart(12, "0")}`;
}

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_SYNTHETIC_SEED !== "true") {
    throw new Error("Synthetic seed data is blocked unless ALLOW_SYNTHETIC_SEED=true is explicitly set in a non-production environment.");
  }
  const demoTeacherPassword = process.env.SYNTHETIC_TEACHER_PASSWORD;
  const demoTeacherPasswordError = demoTeacherPassword ? passwordPolicyError(demoTeacherPassword, "SYNTHETIC-STAFF-053") : null;
  if (demoTeacherPasswordError) throw new Error(`SYNTHETIC_TEACHER_PASSWORD: ${demoTeacherPasswordError}`);
  const demoTeacherPasswordHash = demoTeacherPassword
    ? await argon2.hash(demoTeacherPassword, { type: argon2.argon2id })
    : null;

  const school = await prisma.school.upsert({
    where: { id: syntheticUuid(1) },
    update: {},
    create: { id: syntheticUuid(1), name: "Synthetic Demo School" },
  });

  await prisma.student.createMany({
    data: Array.from({ length: 1000 }, (_, index) => ({
      id: syntheticUuid(1_000 + index + 1),
      schoolId: school.id,
      admissionNo: `DEMO-${String(index + 1).padStart(4, "0")}`,
      fullName: index === 0 ? "Synthetic Twin A" : index === 1 ? "Synthetic Twin B" : `Synthetic Student ${index + 1}`,
      status: index === 999 ? "INACTIVE" : "ACTIVE",
    })),
    skipDuplicates: true,
  });

  const academic = await initializeAcademicStructure(prisma, school.id);
  await prisma.notificationTemplate.createMany({ data: defaultAttendanceTemplates(school.id), skipDuplicates: true });
  for (let index = 0; index < academic.sections.length; index += 1) {
    const section = academic.sections[index];
    if (!section) continue;
    const studentIds = Array.from({ length: 1000 }, (_, studentIndex) => studentIndex)
      .filter((studentIndex) => studentIndex % academic.sections.length === index)
      .map((studentIndex) => syntheticUuid(1_000 + studentIndex + 1));
    if (studentIds.length) await prisma.student.updateMany({
      where: { id: { in: studentIds }, schoolId: school.id },
      data: { sectionId: section.sectionId },
    });
  }

  const guardians = Array.from({ length: 900 }, (_, index) => ({
    id: syntheticUuid(2_000 + index + 1),
    schoolId: school.id,
    name: `Synthetic Guardian ${index + 1}`,
    // Reserved synthetic labels are intentionally not routable phone numbers.
    phone: `SYNTHETIC-PARENT-${String(index + 1).padStart(4, "0")}`,
  }));
  await prisma.guardian.createMany({ data: guardians, skipDuplicates: true });

  await prisma.studentGuardian.createMany({
    data: Array.from({ length: 1000 }, (_, studentIndex) => {
      const guardianIndex = studentIndex < 200
        ? Math.floor(studentIndex / 2)
        : 100 + studentIndex - 200;
      return {
        studentId: syntheticUuid(1_000 + studentIndex + 1),
        guardianId: syntheticUuid(2_000 + guardianIndex + 1),
        schoolId: school.id,
        relation: "Parent",
        isPrimary: true,
      };
    }),
    skipDuplicates: true,
  });

  await seedSystemRoles(prisma);

  const roleAssignments = [
    ["Director", 1],
    ["Principal", 2],
    ["Reception", 3],
    ["Finance", 1],
    ["Class Teacher", 30],
    ["Subject Teacher", 15],
    ["Teacher", 8],
  ] as const;
  const seededRoles = await prisma.role.findMany({ where: { name: { in: roleAssignments.map(([name]) => name) } } });
  const roleIds = new Map(seededRoles.map((role) => [role.name, role.id]));
  const staffRoleLinks: Array<{ userId: string; roleId: string; schoolId: string }> = [];
  let staffIndex = 0;
  for (const [roleName, count] of roleAssignments) {
    const roleId = roleIds.get(roleName);
    if (!roleId) throw new Error(`Seeded role ${roleName} is missing`);
    for (let index = 0; index < count; index += 1) {
      staffIndex += 1;
      const sequence = String(staffIndex).padStart(3, "0");
      const phone = `SYNTHETIC-STAFF-${sequence}`;
      const isDemoTeacher = roleName === "Teacher" && index === 0;
      const user = await prisma.user.upsert({
        where: { phone },
        update: {
          name: `Synthetic Staff ${sequence}`,
          schoolId: school.id,
          status: "ACTIVE",
          deletedAt: null,
          ...(isDemoTeacher && demoTeacherPasswordHash ? { passwordHash: demoTeacherPasswordHash, mustChangePassword: false } : {}),
        },
        create: {
          id: syntheticUuid(3_000 + staffIndex),
          schoolId: school.id,
          name: `Synthetic Staff ${sequence}`,
          phone,
          passwordHash: isDemoTeacher ? demoTeacherPasswordHash : null,
          mustChangePassword: !isDemoTeacher || !demoTeacherPasswordHash,
        },
      });
      staffRoleLinks.push({ userId: user.id, roleId, schoolId: school.id });
    }
  }
  await prisma.userRole.createMany({ data: staffRoleLinks, skipDuplicates: true });

  const [studentCount, guardianCount, guardianLinkCount, staffCount] = await Promise.all([
    prisma.student.count({ where: { schoolId: school.id } }),
    prisma.guardian.count({ where: { schoolId: school.id } }),
    prisma.studentGuardian.count({ where: { schoolId: school.id } }),
    prisma.user.count({ where: { schoolId: school.id, phone: { startsWith: "SYNTHETIC-STAFF-" } } }),
  ]);
  if (studentCount !== 1000 || guardianCount !== 900 || guardianLinkCount !== 1000 || staffCount !== 60) {
    throw new Error(`Synthetic seed verification failed: students=${studentCount}, guardians=${guardianCount}, links=${guardianLinkCount}, staff=${staffCount}`);
  }
  const [academicYearCount, classLevelCount, sectionCount, subjectCount] = await Promise.all([
    prisma.academicYear.count({ where: { schoolId: school.id } }),
    prisma.classLevel.count({ where: { schoolId: school.id } }),
    prisma.section.count({ where: { schoolId: school.id } }),
    prisma.subject.count({ where: { schoolId: school.id } }),
  ]);
  if (academicYearCount < 1 || classLevelCount !== 15 || sectionCount < 20 || subjectCount < 20) {
    throw new Error(`Academic seed verification failed: years=${academicYearCount}, classes=${classLevelCount}, sections=${sectionCount}, subjects=${subjectCount}`);
  }
  console.log(`Synthetic seed verified: ${studentCount} students across ${sectionCount} sections, ${classLevelCount} classes, ${subjectCount} subjects, ${guardianCount} guardians, ${guardianLinkCount} links (100 sibling pairs), ${staffCount} staff accounts.`);
}

main().finally(() => prisma.$disconnect());
