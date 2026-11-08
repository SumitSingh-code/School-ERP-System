import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
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
      fullName: `Synthetic Student ${index + 1}`,
      status: "ACTIVE",
    })),
    skipDuplicates: true,
  });
}

main().finally(() => prisma.$disconnect());
