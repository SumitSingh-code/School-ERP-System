import { CAPABILITIES, type Capability } from "./authorization";

export const ROLE_CAPABILITIES: Record<string, readonly Capability[]> = {
  Director: CAPABILITIES.filter((capability) => !["fees.collect", "fees.reversal.request", "fees.day-close"].includes(capability)),
  Principal: [
    "dashboard.read", "student.read", "student.create", "student.update", "guardian.update",
    "academic.manage", "assignment.manage", "timetable.read", "timetable.manage", "holiday.manage",
    "holiday.sudden", "attendance.read", "attendance.late", "assessment.approve", "marks.read",
    "marks.publish", "report.generate", "fees.structure.manage", "fees.concession.propose",
    "fees.ledger.read", "notice.send", "notice.recall", "reports.read",
  ],
  Reception: [
    "dashboard.read", "student.read", "student.create", "student.update", "guardian.update",
    "academic.manage", "assignment.manage", "timetable.read", "timetable.manage", "holiday.manage",
    "attendance.read", "attendance.late", "fees.structure.manage", "notice.send", "notice.recall",
  ],
  Finance: ["dashboard.read", "fees.collect", "fees.ledger.read", "fees.reversal.request", "fees.day-close", "reports.read"],
  Teacher: ["dashboard.read", "student.read", "timetable.read"],
  "Class Teacher": ["dashboard.read", "attendance.mark", "student.read", "timetable.read"],
  "Subject Teacher": ["dashboard.read", "student.read", "timetable.read", "assessment.declare", "marks.enter", "marks.read"],
  Substitute: ["dashboard.read", "attendance.mark", "attendance.substitute", "student.read"],
  Parent: ["dashboard.read", "parent.read", "fees.ledger.read"],
};

export async function seedSystemRoles(prisma: import("@prisma/client").PrismaClient) {
  const roles = new Map<string, string>();
  for (const name of Object.keys(ROLE_CAPABILITIES)) {
    const role = await prisma.role.upsert({ where: { name }, update: {}, create: { name } });
    roles.set(name, role.id);
  }

  const capabilities = new Map<string, string>();
  for (const key of CAPABILITIES) {
    const capability = await prisma.capability.upsert({ where: { key }, update: {}, create: { key } });
    capabilities.set(key, capability.id);
  }

  for (const [roleName, keys] of Object.entries(ROLE_CAPABILITIES)) {
    const roleId = roles.get(roleName);
    if (!roleId) throw new Error(`Missing seeded role: ${roleName}`);
    await prisma.roleCapability.createMany({
      data: keys.map((key) => {
        const capabilityId = capabilities.get(key);
        if (!capabilityId) throw new Error(`Missing seeded capability: ${key}`);
        return { roleId, capabilityId };
      }),
      skipDuplicates: true,
    });
  }
}
