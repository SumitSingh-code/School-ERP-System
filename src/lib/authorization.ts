export const CAPABILITIES = [
  "dashboard.read",
  "attendance.mark",
  "attendance.override",
  "attendance.late",
  "attendance.read",
  "attendance.substitute",
  "student.read",
  "student.create",
  "student.update",
  "student.import",
  "student.reactivate",
  "guardian.update",
  "staff.manage",
  "academic.manage",
  "assignment.manage",
  "timetable.read",
  "timetable.manage",
  "holiday.manage",
  "holiday.sudden",
  "assessment.declare",
  "assessment.approve",
  "marks.enter",
  "marks.read",
  "marks.publish",
  "report.generate",
  "fees.structure.manage",
  "fees.structure.approve",
  "fees.concession.propose",
  "fees.concession.approve",
  "fees.collect",
  "fees.ledger.read",
  "fees.reversal.request",
  "fees.reversal.approve",
  "fees.day-close",
  "fees.day-close.reopen",
  "notice.send",
  "notice.recall",
  "parent.read",
  "reports.read",
  "audit.read",
  "settings.manage",
  "year.rollover",
] as const;

export type Capability = (typeof CAPABILITIES)[number];
export type ActivePrincipal = { userId: string; schoolId: string; activeRole: string; capabilities: ReadonlySet<string> };

export function requireCapability(principal: ActivePrincipal | null, capability: Capability): ActivePrincipal {
  if (!principal) throw new Error("Authentication required");
  if (!principal.capabilities.has(capability)) throw new Error("Forbidden");
  if (!principal.schoolId) throw new Error("School scope required");
  return principal;
}
