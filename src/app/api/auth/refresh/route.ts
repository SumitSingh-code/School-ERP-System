import { createHash, randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { prisma } from "@/lib/prisma";
import { isDeskSessionIdleExpired } from "@/lib/auth-rules";
import { withPublicRoute } from "@/lib/with-school-route";

const ACCESS_MINUTES = 15;
const STAFF_REFRESH_DAYS = 30;

function clearCookies(response: NextResponse) {
  for (const name of ["school_access", "school_refresh", "school_session"]) {
    response.cookies.set(name, "", { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", maxAge: 0 });
  }
  return response;
}

export const POST = withPublicRoute(async (request: NextRequest) => {
  const refreshToken = request.cookies.get("school_refresh")?.value;
  if (!refreshToken) return clearCookies(NextResponse.json({ error: "Session expired" }, { status: 401 }));

  const oldHash = createHash("sha256").update(refreshToken).digest("hex");
  const session = await prisma.session.findFirst({
    where: { refreshTokenHash: oldHash, revokedAt: null },
    include: { user: { include: { roles: { include: { role: true } } } } },
  });
  if (!session) return NextResponse.json({ error: "Session was already refreshed or revoked" }, { status: 409 });
  const now = new Date();
  const activeRoleStillAssigned = session.user.roles.some(({ role, schoolId }) => schoolId === session.schoolId && role.name === session.activeRole);
  const expired = session.expiresAt <= now || session.user.status !== "ACTIVE" || Boolean(session.user.deletedAt) || !activeRoleStillAssigned || isDeskSessionIdleExpired(session.activeRole, session.lastActivityAt, now);
  if (expired) {
    if (session) await prisma.$transaction(async (tx) => {
      await tx.session.update({ where: { id: session.id, schoolId: session.schoolId }, data: { revokedAt: now } });
      await tx.auditLog.create({ data: {
        actorId: session.userId,
        schoolId: session.schoolId,
        activeRole: session.activeRole,
        action: "auth.session.expired",
        entityType: "Session",
        entityId: session.id,
        newValue: { reason: "expired, inactive, deactivated, role removed, or idle" },
      } });
    });
    return clearCookies(NextResponse.json({ error: "Session expired" }, { status: 401 }));
  }

  const accessToken = randomBytes(32).toString("base64url");
  const nextRefreshToken = randomBytes(48).toString("base64url");
  const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
  const refreshTokenHash = createHash("sha256").update(nextRefreshToken).digest("hex");
  const accessExpiresAt = new Date(now.getTime() + ACCESS_MINUTES * 60 * 1000);
  const expiresAt = new Date(now.getTime() + STAFF_REFRESH_DAYS * 24 * 60 * 60 * 1000);

  const rotated = await prisma.$transaction(async (tx) => {
    const result = await tx.session.updateMany({
      where: { id: session.id, schoolId: session.schoolId, refreshTokenHash: oldHash, revokedAt: null },
      data: { accessTokenHash, accessExpiresAt, refreshTokenHash, expiresAt, lastActivityAt: now },
    });
    if (result.count !== 1) return false;
    await tx.auditLog.create({ data: {
      actorId: session.userId,
      schoolId: session.schoolId,
      activeRole: session.activeRole,
      action: "auth.session.refreshed",
      entityType: "Session",
      entityId: session.id,
      oldValue: { expiresAt: session.expiresAt.toISOString() },
      newValue: { expiresAt: expiresAt.toISOString(), accessExpiresAt: accessExpiresAt.toISOString() },
    } });
    return true;
  });
  if (!rotated) return clearCookies(NextResponse.json({ error: "Session was already refreshed or revoked" }, { status: 409 }));

  const response = NextResponse.json({ ok: true });
  response.cookies.set("school_access", accessToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: accessExpiresAt });
  response.cookies.set("school_refresh", nextRefreshToken, { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax", path: "/", expires: expiresAt });
  return response;
});
