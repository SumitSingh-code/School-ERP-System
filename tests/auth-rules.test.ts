import { test } from "node:test";
import assert from "node:assert/strict";
import { isLoginLockActive, maySwitchRole, normalizeLoginPhone, passwordPolicyError, requiresNewDeviceOtp, shouldLockAfterFailedLogin } from "../src/lib/auth-rules";
import { ROLE_CAPABILITIES } from "../src/lib/role-permissions";

test("login phone accepts Indian 10-digit input and normalizes common prefixes", () => {
  assert.equal(normalizeLoginPhone("98765 43210"), "9876543210");
  assert.equal(normalizeLoginPhone("+91 98765-43210"), "9876543210");
  assert.equal(normalizeLoginPhone("09876543210"), "9876543210");
  assert.equal(normalizeLoginPhone("12345"), null);
  assert.equal(normalizeLoginPhone("5123456789"), null);
});

test("a user can switch only to a role assigned to their own account", () => {
  const schoolAAssignments = ["Teacher", "Class Teacher"];
  const schoolBAssignments = ["Director"];
  assert.equal(maySwitchRole(schoolAAssignments, "Teacher"), true);
  assert.equal(maySwitchRole(schoolAAssignments, "Director"), false);
  assert.equal(maySwitchRole(schoolBAssignments, "Director"), true);
  assert.equal(maySwitchRole([], "Principal"), false);
});

test("password policy rejects short, phone-equal, and common passwords", () => {
  assert.match(passwordPolicyError("short", "9876543210") ?? "", /8 characters/);
  assert.match(passwordPolicyError("9876543210", "9876543210") ?? "", /phone number/);
  assert.match(passwordPolicyError("Password1", "9876543210") ?? "", /common/);
  assert.equal(passwordPolicyError("River-Cedar-71", "9876543210"), null);
});

test("five failed logins trigger a 15 minute account lock", () => {
  const now = new Date("2026-11-09T12:00:00.000Z");
  assert.equal(shouldLockAfterFailedLogin(4), false);
  assert.equal(shouldLockAfterFailedLogin(5), true);
  assert.equal(isLoginLockActive(new Date(now.getTime() + 15 * 60 * 1000), now), true);
  assert.equal(isLoginLockActive(new Date(now.getTime() - 1), now), false);
});

test("privileged roles require OTP on a new device", () => {
  assert.equal(requiresNewDeviceOtp(["Teacher"]), false);
  assert.equal(requiresNewDeviceOtp(["Teacher", "Principal"]), true);
  assert.equal(requiresNewDeviceOtp(["Finance"]), true);
});

test("seeded role capabilities preserve key finance and parent boundaries", () => {
  assert.equal(ROLE_CAPABILITIES.Director.includes("fees.collect"), false);
  assert.equal(ROLE_CAPABILITIES.Finance.includes("fees.collect"), true);
  assert.equal(ROLE_CAPABILITIES.Parent.includes("student.read"), false);
  assert.equal(ROLE_CAPABILITIES.Parent.includes("parent.read"), true);
  assert.equal(ROLE_CAPABILITIES["Class Teacher"].includes("attendance.mark"), true);
});
