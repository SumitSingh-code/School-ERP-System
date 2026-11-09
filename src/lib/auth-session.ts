import { createHash, randomBytes } from "node:crypto";
import { Prisma } from "@prisma/client";
import type { NextResponse } from "next/server";

export const ACCESS_COOKIE = "school_access";
export const REFRESH_COOKIE = "school_refresh";
export const DEVICE_COOKIE = "school_device";
export const ACCESS_MINUTES = 15;
export const STAFF_REFRESH_DAYS = 30;
export const DEVICE_TRUST_DAYS = 90;

export type IssuedSession = {
  accessToken: string;
  refreshToken: string;
  accessExpiresAt: Date;
  refreshExpiresAt: Date;
  deviceToken: string;
  deviceExpiresAt: Date;
};

export async function issueStaffSession(
  tx: Prisma.TransactionClient,
  input: { userId: string; schoolId: string; activeRole: string; deviceId?: string | null; markOtpVerified?: boolean },
): Promise<IssuedSession> {
  const accessToken = randomBytes(32).toString("base64url");
  const refreshToken = randomBytes(48).toString("base64url");
  const deviceToken = randomBytes(32).toString("base64url");
  const accessExpiresAt = new Date(Date.now() + ACCESS_MINUTES * 60 * 1000);
  const refreshExpiresAt = new Date(Date.now() + STAFF_REFRESH_DAYS * 24 * 60 * 60 * 1000);
  const deviceExpiresAt = new Date(Date.now() + DEVICE_TRUST_DAYS * 24 * 60 * 60 * 1000);

  const deviceData = {
    tokenHash: createHash("sha256").update(deviceToken).digest("hex"),
    lastUsedAt: new Date(),
    expiresAt: deviceExpiresAt,
    ...(input.markOtpVerified ? { otpVerified: true } : {}),
  };
  const device = input.deviceId
    ? await tx.authDevice.update({ where: { id: input.deviceId }, data: deviceData })
    : await tx.authDevice.create({ data: { ...deviceData, otpVerified: input.markOtpVerified ?? false, userId: input.userId, schoolId: input.schoolId } });
  await tx.session.create({
    data: {
      userId: input.userId,
      schoolId: input.schoolId,
      activeRole: input.activeRole,
      authDeviceId: device.id,
      accessTokenHash: createHash("sha256").update(accessToken).digest("hex"),
      accessExpiresAt,
      refreshTokenHash: createHash("sha256").update(refreshToken).digest("hex"),
      expiresAt: refreshExpiresAt,
      lastActivityAt: new Date(),
    },
  });
  await tx.user.update({
    where: { id: input.userId, schoolId: input.schoolId },
    data: { failedLoginCount: 0, lockedUntil: null },
  });
  await tx.auditLog.create({
    data: {
      actorId: input.userId,
      schoolId: input.schoolId,
      activeRole: input.activeRole,
      action: "auth.login.succeeded",
      entityType: "Session",
      newValue: { activeRole: input.activeRole, authDeviceId: device.id },
    },
  });

  return { accessToken, refreshToken, accessExpiresAt, refreshExpiresAt, deviceToken, deviceExpiresAt };
}

export function setSessionCookies(response: NextResponse, issued: IssuedSession) {
  const secure = process.env.NODE_ENV === "production";
  response.cookies.set(ACCESS_COOKIE, issued.accessToken, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: issued.accessExpiresAt });
  response.cookies.set(REFRESH_COOKIE, issued.refreshToken, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: issued.refreshExpiresAt });
  response.cookies.set(DEVICE_COOKIE, issued.deviceToken, { httpOnly: true, secure, sameSite: "lax", path: "/", expires: issued.deviceExpiresAt });
}
