export function normalizeLoginPhone(value: string) {
  const digits = value.replace(/[\s()+-]/g, "").replace(/^91/, "").replace(/^0/, "");
  return /^[6-9]\d{9}$/.test(digits) ? digits : null;
}

export function maySwitchRole(assignedRoles: readonly string[], requestedRole: string) {
  return assignedRoles.includes(requestedRole);
}

const COMMON_PASSWORDS = new Set([
  "password", "password1", "12345678", "123456789", "qwerty123", "admin123",
  "iloveyou", "welcome1", "letmein123", "school123", "india123", "changeme",
]);

export function passwordPolicyError(password: string, phone: string) {
  if (password.length < 8) return "Password must be at least 8 characters";
  if (password === phone) return "Password cannot be the same as your phone number";
  if (COMMON_PASSWORDS.has(password.toLowerCase())) return "Choose a less common password";
  return null;
}

export function isLoginLockActive(lockedUntil: Date | null | undefined, now = new Date()) {
  return Boolean(lockedUntil && lockedUntil.getTime() > now.getTime());
}

export function shouldLockAfterFailedLogin(failedLoginCount: number) {
  return failedLoginCount >= 5;
}

export function requiresNewDeviceOtp(roleNames: readonly string[]) {
  return roleNames.some((role) => ["Director", "Principal", "Finance"].includes(role));
}

export function requiresOtpOnDevice(roleNames: readonly string[], deviceOtpVerified: boolean) {
  return requiresNewDeviceOtp(roleNames) && !deviceOtpVerified;
}

export function hasAssignedSchoolRole(
  assignments: Array<{ schoolId: string; roleName: string }>,
  schoolId: string,
  roleName: string,
) {
  return assignments.some((assignment) => assignment.schoolId === schoolId && assignment.roleName === roleName);
}

const DESK_ROLES = new Set(["Director", "Principal", "Reception", "Finance"]);

export function isDeskSessionIdleExpired(activeRole: string, lastActivityAt: Date, now = new Date()) {
  if (!DESK_ROLES.has(activeRole)) return false;
  return now.getTime() - lastActivityAt.getTime() >= 30 * 60 * 1000;
}
