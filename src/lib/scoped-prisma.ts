import { PrismaClient } from "@prisma/client";

const unscopedModels = new Set(["Role", "Capability", "RoleCapability"]);
const tenantModels = new Set([
  "School", "User", "UserRole", "Session", "AuthDevice", "OtpChallenge", "AuditLog",
  "Student", "Guardian", "StudentGuardian", "Section", "TimetableEntry", "AcademicYear",
  "ClassLevel", "Stream", "StudyGroup", "Subject", "ClassSubject", "ImportBatch", "ImportRecord",
  "LedgerEntry",
  "ClassTeacherAssignment",
  "SubjectTeacherAssignment", "ScheduleSettings", "Holiday", "CombinedLessonGroup", "TimetableChange",
]);
const whereOperations = new Set([
  "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "findMany",
  "count", "aggregate", "groupBy", "update", "updateMany", "delete", "deleteMany", "upsert",
]);

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Force scope as a top-level unique selector too, so findUnique/update/delete remain valid Prisma calls. */
export function scopeOperationArgs<T extends Record<string, unknown>>(
  model: string,
  operation: string,
  args: T,
  schoolId: string,
): T {
  if (unscopedModels.has(model)) return args;
  if (!tenantModels.has(model)) throw new Error(`Model ${model || "unknown"} is not classified for tenant access`);

  const tenantField = model === "School" ? "id" : "schoolId";
  const scoped = { ...args } as Record<string, unknown>;
  if (whereOperations.has(operation)) scoped.where = { ...asRecord(scoped.where), [tenantField]: schoolId };
  if (["create", "createMany", "createManyAndReturn"].includes(operation)) {
    const force = (row: unknown) => ({ ...asRecord(row), [tenantField]: schoolId });
    scoped.data = Array.isArray(scoped.data) ? scoped.data.map(force) : force(scoped.data);
  }
  if (operation === "update" || operation === "updateMany") {
    scoped.data = { ...asRecord(scoped.data), [tenantField]: schoolId };
  }
  if (operation === "upsert") {
    scoped.create = { ...asRecord(scoped.create), [tenantField]: schoolId };
    scoped.update = { ...asRecord(scoped.update), [tenantField]: schoolId };
  }
  return scoped as T;
}

/** Create one database client per authenticated school context. Unknown models fail closed. */
export function forSchool(prisma: PrismaClient, schoolId: string) {
  if (!schoolId?.trim()) throw new Error("A school scope is required");
  return prisma.$extends({
    query: {
      $allModels: {
        // Prisma's generated extension callback uses model-dependent argument types.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        async $allOperations({ model, operation, args, query }: any) {
          return query(scopeOperationArgs(model, operation, args, schoolId));
        },
      },
    },
  });
}

export type ScopedPrisma = ReturnType<typeof forSchool>;
