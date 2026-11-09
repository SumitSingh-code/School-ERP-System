import { createHash, randomUUID } from "node:crypto";
import argon2 from "argon2";
import { Prisma } from "@prisma/client";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { isLoginLockActive, normalizeLoginPhone, requiresOtpOnDevice, shouldLockAfterFailedLogin } from "@/lib/auth-rules";
import { createOtpCode, hashClientIp, hashOtp, OTP_LIFETIME_MS, otpLimitReached, requestClientIp } from "@/lib/auth-otp";
import { configuredOtpProvider } from "@/lib/sms/provider";
import { DEVICE_COOKIE, issueStaffSession, setSessionCookies } from "@/lib/auth-session";
import { withPublicRoute } from "@/lib/with-school-route";

const loginSchema = z.object({
  phone: z.string().trim().min(1).max(30),
  password: z.string().min(1).max(200),
});

const MAX_FAILED_LOGINS = 5;

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

  const activeRole = assignments.find(({ role }) => ["Director", "Principal", "Finance"].includes(role.name))?.role.name
    ?? assignments.find(({ role }) => role.name === "Reception")?.role.name
    ?? assignments[0].role.name;
  const rawDeviceToken = request.cookies.get(DEVICE_COOKIE)?.value;
  const deviceHash = rawDeviceToken ? createHash("sha256").update(rawDeviceToken).digest("hex") : null;
  const trustedDevice = deviceHash ? await prisma.authDevice.findFirst({
    where: { userId: user.id, schoolId: user.schoolId, tokenHash: deviceHash, expiresAt: { gt: new Date() }, revokedAt: null },
  }) : null;

  if (requiresOtpOnDevice(assignments.map(({ role }) => role.name), trustedDevice?.otpVerified ?? false)) {
    let otpProvider: ReturnType<typeof configuredOtpProvider>;
    let ipHash: string;
    try {
      otpProvider = configuredOtpProvider();
      ipHash = hashClientIp(requestClientIp(request.headers));
    } catch {
      await prisma.auditLog.create({ data: {
        actorId: user.id,
        schoolId: user.schoolId,
        activeRole,
        action: "auth.otp.unavailable",
        entityType: "User",
        entityId: user.id,
        newValue: { reason: "OTP provider or OTP secret is not configured" },
      } });
      return NextResponse.json({ error: "One-time code delivery is unavailable. Contact the school administrator." }, { status: 503 });
    }
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000);
    const challengeId = randomUUID();
    const code = createOtpCode();
    const expiresAt = new Date(Date.now() + OTP_LIFETIME_MS);
    let admitted = false;
    for (let retry = 0; retry < 3; retry += 1) {
      try {
        admitted = await prisma.$transaction(async (tx) => {
          const [phoneRequests, ipRequests] = await Promise.all([
            tx.otpChallenge.count({ where: { userId: user.id, createdAt: { gte: oneHourAgo } } }),
            tx.otpChallenge.count({ where: { ipHash, createdAt: { gte: oneHourAgo } } }),
          ]);
          if (otpLimitReached(phoneRequests) || otpLimitReached(ipRequests)) return false;
          await tx.otpChallenge.create({ data: {
            id: challengeId,
            userId: user.id,
            schoolId: user.schoolId,
            activeRole,
            codeHash: hashOtp(challengeId, user.id, code),
            ipHash,
            expiresAt,
          } });
          await tx.auditLog.create({ data: {
            actorId: user.id,
            schoolId: user.schoolId,
            activeRole,
            action: "auth.otp.requested",
            entityType: "OtpChallenge",
            entityId: challengeId,
            newValue: { expiresAt, destinationLastTwo: user.phone.slice(-2) },
          } });
          return true;
        }, { isolationLevel: Prisma.TransactionIsolationLevel.Serializable });
        break;
      } catch (error) {
        if ((error as { code?: string }).code !== "P2034") throw error;
        if (retry === 2) return NextResponse.json({ error: "Too many code requests. Try again in an hour." }, { status: 429 });
      }
    }
    if (!admitted) return NextResponse.json({ error: "Too many code requests. Try again in an hour." }, { status: 429 });

    try {
      await otpProvider.sendLoginCode({ phone: user.phone, code });
    } catch {
      await prisma.$transaction(async (tx) => {
        await tx.otpChallenge.updateMany({ where: { id: challengeId, schoolId: user.schoolId, consumedAt: null }, data: { consumedAt: new Date() } });
        await tx.auditLog.create({ data: {
          actorId: user.id,
          schoolId: user.schoolId,
          activeRole,
          action: "auth.otp.delivery_failed",
          entityType: "OtpChallenge",
          entityId: challengeId,
        } });
      });
      return NextResponse.json({ error: "One-time code delivery is unavailable. Contact the school administrator." }, { status: 503 });
    }
    return NextResponse.json({ otpRequired: true, challengeId, destinationHint: `••••${user.phone.slice(-2)}` });
  }

  const issued = await prisma.$transaction((tx) => issueStaffSession(tx, {
    userId: user.id,
    schoolId: user.schoolId,
    activeRole,
    deviceId: trustedDevice?.id,
  }));
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, issued);
  return response;
});
