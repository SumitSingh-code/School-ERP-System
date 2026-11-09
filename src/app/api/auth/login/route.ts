import { createHash, randomBytes } from "node:crypto";
import argon2 from "argon2";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isLoginLockActive, normalizeLoginPhone, requiresNewDeviceOtp, shouldLockAfterFailedLogin } from "@/lib/auth-rules";
import { withPublicRoute } from "@/lib/with-school-route";

const loginSchema = z.object({
  phone: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(200),
});

const ACCESS_COOKIE = "school_access";
const REFRESH_COOKIE = "school_refresh";
const MAX_FAILED_LOGINS = 5;
const ACCESS_MINUTES = 15;
const STAFF_REFRESH_DAYS = 30;

export const POST = withPublicRoute(async (request: NextRequest) => {
  const parsed = loginSchema.safeParse(await request.json().catch(() => null));
  const phone = parsed.success ? normalizeLoginPhone(parsed.data.phone) : null;
  if (!parsed.success || !phone) {
    return NextResponse.json({ error: "Phone number or password is incorrect" }, { status: 401 });
  }

  // Phone is globally unique by schema, so it is the only identifier available
  // before the server can establish the user's school scope.
  const user = await prisma.user.findUnique({ where: { phone } });
  const validPassword = user?.passwordHash ? await argon2.verify(user.passwordHash, parsed.data.password).catch(() => false) : false;
  const lockIsActive = isLoginLockActive(user?.lockedUntil);
  if (!user || !validPassword || user.status !== "ACTIVE" || user.deletedAt || lockIsActive) {
    if (user && user.status === "ACTIVE" && !user.deletedAt) {
      if (!lockIsActive && !validPassword) await prisma.$transaction(async (tx) => {
          if (user.lockedUntil && user.lockedUntil <= new Date()) {
            await tx.user.update({ where: { id: user.id, schoolId: user.schoolId }, data: { failedLoginCount: 0, lockedUntil: null } });
          }
          await tx.user.update({ where: { id: user.id, schoolId: user.schoolId }, data: { failedLoginCount: { increment: 1 } } });
          const latest = await tx.user.findFirst({ where: { id: user.id, schoolId: user.schoolId } });
          const locked = shouldLockAfterFailedLogin(latest?.failedLoginCount ?? MAX_FAILED_LOGINS);
          const lockedUntil = locked ? new Date(Date.now() + 15 * 60 * 1000) : null;
          if (locked) await tx.user.update({ where: { id: user.id, schoolId: user.schoolId }, data: { lockedUntil } });
          await tx.auditLog.create({ data: {
            actorId: user.id,
            schoolId: user.schoolId,
            activeRole: null,
            action: locked ? "auth.login.locked" : "auth.login.failed",
            entityType: "User",
            entityId: user.id,
            newValue: { failedLoginCount: latest?.failedLoginCount ?? MAX_FAILED_LOGINS, lockedUntil },
          } });
        });
    }
    return NextResponse.json({ error: "Phone number or password is incorrect" }, { status: 401 });
  }

  const assignments = await prisma.userRole.findMany({
    where: { userId: user.id, schoolId: user.schoolId },
    include: { role: true },
    orderBy: { roleId: "asc" },
  });
  if (assignments.length === 0) {
    return NextResponse.json({ error: "Your account has no active role. Contact the school administrator." }, { status: 403 });
  }

  if (requiresNewDeviceOtp(assignments.map(({ role }) => role.name))) {
    await prisma.auditLog.create({ data: {
      actorId: user.id,
      schoolId: user.schoolId,
      activeRole: null,
      action: "auth.mfa.required",
      entityType: "User",
      entityId: user.id,
      newValue: { reason: "No verified device-bound OTP flow is configured" },
    } });
    return NextResponse.json({ error: "Your role requires one-time code verification. Contact the school administrator until OTP is configured." }, { status: 503 });
  }

  const activeRole = assignments[0].role.name;
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(48).toString("base64url");
  const accessTokenHash = createHash("sha256").update(accessToken).digest("hex");
  const refreshTokenHash = createHash("sha256").update(refreshToken).digest("hex");
  const now = new Date();
  const accessExpiresAt = new Date(now.getTime() + ACCESS_MINUTES * 60 * 1000);
  const expiresAt = new Date(now.getTime() + STAFF_REFRESH_DAYS * 24 * 60 * 60 * 1000);

  await prisma.$transaction(async (tx) => {
    await tx.session.create({
      data: { userId: user.id, schoolId: user.schoolId, activeRole, accessTokenHash, accessExpiresAt, refreshTokenHash, expiresAt, lastActivityAt: now },
    });
    await tx.user.update({
      where: { id: user.id, schoolId: user.schoolId },
      data: { failedLoginCount: 0, lockedUntil: null },
    });
    await tx.auditLog.create({ data: {
      actorId: user.id,
      schoolId: user.schoolId,
      activeRole,
      action: "auth.login.succeeded",
      entityType: "Session",
      newValue: { activeRole },
    } });
  });

  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, accessToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: accessExpiresAt,
  });
  response.cookies.set(REFRESH_COOKIE, refreshToken, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    expires: expiresAt,
  });
  return response;
});
