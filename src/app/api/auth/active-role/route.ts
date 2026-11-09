import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { maySwitchRole } from "@/lib/auth-rules";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ role: z.string().trim().min(1).max(80) });

export const POST = withSchoolRoute(null, async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success || !maySwitchRole(principal.roles, parsed.data.role)) {
    return NextResponse.json({ error: "That role is not assigned to your account" }, { status: 403 });
  }

  const token = request.cookies.get("school_access")?.value;
  if (!token) return NextResponse.json({ error: "Authentication required" }, { status: 401 });
  const accessTokenHash = createHash("sha256").update(token).digest("hex");
  const session = await db.session.findFirst({
    where: { userId: principal.userId, accessTokenHash, revokedAt: null },
    select: { id: true, activeRole: true },
  });
  if (!session) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  if (session.activeRole === parsed.data.role) return NextResponse.json({ ok: true, activeRole: session.activeRole });

  await auditedMutation(db, {
    actorId: principal.userId,
    activeRole: session.activeRole,
    schoolId: principal.schoolId,
    action: "auth.active_role.changed",
    entityType: "Session",
    entityId: session.id,
    oldValue: { activeRole: session.activeRole },
    newValue: { activeRole: parsed.data.role },
  }, async (tx) => tx.session.update({
    where: { id: session.id },
    data: { activeRole: parsed.data.role },
  }));

  return NextResponse.json({ ok: true, activeRole: parsed.data.role });
});
