import { PrismaClient } from "@prisma/client";
import { seedSystemRoles } from "../src/lib/role-permissions";

const prisma = new PrismaClient();

async function main() {
  if (process.env.NODE_ENV === "production" || process.env.ALLOW_SYNTHETIC_SEED !== "true") {
    throw new Error("Synthetic seed data is blocked unless ALLOW_SYNTHETIC_SEED=true is explicitly set in a non-production environment.");
  }

  const school = await prisma.school.upsert({
    where: { id: "demo-school" },
    update: {},
    create: { id: "demo-school", name: "Synthetic Demo School" },
  });

  await prisma.student.createMany({
    data: Array.from({ length: 1000 }, (_, index) => ({
      id: `demo-student-${String(index + 1).padStart(4, "0")}`,
      schoolId: school.id,
      admissionNo: `DEMO-${String(index + 1).padStart(4, "0")}`,
      fullName: index === 0 ? "Synthetic Twin A" : index === 1 ? "Synthetic Twin B" : `Synthetic Student ${index + 1}`,
      status: index === 999 ? "INACTIVE" : "ACTIVE",
    })),
    skipDuplicates: true,
  });

  const guardians = Array.from({ length: 900 }, (_, index) => ({
    id: `demo-guardian-${String(index + 1).padStart(4, "0")}`,
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
        studentId: `demo-student-${String(studentIndex + 1).padStart(4, "0")}`,
        guardianId: `demo-guardian-${String(guardianIndex + 1).padStart(4, "0")}`,
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
      const user = await prisma.user.upsert({
        where: { phone },
        update: { name: `Synthetic Staff ${sequence}`, schoolId: school.id, status: "ACTIVE", deletedAt: null },
        create: {
          id: `demo-staff-${sequence}`,
          schoolId: school.id,
          name: `Synthetic Staff ${sequence}`,
          phone,
          passwordHash: null,
          mustChangePassword: true,
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
  console.log(`Synthetic seed verified: ${studentCount} students, ${guardianCount} guardians, ${guardianLinkCount} links (100 sibling pairs), ${staffCount} staff accounts.`);
}

main().finally(() => prisma.$disconnect());
