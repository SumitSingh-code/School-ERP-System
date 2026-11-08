import type { ScopedPrisma } from "./scoped-prisma";

export type AuditEvent = {
  actorId: string;
  activeRole: string;
  schoolId: string;
  action: string;
  entityType: string;
  entityId?: string;
  oldValue?: object;
  newValue?: object;
};

/** Commit a domain mutation and its audit row atomically. */
export function auditedMutation<T>(
  db: ScopedPrisma,
  event: AuditEvent,
  mutate: (tx: ScopedPrisma) => Promise<T>,
): Promise<T> {
  if (event.schoolId.trim() === "" || event.actorId.trim() === "" || event.action.trim() === "") {
    throw new Error("Audit actor, school and action are required");
  }
  return db.$transaction(async (tx) => {
    const result = await mutate(tx as ScopedPrisma);
    await tx.auditLog.create({ data: event });
    return result;
  });
}
