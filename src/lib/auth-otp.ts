import { createHmac, randomInt } from "node:crypto";

export const OTP_LIFETIME_MS = 5 * 60 * 1000;
export const OTP_MAX_ATTEMPTS = 3;
export const OTP_MAX_PER_HOUR = 5;

function otpPepper(): string {
  const value = process.env.OTP_HASH_SECRET;
  if (!value || value.length < 32) throw new Error("OTP_HASH_SECRET must contain at least 32 characters");
  return value;
}

export function createOtpCode(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, "0");
}

export function hashOtp(challengeId: string, userId: string, code: string): string {
  return createHmac("sha256", otpPepper()).update(`${challengeId}:${userId}:${code}`).digest("hex");
}

export function hashClientIp(ip: string): string {
  return createHmac("sha256", otpPepper()).update(`ip:${ip}`).digest("hex");
}

export function requestClientIp(headers: Headers): string {
  const realIp = headers.get("x-real-ip")?.trim();
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0]?.trim();
  return realIp || forwarded || "unknown";
}

export function otpLimitReached(countInLastHour: number): boolean {
  return countInLastHour >= OTP_MAX_PER_HOUR;
}

export function otpChallengeCanBeVerified(
  challenge: { attempts: number; expiresAt: Date; consumedAt: Date | null },
  now = new Date(),
): boolean {
  return challenge.consumedAt === null && challenge.expiresAt > now && challenge.attempts < OTP_MAX_ATTEMPTS;
}
