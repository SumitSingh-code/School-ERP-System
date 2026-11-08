import { PrismaClient } from "@prisma/client";

const unscopedModels = new Set(["Role", "Capability", "RoleCapability"]);

/** Create one database client per authenticated school context. Unknown models fail closed. */
export function forSchool(prisma: PrismaClient, schoolId: string) {
  if (!schoolId?.trim()) throw new Error("A school scope is required");
  return prisma.$extends({
    query: {
      $allModels: {
        // Prisma's generated extension callback uses model-dependent argument types.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          if (unscopedModels.has(model)) return query(args);
          if (!model || !["School", "User", "UserRole", "Session", "AuditLog", "Student", "Guardian", "StudentGuardian", "Section", "TimetableEntry"].includes(model)) {
            throw new Error(`Model ${model ?? "unknown"} is not classified for tenant access`);
          }

          const tenantField = model === "School" ? "id" : "schoolId";
          if ("where" in args) args.where = { AND: [args.where ?? {}, { [tenantField]: schoolId }] };
          if (operation === "create") args.data = { ...args.data, [tenantField]: schoolId };
          if (operation === "createMany") args.data = Array.isArray(args.data)
            ? args.data.map((row: object) => ({ ...row, [tenantField]: schoolId }))
            : { ...args.data, [tenantField]: schoolId };
          if (operation === "upsert") args.create = { ...args.create, [tenantField]: schoolId };
          return query(args);
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof forSchool>;
