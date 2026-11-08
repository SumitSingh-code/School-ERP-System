export const CAPABILITIES = [
  "attendance.mark",
  "student.read",
  "fees.collect",
  "audit.read",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ActivePrincipal = { userId: string; schoolId: string; activeRole: string; capabilities: ReadonlySet<string> };

export function requireCapability(principal: ActivePrincipal | null, capability: Capability): ActivePrincipal {
  if (!principal) throw new Error("Authentication required");
  if (!principal.capabilities.has(capability)) throw new Error("Forbidden");
  if (!principal.schoolId) throw new Error("School scope required");
  return principal;
}
