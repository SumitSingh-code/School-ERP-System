import { test } from "node:test";
import assert from "node:assert/strict";
import { createSchoolRepository, scopedWhere } from "../src/lib/tenant-scope";
import { requireCapability } from "../src/lib/authorization";

test("school scope is required and cannot be overridden", () => {
  assert.throws(() => scopedWhere(undefined), /school scope is required/i);
  assert.throws(() => scopedWhere({ schoolId: "school-a" }, { schoolId: "school-b" }), /does not match/i);
});

test("School A repository cannot return School B records", async () => {
  const records = [
    { id: "a1", schoolId: "school-a", name: "Synthetic A" },
    { id: "b1", schoolId: "school-b", name: "Synthetic B" },
  ];
  const delegate = {
    async findMany({ where }: { where: { schoolId: string } }) {
      return records.filter((record) => record.schoolId === where.schoolId);
    },
  };
  const schoolA = createSchoolRepository(delegate, { schoolId: "school-a" });
  const result = await schoolA.findMany({ where: { name: "Synthetic" } });
  assert.deepEqual(result.map((record) => record.schoolId), ["school-a"]);
});

test("authorization requires the requested capability", () => {
  const principal = { userId: "demo-user", schoolId: "school-a", activeRole: "teacher", capabilities: new Set(["attendance.mark"]) };
  assert.equal(requireCapability(principal, "attendance.mark"), principal);
  assert.throws(() => requireCapability(principal, "fees.collect"), /Forbidden/);
  assert.throws(() => requireCapability(null, "student.read"), /Authentication required/);
});
