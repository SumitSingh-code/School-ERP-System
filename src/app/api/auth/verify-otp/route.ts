import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { hashOtp, otpChallengeCanBeVerified, OTP_MAX_ATTEMPTS } from "@/lib/auth-otp";
import { hasAssignedSchoolRole } from "@/lib/auth-rules";
import { issueStaffSession, setSessionCookies } from "@/lib/auth-session";
import { prisma } from "@/lib/prisma";
import { withPublicRoute } from "@/lib/with-school-route";

const verifySchema = z.object({
  challengeId: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/),
});

function equalHashes(actual: string, expected: string) {
  const actualBuffer = Buffer.from(actual, "hex");
  const expectedBuffer = Buffer.from(expected, "hex");
  return actualBuffer.length === expectedBuffer.length && timingSafeEqual(actualBuffer, expectedBuffer);
}

export const POST = withPublicRoute(async (request: NextRequest) => {
  const parsed = verifySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "The code is incorrect or expired." }, { status: 401 });

  const challenge = await prisma.otpChallenge.findFirst({ where: { id: parsed.data.challengeId } });
  const now = new Date();
  if (!challenge || !otpChallengeCanBeVerified(challenge, now)) {
    return NextResponse.json({ error: "The code is incorrect or expired." }, { status: 401 });
  }

  const codeHash = hashOtp(challenge.id, challenge.userId, parsed.data.code);
  if (!equalHashes(codeHash, challenge.codeHash)) {
    await prisma.$transaction(async (tx) => {
      const updated = await tx.otpChallenge.updateMany({
        where: {
          id: challenge.id,
          schoolId: challenge.schoolId,
          consumedAt: null,
          expiresAt: { gt: now },
          attempts: { lt: OTP_MAX_ATTEMPTS },
        },
        data: { attempts: { increment: 1 } },
      });
      if (updated.count === 1) {
        await tx.auditLog.create({ data: {
          actorId: challenge.userId,
          schoolId: challenge.schoolId,
          activeRole: challenge.activeRole,
          action: "auth.otp.failed",
          entityType: "OtpChallenge",
          entityId: challenge.id,
          newValue: { attempt: challenge.attempts + 1 },
        } });
      }
    });
    return NextResponse.json({ error: "The code is incorrect or expired." }, { status: 401 });
  }

  const issued = await prisma.$transaction(async (tx) => {
    const consumed = await tx.otpChallenge.updateMany({
      where: {
        id: challenge.id,
        schoolId: challenge.schoolId,
        userId: challenge.userId,
        codeHash,
        consumedAt: null,
        expiresAt: { gt: now },
        attempts: { lt: OTP_MAX_ATTEMPTS },
      },
      data: { consumedAt: now },
    });
    if (consumed.count !== 1) return null;

    const user = await tx.user.findFirst({
      where: { id: challenge.userId, schoolId: challenge.schoolId, status: "ACTIVE", deletedAt: null },
      include: { roles: { include: { role: true } } },
    });
    const roleStillAssigned = hasAssignedSchoolRole(user?.roles.map((assignment) => ({
      schoolId: assignment.schoolId,
      roleName: assignment.role.name,
    })) ?? [], challenge.schoolId, challenge.activeRole);
    if (!user || !roleStillAssigned) {
      await tx.auditLog.create({ data: {
        actorId: challenge.userId,
        schoolId: challenge.schoolId,
        activeRole: challenge.activeRole,
        action: "auth.otp.account_unavailable",
        entityType: "OtpChallenge",
        entityId: challenge.id,
      } });
      return null;
    }

    return issueStaffSession(tx, {
      userId: user.id,
      schoolId: challenge.schoolId,
      activeRole: challenge.activeRole,
      markOtpVerified: true,
    });
  });

  if (!issued) return NextResponse.json({ error: "The code is incorrect or expired." }, { status: 401 });
  const response = NextResponse.json({ ok: true });
  setSessionCookies(response, issued);
  return response;
});
