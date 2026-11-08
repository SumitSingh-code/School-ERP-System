/** Fail-closed access helpers for Prisma models that carry schoolId. */
export type SchoolScope = { schoolId: string };

export function scopedWhere<T extends Record<string, unknown>>(
  scope: SchoolScope | null | undefined,
  where?: T,
): T & { schoolId: string } {
  if (!scope?.schoolId?.trim()) throw new Error("A school scope is required");
  if (where && "schoolId" in where && where.schoolId !== scope.schoolId) {
    throw new Error("Query schoolId does not match the active school scope");
  }
  return { ...where, schoolId: scope.schoolId } as T & { schoolId: string };
}

type ScopedArgs = { where?: Record<string, unknown>; [key: string]: unknown };
type FindManyDelegate = { findMany(args: ScopedArgs): Promise<Record<string, unknown>[]> };

export function createSchoolRepository<T extends FindManyDelegate>(delegate: T, scope: SchoolScope) {
  return {
    findMany(args: ScopedArgs = {}) {
      return delegate.findMany({ ...args, where: scopedWhere(scope, args.where) });
    },
  };
}
