import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { normalizeAttendanceDate } from "@/lib/attendance-rules";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

const schema = z.object({ sectionId: z.string().uuid(), userId: z.string().uuid(), date: z.string(), reason: z.string().trim().min(3).max(240) });

export const GET = withSchoolRoute("attendance.read", async (request, _context, { db, principal }) => {
  const dateText = new URL(request.url).searchParams.get("date");
  const date = dateText ? normalizeAttendanceDate(dateText) : null;
  if (dateText && !date) return NextResponse.json({ error: "Enter a real date" }, { status: 400 });
  const limited = !principal.capabilities.has("assignment.manage");
  const assignments = await db.substituteAssignment.findMany({ where: { ...(limited ? { userId: principal.userId } : {}), ...(date ? { date } : {}), revokedAt: null }, include: { substitute: { select: { id: true, name: true } }, section: { include: { classLevel: { select: { name: true } } } } }, orderBy: { date: "desc" }, take: 100 });
  return NextResponse.json({ assignments });
});

export const POST = withSchoolRoute("assignment.manage", async (request: NextRequest, _context, { db, principal }) => {
  const parsed = schema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !normalizeAttendanceDate(parsed.data?.date ?? "")) return NextResponse.json({ error: "Check the substitute, section, date and reason", fields: parsed.success ? undefined : parsed.error.flatten().fieldErrors }, { status: 400 });
  const input = parsed.data;
  const date = normalizeAttendanceDate(input.date)!;
  const [section, substitute] = await Promise.all([
    db.section.findFirst({ where: { id: input.sectionId, active: true, deletedAt: null }, include: { academicYear: { select: { startsOn: true, endsOn: true } } } }),
    db.user.findFirst({ where: { id: input.userId, status: "ACTIVE", deletedAt: null }, include: { roles: { where: { deletedAt: null }, include: { role: true } } } }),
  ]);
  if (!section || !substitute) return NextResponse.json({ error: "Choose an active staff member and section from this school" }, { status: 404 });
  if (date < section.academicYear.startsOn || date > section.academicYear.endsOn) return NextResponse.json({ error: "Substitute date must be inside the section's academic year" }, { status: 400 });
  if (!substitute.roles.some(({ schoolId, role }) => schoolId === principal.schoolId && role.name === "Substitute")) return NextResponse.json({ error: "Assign the Substitute role before scheduling attendance cover" }, { status: 409 });
  try {
    const assignment = await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "attendance.substitute.assigned", entityType: "SubstituteAssignment", newValue: { sectionId: input.sectionId, userId: input.userId, date: input.date, reason: input.reason } }, async (tx) => tx.substituteAssignment.create({ data: { schoolId: principal.schoolId, sectionId: input.sectionId, userId: input.userId, assignedById: principal.userId, date, reason: input.reason } }));
    return NextResponse.json({ assignment }, { status: 201 });
  } catch {
    return NextResponse.json({ error: "A substitute is already assigned for this section and date" }, { status: 409 });
  }
});

export const DELETE = withSchoolRoute("assignment.manage", async (request, _context, { db, principal }) => {
  const parsed = z.object({ id: z.string().uuid() }).safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Choose a valid substitute assignment" }, { status: 400 });
  const assignment = await db.substituteAssignment.findFirst({ where: { id: parsed.data.id, revokedAt: null } });
  if (!assignment) return NextResponse.json({ error: "Assignment not found" }, { status: 404 });
  await auditedMutation(db, { actorId: principal.userId, activeRole: principal.activeRole, schoolId: principal.schoolId, action: "attendance.substitute.revoked", entityType: "SubstituteAssignment", entityId: assignment.id, oldValue: { sectionId: assignment.sectionId, userId: assignment.userId, date: assignment.date } }, async (tx) => {
    await tx.substituteAssignment.update({ where: { id: assignment.id }, data: { revokedAt: new Date() } });
  });
  return NextResponse.json({ ok: true });
});
