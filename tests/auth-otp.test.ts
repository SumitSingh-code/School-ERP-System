import assert from "node:assert/strict";
import test from "node:test";
import { createOtpCode, hashClientIp, hashOtp, otpChallengeCanBeVerified, otpLimitReached, requestClientIp } from "../src/lib/auth-otp";

test("OTP is six digits, one-time hashes bind challenge and user, and IPs are not stored in plain text", () => {
  process.env.OTP_HASH_SECRET = "test-only-secret-that-is-at-least-32-characters";
  const code = createOtpCode();
  assert.match(code, /^\d{6}$/);
  const digest = hashOtp("challenge-a", "user-a", code);
  assert.equal(digest, hashOtp("challenge-a", "user-a", code));
  assert.notEqual(digest, hashOtp("challenge-b", "user-a", code));
  assert.notEqual(digest, hashOtp("challenge-a", "user-b", code));
  assert.notEqual(hashClientIp("203.0.113.1"), "203.0.113.1");
});

test("OTP request rate limit allows five per hour, then blocks", () => {
  assert.equal(otpLimitReached(4), false);
  assert.equal(otpLimitReached(5), true);
});

test("OTP challenge accepts a live unused challenge and denies expired, consumed, or exhausted challenges", () => {
  const now = new Date("2026-11-09T12:00:00Z");
  const live = { attempts: 0, expiresAt: new Date("2026-11-09T12:05:00Z"), consumedAt: null };
  assert.equal(otpChallengeCanBeVerified(live, now), true);
  assert.equal(otpChallengeCanBeVerified({ ...live, attempts: 3 }, now), false);
  assert.equal(otpChallengeCanBeVerified({ ...live, expiresAt: now }, now), false);
  assert.equal(otpChallengeCanBeVerified({ ...live, consumedAt: now }, now), false);
});

test("client IP uses the first trusted proxy address or fallback", () => {
  assert.equal(requestClientIp(new Headers({ "x-forwarded-for": "203.0.113.2, 10.0.0.1" })), "203.0.113.2");
  assert.equal(requestClientIp(new Headers({ "x-forwarded-for": "203.0.113.2", "x-real-ip": "192.0.2.1" })), "192.0.2.1");
  assert.equal(requestClientIp(new Headers({ "x-real-ip": "192.0.2.1" })), "192.0.2.1");
  assert.equal(requestClientIp(new Headers()), "unknown");
});
