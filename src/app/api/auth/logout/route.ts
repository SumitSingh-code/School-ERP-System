import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { withPublicRoute } from "@/lib/with-school-route";

export const POST = withPublicRoute(async (request: NextRequest) => {
  const token = request.cookies.get("school_refresh")?.value;
  if (token) {
    const refreshTokenHash = createHash("sha256").update(token).digest("hex");
    const session = await prisma.session.findFirst({
      where: { refreshTokenHash, revokedAt: null },
      select: { id: true, userId: true, schoolId: true, activeRole: true },
    });
    if (session) await prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id, schoolId: session.schoolId }, data: { revokedAt: new Date() } });
      await tx.auditLog.create({ data: {
        actorId: session.userId,
        schoolId: session.schoolId,
        activeRole: session.activeRole,
        action: "auth.logout",
        entityType: "Session",
        entityId: session.id,
        newValue: { revoked: true },
      } });
    });
  }

  const response = NextResponse.json({ ok: true });
  for (const name of ["school_access", "school_refresh", "school_session"]) {
    response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
});
