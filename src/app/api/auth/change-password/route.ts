import { createHash } from "node:crypto";
import argon2 from "argon2";
import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { auditedMutation } from "@/lib/audited-mutation";
import { passwordPolicyError } from "@/lib/auth-rules";
import { withSchoolRoute } from "@/lib/with-school-route";

const bodySchema = z.object({ currentPassword: z.string().min(1).max(200), newPassword: z.string().min(1).max(200), confirmPassword: z.string().min(1).max(200) });

export const POST = withSchoolRoute(null, async (request: NextRequest, _context, { principal, db }) => {
  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return NextResponse.json({ error: "Enter your current password and a new password" }, { status: 400 });
  if (parsed.data.newPassword !== parsed.data.confirmPassword) return NextResponse.json({ error: "The new passwords do not match" }, { status: 400 });
  const user = await db.user.findFirst({ where: { id: principal.userId, deletedAt: null } });
  if (!user?.passwordHash || !await argon2.verify(user.passwordHash, parsed.data.currentPassword).catch(() => false)) {
    return NextResponse.json({ error: "Current password is incorrect" }, { status: 400 });
  }
  const policyError = passwordPolicyError(parsed.data.newPassword, user.phone);
  if (policyError) return NextResponse.json({ error: policyError }, { status: 400 });
  if (parsed.data.currentPassword === parsed.data.newPassword) return NextResponse.json({ error: "Choose a password you have not just used" }, { status: 400 });
  const token = request.cookies.get("school_access")?.value;
  if (!token) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  const accessTokenHash = createHash("sha256").update(token).digest("hex");
  const currentSession = await db.session.findFirst({ where: { userId: principal.userId, accessTokenHash, revokedAt: null }, select: { id: true } });
  if (!currentSession) return NextResponse.json({ error: "Session expired. Sign in again." }, { status: 401 });
  const passwordHash = await argon2.hash(parsed.data.newPassword, { type: argon2.argon2id });

  await auditedMutation(db, {
    actorId: principal.userId,
    activeRole: principal.activeRole,
    schoolId: principal.schoolId,
    action: "auth.password.changed",
    entityType: "User",
    entityId: principal.userId,
    oldValue: { mustChangePassword: user.mustChangePassword },
    newValue: { mustChangePassword: false },
  }, async (tx) => {
    await tx.user.update({ where: { id: user.id }, data: { passwordHash, mustChangePassword: false, failedLoginCount: 0, lockedUntil: null } });
    const revoked = await tx.session.updateMany({ where: { userId: user.id, id: { not: currentSession.id }, revokedAt: null }, data: { revokedAt: new Date() } });
    if (revoked.count > 0) await tx.auditLog.create({ data: { actorId: user.id, schoolId: principal.schoolId, activeRole: principal.activeRole, action: "auth.sessions.revoked_after_password_change", entityType: "User", entityId: user.id, newValue: { count: revoked.count } } });
  });
  return NextResponse.json({ ok: true });
}, { allowPasswordChange: true });
