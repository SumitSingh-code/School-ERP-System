import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { auditedMutation } from "@/lib/audited-mutation";
import { withSchoolRoute } from "@/lib/with-school-route";

export const POST = withSchoolRoute(null, async (request: NextRequest, _context, { principal, db }) => {
  const token = request.cookies.get("school_session")?.value;
  if (token) {
    const refreshTokenHash = createHash("sha256").update(token).digest("hex");
    const session = await db.session.findFirst({
      where: { userId: principal.userId, refreshTokenHash, revokedAt: null },
      select: { id: true },
    });
    if (session) {
      await auditedMutation(db, {
        actorId: principal.userId,
        activeRole: principal.activeRole,
        schoolId: principal.schoolId,
        action: "auth.logout",
        entityType: "Session",
        entityId: session.id,
        newValue: { revoked: true },
      }, async (tx) => tx.session.update({ where: { id: session.id }, data: { revokedAt: new Date() } }));
    }
  }
  const response = NextResponse.json({ ok: true });
  response.cookies.set("school_session", "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  return response;
});
